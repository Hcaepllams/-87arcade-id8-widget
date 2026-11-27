"use strict";
// One schema shared by the native settings app, widget and offline workbench.
const groups = [
    { id: 'temp', name: '温度' },
    { id: 'pressure', name: '压力' },
    { id: 'perf', name: '性能与车况' },
    { id: 'tyre', name: '四轮单项' }
];
const catalog = [
    // Group, kind, and threshold are independent (e.g. tyre pressures).
    ['oil', 'temp', '机油温度', 'OIL TEMP', '°C', 0, 0, 150, 'temp', 'oil'],
    ['coolant', 'temp', '冷却液温度', 'WATER', '°C', 0, 0, 130, 'temp', 'coolant'],
    ['gearbox', 'temp', '变速箱油温', 'GEAR OIL', '°C', 0, 0, 150, 'temp', 'gearbox'],
    ['iat', 'temp', '进气温度', 'IAT', '°C', 0, -20, 100, 'temp', 'iat'],
    ['outside', 'temp', '车外温度', 'AMBIENT', '°C', 1, -30, 60, 'temp', 'outside'],
    ['oilPressure', 'pressure', '机油压力', 'OIL PRESS', 'bar', 1, 0, 10, 'pressure', 'oilPressure'],
    ['fuelRail', 'pressure', '高压油压', 'HPFP', 'bar', 0, 0, 350, 'pressure', 'fuelRail'],
    ['boost', 'pressure', '涡轮增压', 'BOOST', 'bar', 2, -0.5, 3, 'pressure', 'boost'],
    ['rpm', 'perf', '发动机转速', 'RPM', 'rpm', 0, 0, 7500, 'info', 'rpm'],
    ['speed', 'perf', '车速', 'SPEED', 'km/h', 0, 0, 300, 'info', null],
    ['power', 'perf', '实时功率', 'POWER', 'kW', 0, 0, 450, 'info', null],
    ['torque', 'perf', '实时扭矩', 'TORQUE', 'Nm', 0, -100, 700, 'info', null],
    ['pedal', 'perf', '油门开度', 'THROTTLE', '%', 0, 0, 100, 'info', null],
    ['steer', 'perf', '方向盘转角', 'STEER', '°', 0, -540, 540, 'info', null],
    ['gLat', 'perf', '横向 G 值', 'LAT G', 'g', 2, -2, 2, 'g', null],
    ['gLong', 'perf', '纵向 G 值', 'LONG G', 'g', 2, -2, 2, 'g', null],
    ['gTotal', 'perf', '合成 G 值', 'TOTAL G', 'g', 2, 0, 2, 'g', null],
    ['battery', 'perf', '12V 电量', '12V BATT', '%', 0, 0, 100, 'info', 'battery'],
    ['tank', 'perf', '油箱余量', 'FUEL', 'L', 0, 0, 55, 'info', 'tank'],
    ['range', 'perf', '剩余续航', 'RANGE', 'km', 0, 0, 650, 'info', null]
].map(([key, group, name, label, unit, decimals, min, max, kind, thresholdKey]) =>
    ({ key, group, name, label, unit, decimals, min, max, kind, thresholdKey }));

const wheels = [['FL', '左前'], ['FR', '右前'], ['RL', '左后'], ['RR', '右后']];
for (const [wheel, name] of wheels) {
    catalog.push(
        { key: 'pressure' + wheel, group: 'tyre', name: name + '胎压', label: wheel + ' PRESS', unit: 'bar', decimals: 1, min: 0, max: 6, kind: 'pressure', thresholdKey: 'tyrePressure' },
        { key: 'tyre' + wheel, group: 'tyre', name: name + '胎温', label: wheel + ' TEMP', unit: '°C', decimals: 0, min: -40, max: 150, kind: 'temp', thresholdKey: 'tyreTemp' }
    );
}
const thresholdStyle = {
    temp: { lowColor: '#64bde9', lowLabel: '低温低于', highLabel: '高温达到' },
    pressure: { lowColor: '#f0b46c', lowLabel: '低压低于', highLabel: '高压达到' },
    info: { lowColor: '#f0b46c', lowLabel: '低于', highLabel: '高于' }
};
const thresholdCatalog = [
    ['oil', '机油温度', '°C', 'temp', 70, 125, 1, 5, 0, 160],
    ['coolant', '冷却液温度', '°C', 'temp', 60, 112, 1, 5, 0, 140],
    ['gearbox', '变速箱油温', '°C', 'temp', 55, 120, 1, 5, 0, 160],
    ['iat', '进气温度', '°C', 'temp', 5, 55, 1, 5, -20, 110],
    ['tyreTemp', '四轮胎温（共用）', '°C', 'temp', 20, 85, 1, 5, -20, 130],
    ['outside', '车外温度', '°C', 'temp', 3, 40, 1, 5, -30, 60],
    ['oilPressure', '机油压力', 'bar', 'pressure', 1.2, 6.5, 0.1, 0.5, 0, 10],
    ['fuelRail', '高压油压', 'bar', 'pressure', 40, 320, 5, 20, 0, 380],
    ['boost', '涡轮增压', 'bar', 'pressure', -0.3, 1.8, 0.1, 0.5, -0.5, 3.5],
    ['tyrePressure', '四轮胎压（共用）', 'bar', 'pressure', 2.1, 2.9, 0.1, 0.5, 0.5, 5],
    ['rpm', '发动机转速', 'rpm', 'info', 500, 6800, 100, 500, 0, 8000],
    ['battery', '12V 电量', '%', 'info', 50, 100, 5, 10, 0, 100],
    ['tank', '油箱余量', 'L', 'info', 8, 55, 2, 5, 0, 60]
].map(([key, name, unit, kind, low, high, smallStep, bigStep, min, max]) =>
    Object.assign({ key, name, unit, kind, default: {low, high}, smallStep, bigStep, min, max, highColor: '#ff4d45' }, thresholdStyle[kind]));
