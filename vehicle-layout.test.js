'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const idriveApps = process.env.IDRIVE_APPS || path.resolve(__dirname, '../idrive-apps');
const idrive7Apps = process.env.IDRIVE7_APPS || path.resolve(__dirname, '../idrive7-apps');
const { ClusterRender } = require(path.join(idriveApps, 'native/cluster-render/js/cluster_render_client'));
let tick, modeChanged, client;
const offered = new Set();
let withdrawals = 0;
class TestClient extends ClusterRender {
    constructor(name) { super(name); client = this; }
    connect() { this.ready = true; this.sock = {}; }
    _pump() {}
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
        if (name.endsWith('/cluster_render_client')) return { ClusterRender: TestClient };
        if (name.endsWith('/signals')) return { watch: async (iface, version, fields) => {
            if (fields.statusDisplayKombi) modeChanged = fields.statusDisplayKombi;
            return { shutdown: async () => {} };
        } };
        if (name.endsWith('/canvas')) return require(path.join(idrive7Apps, 'kit/runtime/canvas'));
        return name.startsWith('./') ? require(path.join(__dirname, name)) : require(name);
    },
    module: { exports: {} }, __dirname, Buffer, console: { log() {}, error: console.error },
    process: { env: {}, on() {}, exit(code) { throw Error('Unexpected exit ' + code); } },
    setInterval(fn) { tick = fn; return 1; }, clearInterval() {}, setTimeout
};
(async () => {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'framework/widgets/runtime.js'), 'utf8'), context);
    context.module.exports.run(__dirname, 'widget');
    for (let i = 0; i < 30 && !modeChanged; i++) await Promise.resolve();
    assert(modeChanged, 'shared runtime establishes mode subscription');
    for (const mode of [1, 2, 1, 3, 1]) {
        modeChanged({ statusDisplayInstrumentPackM: mode }); tick();
        assert.equal(withdrawals, 0, 'switching modes must not leave widget with zero layers');
        assert.equal(client.layers.size, 1, 'old layout released after replacement');
        const layer = Array.from(client.layers.values())[0];
        assert.equal(layer.iw, mode === 1 ? 1000 : 800);
        assert(layer.have, 'replacement receives rendered pixels');
    }
    modeChanged = null;
    context.module.exports.run(__dirname, 'widget1');
    for (let i = 0; i < 30 && !modeChanged; i++) await Promise.resolve();
    modeChanged({ statusDisplayInstrumentPackM: 1 }); tick();
    assert.equal(Array.from(client.layers.values())[0].opts.target, 'widget1', 'same UI runs on a second registered target');
    console.log('PASS: shared runtime, independent target, ROAD/M continuity, dimensions and pixels');
})().catch(e => { console.error(e); process.exitCode = 1; });
