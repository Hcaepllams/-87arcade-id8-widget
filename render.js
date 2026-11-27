'use strict';
// Shared drawing function for the preview and vehicle runner.
// Drawing uses idrive7-apps' Canvas; pixels travel through the upstream ClusterRender client.
const fs = require('fs');
const style = require('./cluster-draw');
const path = require('path');
const { thresholdCatalog } = require('./settings');
const { GHistory } = require('./g-history');
const { text, textWidth } = require('./font-draw');
const logo = require('./assets/logo.json');
const pixels = fs.readFileSync(path.join(__dirname, 'assets/logo.rgba'));
// Sample only the original wordmark; leave the supplied logo asset untouched.
const wordmark = { x: 35, y: 252, width: 425, height: 178 };
const titlePixels = Buffer.alloc(wordmark.width * wordmark.height * 4);
for (let y = 0; y < wordmark.height; y++) {
    const start = ((wordmark.y + y) * logo.width + wordmark.x) * 4;
    pixels.copy(titlePixels, y * wordmark.width * 4, start, start + wordmark.width * 4);
}
// The PDF export has a black matte. Recover straight alpha once at source resolution.
for (let i = 0; i < titlePixels.length; i += 4) {
    const alpha = Math.max(titlePixels[i], titlePixels[i + 1], titlePixels[i + 2]);
    titlePixels[i + 3] = alpha;
    if (alpha) {
        for (let channel = 0; channel < 3; channel++) {
            titlePixels[i + channel] = Math.round(titlePixels[i + channel] * 255 / alpha);
        }
    }
}

const C = {
    text: '#ffffff', dim: '#9ea8b8', missing: '#7890a6', hot: '#ff423d', blue: '#56b8ff',
    zero: '#8da9c2', gold: '#f0b46c', red: '#e5202b'
};
const fmt = (v, n) => Number.isFinite(v) ? v.toFixed(n) : '--';
const num = { font: 'num' };
const clamp = (v, min, max) => Math.max(min, Math.min(v, max));

// Preview defaults from M Vitals thermal tiles/oilWarn, not vehicle-calibrated limits.
const temperatureLimits = { oil: { cold: 70, hot: 125 }, coolant: { cold: 60, hot: 112 } };
function temperatureStyle(key, value) {
    if (!Number.isFinite(value)) return { color: C.dim, label: '' };
    const limit = temperatureLimits[key];
    if (value < limit.cold) return { color: C.blue, label: 'COLD' };
    if (value >= limit.hot) return { color: C.hot, label: 'HOT' };
    return { color: C.text, label: '' };
}

function wheelReading(cv, number, unit, x, y, size, unitSize, gap, color) {
    const width = textWidth(number, size, num);
    const left = x - (width + gap + textWidth(unit, unitSize)) / 2;
    text(cv, number, left, y, size, color, num);
    text(cv, unit, left + width + gap, y, unitSize, color === C.missing ? C.missing : C.dim);
}

function temperatureIcon(cv, key, x, y, width) {
    const scale = width / 48, stroke = 2.5 * scale;
    const line = points => cv.polyline(points.map(([px, py]) => [x + (px - 24) * scale, y + (py - 16) * scale]), stroke, C.dim);
    if (key === 'oil') {
        line([[8, 12], [8, 26], [29, 26], [40, 9], [28, 15], [23, 12], [8, 12]]);
        line([[8, 15], [2, 15], [2, 23], [8, 23]]);
        line([[14, 6], [24, 6]]); line([[19, 6], [19, 12]]);
        line([[42, 18], [38, 25], [38, 27], [42, 30], [46, 27], [46, 25], [42, 18]]);
    } else {
        line([[13, 20], [13, 5], [16, 2], [19, 5], [19, 20]]);
        cv.arc(x - 8 * scale, y + 8 * scale, 4 * scale, 6.5 * scale, 0, 360, C.dim);
        line([[16, 11], [16, 23]]);
        for (const row of [12, 22, 31]) line([[25, row], [30, row - 2], [36, row + 1], [42, row - 2], [47, row]]);
    }
}

