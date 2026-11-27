'use strict';
const logo = require('./logo-asset.js');
const { Recorder, setImage } = require('./record.js');
const { catalog, kinds, capacity } = require('./settings.js');
const { modes, cardTypes, tyreFields, metrics, orderedThresholds, columnName, range, canAdjust } = require('./menu.js');

setImage(logo.id, logo.w, logo.h, logo.data);

const C = {
    text: '#f5f7fa', sub: '#9aa3b2', disabled: '#575f6d', line: '#282e3a',
    blue: '#2c8cff', crimson: '#e5202b', focus: '#f0f4fa',
    cold: '#56b8ff', amber: '#f0b05c', hot: '#ff4742'
};
const gradient = (top, bottom) => [[0, top], [1, bottom]];
const ground = gradient('#0b0d12', '#040507'), rail = gradient('#11141b', '#090b0f');
const glass = gradient('#1a1e26', '#11141a'), active = gradient('#282e3a', '#1c2029');
const pill = gradient('#303746', '#232834'), quiet = gradient('#1c2029', '#151820');
const typeName = Object.assign({}, kinds, { tyres: '胎压胎温' });
const pages = Object.assign({}, modes, { thresholds: '颜色阈值', general: '通用设置' });
const W = 1836, H = 644;
function claims(placed) {
    // Claim the physical surface exactly, including any vertical letterbox on narrow layers.
    const x = -placed.ox / placed.scale || 0, y = -placed.oy / placed.scale || 0;
    const w = placed.w / placed.scale;
    return [{ x, y, w, h: 68 - y }, { x, y: 68, w, h: y + placed.h / placed.scale - 68 }];
}
const CLAIMS = claims({ w: W, h: H, ox: 0, oy: 0, scale: 1 });
function placement(screen, area) {
    const id8 = screen.w === 2880 && screen.h === 960;
    const left = id8 ? 0 : 84, top = 76, bottom = id8 ? 840 : screen.h;
    const box = area || { x: left, y: top, w: screen.w - left, h: bottom - top };
    const x = Math.max(left, box.x), y = Math.max(top, box.y);
    const w = Math.min(screen.w, box.x + box.w) - x, h = Math.min(bottom, box.y + box.h) - y;
    const scale = Math.min(h / H, w / W), logicalW = Math.max(W, Math.round(w / scale));
    return { x, y, w, h, scale, logicalW, ox: 0, oy: scale === h / H ? 0 : (h - H * scale) / 2 };
}
const TILT = { 1: 'N', 2: 'N', 4: 'E', 5: 'E', 7: 'S', 8: 'S', 10: 'W', 11: 'W' };
const between = (n, max) => Math.max(0, Math.min(n, max));
const contains = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

class Cockpit {
    constructor(paint, action, exit) {
        this.paint = paint;
        this.action = action;
        this.exit = exit;
        this.resize(W);
        this.showFocus = false;
        this.page = 'road';
        this.columns = { road: 0, sport: 0 };
        this.group = 'selected';
        this.metric = 'oil';
        this.offset = 0;
        this.thresholdOffset = 0;
    }

    resize(width) {
        const w = Math.max(W, Math.round(width || W));
        if (this.w === w) return;
        this.w = w;
        this.g = new Recorder(w, H);
    }

    text(label, x, y, size, color = C.text, align = 'left') {
        this.g.text(label, x, y, size, color, { align, literal: true });
    }
    line(x, y, w) { this.g.fillRect(x, y, w, 1, C.line); }

    target(id, x, y, w, h, run) {
        if (!run) return;
        this.g.target(x, y, w, h, run, id, 8);
        this.g.targets[this.g.targets.length - 1].region = this.region;
    }

    surface(x, y, w, h, r = 18, fill = glass, rim = C.line) {
        this.g.card(x, y, w, h, r, fill);
        this.g.strokeRoundRect(x, y, w, h, r, 1, rim);
    }

    button(id, label, x, y, w, h, run, danger = false) {
        if (danger) this.g.roundRect(x, y, w, h, 14, '#c9242c');
        else this.surface(x, y, w, h, 14, quiet, '#2b313e');
        this.text(label, x + w / 2, y + h / 2 + 7, 22, run ? C.text : C.disabled, 'center');
        this.target(id, x, y, w, h, run);
    }

