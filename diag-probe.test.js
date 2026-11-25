'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DiagProbe, DID_SPECS, PHASES, TASU, TASU_INSTANCE, checkRequest, parseBatchReply } = require('./diag-probe');
const { VehicleData } = require('./vehicle-data');

const candidates = DID_SPECS.map(s => s.did);
const rawValues = [104, 13000, 3500, 4000, 25600, 10000, 20000, 160, 25600];
const coreBatch = [0x580F, 0x586F, 0x4201, 0x5658];
const fullBatch = coreBatch.concat(0x4650, 0x4205);
const tasReject = [0, 0, 0x7F, 0x31, 0x25];
const tasPending = [0, 0, 0x7F, 0x31, 0x78];
const ignition = 'FULL_ON_USER_ON';

function positive(dids) {
    const parts = dids.map(did => {
        const i = candidates.indexOf(did);
        const len = DID_SPECS[i].len;
        const b = Buffer.alloc(2 + len);
        b.writeUInt16BE(did, 0);
        b.writeUIntBE(rawValues[i], 2, len);
        return b;
    });
    return Buffer.concat([Buffer.from([0x62])].concat(parts));
}

async function harness(options) {
    let time = 0, onResponse, queued = false;
    const events = [], sends = [], queue = [];
    const data = new VehicleData(() => time);
    const sub = { available: true, proxy: {
        callMethod(name, args, timeout) {
            assert.strictEqual(name, 'sendTasuRequest');
            assert.strictEqual(timeout, 4000);
            const { udsData, udsDataLength } = args;
            assert.deepStrictEqual(args, { sourceAddress: 0xF2, targetAddress: 0x12, serviceID: 0x22, subroutineID: 0,
                udsDataLength: udsData.length, udsData, deadlockTime: 0 });
            assert.strictEqual(udsDataLength, udsData.length);
            const dids = [];
            for (let i = 0; i < udsData.length; i += 2) dids.push(udsData.readUInt16BE(i));
            checkRequest(args.targetAddress, args.serviceID, dids);
            sends.push({ time, dids });
            return { TasuErrorEnum: 'NO_ERROR' };
        }
    } };
    const signals = {
        on: async (proxy, name, fn) => {
            assert.strictEqual(proxy, sub.proxy);
            assert.strictEqual(name, 'sendTasuResponse');
            onResponse = fn;
        },
        call: (proxy, name, args, timeout) => new Promise(resolve => {
            const dispatch = () => resolve(proxy.callMethod(name, args, timeout));
            if (queued) queue.push(dispatch);
            else dispatch();
        })
    };
    const probe = new DiagProbe(data, signals, console, Object.assign({
        mode: 'probe', clock: () => time, write: e => events.push(e), phaseMs: 60000, backoffMs: 30000, loop: false
    }, options));
    await probe.start(sub);
    function frame(uds, ecu, declaredLength) {
        const header = Buffer.alloc(9);
        header[6] = ecu === undefined ? 0x12 : ecu;
        onResponse({ errorCode: 'NO_ERROR', udsResponse: Buffer.concat([header, Buffer.from(uds)]), udsResponseLength: declaredLength });
    }
    function advance(now, heartbeat = true) {
        assert(now >= time);
        while (heartbeat && probe.powerActive && now - probe.powerAt > 2000 && time <= probe.powerAt + 2000) {
            time = probe.powerAt + 2000;
            probe.setPowerState(probe.powerState);
        }
        time = now;
    }
    return {
        data, probe, sends, events, sub, frame,
        raw(bytes) { onResponse({ errorCode: 0, udsResponse: { data: bytes } }); },
        error(errorCode) { onResponse({ errorCode }); },
        reply(dids) { frame(positive(dids || sends[sends.length - 1].dids)); },
        advance,
        tick(now, heartbeat) { advance(now, heartbeat); probe.tick(); },
        active() { probe.setPowerState(ignition); probe.setVisible(true); },
        queueRequests() { queued = true; },
        dispatch() { queue.shift()(); },
        last(event) { return events.filter(e => e.event === event).pop(); }
    };
}

