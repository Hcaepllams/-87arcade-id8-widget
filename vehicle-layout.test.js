'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const idriveApps = process.env.IDRIVE_APPS || path.resolve(__dirname, '../idrive-apps');
const idrive7Apps = process.env.IDRIVE7_APPS || path.resolve(__dirname, '../idrive7-apps');
const simulatorDir = path.resolve(process.env.SIMULATOR_DIR || path.join(__dirname, '../simulator'));
const { ClusterRender } = require(path.join(idriveApps, 'native/cluster-render/js/cluster_render_client'));
const { initial, sample } = process.env.SIMULATOR_DIR || fs.existsSync(simulatorDir)
    ? require(path.join(simulatorDir, 'profiles'))
    : {
        // shortcut: synthetic SPORT inputs for the upload budget test, use SIMULATOR_DIR for full demo profiles.
        initial: { iat: 35, gearbox: 82, pressureFL: 2.35, pressureFR: 2.36, pressureRL: 2.51,
            pressureRR: 2.50, tyreFL: 36, tyreFR: 37, tyreRL: 39, tyreRR: 38 },
        sample(state, seconds) {
            return Object.assign({}, state, {
                valid: true,
                gLat: 0.65 * Math.sin(seconds / 2), gLong: 0.35 * Math.cos(seconds / 3),
                oil: Math.round(98 + 3 * Math.sin(seconds / 20)),
                coolant: Math.round(92 + 2 * Math.sin(seconds / 17)),
                boost: 0.85 + 0.55 * Math.sin(seconds / 4),
                oilPressure: 3.8 + 0.7 * Math.sin(seconds / 5),
                fuelRail: Math.round(170 + 25 * Math.sin(seconds / 4))
            });
        }
    };
const { GHistory } = require('./g-history');
const widget = require('./widget');
let tick, modeChanged, client, probe, exitCode, renders = 0;
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
            render(canvas, sample) {
                renders++;
                widget.render(canvas, sampleData(sample));
                paint(canvas);
            },
            createDiagProbe() {
                probe = {
                    visible: [], power: [], observed: [], started: false, stopped: false,
                    setVisible(value) { this.visible.push(value); },
                    setPowerState(value) { this.power.push(value); },
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
            if (fields.StatusExtDiag) fields.StatusExtDiag({ statusConnectionHSFZ: 1 });
            if (fields.tasuModeStatus) fields.tasuModeStatus(0);
            return { shutdown: async () => {} };
        } };
        if (name.endsWith('/canvas')) return require(path.join(idrive7Apps, 'kit/runtime/canvas'));
        return name.startsWith('./') ? require(path.join(__dirname, name)) : require(name);
    },
    module: { exports: {} }, __dirname, Buffer, console: { log() {}, error(message) { warnings.push(message); } },
    process: { env: {}, on(name, fn) { handlers[name] = fn; }, exit(code) { exitCode = code; } },
    setInterval(fn, ms) { assert.strictEqual(ms, 100); tick = fn; return 1; }, clearInterval() {}, setTimeout() {}
};
(async () => {
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
    sampleData = data => data;

    for (let i = 0; i < 50 && !probe.started; i++) await Promise.resolve();
    assert(probe.started);
    assert(warnings.some(w => w.includes('missing FES')) && warnings.some(w => w.includes('BasicDataSet unavailable')));
    assert(watched.has('de.bmw.infotainment.vehicle.CDS') && watched.has('de.bmw.infotainment.vehicle.TPMS'));
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
    console.log('PASS: expanded ROAD/SPORT geometry and cadence, cold-start layer continuity, reconnect full frames, dirty RGBA, bandwidth, refusal recovery, subscriptions and IPC gate');
    console.log('SPORT peak one-second upload: ' + (peakBytes / 1024).toFixed(1) + ' KiB/s (limit 5500 KiB/s)');
})().catch(e => { console.error(e); process.exitCode = 1; });