    segments(items, x, y, w, h) {
        this.g.roundRect(x, y, w, h, 13, '#0b0d12');
        this.g.strokeRoundRect(x, y, w, h, 13, 1, '#212630');
        items.forEach(([id, label, run, selected], i) => {
            const left = x + Math.round(w * i / items.length);
            const cell = x + Math.round(w * (i + 1) / items.length) - left;
            if (selected) this.surface(left + 4, y + 4, cell - 8, h - 8, 10, pill, '#4c5568');
            else if (i && !items[i - 1][3]) this.g.fillRect(left, y + 15, 1, h - 30, '#282e3a');
            this.text(label, left + cell / 2, y + h / 2 + 7, 22, selected ? C.text : run ? C.sub : C.disabled, 'center');
            this.target(id, left, y, cell, h, run);
        });
    }

    toggle(x, y, on) {
        this.g.roundRect(x, y, 76, 38, 19, on ? C.blue : '#252a35');
        this.g.circle(x + (on ? 57 : 19), y + 19, 15, '#ffffff');
    }

    navIcon(page, x, y, color) {
        const g = this.g;
        if (page === 'road') {
            for (const dx of [-12, 2]) for (const dy of [-12, 2])
                g.strokeRoundRect(x + dx, y + dy, 10, 10, 2, 2, color);
        } else if (page === 'sport') {
            g.arc(x, y + 4, 13, 15, -116, 116, color);
            g.line(x, y + 4, x + 8, y - 5, 2, color);
            g.circle(x, y + 4, 2, color);
        } else if (page === 'thresholds') {
            [-8, 0, 8].forEach((dx, i) => g.roundRect(x + dx - 1, y + 2 - 6 * i, 3, 10 + 6 * i, 1, color));
        } else {
            [-8, 0, 8].forEach((dy, i) => {
                g.line(x - 13, y + dy, x + 13, y + dy, 2, color);
                g.roundRect(x + (i === 1 ? 5 : -7), y + dy - 4, 4, 8, 2, color);
            });
        }
    }

    openPage(page) {
        this.page = page;
        this.group = 'selected';
        this.offset = 0;
        this.focus = 'tab:' + page;
    }

    navigation(railW, notice, error) {
        const g = this.g, inset = 16, w = railW - inset * 2;
        this.region = 'header';
        g.gradientRect(0, 0, railW, H, rail);
        g.fillRect(railW - 1, 0, 1, H, '#222732');
        const logoW = this.w >= 2150 ? 188 : 168, logoH = Math.round(logoW * 178 / 425);
        g.picture(logo.id, Math.round((railW - logoW) / 2), Math.round((102 - logoH) / 2), logoW, logoH, 0);
        this.line(inset, 104, w);
        Object.keys(pages).forEach((page, i) => {
            const y = 116 + 82 * i, selected = this.page === page;
            if (selected) {
                this.surface(inset, y, w, 72, 16, active, '#424b5d');
                g.roundRect(inset + 5, y + 19, 4, 34, 2, this.accent);
            }
            const color = selected ? C.text : C.sub;
            this.navIcon(page, inset + 39, y + 36, color);
            this.text(page === 'general' ? '通用' : pages[page], inset + 69, y + 44, 24, color);
            this.target('tab:' + page, inset, y, w, 72, () => this.openPage(page));
        });
        if (notice) {
            const color = error ? '#ff9ca2' : this.soft;
            g.roundRect(inset, 508, w, 44, 14, error ? '#371b21' : '#171b23');
            g.circle(inset + 18, 530, 4, error ? color : this.accent);
            const size = this.g.textWidth(notice, 20) > w - 48 ? 18 : 20;
            this.text(notice, inset + 32, 537, size, color);
        }
        this.button('restore', '恢复默认', inset, 566, w, 52, () => {
            this.confirm = true;
            this.focus = 'cancel';
        });
    }