async function round() {
    assert.deepStrictEqual(PHASES, [
        'P0_PASSIVE_BASELINE', 'P1_SINGLE_DID_DISCOVERY', 'P2_QUIET_RECOVERY',
        'P3_BATCH_22_5000MS', 'P4_BATCH_22_BACKOFF', 'P5_BATCH_22_1500MS', 'DONE_PASSIVE_ONLY'
    ]);
    const h = await harness();
    h.data.receive('basicDataSet', { valueTemperatureTransmissionOil: 48 });
    h.probe.observeStatus('tasuModeStatus', 0);
    h.probe.observeStatus('extDiagStatus', { statusConnectionHSFZ: 1 });
    h.active();
    h.tick(0); h.tick(4999);
    assert.strictEqual(h.events.filter(e => e.event === 'state').length, 1);
    h.tick(5000);
    assert.strictEqual(h.last('state').passive.BasicDataSet.firstRaw, 48);
    assert.strictEqual(h.last('state').tasuModeStatus, 0);
    assert.deepStrictEqual(h.last('state').extDiagStatus, { statusConnectionHSFZ: 1 });
    assert.strictEqual(h.sends.length, 0);
    assert.strictEqual(h.events.filter(e => e.event === 'state').length, 2);

    for (let i = 0; i < candidates.length; i++) {
        h.tick(60000 + 3000 * i - 1);
        assert.strictEqual(h.sends.length, i);
        h.tick(60000 + 3000 * i);
        assert.deepStrictEqual(h.sends[i].dids, [candidates[i]]);
        if (i === 0) h.tick(60100);
        h.reply();
        const sample = h.last('ok');
        assert.strictEqual(sample.length, 3 + DID_SPECS[i].len);
        assert.strictEqual(sample.readings[0].raw, rawValues[i]);
        assert.strictEqual(sample.readings[0].did, candidates[i]);
        if (candidates[i] === 0x59D4) assert.strictEqual(sample.readings[0].key, 'chargeAirTemp');
        assert.strictEqual(sample.durationMs, i === 0 ? 100 : 0);
        assert.strictEqual(sample.hex, positive([candidates[i]]).toString('hex'));
    }
    assert.strictEqual(h.data.snapshot('road').iat, null, 'discovery only records readings');
    h.tick(119999); h.tick(120000); h.tick(125000); h.tick(179999);
    assert.strictEqual(h.sends.length, candidates.length, 'P2 is entirely passive');
    h.tick(180000);
    assert.deepStrictEqual(h.sends[h.sends.length - 1].dids, fullBatch);
    h.reply();
    assert.deepStrictEqual(h.data.diagValues.oilPressure, { value: 2.5, at: 180000, ttl: 12000 });
    assert.strictEqual(h.data.snapshot('sport').boost, 1);
    assert.strictEqual(h.data.snapshot('sport').fuelRail, 200);
    assert.strictEqual(h.data.snapshot('sport').gearbox, 72);
    assert.strictEqual(h.data.snapshot('sport').iat, 30);
    const oil = h.last('ok');
    assert.deepStrictEqual([oil.oilAbsBar, oil.ambientBar, oil.ambientSource, oil.oilGaugeBar], [3.5, 1, '4201', 2.5]);
    h.tick(184999);
    assert.strictEqual(h.sends.length, candidates.length + 1);
    h.data.receive('statusSwitchDriveDynamicSport2', { displayBoostPressure: 78 });
    h.data.receive('basicDataSet', { valueTemperatureTransmissionOil: 120 });
    h.tick(185000);
    const secondBatch = h.sends[h.sends.length - 1].dids;
    assert.deepStrictEqual(secondBatch, coreBatch);
    h.reply(secondBatch.filter(did => did !== 0x4201));
    assert.strictEqual(h.last('ok').ambientSource, '4201', 'recent ambient can be reused');
    assert.strictEqual(h.data.snapshot('sport').boost, 0.78);
    assert.strictEqual(h.data.diagValues.boost.at, 180000, 'valid FES suppresses diagnostic boost refresh');
    h.advance(191000);
    assert.strictEqual(h.data.snapshot('sport').boost, 1, 'expired FES falls back to recent diagnostic boost');
    h.tick(215001);
    assert.deepStrictEqual(h.sends[h.sends.length - 1].dids, fullBatch, 'expired passive data restores both DIDs');
    h.reply([0x586F]);
    assert.strictEqual(h.last('ok').ambientSource, 'std_1013');
    assert.strictEqual(h.last('ok').ambientBar, 1.013);
    assert.strictEqual(h.data.snapshot('sport').oilPressure, 3.5 - 1.013);
    h.advance(227002);
    assert.strictEqual(h.data.snapshot('sport').oilPressure, null);

    h.advance(239999);
    h.probe.failures = 2;
    h.data.receive('statusSwitchDriveDynamicSport2', { displayBoostPressure: 78 });
    h.data.receive('basicDataSet', { valueTemperatureTransmissionOil: 120 });
    h.tick(240000);
    assert.strictEqual(h.probe.failures, 0, 'entering P4 starts a fresh failure streak');
    assert.deepStrictEqual(h.sends[h.sends.length - 1].dids, coreBatch);
    h.reply();
    assert.strictEqual(h.data.diagValues.iat.ttl, 6000);
    h.tick(241499);
    assert.strictEqual(h.sends[h.sends.length - 1].time, 240000);
    h.tick(241500); h.raw(tasReject);
    h.tick(243000); h.reply();
    for (const t of [296999, 298499]) {
        h.tick(t); h.raw(tasReject.concat([0, 0]));
        assert.strictEqual(h.last('tasReject').code, '0x25');
        assert.strictEqual(h.last('tasReject').durationMs, 0, 'reject completes immediately');
    }
    assert(!h.last('backoff_enter'), 'a success breaks the P4 rejection streak');
    h.tick(299999); h.tick(300000);
    assert.strictEqual(h.last('phase_start').phase, PHASES[5]);
    h.tick(300001); h.raw(tasReject);
    assert.strictEqual(h.last('tasReject').phase, PHASES[4]);
    assert.strictEqual(h.last('backoff_enter').backoffMs, 30000);
    const beforeBackoff = h.sends.length;
    h.tick(329999); h.tick(330000);
    assert.strictEqual(h.sends.length, beforeBackoff, 'P5 does not cut a P4 backoff short');
    h.data.receive('statusSwitchDriveDynamicSport2', { displayBoostPressure: 78 });
    h.data.receive('basicDataSet', { valueTemperatureTransmissionOil: 120 });
    h.tick(330001);
    assert.strictEqual(h.last('backoff_exit').monoMs - h.last('backoff_enter').monoMs, 30000);
    assert.deepStrictEqual(h.sends[h.sends.length - 1].dids, coreBatch);
    h.reply();
    assert.strictEqual(h.data.diagValues.iat.ttl, 6000);
    h.tick(331500);
    assert.strictEqual(h.sends.length, beforeBackoff + 1);
    h.tick(331501); h.reply();
    h.tick(359999);
    assert.deepStrictEqual(h.sends[h.sends.length - 1].dids, fullBatch);
    const atDone = h.sends.length;
    h.tick(360000);
    assert(!h.last('summary'), 'DONE drains the last in-flight request before summarizing');
    h.tick(362999); h.raw(tasPending);
    assert.strictEqual(h.last('response_pending').phase, PHASES[5]);
    assert.strictEqual(h.probe.inFlight.deadline, 366999);
    h.tick(365999); h.frame([0x7F, 0x22, 0x78]);
    h.tick(367998); h.raw(tasPending);
    assert(!h.last('summary'));
    h.tick(367999);
    assert.strictEqual(h.last('timeout').durationMs, 8000, 'pending cannot extend the hard deadline');
    h.reply();
    assert(h.last('late_reply_dropped'));
    h.tick(400000);
    assert.strictEqual(h.sends.length, atDone);
    assert.deepStrictEqual(h.events.filter(e => e.event === 'phase_start').map(e => e.phase), PHASES);
    const summary = h.last('summary');
    assert.strictEqual(summary.phase, PHASES[6]);
    assert.strictEqual(summary.phases[PHASES[0]].sent, 0);
    assert.strictEqual(summary.phases[PHASES[1]].ok, 9);
    assert.strictEqual(summary.phases[PHASES[1]].avgMs, 100 / 9);
    assert.strictEqual(summary.phases[PHASES[4]].tasReject, 4);
    assert.strictEqual(summary.phases[PHASES[4]].backoffs, 1);
    assert.strictEqual(summary.phases[PHASES[5]].ok, 2);
    assert.strictEqual(summary.phases[PHASES[5]].timeout, 1);
    assert.strictEqual(summary.discovered.length, 9);
    assert.strictEqual(summary.passive.FES.everValid, true);
    assert.strictEqual(summary.passive.BasicDataSet.everValid, true);
    assert(h.events.every(e => typeof e.monoMs === 'number' && new Date(e.tsUtc).toISOString() === e.tsUtc && PHASES.includes(e.phase)));
}

