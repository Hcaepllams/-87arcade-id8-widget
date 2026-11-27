"use strict";
const assert = require('assert');
const path = require('path');
const { Canvas } = require(path.resolve(process.env.IDRIVE7_APPS || path.join(__dirname, '../idrive7-apps'), 'kit/runtime/canvas'));
const { render } = require('./render');
const { text, textWidth } = require('./font-draw');
const { defaults, geometry, capacity, dataCard, tyreCard, catalog, validate } = require('./settings');
const { initial, sample } = require('./test-profiles');
const { GHistory } = require('./g-history');
let frames = 0;
for (const mode of ['road', 'sport']) for (const count of [1, 2, 3]) {
    for (const primary of [null, ...Array.from({length: count}, (_, i) => i)]) {
        for (const type of ['data', 'tyres', 'g']) {
            const config = defaults(), layout = config.modes[mode];
            layout.columns = Array.from({length: count}, () => type === 'data' ? dataCard(['oil', 'coolant', 'boost']) : type === 'tyres' ? tyreCard() : {type: 'g'});
            layout.primary = primary;
            const cv = new Canvas(mode === 'sport' ? 760 : 1120, mode === 'sport' ? 556 : 660);
            cv._onText = (s, x, y, size, color, opts) => {
                assert(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(size));
                assert(y >= 152 && y < cv.h, 'text remains below navigation and above bottom edge');
                const width = textWidth(s, size, opts);
                const left = opts && opts.align === 'right' ? x - width : opts && opts.align === 'center' ? x - width / 2 : x;
                assert(left >= 0 && left + width <= cv.w, 'complete text remains in the widget');
            };
            const data = sample(Object.assign({}, initial, {mode, demo: false}), 0);
            render(cv, data, config);
            assert(cv.d.some(Boolean));
            assert(!cv.d.subarray(0, (mode === 'sport' ? 154 : 152) * cv.w * 4).some(Boolean));
            const rects = geometry(mode, layout);
            rects.forEach((r, i) => { assert(r.x >= 0 && r.x + r.w <= cv.w); assert(capacity(mode, layout, i) >= 3); });
            for (const hidden of [Object.assign({}, data, {valid: false}), Object.assign({}, data, {oil: null})]) render(cv, hidden, config);
            frames++;
        }
    }
}
console.log('PASS: ' + frames + ' configured layouts, all card types, navigation clearance and missing values');

