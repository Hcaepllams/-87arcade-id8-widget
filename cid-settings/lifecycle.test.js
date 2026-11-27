'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm'), EventEmitter = require('events');
const { catalog, defaults, copy, validate } = require('../settings');
const { Canvas } = require('./src/canvas');
const logo = require('./src/logo-asset');
const { createHash } = require('crypto');
const { play } = require('./src/record');
const { RenderClient } = require('./src/renderd');
const { Menu, orderedThresholds } = require('./src/menu');
const { Cockpit, placement, claims, CLAIMS } = require('./src/cockpit');

assert.equal(fs.readFileSync(__dirname + '/src/settings.js', 'utf8'), fs.readFileSync(__dirname + '/../settings.js', 'utf8'),
    'Run build.py to refresh the native settings model');

let uploads = 0;
const components = new Map(), written = [];
let app, config = defaults(), revision = 0, saves = 0, opened, rejectSave;
const state = new EventEmitter();
state.updateResources = async () => {};
function component(name) {
    if (!components.has(name)) {
        const c = new EventEmitter();
        c.cells = {};
        c.setValue = async (row, key, value) => { c.cells[key] = value; };
        c.setProperty = async (key, value) => { c[key] = value; };
        components.set(name, c);
    }
    return components.get(name);
}
class Sdk extends EventEmitter {
    constructor() {
        super();
        app = this;
        this.rhmiApplication = new EventEmitter();
        Object.assign(this.rhmiApplication, {
            getByName: name => name === 'ST_Settings' ? state : component(name),
            mapEntryState: async () => {},
            openEntryState: async uuid => { opened = uuid; },
            closeState: async () => { opened = null; }
        });
    }
    start() { return Promise.resolve(); }
    initialized() { return Promise.resolve(); }
    getEntryPoints() {
        return [{ getDescription: () => ({ name: 'arcade_settings', uuid: 'settings-entry' }),
            init: async () => {}, setAvailability: async () => {} }];
    }
}
class RendererWithTestTransport extends RenderClient {
    connect() { this.connected = true; }
    _write(message) {
        const type = message.readUInt32LE(0);
        written.push(type);
        if (type === 9) assert.equal(message.length, 12 + 16 * message.readUInt32LE(8), 'CLAIM rectangles only');
        if (type === 10) {
            assert.deepStrictEqual([4, 8, 12, 16].map(i => message.readUInt32LE(i)),
                [12 + 212 * 89 * 4, logo.id, 212, 89]);
            assert(message.slice(20).equals(logo.data), 'native premultiplied RGBA payload');
            uploads++;
        }
        return true;
    }
}
vm.runInNewContext(fs.readFileSync(__dirname + '/src/main.js', 'utf8'), {
    require(name) {
        if (name === 'oap-sdk/src/core/OnlineApp.js') return Sdk;
        if (name === 'oap-sdk/src/logging/logging') return { getSDKLogger: () => ({ info() {}, warn() {}, error() {} }) };
        if (name === './renderd.js') return { RenderClient: RendererWithTestTransport };
        if (name === './client.js') return { request: async (next, _, {expectedRevision}) => {
            if (next) {
                if (rejectSave) throw Error('settings backend rejected write');
                if (expectedRevision !== revision) throw Object.assign(Error('conflict'), {status: 409, config: copy(config), revision});
                config = validate(next);
                saves++;
                revision++;
            }
            return {config: copy(config), revision};
        } };
        return require(__dirname + '/src/' + name);
    }, setInterval, clearInterval, setTimeout, clearTimeout, process
});