async function gatesAndTransport() {
    const h = await harness({ phaseMs: 18000 });
    h.probe.setVisible(true);
    h.tick(20000);
    assert(!h.last('phase_start'), 'unknown power cannot start the clock');
    h.probe.setPowerState(ignition);
    h.tick(20000); h.tick(30000);
    h.probe.setVisible(false);
    h.tick(70000);
    h.probe.setVisible(true);
    h.tick(77999);
    assert.strictEqual(h.sends.length, 0);
    h.queueRequests();
    h.tick(78000);
    h.probe.setPowerState('SHUTDOWN_MODE_USER_OFF');
    h.dispatch();
    h.tick(90000);
    assert.strictEqual(h.sends.length, 0, 'even a request queued in the kit cannot dispatch after shutdown');
    assert.strictEqual(h.last('phase_start').phase, PHASES[1]);
    h.probe.setPowerState('ENTERTAINMENT_MODE_USER_ON');
    h.tick(90000); h.dispatch();
    assert.deepStrictEqual(h.sends[0].dids, [0x580F]);
    h.tick(93000);
    h.raw(tasPending);
    assert.strictEqual(h.last('response_pending').monoMs, 93000);
    h.tick(94001);
    assert.strictEqual(h.sends.length, 1);
    h.frame(positive([0x580F]), 0x13);
    h.frame(positive([0x59D4]));
    h.frame([0x7F, 0x31, 0x25]);
    assert(!h.last('ok') && !h.last('nrc'), 'other ECU, DID and service responses are ignored');
    h.reply();
    assert.strictEqual(h.last('ok').durationMs, 4001);
    h.tick(94100); h.dispatch();
    h.raw(tasPending);
    assert(!h.last('tasReject'));
    h.error('APP_REQUEST_TEMPORARILY_NOT_ACCEPTED');
    assert.strictEqual(h.last('tasError').durationMs, 0);
    h.tick(97099);
    assert.strictEqual(h.sends.length, 2, 'a TASU error does not trigger an internal retry');
    h.tick(97100); h.dispatch();
    h.frame([0x7F, 0x22, 0x31]);
    assert.strictEqual(h.last('nrc').code, '0x31');
    h.tick(100100); h.dispatch();
    h.tick(104100);
    assert.strictEqual(h.last('timeout').durationMs, 4000);
    h.tick(106100);
    h.probe.setPowerState('SLEEP_MODE_ALL_OFF');
    h.dispatch();
    h.tick(110000);
    assert.strictEqual(h.sends.length, 4);
    h.probe.stop();
    h.active(); h.tick(200000);
    assert.strictEqual(h.sends.length, 4);
}

