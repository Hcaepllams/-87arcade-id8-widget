'use strict';
// Shared drawing function for the preview and vehicle runner.
// Drawing uses idrive7-apps' Canvas; pixels travel through the upstream ClusterRender client.
const fs = require('fs');
const path = require('path');
const logo = require('./assets/logo.json');
const pixels = fs.readFileSync(path.join(__dirname, 'assets/logo.rgba'));
// Sample only the original wordmark; leave the supplied logo asset untouched.
const wordmark = { x: 35, y: 252, width: 425, height: 178 };
const titlePixels = Buffer.alloc(wordmark.width * wordmark.height * 4);
for (let y = 0; y < wordmark.height; y++) {
    const start = ((wordmark.y + y) * logo.width + wordmark.x) * 4;
    pixels.copy(titlePixels, y * wordmark.width * 4, start, start + wordmark.width * 4);
}

const C = { text: '#edf3f8', dim: '#90a2b3', line: '#263745', accent: '#ef4039', blue: '#64bde9', panel: '#0e1820' };
const fmt = (v, n) => Number.isFinite(v) ? v.toFixed(n) : '--';

// Preview defaults from M Vitals thermal tiles/oilWarn, not vehicle-calibrated limits.
const temperatureLimits = { oil: { cold: 70, hot: 125 }, coolant: { cold: 60, hot: 112 } };
function temperatureStyle(key, value) {
    if (!Number.isFinite(value)) return { color: C.dim, label: '' };
    const limit = temperatureLimits[key];
    if (value < limit.cold) return { color: C.blue, label: 'COLD' };
    if (value >= limit.hot) return { color: C.accent, label: 'HOT' };
    return { color: C.text, label: '' };
}

function pressure(cv, value, x, y, size, unitSize) {
    const number = fmt(value, 2), width = cv.textWidth(number, size, { font: 'num' });
    const left = x - (width + 8 + cv.textWidth('bar', unitSize)) / 2;
    cv.text(number, left, y, size, C.text, { font: 'num' });
    cv.text('bar', left + width + 8, y - 2, unitSize, C.dim);
}

function render(cv, data) {
    const w = cv.w, h = cv.h, cx = w / 2;
    cv.clear('#030609');
    // Keep the wordmark below the factory cluster's top-center mask.
    const titleWidth = data.mode === 'road' ? 190 : 170;
    const titleY = data.mode === 'road' ? 76 : 36;
    cv.drawImage(titlePixels, wordmark.width, wordmark.height, cx - titleWidth / 2, titleY, titleWidth, titleWidth * wordmark.height / wordmark.width);
    const value = key => data.valid ? data[key] : null;
    const footY = h - 104;
    if (data.mode === 'road') {
        [['FL', 108, 194], ['FR', w - 108, 194], ['RL', 108, 404], ['RR', w - 108, 404]].forEach(([key, x, y]) => {
            cv.text(key, x, y + 22, 16, C.dim, { font: 'bold', align: 'center' });
            pressure(cv, value('pressure' + key), x, y + 83, 48, 16);
            cv.text(fmt(value('tyre' + key), 0) + ' °C', x, y + 126, 30, C.text, { font: 'num', align: 'center' });
        });
        [['ENGINE OIL', 'oil', 194], ['COOLANT', 'coolant', 404]].forEach(([label, key, y]) => {
            const v = value(key), style = temperatureStyle(key, v);
            cv.text(label, cx, y + 22, 15, C.dim, { align: 'center', spacing: 1 });
            cv.text(fmt(v, 0), cx, y + 88, 60, style.color, { font: 'num', align: 'center' });
            cv.text('°C', cx, y + 126, 20, style.color, { align: 'center' });
        });
    } else {
        [['FL', 100, 114], ['FR', w - 100, 114], ['RL', 100, 228], ['RR', w - 100, 228]].forEach(([key, x, y]) => {
            cv.text(key, x, y + 16, 14, C.dim, { font: 'bold', align: 'center' });
            pressure(cv, value('pressure' + key), x, y + 49, 32, 14);
            cv.text(fmt(value('tyre' + key), 0) + ' °C', x, y + 79, 24, C.text, { font: 'num', align: 'center' });
        });
        const gx = cx, y = 224, r = 86;
        for (const rr of [r / 2, r]) cv.arc(gx, y, rr - 1, rr + 1, 0, 360, rr === r ? '#49606e' : C.line);
        cv.line(gx - r, y, gx + r, y, 1, C.line);
        cv.line(gx, y - r, gx, y + r, 1, C.line);
        cv.text('BRAKE', gx, 126, 14, C.dim, { align: 'center', spacing: 1 });
        cv.text('ACCEL', gx, 332, 14, C.dim, { align: 'center', spacing: 1 });
        cv.text('L', gx - r - 22, y + 6, 18, C.dim, { align: 'center' });
        cv.text('R', gx + r + 22, y + 6, 18, C.dim, { align: 'center' });
        const hasG = data.valid && Number.isFinite(data.gLat) && Number.isFinite(data.gLong);
        if (hasG) {
            const scale = Math.max(1, Math.hypot(data.gLat, data.gLong));
            const x = gx - data.gLat / scale * r, gy = y + data.gLong / scale * r;
            cv.circle(x, gy, 16, '#ef403930'); cv.circle(x, gy, 7, C.accent); cv.circle(x, gy, 3, C.text);
        }
        const g = hasG ? Math.hypot(data.gLat, data.gLong) : null;
        cv.text(fmt(g, 2), cx, 377, 48, C.text, { font: 'num', align: 'center' });
        cv.text('TOTAL g', cx, 403, 14, C.dim, { align: 'center', spacing: 1 });
        [['LAT g', 'gLat', 100], ['LONG g', 'gLong', w - 100]].forEach(([label, key, x]) => {
            cv.text(fmt(value(key), 2), x, 377, 32, C.text, { font: 'num', align: 'center' });
            cv.text(label, x, 403, 14, C.dim, { align: 'center', spacing: 1 });
        });
    }
    if (data.mode === 'sport') {
        cv.line(22, footY, w - 22, footY, 1, C.line);
        [['ENGINE OIL', 'oil', (22 + cx) / 2], ['COOLANT', 'coolant', (cx + w - 22) / 2]].forEach(([label, key, x]) => {
            const v = value(key), style = temperatureStyle(key, v);
            cv.text(label, x, footY + 29, 16, C.dim, { font: 'bold', spacing: 1.5, align: 'center' });
            const number = fmt(v, 0), numberWidth = cv.textWidth(number, 43, { font: 'num' });
            const left = x - (numberWidth + 8 + cv.textWidth('°C', 22)) / 2;
            cv.text(number, left, footY + 77, 43, style.color, { font: 'num' });
            cv.text('°C', left + numberWidth + 8, footY + 73, 22, style.color);
        });
        cv.line(cx, footY + 18, cx, h - 29, 1, C.line);
    }
    if (!data.valid) cv.text(data.stale ? 'DATA STALE' : 'NO DATA', w - 22, h - 8, 11, data.valid ? C.dim : C.accent, { align: 'right', spacing: 1 });
}
module.exports = { render, temperatureStyle };