const flush = () => new Promise(setImmediate);
const native = (type, ...words) => {
    const packet = Buffer.alloc(8 + 4 * words.length);
    packet.writeUInt32LE(type, 0);
    packet.writeUInt32LE(4 * words.length, 4);
    words.forEach((word, i) => packet.writeUInt32LE(word, 8 + i * 4));
    app.gpu._data(packet);
};
const touch = (phase, x, y) => {
    const packet = Buffer.alloc(8);
    packet.writeFloatLE(x, 0);
    packet.writeFloatLE(y, 4);
    native(105, phase, packet.readUInt32LE(0), packet.readUInt32LE(4));
};
const tap = async key => {
    const t = app.cockpit.g.targets.find(t => t.key === key);
    assert(t, key + ' can be touched');
    touch(1, t.x + t.w / 2, t.y + t.h / 2);
    touch(3, t.x + t.w / 2, t.y + t.h / 2);
    await flush();
};
const knob = async (turn, press = 0, tilt = 0) => {
    const packet = Buffer.alloc(8);
    packet.writeUInt16BE(turn, 1);
    packet[3] = press;
    packet[4] = tilt;
    native(0x4d520103, packet.readUInt32LE(0), packet.readUInt32LE(4));
    await flush();
};
const row = label => {
    const index = app.rows.findIndex(r => r.label === label);
    assert(index >= 0, label);
    return app.select(index);
};
const face = require('./src/font-cjk.json').sizes[0];
for (const file of fs.readdirSync(__dirname + '/src').filter(p => p.endsWith('.js'))) {
    for (const ch of fs.readFileSync(__dirname + '/src/' + file, 'utf8').match(/[^\x00-\x7f\s]/g) || []) {
        assert(face.glyphs[ch.codePointAt(0)], 'Missing atlas glyph ' + ch + ' in ' + file);
    }
}
assert(face.atlasH <= 1024);

