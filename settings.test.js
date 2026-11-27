"use strict";
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const schema = require('./settings');
const { createStore, serve } = require('./framework/widgets/preferences');
const { request } = require('./cid-settings/src/client');
const { Menu } = require('./cid-settings/src/menu');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-settings-')), file = path.join(dir,'settings.json'), sock = path.join(dir,'settings.sock');
(async()=>{
    const initial = schema.defaults(); schema.validate(initial);
    assert.equal(initial.version, 2);
    assert.strictEqual(initial.obdCoexistence, false);
    const oldV2 = schema.copy(initial);
    delete oldV2.obdCoexistence;
    assert.deepStrictEqual(schema.validate(oldV2), initial);
    assert.strictEqual(schema.migrate(oldV2).obdCoexistence, false);
    assert.deepStrictEqual(schema.groups.map(g => g.id), ['temp', 'pressure', 'perf', 'tyre']);
    assert.deepStrictEqual(schema.groups.map(g => schema.catalog.filter(m => m.group === g.id).length), [5, 3, 12, 8]);
    assert.equal(new Set(schema.catalog.map(m => m.label)).size, 28);
    assert.equal(schema.thresholdCatalog.length, 13);
    for (const m of schema.catalog) assert(m.thresholdKey === null || schema.thresholdCatalog.some(t => t.key === m.thresholdKey && t.kind === m.kind));
    for (const t of schema.thresholdCatalog) assert(t.min <= t.default.low && t.default.low < t.default.high && t.default.high <= t.max && t.bigStep > t.smallStep);
    assert.deepStrictEqual(initial.modes.sport.columns[2].metrics, ['oil','coolant','gearbox','iat','oilPressure','fuelRail','boost']);
    const legacy = schema.copy(initial);
    legacy.version = 1;
    delete legacy.obdCoexistence;
    legacy.modes.sport.columns[2].metrics = ['oil', 'coolant', 'boost'];
    legacy.modes.road.columns[1] = {type:'tyres', pressure:false, temperature:false};
    legacy.thresholds = {oil:{cold:72,hot:120}, pressureRR:{cold:2.6,hot:3.2}, pressureFR:{cold:2,hot:3}, tyreRR:{cold:25,hot:90}};
    const legacyFile = path.join(dir, 'legacy.json');
    fs.writeFileSync(legacyFile, JSON.stringify(legacy));
    const migrated = createStore(legacyFile, schema).get();
    assert.equal(migrated.version, 2);
    assert.strictEqual(migrated.obdCoexistence, false);
    for (const previous of [legacy, oldV2]) {
        assert.strictEqual(schema.validate(Object.assign({}, previous, {obdCoexistence: true})).obdCoexistence, true);
        for (const invalid of ['false', 0, null, undefined]) {
            assert.throws(() => schema.validate(Object.assign({}, previous, {obdCoexistence: invalid})), /OBD 外设共存设置必须为布尔值/);
        }
    }
    assert.deepStrictEqual(migrated.thresholds, {oil:{low:72,high:120},tyrePressure:{low:2,high:3},tyreTemp:{low:25,high:90}});
    assert.deepStrictEqual(migrated.modes.sport, legacy.modes.sport);
    assert.deepStrictEqual(migrated.modes.road.columns[1], {type:'tyres',pressure:true,temperature:false});
    assert.equal(JSON.parse(fs.readFileSync(legacyFile)).version, 1, 'loading v1 does not overwrite the file');
    assert.deepStrictEqual(schema.migrate(migrated), migrated);
    const full = schema.catalog.map(m => m.key), slots = schema.copy(initial);
    slots.modes.road.columns[0] = schema.dataCard(full);
    schema.resize(slots.modes.road,1);
    assert.equal(schema.capacity('road',slots.modes.road,0),14);
    schema.resize(slots.modes.road,3);
    assert.equal(schema.capacity('road',slots.modes.road,0),7);
    const slotsRoundTrip = schema.validate(slots);
    assert.deepStrictEqual(slotsRoundTrip.modes.road.columns[0].metrics,full);
    let card = schema.switchCardType(slotsRoundTrip.modes.road.columns[0], 'tyres');
    card.temperature = false;
    slotsRoundTrip.modes.road.columns[0] = schema.switchCardType(card, 'g');
    card = schema.switchCardType(schema.validate(slotsRoundTrip).modes.road.columns[0], 'data');
    assert.deepStrictEqual(card.metrics,full);
    assert.equal(schema.switchCardType(card,'tyres').temperature,false);
    assert.deepStrictEqual(schema.switchCardType(schema.switchCardType(schema.dataCard([]), 'g'), 'data').metrics, []);
    const empty = schema.copy(initial);
    empty.modes.road.columns[0].metrics = [];
    assert.deepStrictEqual(schema.validate(empty).modes.road.columns[0].metrics, []);
    empty.modes.road.columns[1].pressure = empty.modes.road.columns[1].temperature = false;
    assert.throws(() => schema.validate(empty), /轮胎卡片至少需要保留胎压或胎温中的一项/);
    const resized = schema.copy(initial), originalCards = schema.copy(resized.modes.road.columns);
    schema.resize(resized.modes.road,1); const roundTrip=schema.validate(resized);schema.resize(roundTrip.modes.road,3);
    assert.deepStrictEqual(roundTrip.modes.road.columns,originalCards,'reducing displayed columns preserves their settings');
    const sport = resized.modes.sport;
    schema.setPrimary(sport, 2);
    schema.resize(sport, 1);
    assert.equal(sport.primary, null);
    assert.equal(sport.hiddenPrimary, 2);
    const restored = schema.validate(resized).modes.sport;
    schema.resize(restored, 2);
    assert.equal(restored.primary, null);
    assert.equal(restored.hiddenPrimary, 2);
    schema.resize(restored, 3);
    assert.equal(restored.primary, 2);
    assert.equal(restored.hiddenPrimary, undefined);
    for (const primary of [0, null]) {
        const override = schema.copy(restored);
        schema.resize(override, 2);
        schema.setPrimary(override, primary);
        schema.resize(override, 3);
        assert.equal(override.primary, primary, 'an explicit width selection supersedes the hidden primary');
    }
    const store = createStore(file,schema), updates=[];store.subscribe(v=>updates.push(v));
    const server = process.argv.includes('--no-socket') ? null : serve(store, sock);
    const send = server ? next => request(next, sock) : async next => next === undefined ? store.get() : store.save(next);
    try {
        if (server) await new Promise((resolve, reject) => {server.once('listening', resolve);server.once('error', reject);});
        const config=await send(); config.modes.road.columns=[schema.dataCard(['oil']),{type:'g'}];config.modes.road.primary=0;
        config.thresholds.boost={low:0,high:1.6};
        const start=Date.now();const saved=await send(config);const elapsed=Date.now()-start;
        assert.deepStrictEqual(saved,config);assert.equal(updates.length,1);assert.deepStrictEqual(updates[0],saved);
        const fromProcess=JSON.parse(cp.execFileSync(process.execPath,['-e',"const s=require(process.argv[1]);const p=require(process.argv[2]);console.log(JSON.stringify(p.createStore(process.argv[3],s).get()))",path.resolve(__dirname,'settings.js'),path.resolve(__dirname,'./framework/widgets/preferences.js'),file],{encoding:'utf8'}));
        assert.deepStrictEqual(fromProcess,saved,'a separate process reloads both mode layouts and thresholds');
        const collapsed=schema.copy(saved);schema.resize(collapsed.modes.road,1);await send(collapsed);
        const reopened=createStore(file,schema).get();schema.resize(reopened.modes.road,2);assert.deepStrictEqual(reopened.modes.road.columns,saved.modes.road.columns);await send(saved);
        const before=fs.readFileSync(file,'utf8'), events=updates.length;
        const invalid=schema.copy(saved);invalid.thresholds.oil={low:130,high:90};
        await assert.rejects(send(invalid),/机油温度 的低阈值必须低于高阈值/);assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(updates.length,events);
        const crowded=schema.copy(saved);crowded.modes.sport.columns=[schema.dataCard(schema.catalog.map(m=>m.key)),{type:'g'},schema.tyreCard()];
        assert.deepStrictEqual(store.save(crowded).modes.sport.columns[0].metrics, full);
        assert.throws(()=>store.save(Object.assign({},saved,{version:3})),/版本/);
        const typo=schema.copy(saved);typo.modes.road.columns[0].metrics=['unknown'];assert.throws(()=>store.save(typo),/数据项目/);
        const badNumber=schema.copy(saved);badNumber.thresholds.boost={low:NaN,high:1};assert.throws(()=>store.save(badNumber),/数值/);
        const unsupported=schema.copy(saved);unsupported.thresholds.speed={low:0,high:200};assert.throws(()=>store.save(unsupported),/数值/);
        const failed=createStore(path.join(dir,'absent','settings.json'),schema);assert.throws(()=>failed.save(saved));assert.deepStrictEqual(failed.get(),initial);
        const menu=new Menu(saved,send);menu.page='layout';menu.mode='road';await menu.rows()[3].run();assert.equal(menu.config.modes.road.columns.length,3);
        menu.page='card';menu.column=1;const choose=menu.rows().find(r=>r.label==='数据卡片');await choose.run();assert.equal(menu.config.modes.road.columns[1].type,'data');
        await menu.rows().find(r=>r.label==='数据项目').run();
        await menu.rows().find(r=>r.label==='四轮').run();
        assert.equal(menu.rows().length, 9);
        await menu.rows().find(r=>r.label==='右后胎温').run();
        assert(menu.config.modes.road.columns[1].metrics.includes('tyreRR'));
        menu.page='thresholds';await menu.rows().find(r=>r.label.startsWith('四轮胎压')).run();
        await menu.rows()[1].run();assert.deepStrictEqual(menu.config.thresholds.tyrePressure,{low:2.1,high:2.9});
        await menu.rows().find(r=>r.label==='低压低于 · +0.1').run();assert.equal(menu.config.thresholds.tyrePressure.low,2.2);
        assert.equal(schema.color('oil',65,saved),'#64bde9');
        assert.equal(schema.color('boost',2,saved),'#ff4d45');assert.equal(schema.color('boost',-.1,saved),'#f0b46c');assert.equal(schema.color('boost',1,saved),'#ffffff');
        assert.equal(schema.color('speed',200,saved),'#ffffff');assert.equal(schema.color('oil',null,saved),'#7890a6');
        assert.equal(schema.color('pressureFL',1.8,migrated),'#f0b46c');assert.equal(schema.color('pressureRR',3,migrated),'#ff4d45');
        assert.equal(schema.color('tyreFR',18,migrated),'#64bde9');
        assert.equal(schema.color('battery',40,{thresholds:{battery:{low:50,high:100}}}),'#f0b46c');
        assert.equal(schema.color('battery',100,{thresholds:{battery:{low:50,high:100}}}),'#ffffff');
        const baseline = store.revision, first = store.get(), newest = store.get();
        first.thresholds.oil.low = 72;
        newest.thresholds.oil.low = 73;
        for (const newestFirst of [false, true]) {
            const expectedRevision = store.revision;
            const saveFirst = () => store.save(first, {expectedRevision, writeId: 'first'});
            const flush = () => store.save(newest, {expectedRevision, afterWriteId: 'first'});
            if (newestFirst) {
                flush();
                assert.throws(saveFirst, {status: 409});
            } else {
                saveFirst();
                flush();
            }
            assert.deepStrictEqual(store.get(), newest);
        }
        store.save(first);
        assert.throws(() => store.save(newest, {expectedRevision: store.revision - 1, afterWriteId: 'first'}), {status: 409});
        assert.equal(store.revision, baseline + 4);
        assert.equal(createStore(file, schema).revision, store.revision, 'revision survives restart');
        if (server) {
            const snapshot = await request(undefined, sock, {withRevision: true});
            assert.equal(snapshot.revision, store.revision);
            await assert.rejects(request(newest, sock, {expectedRevision: baseline}), {
                status: 409, revision: snapshot.revision, config: first
            });
        }
        console.log('PASS: v2 catalog, v1 disk migration, layout and primary restore, thresholds, native menu, atomic save and revision conflicts' + (server ? ', Unix socket' : ''));
        if (server) console.log('Measured local save + socket reply: '+elapsed+' ms');
    }finally{if (server && server.listening) await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