async function expiredPower() {
    const h = await harness({ phaseMs: 8000 });
    h.active();
    h.tick(0, false);
    h.queueRequests();
    h.tick(8000, false);
    h.advance(10001, false);
    h.dispatch();
    assert.strictEqual(h.probe.powerActive, false);
    assert.strictEqual(h.sends.length, 0, 'native dispatch checks freshness without a scheduler tick');
    h.probe.setPowerState(ignition);
    h.tick(10001, false);
    assert.strictEqual(h.probe.powerActive, true, 'a repeated active state restores the gate');
    h.probe.setPowerState(null);
    h.dispatch();
    assert.strictEqual(h.probe.powerActive, false);
    assert.strictEqual(h.sends.length, 0, 'a queued request cannot dispatch after IPC disconnect');

    const timed = await harness({ phaseMs: 2000 });
    timed.active();
    timed.tick(0, false);
    timed.tick(9000, false);
    timed.probe.setPowerState(ignition);
    timed.tick(10001, false);
    assert.strictEqual(timed.probe.powerActive, true, 'an unchanged heartbeat refreshes the timestamp');
    timed.tick(19001, false);
    assert.strictEqual(timed.probe.powerActive, false, 'without new heartbeats the scheduler closes the gate');
    assert.strictEqual(timed.sends.length, 1);
}

async function batchIntegrity() {
    const h = await harness({ phaseMs: 40000 });
    const start = 120000;
    h.active();
    h.tick(0);
    h.tick(40000); h.reply();
    h.tick(43000); h.reply();
    h.tick(46000); h.frame([0x62, 0x58, 0x6F, 0xFF, 0xFF]);
    assert.strictEqual(h.last('ok').readings[0].value, null);
    h.tick(49000); h.reply();
    h.tick(80000);
    h.tick(start);
    assert.deepStrictEqual(h.sends[h.sends.length - 1].dids, [0x580F, 0x4436, 0x4201, 0x5658, 0x4650, 0x4205],
        'a valid alternate outranks the default with an out-of-range discovery value');
    h.reply();
    const iat = h.data.diagValues.iat;
    const oil = h.data.diagValues.oilPressure;
    h.tick(start + 5000);
    h.frame(positive([0x59D4]));
    assert.strictEqual(h.last('ok').monoMs, start, 'a charge-air-only reply does not finish a batch');
    assert.strictEqual(h.data.diagValues.iat, iat);
    h.frame(Buffer.concat([positive([0x580F]), Buffer.from([0x12, 0x34])]));
    assert.strictEqual(h.last('malformed').issue, 'unexpected_did');
    assert.strictEqual(h.last('malformed').readings[0].did, 0x580F);
    assert.strictEqual(h.data.diagValues.iat, iat);
    h.tick(start + 10000);
    const reply = positive([0x580F, 0x4436]);
    h.frame(reply, undefined, 9 + reply.length - 1);
    assert.strictEqual(h.last('malformed').issue, 'short_value');
    assert.strictEqual(h.data.diagValues.iat, iat);
    assert.strictEqual(h.data.diagValues.oilPressure, oil);
    h.tick(start + 15000);
    h.frame(reply, undefined, 10 + reply.length);
    assert.strictEqual(h.last('malformed').issue, 'response_length');
    assert.strictEqual(h.data.diagValues.iat, iat);
    h.tick(start + 20000);
    h.frame(Buffer.concat([reply, Buffer.alloc(3)]), undefined, 9 + reply.length);
    assert.strictEqual(h.last('ok').length, reply.length, 'padding after the declared frame is ignored');
    assert.strictEqual(h.data.diagValues.iat.at, start + 20000);

    h.tick(start + 25000);
    const beforeTimeout = h.sends.length;
    h.advance(start + 29000);
    h.reply();
    h.tick(start + 29000);
    assert.strictEqual(h.last('timeout').durationMs, 4000);
    assert.strictEqual(h.last('late_reply_dropped').monoMs, start + 29000, 'a reply at the deadline is dropped even before tick runs');
    h.tick(start + 30999); h.reply();
    assert.strictEqual(h.sends.length, beforeTimeout, 'no retry during the 2s drain');
    assert.strictEqual(h.data.diagValues.iat.at, start + 20000, 'late replies cannot refresh TTL');
    h.tick(start + 31000);
    assert.strictEqual(h.sends.length, beforeTimeout + 1);
    h.reply();
    assert.strictEqual(h.data.diagValues.iat.at, start + 31000);
    h.tick(start + 36000);
    h.frame(reply, undefined, 9);
    assert.strictEqual(h.last('malformed').issue, 'short_frame');
    assert.strictEqual(h.data.diagValues.iat.at, start + 31000);
}