function checkResponsiveControls(width) {
    const config = defaults(), menu = new Menu(config, async next => next);
    const paint = () => ui.frame(menu, '', false);
    const ui = new Cockpit(paint, run => run(), () => {});
    ui.resize(width);
    const recorder = ui.g;
    ui.resize(width);
    assert.strictEqual(ui.g, recorder);
    assert.strictEqual(recorder.w, width);
    const canvas = new Canvas(width, 644), railW = width === 1836 ? 244 : 292;
    const words = paint().words(), floats = new Float32Array(words.buffer, words.byteOffset, words.length);
    const w = width === 1836 ? 168 : 188, h = Math.round(w * 178 / 425);
    const i = words.findIndex((op, index) => op === 18 && words[index + 6] === logo.id);
    assert(i >= 0, 'native IMAGE op and picture id');
    assert.deepStrictEqual(Array.from(floats.slice(i + 1, i + 6)),
        [Math.round((railW - w) / 2), Math.round((102 - h) / 2), w, h, 0]);
    play(words, canvas);
    const hash = createHash('sha256');
    for (let y = 0; y <= 104; y++) hash.update(canvas.d.subarray(y * width * 4, (y * width + railW) * 4));
    // The entire composited header includes transparent edges, red digits and white lettering.
    assert.equal(hash.digest('hex'), width === 1836 ?
        'eb1b9c0b1ecfcdff523787d1e607e5b7ce32bc631882fb848853d738380091a2' :
        '3d8995d344410869f5dd5322370a5df720ce1af69f8bcf81dfe0bf1156d63751');
    let frames = 0, hits = 0;
    function check() {
        const targets = paint().targets;
        assert(targets.length);
        assert.equal(new Set(targets.map(t => t.key)).size, targets.length);
        targets.forEach((t, i) => {
            const id = [width, ui.page, t.key].join('/');
            assert(t.w >= 48 && t.h >= 48, id + ' undersized');
            assert(t.x >= 0 && t.y >= 0 && t.x + t.w <= width && t.y + t.h <= 644, id + ' outside canvas');
            for (const other of targets.slice(i + 1)) {
                assert(t.x + t.w <= other.x || other.x + other.w <= t.x ||
                    t.y + t.h <= other.y || other.y + other.h <= t.y, id + ' overlaps ' + other.key);
            }
        });
        frames++;
        hits += targets.length;
        return targets;
    }
    for (const mode of ['road', 'sport']) {
        ui.openPage(mode);
        const layout = config.modes[mode];
        for (const count of [3, 2, 1]) {
            layout.columns.length = count;
            for (const primary of [null].concat(layout.columns.map((_, i) => i))) {
                layout.primary = primary;
                for (let col = 0; col < count; col++) {
                    ui.columns[mode] = col;
                    layout.columns[col] = {type: 'data', metrics: catalog.map(m => m.key)};
                    ui.group = 'selected';
                    for (const offset of [0, 5, catalog.length - 5]) { ui.offset = offset; check(); }
                    for (const group of ['perf', 'temp', 'pressure', 'tyre']) {
                        ui.group = group;
                        const targets = check();
                        assert.deepStrictEqual(targets.filter(t => t.key.startsWith('metric:')).map(t => t.key),
                            catalog.filter(m => m.group === group).map(m => 'metric:' + m.key));
                    }
                    ui.group = 'selected';
                    layout.columns[col].metrics = [];
                    check();
                    layout.columns[col] = {type: 'tyres', pressure: true, temperature: true};
                    check();
                    layout.columns[col] = {type: 'g'};
                    check();
                }
            }
        }
    }
    ui.openPage('thresholds');
    for (const m of orderedThresholds) {
        ui.metric = m.key;
        ui.thresholdOffset = Math.min(orderedThresholds.indexOf(m), orderedThresholds.length - 8);
        delete config.thresholds[m.key];
        check();
        config.thresholds[m.key] = m.default;
        check();
    }
    ui.openPage('general');
    check();
    config.obdCoexistence = true;
    const restore = check().find(t => t.key === 'restore');
    restore.run();
    assert.deepStrictEqual(check().map(t => t.key), ['cancel', 'confirm']);

    const hasRing = () => ui.g.words().includes(0xf0f4faff);
    assert(!ui.showFocus && !hasRing());
    ui.ccu({frontRotaryEncoderOperation: 0, frontRotaryEncoderPushButton: 0, frontRotaryEncoderDeflection: 0});
    assert(ui.showFocus && hasRing() && ui.focus === 'cancel');
    const cancel = ui.g.targets[0];
    ui.touch(1, cancel.x + 24, cancel.y + 24);
    assert(!ui.showFocus && !hasRing() && ui.focus === 'cancel');
    ui.touch(3, cancel.x + 24, cancel.y + 24);
    assert(!ui.confirm && ui.focus === 'restore');
    console.log(width + 'x644: ' + frames + ' frames, ' + hits + ' target checks, 0 undersized, 0 overlaps, 0 out of bounds');
}

