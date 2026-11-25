'use strict';
// Shared vehicle runner for widget rendering, signal subscriptions and optional probes.
const path = require('path');
const { appState } = require('./state');

function uploadFrame(cr, layer) {
    const { canvas, prevPixels, ref } = layer;
    const { w, h, d } = canvas;
    const pixels = Buffer.from(d.buffer, d.byteOffset, d.byteLength);
    if (!prevPixels) {
        if (cr.pixels(ref, null, pixels)) layer.prevPixels = Buffer.from(pixels);
        return;
    }
    if (pixels.equals(prevPixels)) return;

    const next = new Uint32Array(pixels.buffer, pixels.byteOffset, w * h);
    const previous = new Uint32Array(prevPixels.buffer, prevPixels.byteOffset, w * h);
    const rects = [];
    // Separate the changing display regions so their gaps are not uploaded.
    const stripWidth = Math.ceil(w / 3);
    for (let start = 0; start < w; start += stripWidth) {
        const end = Math.min(w, start + stripWidth);
        let left = end, right = -1, top = h, bottom = -1;
        for (let y = 0, row = 0; y < h; y++, row += w) {
            let x = start;
            while (x < end && next[row + x] === previous[row + x]) x++;
            if (x === end) continue;
            let last = end - 1;
            while (last > x && next[row + last] === previous[row + last]) last--;
            left = Math.min(left, x);
            right = Math.max(right, last);
            top = Math.min(top, y);
            bottom = y;
        }
        if (bottom >= 0) rects.push({ x: left, y: top, w: right - left + 1, h: bottom - top + 1 });
    }
    const dirtyBytes = rects.reduce((sum, rect) => sum + rect.w * rect.h * 4, 0);
    if (dirtyBytes + rects.length * 8 >= pixels.length) {
        if (cr.pixels(ref, null, pixels)) pixels.copy(prevPixels);
        return;
    }
    const patch = Buffer.allocUnsafe(dirtyBytes);
    let dest = 0;
    for (const rect of rects) {
        const rowBytes = rect.w * 4;
        for (let y = rect.y; y < rect.y + rect.h; y++) {
            const offset = (y * w + rect.x) * 4;
            pixels.copy(patch, dest, offset, offset + rowBytes);
            dest += rowBytes;
        }
    }
    if (cr.pixels(ref, rects, patch)) pixels.copy(prevPixels);
}

