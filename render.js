'use strict';
// Shared drawing function for the preview and vehicle runner.
// Drawing uses idrive7-apps' Canvas; pixels travel through the upstream ClusterRender client.
const fs = require('fs');
const path = require('path');
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
    text: '#ffffff', dim: '#d4e3f0', missing: '#7890a6', hot: '#ff4d45', blue: '#64bde9',
    panel: '#050d1888', border: '#3b5c7d5c', guide: '#38557088', track: '#122334', fill: '#eaf2f8',
    zero: '#8da9c2', gold: '#f0b46c', red: '#ef4039'
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

const layouts = {
    road: {
        panels: [[48, 152, 472, 492], [538, 152, 534, 492]],
        wheelX: [166, 402], wheelY: [260, 422], wheelGuide: [73, 495, 208, 495, 20], guideY: 342,
        pressureSize: 66, pressureUnit: 22, pressureGap: 7, tyreSize: 36, tyreOffset: 44,
        power: { left: 562, right: 1048, top: 172, row: 64, gap: 18, size: 48, unitSize: 20, labelSize: 20,
            showBars: true, barWidth: 180, barHeight: 6 },
        mark: [224, 514, 284], statusY: 632
    },
    sport: {
        panels: [[22, 154, 200, 394], [230, 154, 312, 394], [550, 154, 200, 394]],
        wheelX: [74, 170], wheelY: [224, 352], wheelGuide: [36, 208, 178, 392, 14], guideY: 286,
        pressureSize: 40, pressureUnit: 15, pressureGap: 4, tyreSize: 26, tyreOffset: 32,
        power: { left: 562, right: 738, top: 166, row: 51, gap: 14, size: 38, unitSize: 15, labelSize: 16, showBars: false },
        mark: [150, 442, 122], statusY: 538
    }
};

function powertrain(cv, data, { left, right, top, row, gap, size, unitSize, labelSize, showBars, barWidth, barHeight }) {
    const numberRight = right - textWidth('bar', unitSize) - (showBars ? 10 : 6);
    metrics.forEach(([key, label, unit, decimals, min, max], index) => {
        const y = top + index * row + (index < 4 ? 0 : gap);
        const v = data.valid ? data[key] : null, live = Number.isFinite(v);
        const style = key === 'oil' || key === 'coolant' ? temperatureStyle(key, v) : null;
        const alert = style && style.label;
        const color = live ? (alert ? style.color : C.text) : C.missing;
        const labelColor = live ? C.dim : C.missing;
        const baseline = y + row * 0.64;
        const labelBaseline = y + (showBars ? 17 : 25);
        text(cv, label, left, labelBaseline, labelSize, labelColor);
        text(cv, fmt(v, decimals), numberRight, baseline, size, color, { font: 'num', align: 'right' });
        text(cv, unit, right, showBars ? baseline : labelBaseline, unitSize, labelColor, { align: 'right' });
        if (!showBars) return;
        const barY = y + 28;
        cv.roundRect(left, barY, barWidth, barHeight, barHeight / 2, C.track);
        if (live) {
            const fraction = clamp((v - min) / (max - min), 0, 1);
            cv.roundRect(left, barY, fraction * barWidth, barHeight, barHeight / 2, alert ? color : C.fill);
        }
        if (key === 'boost' && live) {
            cv.fillRect(Math.round(left - min / (max - min) * barWidth), barY - 2, 1, barHeight + 4, C.zero);
        }
    });
}

const gx = 386, gy = 298, r = 108;
const scaleText = ['1g', gx + 40, gy - 72, 15, '#93afc7', {}];

function gDirection(cv, value, x, y, align) {
    const live = Number.isFinite(value);
    const active = live && value > 0.005;
    text(cv, live ? fmt(active ? value : 0, 2) + 'g' : '--g', x, y, 16,
        active ? '#eef6fd' : '#6f899f', { font: 'num', align });
}

