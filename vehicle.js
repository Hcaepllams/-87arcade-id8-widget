'use strict';
// Development vehicle runner. Only subscribes/gets SOME/IP fields; never sends diagnostic requests.
const path = require('path');
const kit = process.env.CLUB_KIT || path.join(__dirname, 'source/javascript/kit');
const { Canvas } = require(path.join(kit, 'canvas'));
const signals = require(path.join(kit, 'signals'));
const { ClusterRender } = require('/var/opt/cluster-render/current/cluster_render_client');
const { VehicleData, definitions } = require('./vehicle-data');
const { render } = require('./render');
const layouts = {
    road: { x: 620, y: 125, w: 1000, h: 570 },
    sport: { x: 720, y: 170, w: 800, h: 527 }
};
const data = new VehicleData(), subscriptions = [], log = { info: console.log, warn: console.error };
const cr = new ClusterRender('87-arcade');
let mode = null, modeAt = 0, ref = null, shape = '', stopping = false, canvas;
let wakePending = false;
cr.on('error', e => console.error(String(e)));
cr.on('ready', () => console.log('renderer ready', cr.targets));
cr.on('target', (target, state, holder, reason) => console.log('target', target, state, reason || ''));
cr.connect();
async function start() {
    const byInterface = {};
    for (const [iface, field] of definitions) {
        if (!byInterface[iface]) byInterface[iface] = {};
        byInterface[iface][field] = v => data.receive(field, v);
    }
    byInterface['de.bmw.infotainment.vehicle.Vehicle2'] = {
        statusDisplayKombi: v => {
            const n = v && v.statusDisplayInstrumentPackM;
            if (n === 0 || n === 'KEINE_AENDERUNG') { if (mode) modeAt = Date.now(); return; }
            mode = n === 1 || n === 'STANDARD_VIEW' ? 'road' : n === 2 || n === 3 || n === 'M_VIEW' || n === 'M_VIEW_PLUS' ? 'sport' : null;
            modeAt = Date.now();
        }
    };
    byInterface['de.bmw.infotainment.lifecycle.lifecycle.Lifecycle'] = {
        powerStateDetailed: state => {
            if (['WELCOME_SCREEN', 'GOODBYE_SCREEN', 'SHUTDOWN_MODE_USER_OFF', 'SLEEP_MODE_ALL_OFF'].indexOf(state) >= 0)
                wakePending = true;
            if (state === 'FULL_ON_USER_ON' && wakePending) {
                wakePending = false;
                console.log('ignition wake: request widget recovery');
                cr.wakeWidget();
            }
        }
    };
    for (const iface of Object.keys(byInterface)) {
        const sub = await signals.watch(iface, /\.Lifecycle$/.test(iface) ? 'Front' : '1', byInterface[iface], log, { pollMs: /CDS2$/.test(iface) ? 500 : /TPMS$/.test(iface) ? 10000 : 2000 });
        subscriptions.push(sub);
        if (sub.error) throw Error(iface + ': ' + sub.error);
    }
    console.log('read-only signal subscriptions ready');
}
function stop(code) {
    if (stopping) return;
    stopping = true; clearInterval(timer); cr.close();
    Promise.all(subscriptions.map(s => s.shutdown())).then(() => process.exit(code));
    setTimeout(() => process.exit(code), 1000);
}
const timer = setInterval(() => {
    if (!cr.ready || stopping) return;
    if (!mode || Date.now() - modeAt > 6000) { if (ref) cr.set(ref, { visible: false }); return; }
    const r = layouts[mode], current = data.snapshot(mode);
    if (shape !== mode) {
        // Keep the widget offered while its replacement waits for the first frame.
        const next = cr.image({ target: 'widget', x: r.x, y: r.y, w: r.w, h: r.h, iw: r.w, ih: r.h, klass: 'content', fps: 5, prewarm: true });
        if (!next) return;
        if (ref) cr.drop(ref);
        ref = next;
        shape = mode; canvas = new Canvas(r.w, r.h);
        console.log('layout', mode, JSON.stringify(r));
    }
    try {
        render(canvas, current); cr.set(ref, { visible: true }); cr.pixels(ref, null, Buffer.from(canvas.d));
    } catch (e) { console.error(e.stack); stop(1); }
}, 200);
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
start().catch(e => { console.error(e.stack); stop(1); });
