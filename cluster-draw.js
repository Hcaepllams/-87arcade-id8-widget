'use strict';

const {color} = require('./settings');

const ice = '#68c1ff', blue = '#1860c4', crimson = '#e5202b';
const silver = '#c8d3e3', cold = '#56b8ff', warn = '#f0b05c', hot = '#ff423d';
const sportStrip = ['#6e101888', crimson, '#6e101888'];
const roadStrip = ['#1a355488', '#5cb8ff', '#1a355488'];
const tricolor = [ice, blue, crimson];
const roadFill = ['#dce6f2', '#ffffff'], sportFill = ['#b81822', '#ff3b45'];

const palette = {'#64bde9': '#56b8ff', '#ff4d45': '#ff423d', '#f0b46c': '#f0b05c'};
function tintFor(key, value, config) {
    const tint = color(key, value, config);
    return palette[tint] || tint;
}

function ease(t, from, to) {
    if (t <= from) return 0;
    if (t >= to) return 1;
    return (1 - Math.pow(2, -4 * (t - from) / (to - from))) / (1 - 1 / 16);
}

function motion(t) {
    return {
        accent: ease(t, 0, 0.45), rise: ease(t, 0.1, 0.45), settle: ease(t, 0.45, 0.85),
        rings: ease(t, 0.1, 0.85), puck: ease(t, 0.65, 1), ink: 0.38 + 0.62 * ease(t, 0.55, 1),
        wheels: [0.25, 0.33, 0.45, 0.53].map(start => 0.12 + 0.88 * ease(t, start, start + 0.22))
    };
}

function opacity(color, alpha) {
    if (alpha >= 1) return color;
    return color + Math.round(255 * alpha).toString(16).padStart(2, '0');
}

function card(cv, r, emblem) {
    cv.card(r.x, r.y, r.w, r.h, 10, [[0, '#0d1017dc'], [1, '#05060ae6']]);
    cv.strokeRoundRect(r.x, r.y, r.w, r.h, 10, 1, '#2c334299');
    if (emblem) tricolor.forEach((color, i) => {
        const x = r.x + 14 + 5 * i, y = r.y + 7;
        cv.quad([[x + 3, y], [x + 7, y], [x + 4, y + 6], [x, y + 6]], color);
    });
}

function accent(cv, r, sport, progress) {
    if (progress <= 0) return;
    const span = r.w - 20, width = span * progress, x = r.x + (r.w - width) / 2, y = r.y + 1;
    cv.rampRect(x, y, width, 2, 1, sport ? sportStrip : roadStrip);
    if (sport && progress < 1) {
        const blend = Math.min(1, (1 - progress) / 0.09);
        cv.rampRect(x, y, width, 2, 1, tricolor.map(c => opacity(c, blend)));
    }
    if (progress < 1) {
        cv.fillRect(x, y, 2, 2, '#ffffff');
        cv.fillRect(x + width - 2, y, 2, 2, '#ffffff');
    }
}

function track(cv, x, y, w, h) {
    cv.roundRect(x, y, w, h, 2, '#151922');
    for (const tick of [0.25, 0.5, 0.75]) cv.fillRect(Math.round(x + w * tick), y - 1, 1, h + 2, '#3e485a');
}

function bar(cv, x, y, w, h, fraction, tint, sport, anim) {
    if (!Number.isFinite(fraction)) {
        if (!anim || !anim.rise || anim.settle === 1) return;
        fraction = 0;
        tint = '#ffffff';
    }
    if (anim) fraction = anim.rise * (1 - anim.settle) + fraction * anim.settle;
    const width = Math.round(fraction * w);
    if (tint === '#ffffff') cv.rampRect(x, y, width, h, 2, sport ? sportFill : roadFill);
    else cv.roundRect(x, y, width, h, 2, tint);
    cv.fillRect(x + Math.min(w - 2, Math.max(0, width - 1)), y - 2, 2, h + 4, '#ffffff');
}

function chassis(cv, x, y, scale) {
    const line = pts => cv.polyline(pts.map(p => [x + p[0] * scale, y + p[1] * scale]), 1.25, '#3e485a');
    for (const side of [-1, 1]) {
        line([[0, -38], [10 * side, -37], [15 * side, -32], [17 * side, -19],
            [16 * side, 4], [17 * side, 21], [15 * side, 34], [11 * side, 38], [0, 38]]);
        line([[8 * side, -31], [12 * side, -21]]);
    }
    line([[-14, -17], [-8, -19], [8, -19], [14, -17], [10, -8], [-10, -8], [-14, -17]]);
    line([[-10, -8], [-11, 12], [-14, 22], [-9, 25], [9, 25], [14, 22], [11, 12], [10, -8]]);
    line([[-11, 12], [11, 12]]);
    line([[-11, 32], [11, 32]]);
    return {x, y, scale};
}

function wheel(cv, body, i, pressure, temperature, anim) {
    const tint = [hot, warn, cold].find(c => pressure === c || temperature === c) ||
        (pressure === '#ffffff' || temperature === '#ffffff' ? silver : '#596373');
    const s = body.scale, x = body.x + (i % 2 ? 17 : -22) * s, y = body.y + (i < 2 ? -26 : 15) * s;
    cv.roundRect(x, y, 5 * s, 13 * s, 2 * s, anim ? opacity(tint, anim.wheels[i]) : tint);
}

function dial(cv, x, y, r) {
    cv.circle(x, y, r, '#07090eb8');
    const d = r * Math.SQRT1_2;
    cv.line(x - d, y - d, x + d, y + d, 1, '#1c212c');
    cv.line(x - d, y + d, x + d, y - d, 1, '#1c212c');
    cv.line(x - r, y, x + r, y, 1, '#29303f');
    cv.line(x, y - r, x, y + r, 1, '#29303f');
}

function rings(cv, x, y, r, progress) {
    if (!progress) return;
    // Kit Canvas measures clockwise from twelve o'clock.
    cv.arc(x, y, r / 2 - 0.6, r / 2 + 0.6, 0, progress * 360, '#323b4c');
    cv.arc(x, y, r - 0.8, r + 0.8, 0, progress * 360, '#7a869c');
    const marks = [[0,-1], [1,0], [0,1], [-1,0]];
    marks.forEach(([dx, dy], i) => {
        if (progress >= i / 4) cv.line(x + dx * (r - 5), y + dy * (r - 5), x + dx * r, y + dy * r, 2, '#aab6ca');
    });
}

module.exports = {tintFor, motion, opacity, card, accent, track, bar, chassis, wheel, dial, rings};