    frame(menu, notice, error) {
        const g = this.g.reset(), wide = this.w >= 2150, railW = wide ? 292 : 244, pad = wide ? 44 : 28;
        const cx = railW + pad, cw = this.w - railW - 2 * pad;
        this.scroll = null;
        this.accent = this.page === 'sport' ? C.crimson : C.blue;
        this.soft = this.page === 'sport' ? '#ff6b72' : '#6cb4ff';
        g.clear('#050608');
        g.gradientRect(0, 0, this.w, H, ground);
        this.navigation(railW, notice, error);
        this.text(pages[this.page], cx, 61, 36);
        this.line(cx, 84, cw);
        if (menu) {
            const layout = menu.config.modes[this.page];
            const summary = layout ? layout.columns.length + ' 栏 · ' + (layout.primary === null ? '等宽' :
                (layout.primary + 1) + ' 栏主视图') : this.page === 'general' ? '全局采集配置' :
                Object.keys(menu.config.thresholds).length + ' 项已开启';
            this.text(summary, cx + cw, 58, 22, C.sub, 'right');
            if (this.page === 'general') this.general(menu, cx, cw);
            else {
                const gap = 24, lw = Math.round((cw - gap) * (layout ? 0.43 : 0.44)), rw = cw - lw - gap;
                const right = cx + lw + gap, inset = 24;
                this.surface(cx, 104, lw, 516);
                this.surface(right, 104, rw, 516);
                if (layout) this.layout(menu, cx + inset, lw - 2 * inset, right + inset, rw - 2 * inset);
                else this.thresholds(menu, cx + inset, lw - 2 * inset, right + inset, rw - 2 * inset);
            }
        } else {
            this.text(error ? '退出后重新打开设置' : '正在读取设置', cx, 164, 28, C.sub);
            g.targets.length = 0;
        }
        if (this.confirm) this.confirmReset(menu);
        const focused = g.targets.find(t => t.key === this.focus) || g.targets[0];
        this.focus = focused ? focused.key : null;
        if (this.showFocus && focused)
            g.strokeRoundRect(focused.x, focused.y, focused.w, focused.h, 12, 2, C.focus);
        return g;
    }

    general(menu, x, w) {
        const enabled = menu.config.obdCoexistence;
        this.region = 'left';
        this.surface(x, 104, w, 174);
        this.text('OBD 外设共存', x + 32, 182, 33);
        this.text('采集频率与外设兼容性设置，全局生效', x + 32, 230, 23, C.sub);
        this.toggle(x + w - 108, 172, enabled);
        this.text(enabled ? '已开启' : '已关闭', x + w - 132, 199, 24, enabled ? this.soft : C.sub, 'right');
        this.target('obd-coexistence', x, 104, w, 174, () => menu.toggleCoexistence());

        const cardW = (w - 24) / 2;
        ['关闭（默认）', '开启'].forEach((label, i) => {
            const left = x + i * (cardW + 24), selected = enabled === !!i;
            this.surface(left, 302, cardW, 318, 18, selected ? active : glass, selected ? '#424b5d' : C.line);
            this.text(label, left + 32, 363, 28);
            if (selected) this.g.circle(left + cardW - 38, 352, 6, this.accent);
            this.text(i ? '错峰退让，兼容外接 OBD 换挡灯或扩展仪表' : '常规高频刷新，适合未接其他 OBD 外设', left + 32, 410, 22, C.sub);
            this.line(left + 32, 444, cardW - 64);
            [i ? '3 s' : '1 s', i ? '25 s' : '10 s'].forEach((value, j) => {
                const col = left + 32 + j * (cardW - 64) / 2;
                this.text(value, col, 528, 44);
                this.text(j ? '数据保留' : '采集间隔', col, 573, 22, C.sub);
            });
        });
    }

