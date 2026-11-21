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
    cv.clear();
    // Keep the wordmark below the factory cluster's top-center mask.
    const titleWidth = data.mode === 'road' ? 230 : 170;
    const titleY = data.mode === 'road' ? 76 : 36;
    const titleHeight = titleWidth * wordmark.height / wordmark.width;
    const titleX = Math.round(cx - titleWidth / 2);
    cv.drawImage(titlePixels, wordmark.width, wordmark.height, titleX, titleY, titleWidth, titleHeight);
    // The PDF export has a black matte; recover straight alpha for the wordmark.
    for (let y = titleY; y < Math.round(titleY + titleHeight); y++) {
        for (let x = titleX; x < titleX + titleWidth; x++) {
            const i = (y * w + x) * 4;
            const alpha = Math.max(cv.d[i], cv.d[i + 1], cv.d[i + 2]);
            cv.d[i + 3] = alpha;
            if (alpha) {
                cv.d[i] = Math.round(cv.d[i] * 255 / alpha);
                cv.d[i + 1] = Math.round(cv.d[i + 1] * 255 / alpha);
                cv.d[i + 2] = Math.round(cv.d[i + 2] * 255 / alpha);
            }
        }
    }
    const value = key => data.valid ? data[key] : null;
    const footY = h - 84;
    const wheelInset = Math.round(w * (data.mode === 'road' ? 0.18 : 0.16));
    if (data.mode === 'road') {
        [['FL', wheelInset, 194], ['FR', w - wheelInset, 194], ['RL', wheelInset, 404], ['RR', w - wheelInset, 404]].forEach(([key, x, y]) => {
            cv.text(key, x, y + 22, 20, C.dim, { font: 'bold', align: 'center' });
            pressure(cv, value('pressure' + key), x, y + 104, 64, 22);
            cv.text(fmt(value('tyre' + key), 0) + ' °C', x, y + 150, 40, C.text, { font: 'num', align: 'center' });
        });
        [['ENGINE OIL', 'oil', 194], ['COOLANT', 'coolant', 404]].forEach(([label, key, y]) => {
            const v = value(key), style = temperatureStyle(key, v);
            cv.text(label, cx, y + 22, 20, C.dim, { align: 'center', spacing: 1 });
            cv.text(fmt(v, 0), cx, y + 104, 76, style.color, { font: 'num', align: 'center' });
            cv.text('°C', cx, y + 145, 26, style.color, { align: 'center' });
        });
    } else {
        [['FL', wheelInset, 114], ['FR', w - wheelInset, 114], ['RL', wheelInset, 228], ['RR', w - wheelInset, 228]].forEach(([key, x, y]) => {
            cv.text(key, x, y + 16, 18, C.dim, { font: 'bold', align: 'center' });
            pressure(cv, value('pressure' + key), x, y + 65, 44, 18);
            cv.text(fmt(value('tyre' + key), 0) + ' °C', x, y + 102, 32, C.text, { font: 'num', align: 'center' });
        });
        const gx = cx, y = 224, r = 86;
        for (const rr of [r / 2, r]) cv.arc(gx, y, rr - 1, rr + 1, 0, 360, rr === r ? '#49606e' : C.line);
        cv.line(gx - r, y, gx + r, y, 1, C.line);
        cv.line(gx, y - r, gx, y + r, 1, C.line);
        cv.text('BRAKE', gx, 126, 16, C.dim, { align: 'center', spacing: 1 });
        cv.text('ACCEL', gx, 332, 16, C.dim, { align: 'center', spacing: 1 });
        cv.text('L', gx - r - 22, y + 6, 22, C.dim, { align: 'center' });
        cv.text('R', gx + r + 22, y + 6, 22, C.dim, { align: 'center' });
        const hasG = data.valid && Number.isFinite(data.gLat) && Number.isFinite(data.gLong);
        if (hasG) {
            const scale = Math.max(1, Math.hypot(data.gLat, data.gLong));
            const x = gx - data.gLat / scale * r, gy = y + data.gLong / scale * r;
            cv.circle(x, gy, 16, '#ef403930'); cv.circle(x, gy, 7, C.accent); cv.circle(x, gy, 3, C.text);
        }
        const g = hasG ? Math.hypot(data.gLat, data.gLong) : null;
        cv.text(fmt(g, 2), cx, 400, 60, C.text, { font: 'num', align: 'center' });
        cv.text('TOTAL g', cx, 428, 18, C.dim, { align: 'center', spacing: 1 });
        [['LAT g', 'gLat', wheelInset], ['LONG g', 'gLong', w - wheelInset]].forEach(([label, key, x]) => {
            cv.text(fmt(value(key), 2), x, 400, 44, C.text, { font: 'num', align: 'center' });
            cv.text(label, x, 428, 18, C.dim, { align: 'center', spacing: 1 });
        });
    }
    if (data.mode === 'sport') {
        cv.line(22, footY, w - 22, footY, 1, C.line);
        [['ENGINE OIL', 'oil', (22 + cx) / 2], ['COOLANT', 'coolant', (cx + w - 22) / 2]].forEach(([label, key, x]) => {
            const v = value(key), style = temperatureStyle(key, v);
            cv.text(label, x, footY + 23, 18, C.dim, { font: 'bold', spacing: 1.5, align: 'center' });
            const number = fmt(v, 0), numberWidth = cv.textWidth(number, 54, { font: 'num' });
            const left = x - (numberWidth + 8 + cv.textWidth('°C', 26)) / 2;
            cv.text(number, left, footY + 79, 54, style.color, { font: 'num' });
            cv.text('°C', left + numberWidth + 8, footY + 75, 26, style.color);
        });
        cv.line(cx, footY + 18, cx, h - 12, 1, C.line);
    }
    if (!data.valid) cv.text(data.stale ? 'DATA STALE' : 'NO DATA', w - 22, h - 8, 11, data.valid ? C.dim : C.accent, { align: 'right', spacing: 1 });
}
module.exports = { render, temperatureStyle };
