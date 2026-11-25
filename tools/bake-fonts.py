#!/usr/bin/env python3
"""Bake the Canvas alpha atlases offline. Pass a font directory to override the local source."""
import base64
import json
import math
from pathlib import Path
import sys
import zlib

from PIL import Image, ImageDraw, ImageFont


OUT = Path(__file__).resolve().parents[1] / 'assets' / 'fonts'
FONT_DIR = Path(__file__).resolve().parent / 'fonts'
DIGITS = '0123456789'
FONTS = (
    ('arcade-num', 'BarlowSemiCondensed-Bold.ttf', (22, 30, 38, 46, 56, 68), DIGITS + '.,:-+%°/ g'),
    ('arcade-label', 'BarlowSemiCondensed-SemiBold.ttf', (16, 18, 20, 24), ''.join(map(chr, range(32, 127))) + '°·–—'),
)


def bake(source, size, charset, tabular):
    font = ImageFont.truetype(str(source), size)
    ascent, descent = font.getmetrics()
    digit_adv = math.ceil(max(font.getlength(ch) for ch in DIGITS)) if tabular else None
    width = 512
    x = y = row_height = 0
    glyphs, bitmaps = {}, []
    for ch in charset:
        ox, oy, right, bottom = font.getbbox(ch, anchor='ls')
        w, h = right - ox, bottom - oy
        adv = font.getlength(ch)
        if w and h:
            if x + w > width:
                x, y, row_height = 0, y + row_height + 1, 0
            bitmap = Image.new('L', (w, h))
            ImageDraw.Draw(bitmap).text((-ox, -oy), ch, font=font, fill=255, anchor='ls')
            bitmaps.append((bitmap, (x, y)))
            gx, gy = x, y
            x += w + 1
            row_height = max(row_height, h)
        else:
            gx = gy = 0
        if tabular and ch in DIGITS:
            ox += (digit_adv - adv) / 2
            adv = digit_adv
        glyphs[ord(ch)] = [gx, gy, w, h, ox, oy, adv]
    height = y + row_height + 1
    atlas = Image.new('L', (width, height))
    for bitmap, position in bitmaps:
        atlas.paste(bitmap, position)
    return dict(size=size, ascent=ascent, descent=descent, atlasW=width, atlasH=height,
                alpha=base64.b64encode(zlib.compress(atlas.tobytes(), 9)).decode(), glyphs=glyphs)


def main():
    font_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else FONT_DIR
    OUT.mkdir(parents=True, exist_ok=True)
    for family, source, sizes, charset in FONTS:
        data = dict(family=family, source=source, sizes=[
            bake(font_dir / source, size, charset, family == 'arcade-num') for size in sizes
        ])
        target = OUT / (family + '.json')
        target.write_text(json.dumps(data, separators=(',', ':')) + '\n', encoding='utf-8')
        print(f'{target.name}: {target.stat().st_size} bytes')


if __name__ == '__main__':
    main()
