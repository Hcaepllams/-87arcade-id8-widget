'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ClusterRender } = require(path.resolve(process.env.IDRIVE_APPS || path.join(__dirname, '../idrive-apps'), 'native/cluster-render/js/cluster_render_client'));
const { initial, ranges, sample, update } = require('./test-profiles');
const { catalog, defaults, dataCard, tyreCard } = require('./settings');
const canvas = require(path.resolve(process.env.IDRIVE7_APPS || path.join(__dirname, '../idrive7-apps'), 'kit/runtime/canvas'));
const { Canvas } = canvas;
const { GHistory } = require('./g-history');
const widget = require('./widget');
let tick, modeChanged, client, probe, exitCode, renders = 0;
let now = 10000, fixture, renderedSample;
let paint = () => {};
let sampleData = data => data;
const watched = new Map(), handlers = {}, warnings = [];
const offered = new Set();
let withdrawals = 0;
class TestClient extends ClusterRender {
    constructor(name) { super(name); client = this; this.uploads = []; this.wireBytes = 0; }
    connect() {
        this.ready = true;
        this.sock = { write: bytes => { this.wireBytes += bytes.length; return true; } };
    }
    close() { this.ready = false; }
    reconnect() {
        this.close();
        this.emit('disconnected');
        this._event({ ev: 'hello', targets: ['widget'] });
    }
    pixels(ref, rects, data) {
        this.uploads.push({ ref, rects, data: Buffer.from(data) });
        return super.pixels(ref, rects, data);
    }
    layerState(ref, state) { this._event({ ev: 'layer', ref, state }); }
    refuse(ref) { this._event({ ev: 'error', op: 'layer', ref, reason: 'test refusal' }); }
    _send(msg) {
        if (msg.op === 'layer') {
            assert.equal(msg.prewarm, 1, 'replacement keeps offer alive before its first frame');
            offered.add(msg.ref);
        }
        if (msg.op === 'drop') {
            offered.delete(msg.ref);
            if (!offered.size) withdrawals++;
        }
    }
}
const context = {
    require(name) {
        if (name === './state') return { appState: () => ({ boot: 'test', load: () => null, save() {} }) };
        if (name.endsWith('/cluster_render_client')) return { ClusterRender: TestClient };
        if (name.endsWith('/widget.js')) return Object.assign({}, widget, {
            createData(storage) { return fixture || widget.createData(storage); },
            render(canvas, sample, settings) {
                renderedSample = sample;
                renders++;
                widget.render(canvas, sampleData(sample), settings);
                paint(canvas);
            },
            createDiagProbe() {
                probe = {
                    visible: [], power: [], coexistence: [], observed: [], started: false, stopped: false,
                    setVisible(value) { this.visible.push(value); },
                    setPowerState(value) { this.power.push(value); },
                    setCoexistence(value) { this.coexistence.push(value); },
                    observeStatus(key, value) { this.observed.push([key, value]); },
                    start(subscription) { this.started = subscription; },
                    stop() { this.stopped = true; },
                    tick() {}
                };
                return probe;
            }
        });
        if (name.endsWith('/signals')) return { watch: async (iface, instance, fields, log, opts) => {
            watched.set(iface, { instance, fields, opts });
            if (fields.statusDisplayKombi) modeChanged = fields.statusDisplayKombi;
            if (fields.statusSwitchDriveDynamicSport2) throw Error('test missing FES config');
            if (fields.basicDataSet) return { error: 'test BasicDataSet unavailable', shutdown: async () => {} };
            if (fields.AngleAcceleratorPedal) throw Error('test accelerator pedal unavailable');
            if (fields.StatusExtDiag) fields.StatusExtDiag({ statusConnectionHSFZ: 1 });
            if (fields.tasuModeStatus) fields.tasuModeStatus(0);
            return { shutdown: async () => {} };
        } };
        if (name.endsWith('/canvas')) return canvas;
        return name.startsWith('./') ? require(path.join(__dirname, name)) : require(name);
    },
    Date: {now: () => now}, module: { exports: {} }, __dirname, Buffer, console: { log() {}, error(message) { warnings.push(message); } },
    process: { env: {}, on(name, fn) { handlers[name] = fn; }, exit(code) { exitCode = code; } },
    setInterval(fn, ms) { assert.strictEqual(ms, 100); tick = fn; return 1; }, clearInterval() {}, setTimeout() {}
};
(async () => {
    if (ranges) for (const {key} of catalog) {
        assert(Number.isFinite(sample(update(initial, {demo:false}), 0)[key]), key + ' manual initial value');
        const values = [0, 5, 10, 30, 60].map(t => sample(initial, t)[key]);
        assert(values.every(Number.isFinite) && new Set(values).size > 1, key + ' changing demo values');
        if (key !== 'gTotal') {
            assert(values.every(v => v >= ranges[key][0] && v <= ranges[key][1]), key + ' demo range');
            assert.equal(sample(update(initial, {[key]:ranges[key][0], demo:false}), 0)[key], ranges[key][0]);
        }
    }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, './framework/widgets/runtime.js'), 'utf8'), context);
    context.module.exports.run(__dirname, 'widget');
    for (let i = 0; i < 30 && !modeChanged; i++) await Promise.resolve();
    assert(modeChanged, 'shared runtime establishes mode subscription');

    function assertReconnectFrame(previous) {
        const before = client.uploads.length;
        client.reconnect();
        tick(); tick();
        assert.strictEqual(client.uploads.length, before + 1, 'ready resends a static frame once');
        const upload = client.uploads[before];
        assert.strictEqual(upload.ref, previous.ref);
        assert.strictEqual(upload.rects, null);
        assert.deepStrictEqual(upload.data, previous.data);
    }

    modeChanged({ statusDisplayInstrumentPackM: 1 });
    const coldRoad = client.uploads[0].ref;
    client.layerState(coldRoad, 'waiting');
    modeChanged({ statusDisplayInstrumentPackM: 2 });
    client.refuse(client.uploads[1].ref);
    assert(client.layers.has(coldRoad), 'a refused replacement keeps the cold-start offer');
    modeChanged({ statusDisplayInstrumentPackM: 1 });
    modeChanged({ statusDisplayInstrumentPackM: 2 });
    modeChanged({ statusDisplayInstrumentPackM: 1 });
    modeChanged({ statusDisplayInstrumentPackM: 2 });
    const coldSport = client.uploads[client.uploads.length - 1];
    assert(client.layers.has(coldRoad), 'the cold-start layer stays until the replacement is shown');
    assert.strictEqual(withdrawals, 0, 'repeated switches before shown keep an offer alive');
    client.layerState(coldSport.ref, 'waiting');
    assertReconnectFrame(coldSport);
    client.layerState(coldSport.ref, 'shown');
    assert(!client.layers.has(coldRoad));

    let current = coldSport.ref;
    for (const mode of [1, 2, 1, 3, 1]) {
        const beforeChange = client.uploads.length;
        modeChanged({ statusDisplayInstrumentPackM: mode });
        assert.equal(client.uploads.length - beforeChange, 1, 'first frame is immediate on a mode switch');
        const upload = client.uploads[beforeChange], ref = upload.ref;
        assert.strictEqual(upload.rects, null);
        assert.equal(withdrawals, 0, 'switching modes must not leave widget with zero layers');
        if (current) {
            client.layerState(ref, 'waiting');
            assert(client.layers.has(current), 'keep the old layer while the server readies the new one');
        }
        const layer = client.layers.get(ref);
        const expectedLayout = mode === 1 ? [560, 125, 1120, 660] : [774, 170, 760, 556];
        assert.deepStrictEqual([layer.opts.x, layer.opts.y, layer.opts.w, layer.opts.h], expectedLayout);
        assert.deepStrictEqual([layer.iw, layer.ih], expectedLayout.slice(2));
        assert.equal(layer.opts.fps, mode === 1 ? 5 : 10);
        assert(layer.have, 'replacement receives rendered pixels');
        client.layerState(ref, 'shown');
        current = ref;
        assert.equal(client.layers.size, 1, 'shown confirmation releases the old layer');
        const beforeTicks = renders;
        for (let i = 0; i < 10; i++) tick();
        assert.equal(renders - beforeTicks, mode === 1 ? 5 : 10);
        assert.equal(client.uploads.length - beforeChange, 1, 'identical frames need no upload');
    }

    modeChanged({ statusDisplayInstrumentPackM: 2 });
    const refused = client.uploads[client.uploads.length - 1].ref;
    client.refuse(refused);
    assert(!client.layers.has(refused));
    assert(client.layers.has(current), 'an asynchronous server refusal keeps the accepted layer');
    tick();
    const replacement = client.uploads[client.uploads.length - 1];
    assert.notStrictEqual(replacement.ref, refused, 'a refusal allows a fresh attempt');
    assert.strictEqual(replacement.rects, null, 'a rebuilt layer starts with a whole frame');
    client.layerState(refused, 'shown');
    assert(client.layers.has(current), 'late events for refused layers do not complete the handoff');
    client.layerState(replacement.ref, 'shown');
    assert(!client.layers.has(current));
    assert.strictEqual(withdrawals, 0);

    const expected = Buffer.from(replacement.data);
    const stride = client.layers.get(replacement.ref).iw;
    const a = (3 * stride + 10) * 4, b = (5 * stride + 12) * 4;
    const farX = stride - 20, c = (4 * stride + farX) * 4;
    expected[a + 1] ^= 0xFF;
    expected[b + 3] ^= 0xFF;
    expected[c] ^= 0xFF;
    paint = cv => { cv.d[a + 1] ^= 0xFF; cv.d[b + 3] ^= 0xFF; cv.d[c] ^= 0xFF; };
    tick();
    const dirty = client.uploads[client.uploads.length - 1];
    assert.strictEqual(dirty.ref, replacement.ref);
    assert.strictEqual(JSON.stringify(dirty.rects), JSON.stringify([
        { x: 10, y: 3, w: 3, h: 3 }, { x: farX, y: 4, w: 1, h: 1 }
    ]));
    const rows = [3, 4, 5].map(y => expected.slice((y * stride + 10) * 4, (y * stride + 13) * 4));
    rows.push(expected.slice(c, c + 4));
    assert.deepStrictEqual(dirty.data, Buffer.concat(rows), 'patch contains contiguous rows of RGBA');
    assert.deepStrictEqual(client.layers.get(replacement.ref).image, expected, 'the client reconstructs the whole image');
    paint = () => {};
    tick();
    assert.deepStrictEqual(client.layers.get(replacement.ref).image, replacement.data, 'cleared pixels are also uploaded');
    const unchanged = client.uploads.length;
    tick();
    assert.strictEqual(client.uploads.length, unchanged);
    assertReconnectFrame(replacement);

    const sport = Object.assign({}, initial, { mode: 'sport' });
    let frame = 0, peakBytes = 0;
    const history = new GHistory(() => frame * 100);
    sampleData = () => {
        const data = sample(sport, frame / 10);
        return Object.assign(data, history.sample(data.gLat, data.gLong, data.valid));
    };
    const recentBytes = [];
    for (; frame < 50; frame++) {
        const before = client.wireBytes;
        tick();
        recentBytes.push(client.wireBytes - before);
        if (recentBytes.length > 10) recentBytes.shift();
        const bytesInWindow = recentBytes.reduce((sum, bytes) => sum + bytes, 0);
        peakBytes = Math.max(peakBytes, bytesInWindow);
        assert(bytesInWindow <= 5500 * 1024,
            'SPORT demo data stays within the one-second upload budget');
    }
    const preferences = require('./settings').defaults();
    handlers.message({type: 'widget-settings', config: preferences});
    const configuredFrame = client.uploads[client.uploads.length - 1];
    assert(!configuredFrame.data.equals(replacement.data), 'settings IPC immediately changes the real widget output');
    const savedShape = client.layers.get(configuredFrame.ref);
    assert.equal(savedShape.opts.w, 760, 'settings do not replace the registered widget or resize its target');
    for (const type of ['data', 'g']) {
        const custom = require('./settings').defaults();
        custom.modes.sport.columns = Array.from({length: 3}, () => type === 'data'
            ? {type: 'data', metrics: ['oil', 'coolant', 'boost', 'fuelRail']} : {type: 'g'});
        custom.modes.sport.primary = null;
        handlers.message({type: 'widget-settings', config: custom});
        const bytes = [];
        for (let i = 0; i < 30; i++) {
            const before = client.wireBytes;
            tick(); frame++;
            bytes.push(client.wireBytes - before);
            if (bytes.length > 10) bytes.shift();
            assert(bytes.reduce((a, b) => a + b, 0) <= 5500 * 1024, 'configured cards fit the one-second upload budget');
        }
    }
    handlers.message({type: 'widget-settings', config: Object.assign({}, preferences, {obdCoexistence: true})});
    assert.strictEqual(probe.coexistence[probe.coexistence.length - 1], true);
    handlers.message({type: 'widget-settings', config: undefined});
    assert.strictEqual(probe.coexistence[probe.coexistence.length - 1], false);
    sampleData = data => data;

    await new Promise(setImmediate);
    assert(probe.started);
    assert(warnings.some(w => w.includes('missing FES')) && warnings.some(w => w.includes('BasicDataSet unavailable')));
    assert(warnings.some(w => w.includes('accelerator pedal unavailable')), 'missing new optional provider leaves the existing probe active');
    assert(watched.has('de.bmw.infotainment.vehicle.CDS') && watched.has('de.bmw.infotainment.vehicle.TPMS'));
    const cds = watched.get('de.bmw.infotainment.vehicle.CDS').fields;
    assert(cds.statusEngineTemperature && cds.statusEngineSpeed2 && cds.statusBattery2);
    const vehicle = watched.get('de.bmw.infotainment.vehicle.Vehicle2').fields;
    assert(vehicle.statusCarSpeed2 && vehicle.statusDisplayKombi, 'mode and speed share the Vehicle2 proxy');
    assert(watched.get('de.bmw.chassis.SteeringAngle').fields.ActualSteeringAngleDriver);
    assert(watched.get('de.bmw.infrastructure.EnvironmentalInformation').fields.ExteriorTemperature);
    assert(watched.get('de.bmw.infotainment.KombiIF').fields.statusRangeTankStatus);
    const tasu = watched.get('com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu');
    assert.strictEqual(tasu.instance, 'SystemFunctionsInternalTasuInst1');
    assert.strictEqual(tasu.opts, undefined, 'TASU keeps its subscription without polling');
    assert.strictEqual(watched.get('de.bmw.infrastructure.ActivationWireExtDiag').opts.pollMs, 2000);
    assert.deepStrictEqual(probe.observed, [['extDiagStatus', { statusConnectionHSFZ: 1 }], ['tasuModeStatus', 0]]);
    client.emit('target', 'widget1', 'shown');
    client.emit('target', 'widget', 'shown');
    client.emit('target', 'widget', 'offered');
    client.emit('target', 'widget', 'shown');
    client.emit('disconnected');
    assert.deepStrictEqual(probe.visible, [false, false, true, false, true, false], 'only this target in shown state enables the probe');
    handlers.message({ type: 'power-state', state: 'FULL_ON_USER_ON' });
    handlers.message({ type: 'power-state', state: 'SHUTDOWN_MODE_USER_OFF' });
    handlers.message({ type: 'power-state', state: 'FULL_ON_USER_ON' });
    handlers.disconnect();
    assert.deepStrictEqual(probe.power, ['FULL_ON_USER_ON', 'SHUTDOWN_MODE_USER_OFF', 'FULL_ON_USER_ON', null]);
    handlers.SIGTERM();
    assert(probe.stopped);
    for (let i = 0; i < 20 && exitCode === undefined; i++) await Promise.resolve();
    assert.strictEqual(exitCode, 0);

    modeChanged = null;
    context.module.exports.run(__dirname, 'widget1');
    for (let i = 0; i < 30 && !modeChanged; i++) await Promise.resolve();
    modeChanged({ statusDisplayInstrumentPackM: 1 }); tick();
    assert.equal(Array.from(client.layers.values())[0].opts.target, 'widget1', 'same UI runs on a second registered target');
    async function verifyReveal(mode, name, config) {
        const sport = mode === 'sport', step = sport ? 100 : 200;
        const start = now, state = Object.assign({}, initial, {mode});
        const history = new GHistory(() => now);
        let snapshot;
        function advanceData() {
            const live = sample(state, (now - start) / 1000);
            snapshot = Object.freeze(Object.assign(live, history.sample(live.gLat, live.gLong, live.valid)));
        }
        advanceData();
        fixture = {snapshot: () => snapshot};
        modeChanged = null;
        context.module.exports.run(__dirname, 'widget');
        for (let i = 0; i < 30 && !modeChanged; i++) await Promise.resolve();
        if (config) handlers.message({type:'widget-settings', config});
        modeChanged({statusDisplayInstrumentPackM: sport ? 2 : 1});
        const ref = client.uploads[0].ref, layer = client.layers.get(ref);
        const control = new Canvas(layer.iw, layer.ih);
        const buckets = [];
        let lastBytes = 0, introPeak = 0, steadyPeak = 0;
        assert.strictEqual(renderedSample, snapshot, 'before first appearance use the original snapshot');
        client.layerState(ref, 'shown');
        client.emit('target', 'widget1', 'shown');
        assert.equal(client.uploads.length, 1);
        client.emit('target', 'widget', 'shown');
        assert.strictEqual(renderedSample.intro, 0);
        for (let ms = 0; ms <= 5000; ms += 100) {
            now = start + ms;
            if (ms) { advanceData(); tick(); }
            if (ms === 400 || ms === 1200) {
                const before = renders;
                client.emit('target', 'widget', 'offered');
                client.emit('target', 'widget', 'shown');
                assert.equal(renders, before, 'widget navigation never restarts the sweep');
            }
            if (ms % step === 0) {
                if (ms <= 1000) assert.equal(renderedSample.intro, ms / 1000);
                else assert.strictEqual(renderedSample, snapshot, 'steady state passes the original snapshot through');
                // Reconstructing every normal draw also checks the final patch on the live layer.
                widget.render(control, ms < 1000 ? Object.assign({}, snapshot, {intro:ms / 1000}) : snapshot, config);
                assert(layer.image.equals(Buffer.from(control.d)), mode + ' patch reconstruction at ' + ms);
            }
            // The first window includes the full prewarm upload and the target-shown patch.
            buckets.push(client.wireBytes - lastBytes);
            lastBytes = client.wireBytes;
            if (buckets.length > 10) buckets.shift();
            const bytes = buckets.reduce((a, b) => a + b, 0);
            if (ms < 2000) introPeak = Math.max(introPeak, bytes);
            else steadyPeak = Math.max(steadyPeak, bytes);
            assert(bytes <= 5500 * 1024, mode + ' ' + name + ' at ' + ms + ' ms: ' + bytes / 1024 + ' KiB/s');
        }
        const before = client.wireBytes;
        for (let i = 0; i < 10; i++) tick();
        assert.equal(client.wireBytes, before, 'unchanged data uploads zero bytes');
        handlers.message({type:'power-state', state:'SLEEP_MODE_ALL_OFF'});
        client.emit('target', 'widget', 'shown');
        assert.strictEqual(renderedSample, snapshot);
        handlers.message({type:'power-state', state:'FULL_ON_USER_ON'});
        client.emit('target', 'widget', 'shown');
        assert.equal(renderedSample.intro, 0, 'the next ignition rearms first appearance');
        if (name === 'default') {
            modeChanged({statusDisplayInstrumentPackM:'KEINE_AENDERUNG'});
            const traffic = [client.wireBytes - before];
            let deferred = false;
            for (let ms = 100; ms <= 1800; ms += 100) {
                now += 100;
                const ink = [Math.min(ms / 100, 9), 0, 0, 255];
                paint = canvas => canvas.clear(ink);
                const previous = client.wireBytes;
                tick();
                traffic.push(client.wireBytes - previous);
                if (traffic.length > 10) traffic.shift();
                assert(traffic.reduce((a, b) => a + b, 0) <= 5500 * 1024, 'hard limit on full-surface changes');
                if (ms % step === 0 && ms < 900 && layer.image[0] !== ink[0]) deferred = true;
            }
            assert(deferred, 'excess traffic was coalesced');
            assert(layer.image.equals(Buffer.from(control.clear([9, 0, 0, 255]).d)), 'latest pixels arrive after saturation');
            paint = () => {};
        }
        console.log(mode.toUpperCase() + ' ' + name + ' peak KiB/s: intro ' + (introPeak / 1024).toFixed(1) +
            ', steady ' + (steadyPeak / 1024).toFixed(1) + ', unchanged 0');
    }
    for (const mode of ['road', 'sport']) {
        await verifyReveal(mode, 'default', defaults());
        await verifyReveal(mode, 'legacy', undefined);
        for (const count of [1, 2]) {
            const config = defaults();
            config.modes[mode].primary = 0;
            config.modes[mode].columns = Array.from({length:count}, () => ({type:'g'}));
            await verifyReveal(mode, count + ' large G', config);
        }
        for (const type of ['bars', 'compact', 'g', 'tyres']) {
            const config = defaults(), layout = config.modes[mode];
            layout.primary = null;
            layout.columns = [0, 1, 2].map(i => type === 'g' ? {type} : type === 'tyres' ? tyreCard() :
                dataCard(type === 'bars' ? ['rpm', 'boost', 'torque', 'pedal'] : catalog.slice(i * 7, i * 7 + 7).map(m => m.key)));
            await verifyReveal(mode, type, config);
        }
    }
    console.log('PASS: expanded ROAD/SPORT geometry and cadence, cold-start layer continuity, reconnect full frames, dirty RGBA, bandwidth, refusal recovery, subscriptions and IPC gate');
    console.log('SPORT peak one-second upload: ' + (peakBytes / 1024).toFixed(1) + ' KiB/s (limit 5500 KiB/s)');
})().catch(e => { console.error(e); process.exitCode = 1; });