function gMeter(cv, data) {
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
    if (live) {
        const [x, y] = gPosition(gLat, gLong, gx, gy, r);
        cv.circle(x, y, 15, C.red + '30');
        cv.circle(x, y, 7, C.red);
        cv.circle(x, y, 3, C.text);
    }
    gDirection(cv, -gLong, gx, gy - r - 10, 'center');
    gDirection(cv, gLong, gx, gy + r + 22, 'center');
    gDirection(cv, gLat, gx - r - 5, gy + 6, 'right');
    gDirection(cv, -gLat, gx + r + 5, gy + 6, 'left');
    text(cv, fmt(Math.hypot(gLat, gLong), 2) + 'g', gx, 512, 48, live ? C.text : C.missing,
        { font: 'num', align: 'center' });
}

function staticLayer(Canvas, w, h, layout, sport) {
    const layer = new Canvas(w, h);
    for (const [x, y, width, height] of layout.panels) {
        layer.roundRect(x, y, width, height, 14, C.panel);
        layer.strokeRoundRect(x, y, width, height, 14, 1, C.border);
    }
    const [left, right, top, bottom, gap] = layout.wheelGuide;
    const x = (layout.wheelX[0] + layout.wheelX[1]) / 2;
    const y = layout.guideY;
    layer.line(left, y, x - gap / 2, y, 1, C.guide);
    layer.line(x + gap / 2, y, right, y, 1, C.guide);
    layer.line(x, top, x, y - gap / 2, 1, C.guide);
    layer.line(x, y + gap / 2, x, bottom, 1, C.guide);
    const power = layout.power;
    const separatorY = power.top + 4 * power.row + power.gap / 2 - 5;
    layer.line(power.left, separatorY, power.right, separatorY, 1, C.guide);
    if (sport) {
        layer.line(gx - r, gy, gx + r, gy, 1, '#2a4154');
        layer.line(gx, gy - r, gx, gy + r, 1, '#2a4154');
        layer.arc(gx, gy, r / 2 - 0.6, r / 2 + 0.6, 0, 360, '#334d63');
        layer.arc(gx, gy, r - 1, r + 1, 0, 360, '#6f8fa8');
        text(layer, ...scaleText);
    }
    drawWordmark(layer, ...layout.mark);
    return layer.d;
}

const staticPixels = {};
function render(cv, data) {
    const sport = data.mode === 'sport';
    const mode = sport ? 'sport' : 'road', layout = layouts[mode];
    if (!staticPixels[mode]) staticPixels[mode] = staticLayer(cv.constructor, cv.w, cv.h, layout, sport);
    cv.d.set(staticPixels[mode]);
    const value = key => data.valid ? data[key] : null;
    ['FL', 'FR', 'RL', 'RR'].forEach((key, index) => {
        const x = layout.wheelX[index % 2], y = layout.wheelY[index >> 1];
        const pressure = value('pressure' + key), tyre = value('tyre' + key);
        wheelReading(cv, fmt(pressure, 1), 'bar', x, y, layout.pressureSize, layout.pressureUnit,
            layout.pressureGap, Number.isFinite(pressure) ? C.text : C.missing);
        wheelReading(cv, fmt(tyre, 0), '°C', x, y + layout.tyreOffset, layout.tyreSize, layout.tyreSize, 3,
            Number.isFinite(tyre) ? C.dim : C.missing);
    });
    if (sport) {
        // Report cached text to observers on each frame, without redrawing its glyphs.
        if (typeof cv._onText === 'function') cv._onText(...scaleText);
        gMeter(cv, data);
    }
    powertrain(cv, data, layout.power);
    if (!data.valid) text(cv, data.stale ? 'DATA STALE' : 'NO DATA', layout.power.right, layout.statusY,
        16, C.hot, { align: 'right', spacing: 1 });
}
function createPreviewData() {
    const history = new GHistory();
    return data => history.sample(data.gLat, data.gLong, data.valid);
}
module.exports = { render, temperatureStyle, temperatureIcon, drawWordmark, createPreviewData };