async function discoveryRetries() {
    const h = await harness();
    h.active();
    h.tick(0);
    const steps = [
        [60000, 0x580F, () => h.frame([0x7F, 0x22, 0x11])],
        [63000, 0x59D4, () => h.frame([0x7F, 0x22, 0x12])],
        [66000, 0x586F, () => h.raw(tasReject)],
        [69000, 0x4436, () => h.reply()],
        [72000, 0x4201, () => h.error('APP_REQUEST_TEMPORARILY_NOT_ACCEPTED')],
        [75000, 0x5658, () => { h.tick(79000); assert.strictEqual(h.last('timeout').durationMs, 4000); }],
        [81000, 0x58EF, () => h.reply()],
        [84000, 0x4650, () => h.frame([0x7F, 0x22, 0x12])],
        [87000, 0x4205, () => h.reply()],
        [90000, 0x586F, () => h.reply()],
        [93000, 0x4201, () => h.error('APP_REQUEST_TEMPORARILY_NOT_ACCEPTED')],
        [96000, 0x5658, () => h.frame([0x7F, 0x22, 0x31])],
        [99000, 0x4201, () => h.raw(tasReject)]
    ];
    for (const [time, did, respond] of steps) {
        h.tick(time - 1);
        assert.notStrictEqual(h.sends[h.sends.length - 1] && h.sends[h.sends.length - 1].time, time - 1);
        h.tick(time);
        assert.deepStrictEqual(h.sends[h.sends.length - 1], { time, dids: [did] });
        respond();
    }
    h.tick(102000); h.tick(119999);
    assert.strictEqual(h.sends.length, steps.length, 'resolved and three-attempt DIDs leave the queue');
    assert.deepStrictEqual(h.probe.discovery.get(0x586F), { attempts: 2, status: 'ok' });
    assert.deepStrictEqual(h.probe.discovery.get(0x5658), { attempts: 2, status: 'unsupported' });
    assert.deepStrictEqual(h.probe.discovery.get(0x4201), { attempts: 3, status: 'tasReject' });
    h.tick(120000); h.tick(180000);
    assert.deepStrictEqual(h.sends[h.sends.length - 1].dids, [0x586F, 0x4201, 0x58EF, 0x4205]);

    const collision = await harness({ phaseMs: 30000 });
    collision.active(); collision.tick(0);
    for (let i = 0; i < candidates.length; i++) {
        const did = candidates[i];
        collision.tick(30000 + i * 3000);
        if (did === 0x4201) collision.reply();
        else if (did === 0x586F || did === 0x5658) collision.frame([0x7F, 0x22, 0x31]);
        else collision.raw(tasReject);
    }
    collision.tick(60000); collision.tick(90000);
    assert.deepStrictEqual(collision.sends[collision.sends.length - 1].dids, [0x580F, 0x4436, 0x4201, 0x58EF, 0x4650, 0x4205],
        'ambient-only discovery fills missing measurements without sending explicitly unsupported defaults');
}

