"use strict";
const { catalog, geometry, capacity } = require('./settings');
const style = require('./cluster-draw');
const { text, textWidth } = require('./font-draw');
const metrics = new Map(catalog.map(m => [m.key, m]));
const wheels = ['FL', 'FR', 'RL', 'RR'];
const cache = {};
const num = {font: 'num', align: 'right'};
const rightAlign = {align: 'right'};
const centerAlign = {align: 'center'};
const dim = '#9ea8b8', muted = '#7890a6';
const fmt = (v, n) => Number.isFinite(v) ? v.toFixed(n) : '--';

function dataCard(layer, card, r, cap, sport) {
    const visible = card.metrics.slice(0, cap), overflow = card.metrics.length - visible.length;
    if (!visible.length) {
        text(layer, 'NO METRICS', r.x + r.w / 2, r.y + r.h / 2 + 6, 16, muted, centerAlign);
        return {readings: [], bottom: r.y + r.h / 2 + 8};
    }

    const across = cap / 7, rows = Math.ceil(visible.length / across), width = r.w / across;
    const topPad = sport ? 8 : 16, botPad = overflow ? 20 : topPad;
    const available = r.h - topPad - botPad;
    const spread = rows <= 4 && available / rows >= 88;
    const row = spread ? available / rows : Math.min(sport ? 51 : 62, available / rows);
    const slots = across === 1 && rows >= 5 ? 7 : rows;
    const top = r.y + topPad + (available - Math.min(available, row * slots)) / 2;
    const labelSize = sport ? 15 : 16, unitSize = spread && !sport ? 18 : sport ? 14 : 15;
    const size = spread ? (sport ? 38 : 56) : (sport ? 38 : 42);
    const inset = sport ? 14 : 18;
    const readings = visible.map((key, i) => {
        const m = metrics.get(key);
        const x = r.x + Math.floor(i / rows) * width + inset;
        const y = top + i % rows * row;
        const right = x + width - inset * 2, barWidth = right - x;
        const baseline = y + (spread ? row / 2 + 4 : row / 2 + size * 0.34);
        const labelY = baseline - (spread ? size * 0.22 : size * 0.19);
        const numberRight = right - textWidth(m.unit, unitSize) - 5;
        const numberWidth = numberRight - x - textWidth(m.label, labelSize) - 16;
        text(layer, m.label, x, labelY, labelSize, dim);
        text(layer, m.unit, right, spread ? baseline : labelY, unitSize, dim, rightAlign);
        const barY = Math.round(y + row * 0.70);
        if (spread) style.track(layer, x, barY, barWidth, 5);
        else if (rows >= 5 && i % rows) layer.fillRect(x, Math.round(y), barWidth, 1, '#ffffff14');
        return {m, x, baseline, numberRight, numberWidth, size, spread, barY, barWidth};
    });

    if (overflow) {
        const s = '+' + overflow, right = r.x + r.w - inset, y = r.y + r.h - 6;
        const w = textWidth(s, 13) + 12;
        layer.roundRect(right - w, y - 11, w, 15, 5, '#13283a');
        text(layer, s, right - 6, y, 13, '#9bd7f4', rightAlign);
    }
    return {readings, bottom: overflow ? r.y + r.h : top + row * rows};
}

function staticLayer(cv, mode, config, draw) {
    const layer = new cv.constructor(cv.w, cv.h), sport = mode === 'sport';
    const layout = config.modes[mode], rects = geometry(mode, layout);
    const cards = layout.columns.map((card, i) => {
        const r = rects[i], x = r.x + r.w / 2, bottom = r.y + r.h;
        style.card(layer, r, sport && i === (layout.primary === null ? Math.floor(rects.length / 2) : layout.primary));
        if (card.type === 'data') return dataCard(layer, card, r, capacity(mode, layout, i), sport);
        if (card.type === 'tyres') {
            const top = r.y + 18, row = (bottom - 86 - top) / 2, y = top + row;
            const body = style.chassis(layer, x, y, Math.min(1.35, row / 145));
            return {top, row, body, size: Math.min(sport ? 40 : 56, Math.floor(r.w / 5))};
        }
        const directionSize = 14, directionGap = 11;
        const side = textWidth('4.00g', directionSize, num) + directionGap + 14;
        const top = r.y + 42, chartBottom = bottom - 112;
        const radius = Math.min(r.w / 2 - side, (chartBottom - top) / 2), y = (top + chartBottom) / 2;
        style.dial(layer, x, y, radius);
        text(layer, '1g', x + radius * 0.4, y - radius * 0.65, 14, '#93afc7');
        return {x, y, radius, totalY: bottom - 23, totalSize: sport ? 38 : 44, directionSize, directionGap};
    });
    const tyre = layout.columns.findIndex(c => c.type === 'tyres');
    if (tyre >= 0) {
        const r = rects[tyre], width = Math.min(150, Math.floor(r.w * 0.7));
        draw.drawWordmark(layer, width, r.y + r.h - Math.ceil(width * 178 / 425) - 12, r.x + r.w / 2);
    } else {
        const center = Math.floor(rects.length / 2), r = rects[center];
        if (layout.columns[center].type === 'data' && r.y + r.h - cards[center].bottom >= 56) {
            draw.drawWordmark(layer, 100, r.y + r.h - 50, r.x + r.w / 2);
        }
    }
    const base = layer.d.slice();
    rects.forEach((r, i) => {
        style.accent(layer, r, sport, 1);
        const plan = cards[i];
        if (plan.radius) style.rings(layer, plan.x, plan.y, plan.radius, 1);
    });
    return {pixels: layer.d, base, cards, rects};
}