    layout(menu, left, width, right, detail) {
        const mode = this.page, layout = menu.config.modes[mode], count = layout.columns.length;
        const col = this.columns[mode] = between(this.columns[mode], count - 1), card = layout.columns[col];
        this.region = 'left';
        this.text('仪表布局', left, 148, 28);
        this.text('栏数', left, 187, 20, C.sub);
        this.segments([1, 2, 3].map(n => ['count:' + n, n + ' 栏', () => menu.size(mode, n), n === count]),
            left, 199, width, 52);
        this.text('宽度比例', left, 286, 20, C.sub);
        const choices = count === 1 ? [null] : [null].concat(layout.columns.map((_, i) => i));
        this.segments(choices.map(i => ['primary:' + i, i === null ? '等宽' : (i + 1) + ' 栏主',
            count > 1 ? () => menu.primary(mode, i) : null, i === layout.primary]), left, 298, width, 52);

        this.text('栏位预览', left, 390, 22, C.sub);
        this.g.roundRect(left, 404, width, 136, 14, '#07080c');
        const weight = count + (layout.primary === null ? 0 : 0.6), gap = 8;
        const area = width - 16 - gap * (count - 1);
        let x = left + 8;
        layout.columns.forEach((item, i) => {
            const primary = layout.primary === i, w = area * (primary ? 1.6 : 1) / weight;
            const selected = col === i;
            this.surface(x, 412, w, 120, 10, selected ? active : glass, selected ? '#424b5d' : '#212630');
            if (selected) this.g.roundRect(x + 12, 413, w - 24, 3, 1.5, this.accent);
            this.text(columnName(i), x + 14, 444, 18, C.sub);
            if (primary && count > 1) {
                this.g.roundRect(x + w - 76, 423, 65, 28, 9, '#303746');
                this.text('主视图', x + w - 44, 443, 17, C.text, 'center');
            }
            this.text(typeName[item.type], x + 14, 481, 25);
            const summary = item.type === 'data' ? item.metrics.length + ' 项' :
                item.type === 'tyres' ? [item.pressure ? '胎压' : '', item.temperature ? '胎温' : ''].filter(Boolean).join(' + ') : '实时 G 值';
            this.text(summary, x + 14, 514, 19, C.sub);
            this.target('column:' + i, x, 412, w, 120, () => {
                this.columns[mode] = i;
                this.group = 'selected';
                this.offset = 0;
            });
            x += w + gap;
        });
        if (count > 1) {
            const move = d => async () => {
                await menu.moveColumn(mode, col, col + d);
                this.columns[mode] = col + d;
                this.focus = 'column:' + (col + d);
            };
            this.button('column:left', '← 左移', left, 556, 142, 48, col > 0 ? move(-1) : null);
            this.button('column:right', '右移 →', left + 152, 556, 142, 48, col + 1 < count ? move(1) : null);
        }
        this.region = 'right';
        this.text(columnName(col) + ' · ' + typeName[card.type], right, 148, 28);
        const shown = capacity(mode, layout, col);
        if (card.type === 'data') {
            const total = card.metrics.length, overflow = total > shown;
            const label = '已选 ' + total + ' 项' + (overflow ? ' · 显示前 ' + shown + ' 项' : '');
            const badgeW = this.g.textWidth(label, 18) + 26;
            this.g.roundRect(right + detail - badgeW, 119, badgeW, 34, 12, overflow ? '#342b20' : '#222732');
            this.text(label, right + detail - 13, 142, 18, overflow ? C.amber : C.sub, 'right');
        }
        this.segments(cardTypes.map(key => ['type:' + key, typeName[key], () => menu.type(mode, col, key), key === card.type]),
            right, 165, detail, 52);
        if (card.type === 'tyres') {
            const both = card.pressure && card.temperature;
            tyreFields.forEach(([key], i) => {
                const y = 244 + i * 92, editable = !card[key] || both;
                this.text(key === 'pressure' ? '胎压显示' : '胎温显示', right + 12, y + 52, 26, editable ? C.text : C.disabled);
                this.toggle(right + detail - 84, y + 25, card[key]);
                this.line(right, y + 89, detail);
                this.target('tyre:' + key, right, y, detail, 88, editable ? () => menu.tyre(mode, col, key) : null);
            });
            this.text('至少保留胎压或胎温中的一项', right + 12, 480, 22, C.sub);
        } else if (card.type === 'g') {
            this.gauge(right, detail);
        } else {
            this.data(menu, mode, col, card.metrics, shown, right, detail);
        }
    }

    gauge(x, w) {
        const g = this.g, cx = x + w * 0.25, cy = 399;
        g.circle(cx, cy, 133, '#0b0d12');
        [38, 77, 115, 132].forEach(r => g.arc(cx, cy, r - 1, r, 0, 360, '#353b48'));
        g.line(cx - 122, cy, cx + 122, cy, 1, C.line);
        g.line(cx, cy - 122, cx, cy + 122, 1, C.line);
        g.polyline([[-66,-32], [-43,-63], [14,-84], [59,-52], [88,5], [62,51], [26,69], [-47,55], [-66,-32]]
            .map(([dx, dy]) => [cx + dx, cy + dy]), 2, '#424b5d');
        [[-31, 25, 3, '#344c62'], [-19, 19, 3, '#517594'], [-8, 12, 4, '#8aaabd'],
            [2, 4, 4, '#c99da9'], [12, -7, 5, '#e36670'], [22, -21, 7, C.crimson]]
            .forEach(([dx, dy, r, color]) => g.circle(cx + dx, cy + dy, r, color));
        this.text('轨迹示意', cx, 570, 20, C.sub, 'center');
        const left = x + w * 0.49;
        this.text('实时 G 值点', left, 365, 30);
        this.text('保留最近 2 秒的拖影', left, 419, 23, C.sub);
        this.text('记录本次驾驶极值轮廓', left, 459, 23, C.sub);
    }