(async () => {
    await app.setup();
    await app.open('settings-entry');
    assert.equal(opened, 'settings-entry');
    assert.equal(component('row0').cells.PrimaryText, '普通模式');
    assert.equal(component('row0').cells.FrequencyText, '3 栏');
    assert(component('row0').cells.FrequencyVisible);
    assert.equal(component('row3').cells.PrimaryText, 'OBD 外设共存');
    assert.equal(component('row3').cells.FrequencyText, '关闭');
    await row('OBD 外设共存');
    assert.strictEqual(config.obdCoexistence, true);
    assert.equal(component('row3').cells.FrequencyText, '开启');
    await row('普通模式');
    await row('第 1 栏');
    assert.equal(component('SettingsTitle').cells.Text, '普通模式 / 第 1 栏 · 数据卡片');
    assert.equal(component('row15').Visible, 0);
    assert(!app.rows.some(r => r.label === '左移'));
    await row('右移');
    assert.equal(app.menu.column, 1);
    assert.equal(config.modes.road.columns[1].type, 'data');
    assert.equal(component('SettingsNotice').cells.Text, '已保存');
    assert.equal(component('SettingsTitle').cells.Text, '普通模式 / 第 2 栏 · 数据卡片');
    await row('返回'); await row('返回'); await row('恢复默认');
    assert.notDeepStrictEqual(config, defaults());
    await row('确认恢复默认');
    assert.deepStrictEqual(config, defaults());

    native(0x4d520101, 1, 2, 3);
    native(101, 4, 1920, 720, 1);
    native(0x4d520102, 2, 1, 1);
    assert(!app.graphical && !app.gpu.ready);
    assert.deepStrictEqual(written, [], 'embed-only renderer receives no layer messages');
    const id8Area = {x: 0, y: 76, w: 2880, h: 764};
    native(0x4d520101, 1, 1, 0x1d, 0, 0, 0, 0, 0, 76, 2880, 764, 2048, 60000);
    native(101, 4, 2880, 960, 1);
    assert.deepStrictEqual(app.gpu.info, {layer: true, touch: true, controller: false, frontGate: true, appArea: id8Area});
    assert(app.gpu.visible);
    native(0x4d520102, 1, 1, 1);
    assert.strictEqual(app.graphical, true);
    assert.strictEqual(app.gpu.grabbing, false);
    assert(!written.includes(0x4d520002), 'touch-only renderer receives no controller grab');
    assert.deepStrictEqual(Array.from(app.cockpit.g.words().slice(0, 2)), [1, 0x050608ff], 'opaque surface clear');
    const placed = app.gpu.placement, rects = JSON.parse(app.gpu.claimed);
    assert.deepStrictEqual(placed, {x: 0, y: 76, w: 2880, h: 764, scale: 764 / 644, logicalW: 2428, ox: 0, oy: 0});
    assert.equal(app.cockpit.g.w, 2428);
    assert.deepStrictEqual(rects, claims(placed));
    const edges = rects.map(r => [
        placed.x + placed.ox + r.x * placed.scale, placed.y + placed.oy + r.y * placed.scale,
        placed.x + placed.ox + (r.x + r.w) * placed.scale, placed.y + placed.oy + (r.y + r.h) * placed.scale
    ].map(Math.round));
    const split = Math.round(76 + 68 * placed.scale);
    assert.deepStrictEqual(edges, [[0, 76, 2880, split], [0, split, 2880, 840]]);
    await tap('tab:general');
    assert.equal(app.cockpit.page, 'general');
    native(106);
    assert(app.visible && !app.graphical && !app.gpu.visible);
    await new Promise(resolve => setTimeout(resolve, 750));
    assert(app.gpu.visible);
    native(0x4d520102, 1, 1, 1);
    assert(app.graphical && !app.gpu.grabbing);
    await tap('tab:road');
    assert.equal(uploads, 1, 'one native image upload across repeated frames');
    app.gpu.emit('close');

    native(0x4d520101, 1, 1, 3, 0, 0, 0, 0, 108, 82, 1790, 638, 2048, 60000);
    native(101, 4, 1920, 720, 1);
    assert.deepStrictEqual(app.gpu.info.appArea, {x: 108, y: 82, w: 1790, h: 638});
    assert.equal(app.gpu.placement.y, 82);
    assert(written.includes(9) && written.includes(4) && written.includes(7), 'claims, atlas and frame uploaded');
    native(0x4d520102, 1, 1, 1);
    assert(app.graphical && app.gpu.grabbing && written.includes(0x4d520002));
    assert(app.cockpit.g.targets.every(t => t.w >= 48 && t.h >= 48));
    assert.deepStrictEqual(placement({w: 1920, h: 720}),
        {x: 84, y: 76, w: 1836, h: 644, scale: 1, logicalW: 1836, ox: 0, oy: 0});
    assert.deepStrictEqual(claims(placement({w: 1920, h: 720})), CLAIMS);
    assert.deepStrictEqual(CLAIMS, [{x: 0, y: 0, w: 1836, h: 68}, {x: 0, y: 68, w: 1836, h: 576}]);
    for (const [screen, area, touchArea] of [
        [{w: 1920, h: 720}, {x: 84, y: 0, w: 1836, h: 720}, {x: 84, y: 0, w: 1836, h: 720}],
        [{w: 1920, h: 720}, {x: 84, y: 0, w: 1836, h: 720}, {x: 84, y: 76, w: 1836, h: 644}],
        [{w: 1920, h: 720}, app.gpu.info.appArea, {x: 84, y: 76, w: 1836, h: 644}],
        [{w: 2880, h: 960}, {x: 0, y: 76, w: 2880, h: 764}, {x: 0, y: 76, w: 2880, h: 764}]
    ]) {
        const p = placement(screen, area);
        const ui = new Cockpit();
        ui.resize(p.logicalW);
        const header = ui.frame(app.menu).targets.filter(t => t.region === 'header');
        assert.deepStrictEqual(header.map(t => t.key), ['tab:road', 'tab:sport', 'tab:thresholds', 'tab:general', 'restore']);
        const rects = claims(p);
        for (const r of rects.concat(header)) {
            assert(p.x + p.ox + r.x * p.scale >= touchArea.x - 1e-6);
            assert(p.y + p.oy + r.y * p.scale >= touchArea.y - 1e-6);
            assert(p.x + p.ox + (r.x + r.w) * p.scale <= touchArea.x + touchArea.w + 1e-6);
            assert(p.y + p.oy + (r.y + r.h) * p.scale <= touchArea.y + touchArea.h + 1e-6);
        }
        for (const t of header) assert(rects.some(r => t.x >= r.x && t.x + t.w <= r.x + r.w &&
            t.y >= r.y && t.y + t.h <= r.y + r.h));
    }
    assert.equal(app.cockpit.g.w, 1836, 'reconnecting to a narrower screen resizes the recorder');
    assert.equal(uploads, 2, 'resized renderer receives its image again');
    [1836, 2428].forEach(checkResponsiveControls);
    app.cockpit.focus = 'tab:road';
    await knob(65535);
    await knob(0);
    assert.equal(app.cockpit.focus, 'tab:sport', 'rotary counter wraps');
    await knob(0, 1);
    assert.equal(app.cockpit.page, 'sport');
    await knob(0, 0, 4);
    assert.equal(app.cockpit.focus, 'type:data', 'tilt east reaches the configuration panel');
    await tap('count:1'); await tap('count:2'); await tap('count:3'); await tap('primary:0');
    assert.equal(config.modes.sport.primary, 0);
    await tap('column:right');
    assert.equal(app.cockpit.focus, 'column:1');
    assert.equal(config.modes.sport.primary, 1);
    await tap('type:data'); await tap('group:perf');
    await tap('metric:speed'); await tap('group:selected'); await tap('up:speed');
    assert.equal(config.modes.sport.columns[1].metrics[1], 'speed');
    await tap('type:tyres'); await tap('tyre:pressure');
    assert(!app.cockpit.g.targets.some(t => t.key === 'tyre:temperature'), 'last tyre channel is disabled');
    await tap('type:g'); await tap('type:data');
    assert.equal(config.modes.sport.columns[1].metrics[1], 'speed');
    await tap('remove:speed');
    assert(!config.modes.sport.columns[1].metrics.includes('speed'));
    assert.equal(app.cockpit.focus, 'remove:coolant');
    await tap('group:pressure');
    await knob(0, 0, 10);
    assert.equal(app.cockpit.group, 'selected', 'tilt west returns from the group');
    await knob(0);

    await tap('tab:thresholds'); await tap('limit:oilPressure'); await tap('limit:enable');
    await tap('low:3'); await tap('high:2');
    assert.deepStrictEqual(config.thresholds.oilPressure, { low: 1.7, high: 6.6 });
    touch(1, 400, 530); touch(2, 400, 260); touch(3, 400, 260);
    assert.equal(app.cockpit.metric, 'oilPressure', 'drag scrolls without choosing a threshold');
    assert.equal(app.cockpit.thresholdOffset, 5);
    assert(app.cockpit.g.targets.some(t => t.key === 'limit:tyrePressure'));
    const canvas = new Canvas(1836, 644);
    play(app.cockpit.g.words(), canvas);
    assert(canvas.png().length > 10000, 'recorded threshold frame renders');
    rejectSave = true;
    await tap('low:2');
    assert.equal(app.notice, '保存失败');
    assert.equal(config.thresholds.oilPressure.low, 1.7);
    rejectSave = false;
    await tap('limit:default');
    await tap('tab:general');
    assert.equal(app.cockpit.page, 'general');
    await knob(0, 0, 7);
    assert.equal(app.cockpit.focus, 'obd-coexistence');
    await knob(0, 1);
    assert.strictEqual(config.obdCoexistence, true);
    await tap('obd-coexistence');
    assert.strictEqual(config.obdCoexistence, false);
    await tap('obd-coexistence');
    assert.strictEqual(config.obdCoexistence, true);
    await tap('restore');
    assert(config.thresholds.oilPressure);
    await tap('cancel');
    assert(config.thresholds.oilPressure);
    assert.strictEqual(config.obdCoexistence, true);
    await tap('restore'); await tap('confirm');
    assert.deepStrictEqual(config, defaults());

    native(0x4d520102, 1, 0, 0);
    assert(!app.graphical && !app.gpu.grabbing, 'hidden layer releases the controller');
    native(0x4d520102, 1, 1, 1);
    assert(app.graphical && app.gpu.grabbing, 'returning to the layer reacquires the controller');
    app.gpu.emit('close');
    assert(!app.graphical && !app.gpu.grabbing);
    await flush();
    await row('颜色阈值');
    assert.equal(app.rows.length, 14);
    assert.deepStrictEqual(app.rows.slice(1, 10).map(r => r.label),
        ['机油温度', '冷却液温度', '变速箱油温', '进气温度', '四轮胎温（共用）', '机油压力', '高压油压', '涡轮增压', '四轮胎压（共用）']);
    await row('机油温度'); await row('低温低于 · +5');
    assert.equal(config.thresholds.oil.low, 75);
    assert.equal(component('SettingsTitle').cells.Text, '颜色阈值 / 机油温度');
    state.emit('visible', { visible: false });
    state.emit('visible', { visible: true });
    await flush();
    assert.equal(app.menu.config.thresholds.oil.low, 75);
    config = copy(config);
    config.thresholds.oil.high = 127;
    revision++;
    await row('低温低于 · +5');
    assert.equal(app.notice, '设置已在其他端更新');
    assert.deepStrictEqual(app.menu.config, config);
    assert.equal(config.thresholds.oil.low, 75);
    await row('低温低于 · +5');
    assert.equal(config.thresholds.oil.low, 80);

    Object.assign(app.menu, { mode: 'road', page: 'choose', column: 2 });
    config = copy(config);
    config.modes.road.columns.length = 1;
    await app.update();
    assert.equal(app.menu.column, 0);
    assert.equal(app.menu.page, 'layout');
    assert.equal(component('SettingsTitle').cells.Text, '普通模式');
    config.modes.road.columns[0] = {type: 'g'};
    await app.update();
    for (const page of ['choose', 'group', 'groups']) {
        app.menu.page = page;
        assert.equal(app.menu.title(), '普通模式 / 第 1 栏 · G 值表');
        assert.equal(app.menu.page, 'card');
        app.menu.page = page;
        assert(app.menu.rows().some(r => r.label === 'G 值表'));
    }
    Object.assign(app.menu, { page: 'metric', metric: 'missing' });
    assert.equal(app.menu.title(), '颜色阈值 / 机油温度');
    assert.equal(app.menu.metric, 'oil');
    assert(saves > 10);
    console.log('PASS: settings entry, ID8 touch-only layer, full-area claims, opaque clear, closed recovery, native dual-column fallback, mgu-render/1 messages, touch, CCU, layout, metrics, thresholds, reset and glyph coverage');
})().catch(e => { console.error(e); process.exitCode = 1; }).then(() => {
    clearInterval(app.heartbeat);
    app.gpu.close();
});