function gPosition(lat, longitudinal, x, y, radius) {
    const scale = Math.max(1, Math.hypot(lat, longitudinal));
    return [x - lat / scale * radius, y + longitudinal / scale * radius];
}

function drawWordmark(cv, titleWidth, titleY, centerX = cv.w / 2) {
    const titleHeight = titleWidth * wordmark.height / wordmark.width;
    // Canvas.drawImage forces opaque alpha, so scale the transparent crop before blitting it.
    const mark = new cv.constructor(titleWidth, Math.round(titleHeight));
    for (let y = 0; y < mark.h; y++) {
        const sy = Math.min(wordmark.height - 1, Math.floor((y + 0.5) * wordmark.height / titleHeight));
        for (let x = 0; x < mark.w; x++) {
            const sx = Math.floor((x + 0.5) * wordmark.width / titleWidth);
            const src = (sy * wordmark.width + sx) * 4;
            mark.d.set(titlePixels.subarray(src, src + 4), (y * mark.w + x) * 4);
        }
    }
    cv.blit(mark, centerX - mark.w / 2, titleY);
}

// Display scales for the preview bars, not calibrated warning limits.
const metrics = [
    ['oil', 'OIL TEMP', '°C', 0, 0, 150],
    ['coolant', 'WATER', '°C', 0, 0, 130],
    ['gearbox', 'GEAR OIL', '°C', 0, 0, 150],
    ['iat', 'IAT', '°C', 0, -20, 100],
    ['oilPressure', 'OIL PRESS', 'bar', 1, 0, 10],
    ['fuelRail', 'HPFP', 'bar', 0, 0, 350],
    ['boost', 'BOOST', 'bar', 2, -0.5, 3]
];
const temperatureMetrics = metrics.slice(0, 4);
const pressureMetrics = metrics.slice(4);

const tyreLimits = {thresholds: {}};
for (const t of thresholdCatalog) {
    if (t.key === 'tyrePressure' || t.key === 'tyreTemp') tyreLimits.thresholds[t.key] = t.default;
}

const layouts = {
    road: {
        panels: [[48, 152, 314, 492], [376, 152, 368, 492], [758, 152, 314, 492]],
        wheelX: [468, 652], wheelY: [248, 408], guideY: 328,
        pressureSize: 56, pressureUnit: 20, pressureGap: 6, tyreSize: 30, tyreUnit: 20, tyreOffset: 42,
        temperature: { left: 68, right: 342, top: 172, row: 116, size: 56, unitSize: 20, labelSize: 20,
            showBars: true, barHeight: 7, labelOffset: 48, valueOffset: 58, barOffset: 76, unitGap: 8 },
        power: { left: 778, right: 1052, top: 186, row: 152, size: 56, unitSize: 20, labelSize: 20,
            showBars: true, barHeight: 7, labelOffset: 54, valueOffset: 64, barOffset: 88, unitGap: 8 },
        mark: [220, 514, 560], statusY: 632
    },
    sport: {
        panels: [[22, 154, 200, 394], [230, 154, 312, 394], [550, 154, 200, 394]],
        wheelX: [74, 170], wheelY: [224, 352], guideY: 286,
        pressureSize: 40, pressureUnit: 15, pressureGap: 4, tyreSize: 26, tyreOffset: 32,
        power: { left: 562, right: 738, top: 166, row: 51, gap: 14, size: 38, unitSize: 15, labelSize: 16, showBars: false },
        mark: [150, 442, 122], statusY: 538
    }
};

