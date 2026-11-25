'use strict';
const zlib = require('zlib');
const families = {};

function atlas(size, font) {
    const key = font === 'num' ? 'num' : 'label';
    const sizes = families[key] || (families[key] = require('./assets/fonts/arcade-' + key + '.json').sizes);
    return sizes.find(f => f.size >= size) || sizes[sizes.length - 1];
}

function measure(f, str, scale, spacing) {
    let advance = 0;
    for (const ch of str) {
        const glyph = f.glyphs[ch.codePointAt(0)] || f.glyphs[63];
        if (glyph) advance += glyph[6];
    }
    return advance * scale + spacing * Math.max(0, str.length - 1);
}

function textWidth(str, size, opts = {}) {
    const f = atlas(size, opts.font);
    return measure(f, String(str), size / f.size, opts.spacing || 0);
}

function rgba(color) {
    if (Array.isArray(color)) return color.length === 3 ? color.concat(255) : color;
    let hex = color.replace('#', '');
    if (hex.length === 3) hex = hex.replace(/./g, ch => ch + ch);
    if (hex.length === 6) hex += 'ff';
    const n = parseInt(hex, 16);
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

const alpha = new WeakMap();
function text(cv, str, x, y, size, color, opts = {}) {
    const s = String(str);
    if (typeof cv._onText === 'function') cv._onText(s, x, y, size, color, opts);
    if (typeof cv._blit !== 'function') return cv.text(s, x, y, size, color, opts);
    const f = atlas(size, opts.font), scale = size / f.size, spacing = opts.spacing || 0;
    const w = measure(f, s, scale, spacing), c = rgba(color);
    if (!alpha.has(f)) alpha.set(f, Object.assign({}, f, { alpha: zlib.inflateSync(Buffer.from(f.alpha, 'base64')) }));
    const decoded = alpha.get(f);
    let pen = opts.align === 'center' ? x - w / 2 : opts.align === 'right' ? x - w : x;
    for (const ch of s) {
        const glyph = f.glyphs[ch.codePointAt(0)] || f.glyphs[63];
        if (!glyph) continue;
        const [gx, gy, gw, gh, ox, oy, adv] = glyph;
        if (gw && gh) cv._blit(decoded, gx, gy, gw, gh, pen + ox * scale, y + oy * scale, scale, c);
        pen += adv * scale + spacing;
    }
    return w;
}

module.exports = { text, textWidth };
