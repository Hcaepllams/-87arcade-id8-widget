'use strict';
const zlib = require('zlib');
const atlas = require('./font-atlas.js');
const face = atlas.sizes[0];
face.family = atlas.family;
face.cacheKey = atlas.cacheKey;

function get() {
    if (typeof face.alpha === 'string') face.alpha = zlib.inflateSync(Buffer.from(face.alpha, 'base64'));
    return face;
}

function measure(f, text) {
    let w = 0;
    for (const ch of text) w += f.glyphs[ch.codePointAt(0)][6];
    return w;
}

module.exports = { get, measure, t: String };