async function quietResponses() {
    const h = await harness({ phaseMs: 1000 });
    h.active();
    h.tick(0);
    const raw = Buffer.from('00007f3178010203040506070809', 'hex');
    const initialStats = JSON.stringify(h.probe.stats);
    h.raw(raw);
    const p0 = h.last('unsolicited_response');
    assert.strictEqual(p0.phase, PHASES[0]);
    assert.strictEqual(p0.length, raw.length);
    assert.strictEqual(p0.hex, raw.slice(0, 12).toString('hex'));
    assert.deepStrictEqual(Object.keys(p0).sort(), ['event', 'hex', 'length', 'monoMs', 'phase', 'tsUtc']);
    assert.strictEqual(JSON.stringify(h.probe.stats), initialStats);
    h.raw(raw);
    h.advance(999); h.raw(raw);
    assert.strictEqual(h.events.filter(e => e.event === 'unsolicited_response').length, 1);

    h.tick(1000);
    h.tick(2000);
    h.reply();
    assert.strictEqual(h.last('ok').phase, PHASES[1], 'an outstanding P1 request can complete during P2');
    const quietStats = JSON.stringify(h.probe.stats);
    h.raw(tasPending);
    assert.strictEqual(h.last('unsolicited_response').phase, PHASES[2]);
    h.advance(3000); h.raw(raw);
    assert.strictEqual(h.events.filter(e => e.event === 'unsolicited_response').length, 3);
    assert.strictEqual(h.probe.inFlight, null);
    assert.strictEqual(JSON.stringify(h.probe.stats), quietStats);
    assert.deepStrictEqual(h.data.diagValues, {});
    assert.strictEqual(h.probe.discovered.size, 1);

    h.tick(3000); h.reply();
    h.advance(4000); h.raw(raw);
    assert.strictEqual(h.last('unsolicited_response').phase, PHASES[3], 'an idle interval in an active phase is logged too');
}

async function fallbackAndLoop() {
    const h = await harness({ phaseMs: 30000, loop: true });
    h.active();
    h.tick(0);
    for (let i = 0; i < candidates.length; i++) {
        h.tick(30000 + i * 3000);
        h.raw(tasReject);
    }
    h.tick(60000); h.tick(90000);
    assert.deepStrictEqual(h.sends[h.sends.length - 1].dids, fullBatch);
    h.reply();
    h.tick(120000); h.reply();
    h.tick(150000); h.reply();
    h.tick(180000);
    assert.deepStrictEqual(h.last('summary').discovered, []);
    h.tick(180001);
    assert.strictEqual(h.last('phase_start').phase, PHASES[0]);
    for (let i = 0; i < candidates.length; i++) {
        h.tick(210001 + i * 3000);
        assert.deepStrictEqual(h.sends[h.sends.length - 1].dids, [candidates[i]]);
        h.frame([0x7F, 0x22, 0x31]);
    }
    const count = h.sends.length;
    h.tick(240001); h.tick(270001); h.tick(300001); h.tick(330001);
    assert.strictEqual(h.sends.length, count, 'an entirely unsupported batch sends no request');
}

async function liveCadence() {
    const h = await harness({ mode: 'live' });
    const batch = coreBatch.concat(0x4650);
    h.probe.setPowerState(ignition);
    h.tick(0);
    assert.strictEqual(h.sends.length, 0, 'a hidden widget does not send');
    h.sub.available = false;
    h.probe.setVisible(true);
    h.tick(0);
    assert.strictEqual(h.sends.length, 0, 'an unavailable TASU stops dispatch');
    h.sub.available = true;
    h.data.receive('basicDataSet', { valueTemperatureTransmissionOil: 120 });
    h.data.receive('statusSwitchDriveDynamicSport2', { displayBoostPressure: 78 });
    h.tick(0);
    assert.deepStrictEqual(h.sends[0].dids, batch, 'production always uses the fixed five-DID packet');
    h.advance(160); h.reply();
    assert.deepStrictEqual(h.data.diagValues.oilPressure, { value: 2.5, at: 160, ttl: 15000 });
    assert.strictEqual(h.data.snapshot('road').boost, 0.78, 'boost comes from passive FES');
    assert.strictEqual(h.data.diagValues.boost, undefined);
    h.tick(1499);
    assert.strictEqual(h.sends.length, 1);

    for (const t of [1500, 4800, 8100]) {
        h.tick(t);
        assert.deepStrictEqual(h.sends[h.sends.length - 1], { time: t, dids: batch });
        h.tick(t + 3200);
        assert(h.probe.inFlight);
        h.raw(tasReject.concat(0));
        assert.strictEqual(h.probe.inFlight, null, 'long TASU rejections end on arrival');
        assert.strictEqual(h.data.snapshot('sport').iat, 30, 'a streak of rejections keeps the last good sample');
    }
    h.tick(11400);
    assert.strictEqual(h.sends.length, 5, 'the next tick can recover after three rejections');
    h.advance(11600); h.reply();
    assert.deepStrictEqual(h.data.diagValues.iat, { value: 30, at: 11600, ttl: 15000 });
    h.tick(370000);
    assert.deepStrictEqual(h.sends[5], { time: 370000, dids: batch }, 'production still sends after six minutes');
    h.advance(370200); h.reply();
    h.tick(371500);
    h.probe.setPowerState(null);
    h.advance(371700); h.reply();
    assert.strictEqual(h.data.diagValues.iat.at, 370200, 'a reply in flight at IPC disconnect does not refresh the sample');
    h.tick(385200);
    assert.strictEqual(h.data.snapshot('road').iat, 30);
    h.tick(385201);
    assert.strictEqual(h.data.snapshot('road').iat, null, 'the last sample expires after the IPC disconnect');
    assert.strictEqual(h.sends.length, 7);
    assert(!h.last('backoff_enter') && !h.last('phase_start') && !h.last('summary'));
}