const groups = [
    ['oil', 'coolant', 'gearbox', 'iat', 'outside', 'pressureFL', 'tyreFL'],
    ['oilPressure', 'fuelRail', 'boost', 'rpm', 'speed', 'power', 'torque'],
    ['pedal', 'steer', 'battery', 'tank', 'range', 'pressureRR', 'tyreRR']
];
function fullConfig(mode, count) {
    const config = defaults(), layout = config.modes[mode];
    layout.primary = null;
    layout.columns = groups.map(dataCard);
    if (count === 20) layout.columns[2].metrics.pop();
    return validate(config);
}
function trace(mode) {
    const ops = [], staticText = [], liveText = [];
    class ObservedCanvas extends Canvas {
        constructor(w, h) {
            super(w, h);
            this._onText = (...args) => staticText.push(args);
        }
        card(...args) { ops.push(['card', ...args]); super.card(...args); }
        quad(...args) { ops.push(['quad', ...args]); super.quad(...args); }
        arc(...args) { ops.push(['arc', ...args]); super.arc(...args); }
        line(...args) { ops.push(['line', ...args]); super.line(...args); }
        roundRect(...args) { ops.push(['panel', ...args]); super.roundRect(...args); }
        fillRect(...args) { ops.push(['fill', ...args]); super.fillRect(...args); }
        blit(...args) { ops.push(['mark', ...args]); super.blit(...args); }
    }
    const cv = new ObservedCanvas(mode === 'sport' ? 760 : 1120, mode === 'sport' ? 556 : 660);
    cv._onText = (...args) => liveText.push(args);
    return {cv, ops, staticText, liveText};
}
function bounds([s, x, y, size, tint, opts]) {
    const w = textWidth(s, size, opts);
    const left = opts.align === 'right' ? x - w : opts.align === 'center' ? x - w / 2 : x;
    return {left, right: left + w, top: y - size, bottom: y + size * 0.25};
}
for (const mode of ['road', 'sport']) {
    for (const count of [20, 21]) {
        const config = fullConfig(mode, count), layout = config.modes[mode];
        const {cv, ops, staticText, liveText} = trace(mode);
        const data = sample(Object.assign({}, initial, {mode, demo:false, boost:-0.5, rpm:7500, speed:300, steer:-540, torque:-100}), 0);
        render(cv, data, config);
        assert.equal(liveText.length, count);
        assert.equal(staticText.length, count * 2);
        assert.equal(ops.filter(([kind]) => kind === 'card').length, 3);
        assert.equal(ops.filter(op => op[0] === 'fill' && op[5] === '#ffffff14').length, count - 3, 'one divider between compact rows');
        assert.equal(ops.filter(([kind]) => kind === 'panel').length, 0, 'compact rows have no bars');
        assert(!ops.some(([kind]) => kind === 'mark'), 'wordmark leaves the full middle card clear');
        const rects = geometry(mode, layout);
        let i = 0;
        rects.forEach((r, c) => {
            let end = r.y;
            for (const key of layout.columns[c].metrics) {
                const m = catalog.find(metric => metric.key === key);
                assert.equal(staticText[i * 2][0], m.label);
                assert.equal(liveText[i][0], data[key].toFixed(m.decimals));
                const [label, value, unit] = [staticText[i * 2], liveText[i], staticText[i * 2 + 1]].map(bounds);
                assert(label.left > r.x && label.right < value.left && value.right < unit.left && unit.right < r.x + r.w,
                    mode + ' separates label, number and unit for ' + key);
                const top = Math.min(label.top, value.top, unit.top);
                assert(top >= end, mode + ' keeps readings in separate rows');
                end = Math.max(label.bottom, value.bottom, unit.bottom);
                assert(end < r.y + r.h);
                i++;
            }
        });
    }
}
{
    const mode = 'sport', config = defaults(), layout = config.modes[mode];
    const keys = catalog.slice(0, 12).map(m => m.key);
    layout.primary = null;
    layout.columns = [dataCard(keys)];
    const data = sample(Object.assign({}, initial, {mode, demo:false, rpm:7500, boost:-0.5}), 0);
    const wide = trace(mode);
    render(wide.cv, data, validate(config));
    assert.equal(wide.liveText.length, 12);
    assert.equal(new Set(wide.staticText.filter((_, i) => i % 2 === 0).map(args => args[1])).size, 2);
    layout.columns = [layout.columns[0], dataCard([]), {type:'g'}];
    layout.primary = 2;
    const narrow = trace(mode), narrowed = validate(config);
    assert.deepStrictEqual(narrowed.modes.sport.columns[0].metrics, keys);
    render(narrow.cv, data, narrowed);
    assert(narrow.staticText.some(([s, , , , tint]) => s === '+5' && tint === '#9bd7f4'));
    assert(!narrow.staticText.some(([s]) => s === 'RPM'));
    const empty = narrow.staticText.find(([s]) => s === 'NO METRICS');
    const rect = geometry(mode, layout)[1];
    assert.equal(empty[1], rect.x + rect.w / 2);
    assert.equal(empty[5].align, 'center');
    assert.equal(narrow.ops.filter(([kind]) => kind === 'mark').length, 1, 'the empty middle card has room for the mark');
    layout.columns = [dataCard(['boost', 'rpm', 'oilPressure', 'fuelRail', 'pressureFL', 'tyreRR', 'outside']), dataCard([]), {type:'g'}];
    const extremes = trace(mode);
    render(extremes.cv, data, validate(config));
    for (const [i, expected] of ['-0.50','7500'].entries()) {
        const value = extremes.liveText[i];
        assert.equal(value[0], expected);
        assert(bounds(extremes.staticText[i * 2]).right < bounds(value).left);
        assert(bounds(value).right < bounds(extremes.staticText[i * 2 + 1]).left);
    }
    assert(extremes.liveText[0][3] < 38, 'wide boost reading shrinks on the narrow card');
    narrowed.modes.sport.columns = [narrowed.modes.sport.columns[0]];
    narrowed.modes.sport.primary = null;
    const restored = trace(mode);
    render(restored.cv, data, validate(narrowed));
    assert.deepStrictEqual(restored.staticText, wide.staticText, 'widening again restores all original readings and clears the badge');
}
for (const mode of ['road', 'sport']) {
    const config = defaults(), layout = config.modes[mode], chart = trace(mode);
    layout.columns = [tyreCard(), {type:'g'}, dataCard(['boost'])];
    layout.primary = 1;
    const data = Object.assign({}, initial, {mode, valid:true, gLat:0, gLong:1.4,
        gEnvelope:[{lat:0,long:1.4}, {lat:1.4,long:0}, {lat:0,long:-1.4}]});
    render(chart.cv, data, validate(config));
    const circle = chart.ops.find(op => op[0] === 'arc' && op[7] === '#7a869c');
    const [, cx, cy, , radius] = circle;
    const total = chart.liveText.find(([s, x, , size]) => s === '1.40g' && x === cx && size >= 36);
    const r = geometry(mode, layout)[1], directions = chart.liveText.filter(([s, , , size]) => s.endsWith('g') && size === 14);
    assert.equal(directions.length, 4);
    for (const reading of directions.concat([total])) {
        const box = bounds(reading);
        assert(box.left > r.x && box.right < r.x + r.w && box.top > r.y && box.bottom < r.y + r.h);
    }
    assert(bounds(directions[0]).bottom < cy - radius);
    assert(bounds(directions[1]).top > cy + radius);
    assert(bounds(total).top > bounds(directions[1]).bottom && bounds(total).top > cy + radius + 15,
        'total G clears the outer ring, envelope, point halo and bottom direction');
    assert.equal(chart.ops.filter(op => op[0] === 'line' && op[6] === '#aab6ca').length, 4, 'four cardinal notches');
    assert.equal(chart.ops.filter(op => op[0] === 'panel' && op[6] === '#c8d3e3').length, 4, 'four normal tyre capsules');
    assert.equal(chart.ops.filter(op => op[0] === 'quad').length, mode === 'sport' ? 3 : 0);
    assert.equal(chart.ops.filter(([kind]) => kind === 'mark').length, 1);
    if (mode === 'road') {
        const tick = chart.ops.find(op => op[0] === 'fill' && op[5] === '#8da9c2');
        const bar = chart.ops.find(op => op[0] === 'panel' && op[6] === '#151922');
        assert.equal(tick[1], Math.round(bar[1] + bar[3] * (0.5 / 3.5)), 'boost scale marks 0 bar');
    }
    for (const stale of [false, true]) {
        render(chart.cv, Object.assign({}, data, {valid:false,stale}), validate(config));
        const alert = chart.liveText[chart.liveText.length - 1];
        assert.equal(alert[0], stale ? 'DATA STALE' : 'NO DATA');
        assert(bounds(alert).top >= r.y + r.h && bounds(alert).bottom < chart.cv.h);
    }
}
console.log('PASS: 20/21 compact readings, two subcolumns, value fitting, overflow badge, empty card, wheel capsules, boost tick, G-chart separation and alerts');