    data(menu, mode, col, keys, shown, x, w) {
        const groups = [['selected', '已选 (' + keys.length + ')'], ['perf', '动力'], ['temp', '温度'],
            ['pressure', '压力'], ['tyre', '驾驶']];
        this.line(x, 271, w);
        groups.forEach(([id, label], i) => {
            const left = x + Math.round(w * i / groups.length);
            const cell = x + Math.round(w * (i + 1) / groups.length) - left;
            const selected = this.group === id;
            this.text(label, left + cell / 2, 255, 21, selected ? C.text : C.sub, 'center');
            if (selected) this.g.roundRect(left + 12, 269, cell - 24, 3, 1.5, this.accent);
            this.target('group:' + id, left, 221, cell, 52, () => { this.group = id; this.offset = 0; });
        });
        if (this.group !== 'selected') {
            const list = catalog.filter(m => m.group === this.group), cell = (w - 12) / 2;
            list.forEach((m, i) => {
                const left = x + (i % 2) * (cell + 12), y = 279 + Math.floor(i / 2) * 55, checked = keys.includes(m.key);
                this.g.roundRect(left, y, cell, 48, 12, checked ? '#282e3a' : '#1c2029');
                this.g.arc(left + 25, y + 24, checked ? 0 : 9, 11, 0, 360, checked ? C.blue : C.disabled);
                if (checked) this.g.polyline([[left + 20, y + 24], [left + 24, y + 28], [left + 30, y + 20]], 2, '#ffffff');
                this.text(m.name, left + 49, y + 32, 23);
                this.text(m.unit, left + cell - 16, y + 31, 20, C.sub, 'right');
                this.target('metric:' + m.key, left, y, cell, 48, () => menu.toggleMetric(mode, col, m.key));
            });
            return;
        }
        if (!keys.length) {
            this.text('尚未选择指标', x, 344, 28);
            this.text('从上方分组选择要显示的项目', x, 384, 23, C.sub);
            return;
        }

        const limit = 5, step = 54, top = 281;
        this.offset = between(this.offset, Math.max(0, keys.length - limit));
        const move = (key, i, delta) => async () => {
            await menu.moveMetric(mode, col, i, i + delta);
            this.offset = between(i + delta < this.offset ? i + delta : Math.max(this.offset, i + delta - limit + 1),
                Math.max(0, keys.length - limit));
            if (i + 2 * delta < 0 || i + 2 * delta >= keys.length) this.focus = 'remove:' + key;
        };
        keys.slice(this.offset, this.offset + limit).forEach((key, j) => {
            const i = this.offset + j, m = metrics.get(key), y = top + j * step;
            if (i === shown || (i > shown && j === 0)) this.g.fillRect(x, y - 5, w, 1, C.amber);
            this.line(x, y + 51, w);
            this.text(String(i + 1).padStart(2, '0'), x + 8, y + 35, 22, i < shown ? C.sub : C.amber);
            this.text(m.name, x + 64, y + 35, 25);
            this.text(m.unit, x + w * 0.42, y + 35, 21, C.sub);
            if (i === shown || (i > shown && j === 0)) {
                this.g.roundRect(x + w - 277, y + 10, 84, 29, 10, '#342b20');
                this.text('窄栏折叠', x + w - 235, y + 31, 17, C.amber, 'center');
            }
            this.button('up:' + key, '↑', x + w - 180, y, 50, 48, i > 0 ? move(key, i, -1) : null);
            this.button('down:' + key, '↓', x + w - 120, y, 50, 48, i + 1 < keys.length ? move(key, i, 1) : null);
            this.button('remove:' + key, '×', x + w - 52, y, 50, 48, async () => {
                await menu.toggleMetric(mode, col, key);
                const next = keys[i + 1] || keys[i - 1];
                this.focus = next ? 'remove:' + next : 'group:selected';
            });
        });
        this.pager('offset', keys.length, limit, step, x, top, w);
    }

