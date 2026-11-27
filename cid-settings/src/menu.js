'use strict';
const { groups, catalog, thresholdCatalog, kinds, copy, defaults, switchCardType, capacity, resize, setPrimary } = require('./settings.js');
const modes = { road: '普通模式', sport: '运动模式' };
const cardTypes = ['data', 'tyres', 'g'];
const tyreFields = [['pressure', '显示胎压'], ['temperature', '显示胎温']];
const groupNames = { temp: '温度', pressure: '压力', perf: '性能', tyre: '四轮' };
const metrics = new Map(catalog.map(m => [m.key, m]));
const orderedThresholds = thresholdCatalog.filter(m => m.key !== 'outside');
orderedThresholds.splice(9, 0, thresholdCatalog.find(m => m.key === 'outside'));
const columnName = i => '第 ' + (i + 1) + ' 栏';
const range = (t, m) => t ? t.low + ' ~ ' + t.high + ' ' + m.unit : '已关闭';
const stepValue = (t, key, delta) => Number((t[key] + delta).toFixed(2));
const canAdjust = (t, key, delta) => {
    if (!t) return false;
    const next = stepValue(t, key, delta);
    return next !== t[key] && (key === 'low' ? next < t.high : next > t.low);
};

class Menu {
    constructor(config, save) {
        this.config = config;
        this.save = save;
        this.mode = 'road';
        this.page = 'home';
        this.column = 0;
        this.metric = 'oil';
        this.group = 'temp';
    }

    async replace(next) { this.config = await this.save(next); }
    async change(edit) {
        const next = copy(this.config);
        edit(next);
        await this.replace(next);
    }
    reset() { return this.replace(defaults()); }
    toggleCoexistence() { return this.change(c => { c.obdCoexistence = !c.obdCoexistence; }); }
    size(mode, count) { return this.change(c => resize(c.modes[mode], count)); }
    primary(mode, index) { return this.change(c => setPrimary(c.modes[mode], index)); }
    moveColumn(mode, from, to) {
        return this.change(c => {
            const layout = c.modes[mode], columns = layout.columns;
            [columns[from], columns[to]] = [columns[to], columns[from]];
            if (layout.primary === from) layout.primary = to;
            else if (layout.primary === to) layout.primary = from;
        });
    }
    card(mode, index, edit) {
        return this.change(c => { edit(c.modes[mode].columns, index); });
    }
    type(mode, index, type) {
        return this.card(mode, index, (cards, i) => { cards[i] = switchCardType(cards[i], type); });
    }
    tyre(mode, index, key) {
        return this.card(mode, index, (cards, i) => { cards[i][key] = !cards[i][key]; });
    }
    toggleMetric(mode, index, key) {
        return this.card(mode, index, (cards, i) => {
            const list = cards[i].metrics, pos = list.indexOf(key);
            if (pos < 0) list.push(key);
            else list.splice(pos, 1);
        });
    }
    moveMetric(mode, index, from, to) {
        return this.card(mode, index, (cards, i) => {
            const list = cards[i].metrics;
            [list[from], list[to]] = [list[to], list[from]];
        });
    }
    threshold(m, enabled) {
        return this.change(c => {
            if (enabled) c.thresholds[m.key] = copy(m.default);
            else delete c.thresholds[m.key];
        });
    }
    adjust(m, key, delta) {
        return this.change(c => {
            const t = c.thresholds[m.key];
            t[key] = stepValue(t, key, delta);
        });
    }

    syncCursor() {
        const columns = this.config.modes[this.mode].columns;
        if (this.column >= columns.length) {
            this.column = 0;
            this.page = 'layout';
        }
        if (['choose', 'group', 'groups'].includes(this.page) && columns[this.column].type !== 'data') this.page = 'card';
        if (!orderedThresholds.some(m => m.key === this.metric)) this.metric = orderedThresholds[0].key;
    }

    title() {
        this.syncCursor();
        const { page, mode, column, metric, group } = this;
        const name = modes[mode];
        const cardTitle = () => name + ' / ' + columnName(column) + ' · ' + kinds[this.config.modes[mode].columns[column].type];
        if (page === 'layout') return name;
        if (page === 'card') return cardTitle();
        if (page === 'groups') return cardTitle() + ' / 数据项目';
        if (page === 'choose') return cardTitle() + ' / ' + groupNames[group];
        if (page === 'thresholds') return '颜色阈值';
        if (page === 'metric') return '颜色阈值 / ' + orderedThresholds.find(m => m.key === metric).name;
        if (page === 'reset') return '恢复默认';
        return '87 Arcade 设置';
    }