async function liveSummary() {
    const h = await harness({ mode: 'live' });
    h.active();
    h.probe.observeStatus('tasuModeStatus', 'NO_RESTRICTION');
    h.tick(0); h.advance(150); h.reply();
    h.tick(1500); h.advance(1650); h.frame([0x62, 0x58, 0x0F]);
    h.tick(3000); h.advance(3150); h.error('TAS_CONNECTION_ERROR');
    h.tick(4500); h.advance(4700); h.frame([0x7F, 0x22, 0x31]);
    h.tick(6000); h.advance(6200); h.raw(tasReject);
    h.tick(7500);
    h.advance(10500); h.raw(tasPending);
    h.advance(13500); h.raw(tasPending);
    h.advance(15499); h.raw(tasPending);
    assert(h.probe.inFlight);
    h.tick(15500);
    assert.strictEqual(h.probe.inFlight, null, 'live requests retain the 8s hard deadline');
    h.reply();
    h.tick(17499);
    assert.strictEqual(h.sends.length, 6, 'live also observes the two-second timeout drain');
    h.probe.setVisible(false);

    h.tick(59999);
    assert(!h.last('live_summary'));
    h.tick(60000);
    const { sent, ok, tasReject: rejects, nrc, timeout, malformed, avgMs, passive } = h.last('live_summary');
    assert.deepStrictEqual({ sent, ok, rejects, nrc, timeout, malformed, avgMs, passive },
        { sent: 6, ok: 1, rejects: 1, nrc: 1, timeout: 1, malformed: 1, avgMs: 8850 / 6, passive: h.data.passiveStatus() });
    h.tick(120000);
    assert.strictEqual(h.last('live_summary').sent, 0, 'summary counters restart each minute');
    assert.strictEqual(h.last('live_summary').avgMs, null);
    assert.strictEqual(h.events.filter(e => e.event === 'live_summary').length, 2);
    assert.deepStrictEqual(Array.from(new Set(h.events.map(e => e.event))).sort(),
        ['gate', 'live_summary', 'malformed', 'status_change', 'tasError']);
}

function verifyConfigs(sessionDir) {
    const catalog = require(path.join(sessionDir, 'someip-interfaces.json'));
    const manifest = require('./someip-manifest.json');
    const archive = path.join(sessionDir, 'club-dashboard-preview.tgz');
    assert.strictEqual(Object.keys(manifest.proxies).length, 8);
    for (const [iface, selection] of Object.entries(manifest.proxies)) {
        const name = iface.replace(/\./g, '_') + '.json';
        const config = require('./someipInterfaces/' + name);
        const original = catalog.interfaces[iface];
        assert.strictEqual(config.serviceId, original.serviceId);
        assert.deepStrictEqual(config.version, original.version);
        assert.deepStrictEqual(config.instances, { [selection.instances]: catalog.instanceIDs[iface][selection.instances] });
        assert.deepStrictEqual(Object.keys(config.fields).sort(), Object.keys(selection.attributes).sort());
        assert.deepStrictEqual(Object.keys(config.methods), selection.methods || []);
        assert.deepStrictEqual(Object.keys(config.events), selection.broadcasts || []);
        if (['CDS', 'CDS2', 'TPMS', 'Vehicle2'].includes(config.name)) {
            const snapshot = JSON.parse(execFileSync('tar', ['-xOf', archive, 'club-dashboard/someipInterfaces/' + name], { encoding: 'utf8' }));
            assert.deepStrictEqual(config, snapshot, name);
        }
        if (iface === TASU) {
            assert.strictEqual(selection.instances, TASU_INSTANCE);
            assert.deepStrictEqual(Object.keys(config.methods), ['sendTasuRequest']);
            const method = config.methods.sendTasuRequest;
            const nativeMethod = original.methods.sendTasuRequest;
            const nativeEvent = original.events.sendTasuResponse;
            const enumSchema = ref => ({ t: 'Enum', w: 1, e: catalog.datatypes[ref].items });
            assert.deepStrictEqual(Object.keys(method).sort(), ['id', 'retSchema', 'schema']);
            assert.strictEqual(method.id, 1);
            assert.strictEqual(method.schema.t, 'Struct');
            assert.deepStrictEqual(method.schema.e.map(field => field.n), nativeMethod.inputs.map(field => field.name));
            assert.deepStrictEqual(method.retSchema, { t: 'Struct', e: [
                Object.assign({ n: 'TasuErrorEnum' }, enumSchema(nativeMethod.outputs[0].dataRef))
            ] });
            assert.strictEqual(config.events.sendTasuResponse.id, 32769);
            const error = nativeEvent.outputs.find(member => member.name === 'errorCode');
            assert.deepStrictEqual(config.events.sendTasuResponse.schema.e.find(member => member.n === error.name),
                Object.assign({ n: error.name }, enumSchema(error.dataRef)));
            assert.deepStrictEqual(config.eventGroups.selectiveEvents, { 32769: [1] });
            assert.deepStrictEqual(config.fields.tasuModeStatus.schema, enumSchema(original.fields.tasuModeStatus.dataRef));
            assert.strictEqual(config.fields.tasuModeStatus.getter.id, 2);
            assert.strictEqual(config.fields.tasuModeStatus.event.id, 32770);
        }
    }
}