    pager(field, total, count, step, x, top, w) {
        const max = Math.max(0, total - count);
        if (max === 0) return;
        const offset = this[field], y = 563;
        const shift = n => () => {
            this[field] = between(offset + n, max);
            if (this[field] === 0) this.focus = field + ':next';
            if (this[field] === max) this.focus = field + ':prev';
        };
        this.scroll = { x, y: top, w, h: y - top, field, max, step };
        this.text((offset + 1) + '–' + Math.min(offset + count, total) + ' / ' + total, x + 8, y + 33, 22, C.sub);
        this.button(field + ':prev', '上一页', x + w - 278, y, 132, 48, offset > 0 ? shift(-count) : null);
        this.button(field + ':next', '下一页', x + w - 134, y, 134, 48, offset < max ? shift(count) : null);
    }

    thresholds(menu, x, w, right, detail) {
        const top = 146, step = 52, count = 8;
        this.region = 'left';
        this.text('指标', x, 136, 22, C.sub);
        orderedThresholds.slice(this.thresholdOffset, this.thresholdOffset + count).forEach((m, i) => {
            const y = top + i * step, t = menu.config.thresholds[m.key], selected = this.metric === m.key;
            if (selected) {
                this.surface(x, y, w, 48, 12, active, '#424b5d');
                this.g.roundRect(x + 5, y + 11, 3, 26, 1.5, this.accent);
            } else this.line(x + 14, y + 49, w - 28);
            this.text(m.name, x + 18, y + 32, 23);
            this.g.circle(x + w - 208, y + 24, 4, t ? (m.kind === 'temp' ? C.cold : C.amber) : C.disabled);
            this.g.circle(x + w - 194, y + 24, 4, t ? C.hot : C.disabled);
            this.text(range(t, m), x + w - 14, y + 31, 21, t ? C.text : C.sub, 'right');
            this.target('limit:' + m.key, x, y, w, 48, () => { this.metric = m.key; });
        });
        this.pager('thresholdOffset', orderedThresholds.length, count, step, x, top, w);

        this.region = 'right';
        const m = orderedThresholds.find(m => m.key === this.metric), t = menu.config.thresholds[m.key];
        const description = m.kind === 'temp' ? '低温蓝 / 高温红' :
            m.kind === 'pressure' ? '低压琥珀 / 高压红' : '低值琥珀 / 高值红';
        this.text(m.name, right, 149, 30);
        this.text(description, right, 183, 21, C.sub);
        this.line(right, 202, detail);
        this.text('颜色提醒', right, 252, 25);
        this.text(t ? '已开启' : '已关闭', right + detail - 98, 251, 21, t ? this.soft : C.sub, 'right');
        this.toggle(right + detail - 76, 223, !!t);
        this.target('limit:enable', right, 209, detail, 64, () => menu.threshold(m, !t));
        this.line(right, 281, detail);
        const lowColor = m.kind === 'temp' ? C.cold : C.amber;
        this.thresholdLine(menu, m, t, 'low', right, 291, detail, lowColor);
        this.thresholdLine(menu, m, t, 'high', right, 374, detail, C.hot);
        const value = t || m.default, band = detail / 3;
        const colors = t ? [lowColor, '#9aa3b2', C.hot] : [C.line, C.line, C.line];
        this.text(t ? '提醒范围' : '默认范围 · 提醒已关闭', right, 487, 20, C.sub);
        const labels = ['< ' + value.low + ' ' + m.unit,
            '≥ ' + value.low + ' / ' + (m.kind === 'info' ? '≤ ' : '< ') + value.high + ' ' + m.unit,
            (m.kind === 'info' ? '> ' : '≥ ') + value.high + ' ' + m.unit];
        labels.forEach((label, i) => {
            this.g.roundRect(right + band * i, 501, band - 3, 10, 5, colors[i]);
            this.text(label, right + band * (i + 0.5), 539, 20, C.sub, 'center');
        });
        this.button('limit:default', '恢复此项默认', right, 562, 190, 48, () => menu.threshold(m, true));
    }