function render(cv, data, config, draw) {
    const mode = data.mode === 'sport' ? 'sport' : 'road';
    const signature = JSON.stringify(config) + '/' + cv.w + 'x' + cv.h;
    if (!cache[mode] || cache[mode].signature !== signature) {
        cache[mode] = Object.assign(staticLayer(cv, mode, config, draw), {signature});
    }
    const {pixels, base, cards, rects} = cache[mode];
    const anim = data.intro < 1 && style.motion(data.intro);
    cv.d.set(anim ? base : pixels);
    const sample = key => !data.valid ? null : key === 'gTotal'
        ? Number.isFinite(data.gLat) && Number.isFinite(data.gLong) ? Math.hypot(data.gLat, data.gLong) : null : data[key];

    config.modes[mode].columns.forEach((card, index) => {
        const plan = cards[index], r = rects[index];
        if (anim) style.accent(cv, r, mode === 'sport', anim.accent);
        if (card.type === 'data') {
            for (const {m, x, baseline, numberRight, numberWidth, size, spread, barY, barWidth} of plan.readings) {
                const value = sample(m.key), number = fmt(value, m.decimals), tint = style.tintFor(m.key, value, config);
                let font = size;
                while (textWidth(number, font, num) > numberWidth) font--;
                text(cv, number, numberRight, baseline, font, anim ? style.opacity(tint, anim.ink) : tint, num);
                if (!spread) continue;
                const fraction = Number.isFinite(value) ? Math.max(0, Math.min(1, (value - m.min) / (m.max - m.min))) : null;
                style.bar(cv, x, barY, barWidth, 5, fraction, tint, mode === 'sport', anim);
                if (m.key === 'boost') cv.fillRect(Math.round(x - m.min / (m.max - m.min) * barWidth), barY - 2, 1, 9, '#8da9c2');
            }
        } else if (card.type === 'tyres') {
            const {top, row, size} = plan, both = card.pressure && card.temperature;
            wheels.forEach((wheel, i) => {
                const x = r.x + r.w * (i % 2 ? 0.75 : 0.25), y = top + (Math.floor(i / 2) + 0.5) * row;
                const pressure = style.tintFor('pressure' + wheel, sample('pressure' + wheel), config);
                const temperature = style.tintFor('tyre' + wheel, sample('tyre' + wheel), config);
                style.wheel(cv, plan.body, i, pressure, temperature, anim);
                const readings = card.pressure ? ['pressure' + wheel] : [];
                if (card.temperature) readings.push('tyre' + wheel);
                readings.forEach((key, j) => {
                    const m = metrics.get(key), value = sample(key), number = fmt(value, m.decimals);
                    const baseline = y + (both ? (j === 0 ? -4 : size * 0.76) : size * 0.35);
                    let font = j === 0 ? size : Math.round(size * 0.68);
                    const unitSize = Math.max(14, Math.round(font * 0.4));
                    while (textWidth(number, font, num) + textWidth(m.unit, unitSize) + 3 > r.w / 2 - 14) font--;
                    const tint = key === 'tyre' + wheel ? temperature : pressure;
                    draw.wheelReading(cv, number, m.unit, x, baseline, font, unitSize, 3, anim ? style.opacity(tint, anim.ink) : tint);
                });
            });
        } else {
            if (anim) style.rings(cv, plan.x, plan.y, plan.radius, anim.rings);
            draw.gMeter(cv, data, plan, anim);
        }
    });
    if (!data.valid) text(cv, data.stale ? 'DATA STALE' : 'NO DATA', cv.w - (mode === 'sport' ? 22 : 48), cv.h - 4,
        14, '#ff4d45', {align: 'right', spacing: 1});
}
module.exports = { render };