const byKey = new Map(catalog.map(m => [m.key, m]));
const kinds = { tyres: '轮胎', g: 'G 值表', data: '数据卡片' };
const copy = value => JSON.parse(JSON.stringify(value));
const dataCard = keys => ({ type: 'data', metrics: keys.slice() });
const tyreCard = () => ({ type: 'tyres', pressure: true, temperature: true });
function defaults() {
    return { version: 2, obdCoexistence: false, modes: {
        road: { primary: null, hidden: [], columns: [dataCard(['oil', 'coolant', 'gearbox', 'iat']), tyreCard(), dataCard(['oilPressure', 'fuelRail', 'boost'])] },
        sport: { primary: 1, hidden: [], columns: [tyreCard(), { type: 'g' }, dataCard(['oil', 'coolant', 'gearbox', 'iat', 'oilPressure', 'fuelRail', 'boost'])] }
    }, thresholds: { oil: copy(thresholdCatalog[0].default), coolant: copy(thresholdCatalog[1].default) } };
}
function resize(layout, count) {
    const cards = layout.columns.concat(layout.hidden || []);
    while (cards.length < count) cards.push(dataCard(['oil', 'coolant']));
    layout.columns = cards.slice(0, count);
    layout.hidden = cards.slice(count);
    if (layout.primary >= count) {
        layout.hiddenPrimary = layout.primary;
        layout.primary = null;
    } else if (layout.hiddenPrimary < count) {
        setPrimary(layout, layout.hiddenPrimary);
    }
}
function setPrimary(layout, primary) {
    layout.primary = primary;
    delete layout.hiddenPrimary;
}
function geometry(mode, layout) {
    const w = mode === 'sport' ? 760 : 1120, h = mode === 'sport' ? 556 : 660;
    const left = mode === 'sport' ? 22 : 48, top = mode === 'sport' ? 154 : 152;
    const gap = mode === 'sport' ? 10 : 14, available = w - 2 * left - gap * (layout.columns.length - 1);
    const weights = layout.columns.map((_, i) => layout.primary === i ? 1.6 : 1);
    const sum = weights.reduce((a, b) => a + b, 0);
    let x = left;
    return layout.columns.map((_, i) => {
        const width = i === layout.columns.length - 1 ? w - left - x : Math.floor(available * weights[i] / sum);
        const r = { x, y: top, w: width, h: h - top - 18 };
        x += width + gap;
        return r;
    });
}
function capacity(mode, layout, index) {
    return (geometry(mode, layout)[index].w >= 420 ? 2 : 1) * 7;
}
function switchCardType(card, nextType) {
    if (card.type === nextType) return card;
    const saved = copy(card.saved || {});
    if (card.type === 'data') saved.metrics = card.metrics.slice();
    if (card.type === 'tyres') {
        saved.pressure = card.pressure;
        saved.temperature = card.temperature;
    }
    const next = nextType === 'data' ? dataCard(saved.metrics || ['oil', 'coolant'])
        : nextType === 'tyres' ? tyreCard() : {type: nextType};
    if (nextType === 'tyres' && saved.pressure !== undefined) {
        next.pressure = saved.pressure;
        next.temperature = saved.temperature;
    }
    if (Object.keys(saved).length) next.saved = saved;
    return next;
}
function color(key, value, config) {
    if (!Number.isFinite(value)) return '#7890a6';
    const metric = byKey.get(key);
    const limit = metric && metric.thresholdKey && config.thresholds[metric.thresholdKey];
    if (!limit) return '#ffffff';
    if (value < limit.low) return thresholdStyle[metric.kind].lowColor;
    const high = metric.kind === 'info' ? value > limit.high : value >= limit.high;
    return high ? '#ff4d45' : '#ffffff';
}
const object = v => v && typeof v === 'object' && !Array.isArray(v);
function migrate(raw) {
    if (!object(raw) || (raw.version !== 1 && raw.version !== 2)) return raw;
    const obdCoexistence = Object.prototype.hasOwnProperty.call(raw, 'obdCoexistence') ? raw.obdCoexistence : false;
    if (typeof obdCoexistence !== 'boolean') throw Error('OBD 外设共存设置必须为布尔值');
    if (raw.version === 2) return raw.obdCoexistence === obdCoexistence ? raw : Object.assign({}, raw, {obdCoexistence});
    const value = copy(raw);
    value.version = 2;
    value.obdCoexistence = obdCoexistence;
    if (object(value.thresholds)) {
        const limits = value.thresholds;
        // When corners differ, retain the first configured threshold in wheel order.
        for (const [prefix, shared] of [['pressure', 'tyrePressure'], ['tyre', 'tyreTemp']]) {
            for (const [wheel] of wheels) {
                const key = prefix + wheel;
                if (!Object.prototype.hasOwnProperty.call(limits, key)) continue;
                if (!Object.prototype.hasOwnProperty.call(limits, shared)) limits[shared] = limits[key];
                delete limits[key];
            }
        }
        for (const key of Object.keys(limits)) {
            const t = limits[key];
            if (object(t)) limits[key] = {low: t.cold, high: t.hot};
        }
    }
    if (object(value.modes)) for (const mode of ['road', 'sport']) {
        const layout = value.modes[mode];
        if (!layout) continue;
        for (const cards of [layout.columns, layout.hidden]) if (Array.isArray(cards)) {
            for (const card of cards) {
                if (card && card.type === 'tyres' && card.pressure === false && card.temperature === false) card.pressure = true;
            }
        }
    }
    return value;
}
function validate(raw) {
    const value = migrate(raw);
    if (!object(value) || value.version !== 2) throw Error('设置版本不支持');
    if (!object(value.modes) || !object(value.thresholds)) throw Error('设置格式不正确');
    const out = {version: 2, obdCoexistence: value.obdCoexistence, modes: {}, thresholds: {}};
    function metrics(keys) {
        if (!Array.isArray(keys) || keys.length > catalog.length || new Set(keys).size !== keys.length || keys.some(key => !byKey.has(key))) throw Error('数据项目无效');
        return keys.slice();
    }
    function tyres(card) {
        if (typeof card.pressure !== 'boolean' || typeof card.temperature !== 'boolean') throw Error('轮胎设置无效');
        if (!card.pressure && !card.temperature) throw Error('轮胎卡片至少需要保留胎压或胎温中的一项');
        return {pressure: card.pressure, temperature: card.temperature};
    }
    function validateCard(card) {
        if (!object(card) || !Object.prototype.hasOwnProperty.call(kinds, card.type)) throw Error('显示内容无效');
        const next = {type: card.type};
        if (card.type === 'data') next.metrics = metrics(card.metrics);
        if (card.type === 'tyres') Object.assign(next, tyres(card));
        if (card.saved !== undefined) {
            if (!object(card.saved)) throw Error('保留卡片配置无效');
            next.saved = {};
            if (card.saved.metrics !== undefined) next.saved.metrics = metrics(card.saved.metrics);
            if (card.saved.pressure !== undefined || card.saved.temperature !== undefined) Object.assign(next.saved, tyres(card.saved));
        }
        return next;
    }
    for (const mode of ['road', 'sport']) {
        const layout = value.modes[mode];
        if (!object(layout) || !Array.isArray(layout.columns) || layout.columns.length < 1 || layout.columns.length > 3) throw Error('请选择一至三栏');
        if (layout.primary !== null && (!Number.isInteger(layout.primary) || layout.primary < 0 || layout.primary >= layout.columns.length)) throw Error('主视图位置无效');
        const hidden = layout.hidden === undefined ? [] : layout.hidden;
        if (!Array.isArray(hidden) || hidden.length + layout.columns.length > 3) throw Error('保留栏配置无效');
        out.modes[mode] = {primary: layout.primary, columns: layout.columns.map(validateCard), hidden: hidden.map(validateCard)};
        const index = layout.hiddenPrimary;
        if (layout.primary === null && Number.isInteger(index) && index >= layout.columns.length && index < layout.columns.length + hidden.length) {
            out.modes[mode].hiddenPrimary = index;
        }
    }
    for (const key of Object.keys(value.thresholds)) {
        const m = thresholdCatalog.find(m => m.key === key), t = value.thresholds[key];
        if (!m || !object(t) || !Number.isFinite(t.low) || !Number.isFinite(t.high)) throw Error('颜色阈值数值无效');
        if (t.low >= t.high) throw Error(m.name + ' 的低阈值必须低于高阈值');
        out.thresholds[key] = {low: t.low, high: t.high};
    }
    return out;
}
module.exports = { groups, catalog, thresholdCatalog, kinds, defaults, copy, dataCard, tyreCard, geometry, capacity, color, migrate, validate, resize, setPrimary, switchCardType };