function powertrain(cv, data, { left, right, top, row, gap = 0, size, unitSize, labelSize, showBars, barHeight,
    labelOffset = 25, valueOffset = row * 0.64, barOffset, unitGap = 6 }, readings, anim) {
    const numberRight = right - textWidth('bar', unitSize) - unitGap;
    const barWidth = right - left;
    readings.forEach(([key, label, unit, decimals, min, max], index) => {
        const y = top + index * row + (index < 4 ? 0 : gap);
        const v = data.valid ? data[key] : null, live = Number.isFinite(v);
        const thermal = key === 'oil' || key === 'coolant' ? temperatureStyle(key, v) : null;
        const alert = thermal && thermal.label;
        const color = live ? (alert ? thermal.color : C.text) : C.missing;
        const labelColor = live ? C.dim : C.missing;
        const baseline = y + valueOffset;
        const labelBaseline = y + labelOffset;
        text(cv, label, left, labelBaseline, labelSize, labelColor);
        text(cv, fmt(v, decimals), numberRight, baseline, size, anim ? style.opacity(color, anim.ink) : color, { font: 'num', align: 'right' });
        text(cv, unit, right, showBars ? baseline : labelBaseline, unitSize, labelColor, { align: 'right' });
        if (!showBars) return;
        const barY = y + barOffset;
        style.track(cv, left, barY, barWidth, barHeight);
        const fraction = live ? clamp((v - min) / (max - min), 0, 1) : null;
        style.bar(cv, left, barY, barWidth, barHeight, fraction, color, false, anim);
        if (key === 'boost' && live) {
            cv.fillRect(Math.round(left - min / (max - min) * barWidth), barY - 2, 1, barHeight + 4, C.zero);
        }
    });
}

const gx = 386, gy = 298, r = 108;
const scaleText = ['1g', gx + 40, gy - 72, 15, '#93afc7', {}];

function gDirection(cv, value, x, y, align, size, anim) {
    const live = Number.isFinite(value);
    const active = live && value > 0.005;
    const tint = active ? '#eef6fd' : '#8491a5';
    text(cv, live ? fmt(active ? value : 0, 2) + 'g' : '--g', x, y, size,
        anim ? style.opacity(tint, anim.ink) : tint, { font: 'num', align });
}

function gMeter(cv, data, { x: gx = 386, y: gy = 298, radius: r = 108, totalY = 512, totalSize = 48, directionSize = 16, directionGap = 0 } = {}, anim) {
    const gLat = data.valid && Number.isFinite(data.gLat) ? data.gLat : NaN;
    const gLong = data.valid && Number.isFinite(data.gLong) ? data.gLong : NaN;
    const envelope = data.gEnvelope || [];
    if (envelope.length > 1) {
        const points = envelope.map(p => gPosition(p.lat, p.long, gx, gy, r));
        if (points.length >= 3) {
            cv.convex(points, '#f0b46c2a');
            points.push(points[0]);
        }
        cv.polyline(points, 2.5, C.gold);
    }
    const trail = data.gTrail || [];
    for (let i = 1; i < trail.length; i++) {
        const previous = gPosition(trail[i - 1].lat, trail[i - 1].long, gx, gy, r);
        const current = gPosition(trail[i].lat, trail[i].long, gx, gy, r);
        const alpha = Math.round(24 + 150 * (1 - trail[i].age / 2000)).toString(16).padStart(2, '0');
        cv.line(previous[0], previous[1], current[0], current[1], 3, C.red + alpha);
    }
    const live = Number.isFinite(gLat) && Number.isFinite(gLong);
    if (live && (!anim || anim.puck > 0)) {
        const [x, y] = gPosition(gLat, gLong, gx, gy, r);
        const light = anim ? anim.puck : 1;
        cv.circle(x, y, 15, style.opacity(C.red, light * 0.19));
        cv.circle(x, y, 7, style.opacity(C.red, light));
        cv.circle(x, y, 3, style.opacity(C.text, light));
    }
    gDirection(cv, -gLong, gx, gy - r - 10 - directionGap, 'center', directionSize, anim);
    gDirection(cv, gLong, gx, gy + r + 22 + directionGap, 'center', directionSize, anim);
    gDirection(cv, gLat, gx - r - 5 - directionGap, gy + 6, 'right', directionSize, anim);
    gDirection(cv, -gLat, gx + r + 5 + directionGap, gy + 6, 'left', directionSize, anim);
    const tint = live ? C.text : C.missing;
    text(cv, fmt(Math.hypot(gLat, gLong), 2) + 'g', gx, totalY, totalSize, anim ? style.opacity(tint, anim.ink) : tint,
        { font: 'num', align: 'center' });
}