function run(directory, target) {
    const manifest = require(path.join(directory, 'app.json'));
    const plugin = require(path.join(directory, manifest.vehicle));
    const kit = process.env.CLUB_KIT || path.join(directory, 'source/javascript/kit');
    const { Canvas } = require(path.join(kit, 'canvas'));
    const signals = require(path.join(kit, 'signals'));
    const { ClusterRender } = require('/var/opt/cluster-render/current/cluster_render_client');
    const definitions = plugin.signals;
    const render = plugin.render;
    const layouts = {
        road: { x: 560, y: 125, w: 1120, h: 660 },
        sport: { x: 774, y: 170, w: 760, h: 556 }
    };
    const data = plugin.createData(appState(manifest.id)), subscriptions = [], log = { info: console.log, warn: console.error };
    const probe = plugin.createDiagProbe && plugin.createDiagProbe(data, signals, log);
    process.on('message', message => {
        if (message.type !== 'power-state') return;
        if (data.powerState) data.powerState(message.state);
        if (probe) probe.setPowerState(message.state);
    });
    if (probe) process.on('disconnect', () => probe.setPowerState(null));
    const cr = new ClusterRender(manifest.id);
    let mode = null, modeAt = 0, current = null, pending = null, stopping = false, skipRoadTick = false;
    cr.on('error', e => console.error(String(e)));
    cr.on('ready', () => {
        if (current) current.prevPixels = null;
        if (pending) pending.prevPixels = null;
        console.log('renderer ready', cr.targets);
    });
    cr.on('target', (t, state, holder, reason) => {
        console.log('target', t, state, reason || '');
        if (probe && t === target) probe.setVisible(state === 'shown');
    });
    if (probe) cr.on('disconnected', () => probe.setVisible(false));
    function dropPending() {
        const ref = pending.ref;
        pending = null;
        cr.drop(ref);
    }
    cr.on('layer', (ref, state) => {
        if (!pending || pending.ref !== ref) return;
        if (state === 'error') dropPending();
        if (state !== 'shown') return;
        const old = current;
        current = pending;
        pending = null;
        if (old) cr.drop(old.ref);
    });
    cr.on('refused', (op, ref, reason) => {
        if (!pending || pending.ref !== ref) return;
        log.warn(op + ' ' + ref + ': ' + reason);
        dropPending();
    });
    cr.connect();
    async function watch(iface, instance, fields, optional, pollMs) {
        try {
            const sub = await signals.watch(iface, instance, fields, log, pollMs === undefined ? undefined : { pollMs });
            subscriptions.push(sub);
            if (sub.error) throw Error(sub.error);
            if (optional && sub.available === false) log.warn(iface + ': provider currently unavailable');
            return sub;
        } catch (e) {
            if (!optional) throw e;
            log.warn(iface + ': ' + e.message);
        }
    }
    async function start() {
        const byInterface = {};
        for (const [iface, field, , , options] of definitions) {
            const optional = !!(options && options.optional);
            const group = byInterface[iface] || (byInterface[iface] = { fields: {}, optional });
            group.optional = group.optional && optional;
            group.fields[field] = v => data.receive(field, v);
        }
        await watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
            statusDisplayKombi: v => {
                const n = v && v.statusDisplayInstrumentPackM;
                if (n === 0 || n === 'KEINE_AENDERUNG') { if (mode) modeAt = Date.now(); return; }
                const previous = mode;
                mode = n === 1 || n === 'STANDARD_VIEW' ? 'road' : n === 2 || n === 3 || n === 'M_VIEW' || n === 'M_VIEW_PLUS' ? 'sport' : null;
                modeAt = Date.now();
                if (mode !== previous) renderFrame();
            }
        }, false, 2000);
        for (const iface of Object.keys(byInterface)) {
            const { fields, optional } = byInterface[iface];
            await watch(iface, '1', fields, optional, /CDS2$/.test(iface) ? 500 : /TPMS$/.test(iface) ? 10000 : 2000);
        }
        if (probe) {
            await watch('de.bmw.infrastructure.ActivationWireExtDiag', '1', {
                StatusExtDiag: v => probe.observeStatus('extDiagStatus', v)
            }, true, 2000);
            const tasu = await watch('com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu', 'SystemFunctionsInternalTasuInst1', {
                tasuModeStatus: v => probe.observeStatus('tasuModeStatus', v)
            }, true);
            await probe.start(tasu);
        }
        console.log('read-only signal subscriptions ready');
    }
    function stop(code) {
        if (stopping) return;
        stopping = true; clearInterval(timer);
        if (probe) probe.stop();
        cr.close();
        Promise.all(subscriptions.map(s => s.shutdown())).then(() => process.exit(code));
        setTimeout(() => process.exit(code), 1000);
    }
    function renderFrame() {
        if (!cr.ready || stopping) return;
        if (!mode || Date.now() - modeAt > 6000) {
            for (const layer of [current, pending]) {
                if (!layer || !layer.visible) continue;
                layer.visible = false;
                cr.set(layer.ref, { visible: false });
            }
            return;
        }
        if (current && current.mode === mode && pending && pending.mode !== mode) dropPending();
        let layer = pending || current;
        try {
            if (!layer || layer.mode !== mode) {
                const oldPending = pending;
                const r = layouts[mode];
                const ref = cr.image({ target: target, x: r.x, y: r.y, w: r.w, h: r.h, iw: r.w, ih: r.h, klass: 'content', fps: mode === 'sport' ? 10 : 5, prewarm: true });
                if (!ref) return;
                layer = pending = { ref, mode, canvas: new Canvas(r.w, r.h), prevPixels: null, visible: true };
                // image() assigns a local ref before the server accepts the layer.
                if (oldPending && !current) current = oldPending;
                else if (oldPending) cr.drop(oldPending.ref);
                console.log('layout', mode, JSON.stringify(r));
            }
            if (!layer.visible) {
                layer.visible = true;
                cr.set(layer.ref, { visible: true });
            }
            render(layer.canvas, data.snapshot(mode));
            uploadFrame(cr, layer);
            skipRoadTick = mode === 'road';
        } catch (e) { console.error(e.stack); stop(1); }
    }
    const timer = setInterval(() => {
        if (probe) probe.tick();
        if (mode === 'road' && skipRoadTick) { skipRoadTick = false; return; }
        renderFrame();
    }, 100);
    process.on('SIGTERM', () => stop(0));
    process.on('SIGINT', () => stop(0));
    start().catch(e => { console.error(e.stack); stop(1); });

}
module.exports = { run };
if (require.main === module) run(path.resolve(process.argv[2]), process.argv[3]);