    thresholdLine(menu, m, t, key, x, y, w, color) {
        this.text(m[key + 'Label'], x, y + 22, 20, C.sub);
        this.text(t ? t[key] + ' ' + m.unit : '—', x, y + 62, 34, t ? color : C.disabled);
        const controlW = Math.round(w * 0.58);
        this.segments([-m.bigStep, -m.smallStep, m.smallStep, m.bigStep]
            .map((delta, i) => [key + ':' + i, delta > 0 ? '+' + delta : String(delta),
                canAdjust(t, key, delta) ? () => menu.adjust(m, key, delta) : null]),
        x + w - controlW, y + 12, controlW, 54);
        this.line(x, y + 78, w);
    }

    confirmReset(menu) {
        this.g.targets.length = 0;
        this.scroll = null;
        this.region = 'confirm';
        const w = 720, h = 252, x = (this.w - w) / 2, y = (H - h) / 2;
        this.g.fillRect(0, 0, this.w, H, [4, 5, 8, 200]);
        this.surface(x, y, w, h, 20, glass, '#424b5d');
        this.text('恢复全部默认设置？', x + 34, y + 70, 34);
        this.text('所有设置都将恢复默认，OBD 外设共存将关闭。', x + 34, y + 119, 23, C.sub);
        this.button('cancel', '取消', x + 34, y + 162, 166, 56, () => this.cancelReset());
        this.button('confirm', '确认恢复默认', x + w - 244, y + 162, 210, 56, async () => {
            await menu.reset();
            this.columns = { road: 0, sport: 0 };
            this.group = 'selected';
            this.offset = 0;
            this.metric = 'oil';
            this.thresholdOffset = 0;
            this.cancelReset();
        }, true);
    }

    cancelReset() {
        this.confirm = false;
        this.focus = 'restore';
    }

    back() {
        if (this.confirm) this.cancelReset();
        else if (this.page !== 'thresholds' && this.group !== 'selected') {
            this.group = 'selected';
            this.offset = 0;
            this.focus = 'group:selected';
        } else return this.exit();
        this.paint();
    }

    press(target) {
        if (!target) return;
        this.focus = target.key;
        this.action(target.run);
    }

    touch(phase, x, y) {
        if (this.showFocus) {
            this.showFocus = false;
            this.paint();
        }
        if (phase === 1) {
            const scroll = this.scroll && contains(this.scroll, x, y) ? this.scroll : null;
            this.gesture = { x, y, scroll, offset: scroll ? this[scroll.field] : 0 };
            return;
        }
        const down = this.gesture;
        if (!down) return;
        if (Math.abs(y - down.y) >= 22 || Math.abs(x - down.x) >= 22) down.drag = true;
        if (down.drag && down.scroll) {
            const s = down.scroll, steps = Math.round((down.y - y) / s.step);
            const next = between(down.offset + steps, s.max);
            if (next !== this[s.field]) { this[s.field] = next; this.paint(); }
        }
        if (phase === 3) {
            this.gesture = null;
            if (!down.drag) this.press(this.g.targets.find(t => contains(t, down.x, down.y) && contains(t, x, y)));
        }
    }

    ccu(event) {
        const current = {
            knob: event.frontRotaryEncoderOperation, press: event.frontRotaryEncoderPushButton,
            tilt: TILT[event.frontRotaryEncoderDeflection]
        };
        if (current.press === 15 && event.frontRotaryEncoderDeflection === 15) return;
        if (!this.showFocus) {
            this.showFocus = true;
            this.paint();
        }
        const last = this.ccuLast;
        this.ccuLast = current;
        const tilt = current.tilt !== (last && last.tilt) ? current.tilt : null;
        const targets = this.g.targets;
        const index = Math.max(0, targets.findIndex(t => t.key === this.focus));
        const focused = targets[index];
        if (tilt === 'W') return this.back();
        if (!focused) return;
        const delta = last ? ((current.knob - last.knob + 32768) & 0xffff) - 32768 : 0;
        if (delta && Math.abs(delta) <= 64) {
            this.focus = targets[between(index + delta, targets.length - 1)].key;
            this.paint();
        } else if (tilt && !this.confirm) {
            const region = tilt === 'N' ? 'header' : tilt === 'E' ? 'right' : focused.region === 'header' ? 'left' : 'right';
            const target = targets.find(t => t.region === region && (region !== 'header' || t.key === 'tab:' + this.page));
            if (target) { this.focus = target.key; this.paint(); }
        } else if ((current.press === 1 || current.press === 2) && (!last || (last.press !== 1 && last.press !== 2))) {
            this.press(focused);
        }
    }
}

module.exports = { Cockpit, placement, claims, CLAIMS };