for (const mode of ['road', 'sport']) {
    const config = defaults(), different = defaults();
    different.thresholds.battery = {low:50, high:100};
    const warm = trace(mode), data = sample(Object.assign({}, initial, {mode}), 5);
    render(warm.cv, data, config);
    const first = Buffer.from(warm.cv.d), ops = warm.ops.length, labels = warm.staticText.length;
    render(warm.cv, data, config);
    assert.equal(warm.staticText.length, labels, 'unchanged config reuses cached labels');
    assert(!warm.ops.slice(ops).some(op => op[0] === 'mark' || op[0] === 'line' || op[0] === 'card'),
        'no panels, wordmark or guides repaint on a cache hit');
    assert(first.equals(Buffer.from(warm.cv.d)));
    render(warm.cv, data, different);
    assert.equal(warm.staticText.length, labels * 2, 'changed config invalidates the scene');
    assert(first.equals(Buffer.from(warm.cv.d)), 'an unrelated setting leaves pixels identical');

    const cv = new Canvas(warm.cv.w, warm.cv.h);
    function measure(rebuild) {
        const start = process.hrtime();
        for (let i = 0; i < 40; i++) render(cv, data, rebuild && i % 2 === 0 ? different : config);
        const [s, ns] = process.hrtime(start);
        return (s * 1000 + ns / 1e6) / 40;
    }
    measure(true); measure(false);
    const uncached = measure(true), cached = measure(false);
    console.log(mode.toUpperCase() + ' 40-frame mean: rebuild ' + uncached.toFixed(3) + ' ms/frame, cached ' + cached.toFixed(3) +
        ' ms/frame (' + (uncached / cached).toFixed(2) + 'x)');
}