    rows() {
        this.syncCursor();
        const { config, mode, column, page } = this, layout = config.modes[mode];
        const row = (label, run, value = '') => ({ label, run, value });
        const go = page => () => { this.page = page; };
        const parent = { metric: 'thresholds', card: 'layout', groups: 'card', choose: 'groups' };
        const back = row('返回', go(parent[page] || 'home'));
        if (page === 'home') return [
            ...Object.keys(modes).map(key => row(modes[key], () => { this.mode = key; this.page = 'layout'; }, config.modes[key].columns.length + ' 栏')),
            row('颜色阈值', go('thresholds'), Object.keys(config.thresholds).length + ' 项开启'),
            row('OBD 外设共存', () => this.toggleCoexistence(), config.obdCoexistence ? '开启' : '关闭'),
            row('恢复默认', go('reset'))
        ];
        if (page === 'reset') return [back, row('确认恢复默认', async () => { await this.reset(); this.page = 'home'; }, '所有设置')];
        if (page === 'layout') return [back,
            ...[1, 2, 3].map(n => row(n + ' 栏', () => this.size(mode, n), layout.columns.length === n ? '已选' : '')),
            ...(layout.columns.length > 1 ? [row('切换宽度', () => this.primary(mode,
                layout.primary === null ? 0 : layout.primary + 1 >= layout.columns.length ? null : layout.primary + 1),
            layout.primary === null ? '等宽' : columnName(layout.primary) + '为主')] : []),
            ...layout.columns.map((card, i) => row(columnName(i), () => { this.column = i; this.page = 'card'; }, kinds[card.type]))
        ];
        const card = layout.columns[column];
        if (page === 'card') return [back,
            ...cardTypes.map(type => row(kinds[type], () => this.type(mode, column, type), card.type === type ? '已选' : '')),
            ...[[-1, '左移'], [1, '右移']].filter(([d]) => layout.columns[column + d]).map(([d, label]) =>
                row(label, async () => { await this.moveColumn(mode, column, column + d); this.column += d; }, columnName(column + d))),
            ...(card.type === 'data' ? [row('数据项目', go('groups'), card.metrics.length + ' 项 / 显示前 ' + capacity(mode, layout, column) + ' 项')] : []),
            ...(card.type === 'tyres' ? tyreFields.filter(([key]) => !card[key] || (card.pressure && card.temperature)).map(([key, label]) =>
                row(label, () => this.tyre(mode, column, key), card[key] ? '开启' : '关闭')) : [])
        ];
        if (page === 'groups') return [back, ...groups.map(g => row(groupNames[g.id], () => { this.group = g.id; this.page = 'choose'; },
            catalog.filter(m => m.group === g.id && card.metrics.includes(m.key)).length + ' 项已选'))];
        if (page === 'choose') return [back, ...catalog.filter(m => m.group === this.group).map(m =>
            row(m.name, () => this.toggleMetric(mode, column, m.key), (card.metrics.includes(m.key) ? '已选 · ' : '') + m.unit))];
        if (page === 'thresholds') return [back, ...orderedThresholds.map(m =>
            row(m.name, () => { this.metric = m.key; this.page = 'metric'; }, range(config.thresholds[m.key], m)))];
        const m = orderedThresholds.find(m => m.key === this.metric), t = config.thresholds[m.key];
        return [back,
            row(t ? '关闭颜色提醒' : '开启颜色提醒', () => this.threshold(m, !t), range(t, m)),
            ...(!t ? [] : ['low', 'high'].reduce((rows, key) => rows.concat(
                [-m.bigStep, -m.smallStep, m.smallStep, m.bigStep]
                    .filter(delta => canAdjust(t, key, delta))
                    .map(delta => row(m[key + 'Label'] + ' · ' + (delta > 0 ? '+' + delta : String(delta)), () => this.adjust(m, key, delta), t[key] + ' ' + m.unit))
            ), [])),
            row('恢复此项默认', () => this.threshold(m, true), range(m.default, m))
        ];
    }
}
module.exports = { Menu, modes, cardTypes, tyreFields, groupNames, metrics, orderedThresholds, columnName, range, canAdjust };