function verifyJsonl() {
    const writeGate = (file, mode = '') => execFileSync(process.execPath, ['-e',
        "const { DiagProbe } = require('./diag-probe'); const p = new DiagProbe({}, {}, {}); p.setVisible(true);"],
        { cwd: __dirname, env: Object.assign({}, process.env, { ID8_DIAG_LOG: file, ID8_DIAG_MODE: mode }), encoding: 'utf8' });
    const defaultGate = JSON.parse(writeGate(''));
    assert.strictEqual(defaultGate.event, 'gate');
    assert.strictEqual(defaultGate.phase, 'LIVE');
    assert.strictEqual(JSON.parse(writeGate('/dev/null/diag-probe.jsonl', 'probe')).phase, PHASES[0]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'club-diag-'));
    const file = path.join(dir, 'diag-probe.jsonl');
    const backup = file + '.1';
    try {
        const limit = 5 * 1024 * 1024;
        fs.writeFileSync(file, '');
        fs.truncateSync(file, limit);
        fs.writeFileSync(backup, 'previous rotation');
        assert.strictEqual(writeGate(file), '');
        const oversized = fs.statSync(file).size;
        assert(oversized > limit);
        assert.strictEqual(fs.readFileSync(backup, 'utf8'), 'previous rotation', 'exactly 5 MiB still receives the next record');
        assert.strictEqual(writeGate(file), '');
        assert.strictEqual(fs.statSync(backup).size, oversized);
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        assert.strictEqual(lines.length, 2);
        assert.strictEqual(JSON.parse(lines[0]).event, 'gate');
        assert.strictEqual(lines[1], '');
    } finally {
        for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
        fs.rmdirSync(dir);
    }
}

(async () => {
    for (const sid of [0x01, 0x10, 0x11, 0x14, 0x27, 0x2E, 0x2F, 0x31, 0x3E]) {
        assert.throws(() => checkRequest(0x12, sid, fullBatch), /Only DME UDS 0x22/);
    }
    assert.throws(() => checkRequest(0xDF, 0x22, fullBatch), /Only DME/);
    assert.throws(() => checkRequest(0x12, 0x22, []), /1 to 8/);
    assert.throws(() => checkRequest(0x12, 0x22, candidates), /1 to 8/);
    assert.throws(() => checkRequest(0x12, 0x22, [undefined]), /Invalid DID/);
    const signed = parseBatchReply([0x62, 0x58, 0x6F, 0xFF, 0xFF], DID_SPECS);
    assert.strictEqual(signed.readings[0].raw, -1);
    assert.strictEqual(signed.readings[0].value, null);
    const unknown = parseBatchReply([0x62, 0x58, 0x0F, 104, 0x12, 0x34, 56], DID_SPECS);
    assert.strictEqual(unknown.issue, 'unexpected_did');
    assert.strictEqual(unknown.hex, '62580f68123438');
    assert.strictEqual(unknown.readings.length, 1);
    assert.strictEqual(parseBatchReply([0x62, 0x58, 0x6F, 0x01], DID_SPECS).issue, 'short_value');
    await round();
    await gatesAndTransport();
    await expiredPower();
    await batchIntegrity();
    await discoveryRetries();
    await quietResponses();
    await fallbackAndLoop();
    await liveCadence();
    await liveSummary();
    const sessionDir = path.resolve(__dirname, '../vehicle-session-20261107');
    const configInputs = [
        path.join(__dirname, 'someip-manifest.json'),
        path.join(__dirname, 'someipInterfaces'),
        path.join(sessionDir, 'someip-interfaces.json')
    ];
    if (configInputs.every(file => fs.existsSync(file))) {
        verifyConfigs(sessionDir);
        console.log('PASS: native TASU schemas');
    } else {
        console.log('SKIP: native TASU schema comparison requires local interface fixtures');
    }
    verifyJsonl();
    console.log('PASS: continuous live cadence and TTL, minute summaries, probe stages, deadlines and drain, JSONL rotation');
})().catch(e => { console.error(e); process.exitCode = 1; });