// Native atlas blits must match the kit's sampling at subpixel glyph origins.
{
    const reference = new Canvas(200, 80), fast = new Canvas(200, 80);
    for (const offset of [0, 0.25, 0.5, 0.75]) {
        reference.clear(); fast.clear();
        const args = ['-2.40g', 177 + offset, 66 + offset, 56, '#56b8ff9a', {font:'num', align:'right'}];
        text({_blit:reference._blit.bind(reference)}, ...args);
        text(fast, ...args);
        assert(Buffer.from(reference.d).equals(Buffer.from(fast.d)));
    }
}
{
    const config = defaults(), mode = 'sport', display = trace(mode);
    config.thresholds.tyrePressure = {low:2.1, high:2.9};
    config.thresholds.tyreTemp = {low:20, high:85};
    const data = Object.assign({}, initial, {mode, valid:true, tyreFR:18, pressureRL:1.9, tyreRR:90});
    render(display.cv, data, config);
    const capsules = display.ops.filter(op => op[0] === 'panel' && op[3] < 6);
    assert.deepStrictEqual(capsules.map(op => op[6]), ['#c8d3e3', '#56b8ff', '#f0b05c', '#ff423d']);
    render(display.cv, Object.assign({}, data, {intro:0.4}), config);
    const glow = display.ops.filter(op => op[0] === 'panel' && op[3] < 6).slice(-4).map(op => parseInt(op[6].slice(7), 16));
    assert(glow[0] > glow[1] && glow[1] > glow[2] && glow[2] === glow[3], 'front axle lights before rear');
}
for (const mode of ['road', 'sport']) {
    const config = defaults(), display = trace(mode);
    const layout = config.modes[mode];
    layout.primary = 1;
    layout.columns = [tyreCard(), {type:'g'}, dataCard(['boost'])];
    const data = Object.assign({}, initial, {mode, valid:true, boost:0.55});
    render(display.cv, data, config);
    const track = display.ops.find(op => op[0] === 'panel' && op[6] === '#151922');
    const tick = () => display.ops.filter(op => op[0] === 'fill' && op[3] === 2 && op[4] === 9 && op[5] === '#ffffff').pop();
    const liveX = tick()[1];
    for (const t of [0.1, 0.45, 0.85]) {
        display.ops.length = 0;
        render(display.cv, Object.assign({}, data, {intro:t}), config);
        assert.equal(tick()[1], t === 0.1 ? track[1] : t === 0.45 ? track[1] + track[3] - 2 : liveX);
        const arcs = display.ops.filter(op => op[0] === 'arc' && ['#323b4c', '#7a869c'].includes(op[7]));
        assert.equal(arcs.length, t === 0.1 ? 0 : 2);
        assert(arcs.every(op => op[5] === 0 && (t === 0.85 ? op[6] === 360 : op[6] > 0 && op[6] < 360)));
    }
    for (const count of [1, 3]) {
        layout.columns = Array.from({length:count}, () => tyreCard());
        layout.primary = count === 3 ? 1 : null;
        const tyre = trace(mode);
        render(tyre.cv, Object.assign({}, data, {tyreFL:-40, tyreFR:150}), config);
        const capsules = tyre.ops.filter(op => op[0] === 'panel' && op[6] === '#c8d3e3');
        for (let i = 0; i < count; i++) {
            const front = capsules[i * 4], rear = capsules[i * 4 + 3];
            const scale = front[3] / 5, centerY = front[2] + 26 * scale;
            for (const reading of tyre.liveText.slice(i * 16, (i + 1) * 16)) {
                text({_blit(atlas, sx, sy, w, h, x, y, k) {
                    assert(x + w * k < front[1] || x > rear[1] + rear[3] ||
                        y + h * k < centerY - 38 * scale || y > centerY + 38 * scale,
                    mode + ' tyre glyph clears the chassis: ' + reading[0]);
                }}, ...reading);
            }
        }
    }
}