function staticLayer(Canvas, w, h, layout, sport) {
    const layer = new Canvas(w, h);
    const rects = layout.panels.map(([x, y, w, h]) => ({x, y, w, h}));
    rects.forEach((r, i) => style.card(layer, r, sport && i === 1));
    const body = style.chassis(layer, (layout.wheelX[0] + layout.wheelX[1]) / 2, layout.guideY, sport ? 0.85 : 1.1);
    if (sport) {
        const power = layout.power;
        for (let i = 1; i < 7; i++) {
            const y = power.top + i * power.row + (i >= 4 ? power.gap : 0) - 5;
            layer.fillRect(power.left, y, power.right - power.left, 1, '#ffffff14');
        }
        style.dial(layer, gx, gy, r);
        text(layer, ...scaleText);
    }
    drawWordmark(layer, ...layout.mark);
    const base = layer.d.slice();
    rects.forEach(r => style.accent(layer, r, sport, 1));
    if (sport) style.rings(layer, gx, gy, r, 1);
    return {pixels: layer.d, base, rects, body};
}

const staticPixels = {};
function render(cv, data, settings) {
    if (settings) return require('./configured-render').render(cv, data, settings, { wheelReading, drawWordmark, gMeter });
    const sport = data.mode === 'sport';
    const mode = sport ? 'sport' : 'road', layout = layouts[mode];
    if (!staticPixels[mode]) staticPixels[mode] = staticLayer(cv.constructor, cv.w, cv.h, layout, sport);
    const scene = staticPixels[mode], anim = data.intro < 1 && style.motion(data.intro);
    cv.d.set(anim ? scene.base : scene.pixels);
    if (anim) {
        scene.rects.forEach(r => style.accent(cv, r, sport, anim.accent));
        if (sport) style.rings(cv, gx, gy, r, anim.rings);
    }
    const value = key => data.valid ? data[key] : null;
    ['FL', 'FR', 'RL', 'RR'].forEach((key, index) => {
        const x = layout.wheelX[index % 2], y = layout.wheelY[index >> 1];
        const pressure = value('pressure' + key), tyre = value('tyre' + key);
        const p = style.tintFor('pressure' + key, pressure, tyreLimits);
        const t = style.tintFor('tyre' + key, tyre, tyreLimits);
        style.wheel(cv, scene.body, index, p, t, anim);
        wheelReading(cv, fmt(pressure, 1), 'bar', x, y, layout.pressureSize, layout.pressureUnit,
            layout.pressureGap, anim ? style.opacity(p, anim.ink) : p);
        wheelReading(cv, fmt(tyre, 0), '°C', x, y + layout.tyreOffset, layout.tyreSize, sport ? layout.tyreSize : layout.tyreUnit, 3,
            anim ? style.opacity(t, anim.ink) : t);
    });
    if (sport) {
        // Report cached text to observers on each frame, without redrawing its glyphs.
        if (typeof cv._onText === 'function') cv._onText(...scaleText);
        gMeter(cv, data, undefined, anim);
        powertrain(cv, data, layout.power, metrics, anim);
    } else {
        powertrain(cv, data, layout.temperature, temperatureMetrics, anim);
        powertrain(cv, data, layout.power, pressureMetrics, anim);
    }
    if (!data.valid) text(cv, data.stale ? 'DATA STALE' : 'NO DATA', layout.power.right, layout.statusY,
        16, C.hot, { align: 'right', spacing: 1 });
}
function createPreviewData() {
    const history = new GHistory();
    return data => history.sample(data.gLat, data.gLong, data.valid);
}
module.exports = { render, temperatureStyle, temperatureIcon, drawWordmark, createPreviewData };