for (const mode of ['road', 'sport']) {
    const config = defaults(), sport = mode === 'sport', cv = new Canvas(sport ? 760 : 1120, sport ? 556 : 660);
    const data = sample(Object.assign({}, initial, {mode}), 3), steps = sport ? 10 : 5;
    render(cv, data, config);
    const steady = Buffer.from(cv.d);
    let previous, renderMs = 0;
    for (let i = 0; i <= steps; i++) {
        const start = process.hrtime();
        render(cv, Object.assign({}, data, {intro:i / steps}), config);
        const elapsed = process.hrtime(start);
        renderMs += elapsed[0] * 1000 + elapsed[1] / 1e6;
        const frame = Buffer.from(cv.d);
        assert(!previous || !frame.equals(previous), mode + ' advances on every scheduled intro frame');
        assert.equal(frame.equals(steady), i === steps, 'only the completed reveal matches the steady-state frame');
        for (const r of geometry(mode, config.modes[mode])) {
            const offset = ((r.y + 20) * cv.w + r.x + 6) * 4;
            assert(frame.slice(offset, offset + 4).equals(steady.slice(offset, offset + 4)), 'stable obsidian background');
        }
        previous = frame;
    }
    console.log(mode.toUpperCase() + ' intro mean (' + (steps + 1) + ' frames including lock-in): ' +
        (renderMs / (steps + 1)).toFixed(3) + ' ms/frame');
    render(cv, Object.assign({}, data, {intro:1.2}), config);
    assert(steady.equals(Buffer.from(cv.d)));
}
console.log('PASS: Road and Sport reveals advance at native cadence and converge byte-for-byte');

if (process.argv.includes('--review')) {
    const fs = require('fs');
    const out = path.resolve(__dirname, '.impeccable/review');
    if (!fs.existsSync(out)) fs.mkdirSync(out, {recursive:true});
    for (const [name, config, intro] of [
        ['road', defaults()], ['sport', defaults()], ['road-20metrics', fullConfig('road', 20)],
        ['sport-intro-30', defaults(), 0.30], ['sport-intro-65', defaults(), 0.65], ['road-intro-40', defaults(), 0.40]
    ]) {
        const mode = name.split('-')[0], cv = new Canvas(mode === 'sport' ? 760 : 1120, mode === 'sport' ? 556 : 660);
        let t = 0, data;
        const history = new GHistory(() => t);
        for (; t <= 10500; t += 100) {
            data = sample(Object.assign({}, initial, {mode}), t / 1000);
            Object.assign(data, history.sample(data.gLat, data.gLong, data.valid));
        }
        render(cv, Object.assign({}, data, {intro}), validate(config));
        fs.writeFileSync(path.join(out, 'cluster-oem-' + name + '.png'), cv.png());
    }
    console.log('Wrote 6 Canvas PNGs to .impeccable/review');
}
