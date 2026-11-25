'use strict';
const fs = require('fs');

const TASU = 'com.harman.infotainment.systemfunctions.tasu.tasu.InternalTasu';
const TASU_INSTANCE = 'SystemFunctionsInternalTasuInst1';
const EXT_DIAG = 'de.bmw.infrastructure.ActivationWireExtDiag';
const DME = 0x12, READ_DID = 0x22, MAX_DIDS = 8, WAIT_MS = 4000;
const DRAIN_MS = 2000;
const PHASES = [
    'P0_PASSIVE_BASELINE', 'P1_SINGLE_DID_DISCOVERY', 'P2_QUIET_RECOVERY',
    'P3_BATCH_22_5000MS', 'P4_BATCH_22_BACKOFF', 'P5_BATCH_22_1500MS', 'DONE_PASSIVE_ONLY'
];
const CADENCE = [0, 3000, 0, 5000, 1500, 1500, 0];
const DEFAULT_DIDS = [0x580F, 0x586F, 0x4201, 0x5658];
const LIVE_DIDS = DEFAULT_DIDS.concat(0x4650);
const LIVE_CADENCE = 1500, LIVE_TTL = 15000, LIVE_SUMMARY_INTERVAL = 60000;
const LIVE_EVENTS = new Set(['gate', 'status_change', 'malformed', 'tasError', 'live_summary']);
const ALTERNATE_DIDS = { 0x586F: 0x4436, 0x5658: 0x58EF };
const UNSUPPORTED_NRC = new Set(['0x11', '0x12', '0x31']);
const DID_SPECS = [
    [0x580F, 'iat',      1, 'u8',  0.75,         -48,    -40, 150],
    [0x59D4, 'chargeAirTemp', 2, 'u16', 0.0234375, -273.15, -40, 150],
    [0x586F, 'oilAbs',   2, 's16', 0.001,         0,        0, 15],
    [0x4436, 'oilAbs',   2, 'u16', 0.001,         0,        0, 15],
    [0x4201, 'ambient',  2, 'u16', 0.0000390625,  0,      0.5, 1.2],
    [0x5658, 'fuelRail', 2, 'u16', 0.02,          0,        0, 450],
    [0x58EF, 'fuelRail', 2, 'u16', 0.005,         0,        0, 330],
    [0x4650, 'gearbox',  1, 'u8',  0.75,         -48,     -40, 170],
    [0x4205, 'boostAbs', 2, 'u16', 0.000078125,   0,      0.5, 5.12]
].map(([did, key, len, type, factor, offset, min, max]) => ({ did, key, len, type, factor, offset, min, max }));

const hex = n => '0x' + n.toString(16).toUpperCase().padStart(2, '0');
const monotonicMs = () => {
    const [sec, ns] = process.hrtime();
    return sec * 1000 + Math.floor(ns / 1000000);
};

function checkRequest(target, service, dids) {
    if (target !== DME || service !== READ_DID) throw Error('Only DME UDS 0x22 is allowed');
    if (!Array.isArray(dids) || dids.length < 1 || dids.length > MAX_DIDS) throw Error('UDS 0x22 requires 1 to 8 DIDs');
    for (const did of dids) {
        if (!Number.isInteger(did) || did < 0 || did > 0xFFFF) throw Error('Invalid DID');
    }
}

function parseBatchReply(uds, didSpecs) {
    const b = Buffer.from(uds);
    const result = { hex: b.toString('hex'), length: b.length, readings: [], issue: null };
    if (b[0] !== 0x62) {
        result.issue = 'unexpected_service';
        return result;
    }
    let i = 1;
    do {
        if (i + 2 > b.length) { result.issue = 'short_did'; break; }
        const did = b.readUInt16BE(i);
        const spec = didSpecs.find(s => s.did === did);
        if (!spec) { result.issue = 'unexpected_did'; break; }
        i += 2;
        if (i + spec.len > b.length) { result.issue = 'short_value'; break; }
        const raw = spec.type === 'u8' ? b[i] : spec.type === 's16' ? b.readInt16BE(i) : b.readUInt16BE(i);
        const scaled = raw * spec.factor + spec.offset;
        const value = scaled >= spec.min && scaled <= spec.max ? scaled : null;
        result.readings.push({ did, key: spec.key, raw, bytes: b.slice(i, i + spec.len).toString('hex'), value });
        i += spec.len;
    } while (i < b.length);
    return result;
}

function jsonlWriter(file, maxBytes = 5 * 1024 * 1024) {
    return record => {
        const line = JSON.stringify(record) + '\n';
        if (file) {
            try {
                if (fs.existsSync(file) && fs.statSync(file).size > maxBytes) fs.renameSync(file, file + '.1');
                fs.appendFileSync(file, line);
                return;
            }
            catch (e) { file = null; }
        }
        process.stdout.write(line);
    };
}

function newStats() {
    return { sent: 0, ok: 0, tasReject: 0, tasError: 0, nrc: 0, timeout: 0, malformed: 0, totalMs: 0 };
}

class DiagProbe {
    constructor(data, signals, log, opts) {
        opts = opts || {};
        this.data = data;
        this.signals = signals;
        this.log = log;
        this.clock = opts.clock || monotonicMs;
        this.mode = opts.mode || process.env.ID8_DIAG_MODE || 'live';
        if (this.mode !== 'live' && this.mode !== 'probe') throw Error('ID8_DIAG_MODE must be live or probe');
        this.phaseMs = opts.phaseMs || Number(process.env.ID8_DIAG_PHASE_MS) || 60000;
        this.backoffMs = opts.backoffMs || Number(process.env.ID8_DIAG_BACKOFF_MS) || 30000;
        this.hardTimeoutMs = opts.hardTimeoutMs || 8000;
        this.powerTtlMs = opts.powerTtlMs || 10000;
        this.loop = opts.loop === undefined ? process.env.ID8_DIAG_LOOP === '1' : opts.loop;
        this.write = opts.write || jsonlWriter(process.env.ID8_DIAG_LOG);
        this.visible = false;
        this.powerActive = false;
        this.powerState = null;
        this.powerAt = null;
        this.status = { tasuModeStatus: null, extDiagStatus: null };
        this.activeSince = null;
        this.activeMs = 0;
        this.initialized = false;
        this.stopped = false;
        this.subscription = null;
        this.inFlight = null;
        this.drainUntil = 0;
        this.backoffUntil = null;
        this.nextUnsolicitedAt = 0;
        if (this.mode === 'probe') this.resetRound();
        else {
            this.nextRequest = 0;
            this.liveStats = newStats();
        }
    }

    async start(subscription) {
        if (subscription && !subscription.error && subscription.proxy) {
            try {
                await this.signals.on(subscription.proxy, 'sendTasuResponse', v => this.onResponse(v), this.log);
                this.subscription = subscription;
            } catch (e) { this.log.warn('TASU sendTasuResponse subscription failed: ' + e); }
        }
        this.expirePower(this.clock());
        this.initialized = true;
        if (this.mode === 'live') this.liveSummaryAt = this.clock() + LIVE_SUMMARY_INTERVAL;
        this.updateGate();
    }

    resetRound() {
        this.phase = 0;
        this.phaseAt = null;
        this.discovered = new Set();
        this.discoveryQueue = DID_SPECS.map(s => s.did);
        this.discovery = new Map(this.discoveryQueue.map(did => [did, { attempts: 0, status: 'untested' }]));
        this.failures = 0;
        this.summarized = false;
        this.stats = CADENCE.slice(0, -1).map(newStats);
        this.stats[4].backoffs = 0;
    }

    record(event, fields, phase) {
        const live = this.mode === 'live';
        if (live && !LIVE_EVENTS.has(event)) return;
        this.write(Object.assign({
            tsUtc: new Date().toISOString(), monoMs: this.clock(),
            phase: live ? 'LIVE' : PHASES[phase === undefined ? this.phase : phase], event
        }, fields));
    }

    observeStatus(key, value) {
        if (JSON.stringify(this.status[key]) === JSON.stringify(value)) return;
        this.status[key] = value;
        this.record('status_change', { signal: key, value });
    }

    setVisible(visible) {
        if (this.visible === visible) return;
        this.expirePower(this.clock());
        this.visible = visible;
        this.updateGate();
    }

    setPowerState(state) {
        const now = this.clock();
        this.expirePower(now);
        this.powerAt = now;
        const active = state === 'FULL_ON_USER_ON' || state === 'ENTERTAINMENT_MODE_USER_ON';
        if (this.powerState === state && this.powerActive === active) return;
        this.powerState = state;
        this.powerActive = active;
        this.updateGate(now);
    }

    expirePower(now) {
        if (!this.powerActive || now - this.powerAt <= this.powerTtlMs) return;
        this.powerActive = false;
        this.updateGate(this.powerAt + this.powerTtlMs);
    }

    updateGate(now = this.clock()) {
        const active = this.initialized && !this.stopped && this.visible === true && this.powerActive;
        if (active && this.activeSince === null) this.activeSince = now;
        if (!active && this.activeSince !== null) {
            this.activeMs = this.elapsed(now);
            this.activeSince = null;
        }
        this.record('gate', { active, visible: this.visible, powerState: this.powerState });
    }

    elapsed(now) {
        return this.activeMs + (this.activeSince === null ? 0 : now - this.activeSince);
    }

    enterPhase(phase, elapsed) {
        this.phase = phase;
        this.phaseAt = elapsed;
        this.nextSample = elapsed;
        this.nextRequest = elapsed;
        if (phase === 4) this.failures = 0;
        this.record('phase_start');
    }

    expireRequest(now) {
        const request = this.inFlight;
        if (request && (now >= request.deadline || now >= request.hardDeadline)) {
            this.finish(request, 'timeout');
        }
    }

    tick() {
        if (this.stopped) return;
        const now = this.clock();
        this.expirePower(now);
        this.expireRequest(now);
        if (this.mode === 'live') {
            this.tickLive(now);
            return;
        }
        if (this.backoffUntil !== null && now >= this.backoffUntil) {
            this.backoffUntil = null;
            this.record('backoff_exit', null, 4);
        }
        if (this.phase === 6) {
            if (this.inFlight) return;
            if (!this.summarized) this.summarize();
            if (!this.loop || this.activeSince === null) return;
            this.resetRound();
        }
        if (this.activeSince === null) return;
        const elapsed = this.elapsed(now);
        if (this.phaseAt === null) this.enterPhase(0, elapsed);
        else if (elapsed - this.phaseAt >= this.phaseMs) {
            this.enterPhase(this.phase + 1, elapsed);
            if (this.phase === 6) {
                if (!this.inFlight) this.summarize();
                return;
            }
        }
        if (elapsed >= this.nextSample) {
            this.record('state', Object.assign({ passive: this.data.passiveStatus() }, this.status));
            this.nextSample = elapsed + 5000;
        }
        if (now < this.drainUntil || this.backoffUntil !== null || !CADENCE[this.phase] || this.inFlight || elapsed < this.nextRequest ||
            !this.subscription || !this.subscription.available) return;
        const dids = this.phase === 1 ? this.discoveryQueue.slice(0, 1) : this.selectBatchDids();
        if (dids.length) this.readMany(dids);
    }

    tickLive(now) {
        if (!this.initialized) return;
        if (now >= this.liveSummaryAt) {
            const { sent, ok, tasReject, tasError, nrc, timeout, malformed, totalMs } = this.liveStats;
            const completed = ok + tasReject + tasError + nrc + timeout + malformed;
            this.record('live_summary', {
                sent, ok, tasReject, nrc, timeout, malformed,
                avgMs: completed ? totalMs / completed : null,
                passive: this.data.passiveStatus()
            });
            this.liveStats = newStats();
            this.liveSummaryAt = now + LIVE_SUMMARY_INTERVAL;
        }
        if (this.activeSince !== null && this.elapsed(now) >= this.nextRequest) this.readMany(LIVE_DIDS);
    }

    selectBatchDids() {
        const eligible = did => this.discovery.get(did).status !== 'unsupported';
        const dids = DEFAULT_DIDS.map(did => {
            const alternate = ALTERNATE_DIDS[did];
            if (alternate && (!eligible(did) || (!this.discovered.has(did) && this.discovered.has(alternate)))) {
                return alternate;
            }
            return did;
        });
        const { BasicDataSet, FES } = this.data.passiveStatus();
        if (!BasicDataSet.valid) dids.push(0x4650);
        if (!FES.valid) dids.push(0x4205);
        return dids.filter(eligible);
    }

    readMany(dids) {
        checkRequest(DME, READ_DID, dids);
        const live = this.mode === 'live';
        const cadence = live ? LIVE_CADENCE : CADENCE[this.phase];
        if (!cadence || this.inFlight || !this.subscription || !this.subscription.available ||
            this.backoffUntil !== null || this.clock() < this.drainUntil) return;
        const request = { phase: live ? null : this.phase, dids: dids.slice(), deadline: Infinity, hardDeadline: Infinity, at: null };
        this.inFlight = request;
        const bytes = Buffer.alloc(dids.length * 2);
        dids.forEach((did, i) => bytes.writeUInt16BE(did, 2 * i));
        // signals.call queues native work. Recheck the gate at the actual dispatch.
        const proxy = { callMethod: (name, params, ms) => {
            const now = this.clock();
            this.expirePower(now);
            const elapsed = this.elapsed(now);
            if (this.inFlight !== request || this.activeSince === null || !this.subscription.available ||
                (!live && (this.phase !== request.phase || elapsed - this.phaseAt >= this.phaseMs))) {
                this.finish(request, 'cancelled');
                return;
            }
            request.at = now;
            request.deadline = now + WAIT_MS;
            request.hardDeadline = now + this.hardTimeoutMs;
            const stats = live ? this.liveStats : this.stats[request.phase];
            stats.sent++;
            if (request.phase === 1) {
                const did = this.discoveryQueue.shift();
                this.discovery.get(did).attempts++;
            }
            this.nextRequest = elapsed + cadence;
            this.record('request', { dids: request.dids.map(hex) }, request.phase);
            return this.subscription.proxy.callMethod(name, params, ms);
        } };
        this.signals.call(proxy, 'sendTasuRequest', {
            sourceAddress: 0xF2, targetAddress: DME, serviceID: READ_DID, subroutineID: 0,
            udsDataLength: bytes.length, udsData: bytes, deadlockTime: 0
        }, WAIT_MS).then(reply => {
            if (this.inFlight !== request) return;
            this.expireRequest(this.clock());
            const verdict = reply && typeof reply === 'object' ? reply.TasuErrorEnum : reply;
            if (verdict !== undefined && verdict !== 'NO_ERROR' && verdict !== 0 &&
                verdict !== 'REQUEST_PENDING' && verdict !== 1) this.finish(request, 'tasError', { code: verdict });
        }, () => {
            if (this.inFlight !== request) return;
            this.expireRequest(this.clock());
            this.finish(request, 'tasError', { code: 'call_failed' });
        });
    }

    onResponse(response) {
        const now = this.clock();
        this.expireRequest(now);
        const request = this.inFlight;
        const draining = now < this.drainUntil;
        const unsolicited = !draining && (!request || request.at === null);
        if (unsolicited && now < this.nextUnsolicitedAt) return;
        const error = response && response.errorCode;
        const raw = response && (response.udsResponse === undefined ? response : response.udsResponse);
        const bytes = raw && (raw.data || raw);
        let b = Buffer.from(bytes && typeof bytes.length === 'number' ? bytes : []);
        if (unsolicited) {
            this.nextUnsolicitedAt = now + 1000;
            this.record('unsolicited_response', { length: b.length, hex: b.slice(0, 12).toString('hex') });
            return;
        }
        const frame = { hex: b.toString('hex'), length: b.length };
        if (draining) {
            this.record('late_reply_dropped', frame);
            return;
        }
        if (error !== undefined && error !== 'NO_ERROR' && error !== 0) {
            this.finish(request, 'tasError', Object.assign({ code: error }, frame));
            return;
        }
        const declaredLength = response && response.udsResponseLength;
        if (Number.isFinite(declaredLength)) {
            if (!Number.isInteger(declaredLength) || declaredLength < 0 || declaredLength > b.length) {
                this.finish(request, 'malformed', Object.assign({ issue: 'response_length', declaredLength }, frame));
                return;
            }
            b = b.slice(0, declaredLength);
        }
        if (b.length >= 5 && b[2] === 0x7F) {
            if (b[4] === 0x78) {
                request.deadline = now + WAIT_MS;
                this.record('response_pending', frame, request.phase);
            } else this.finish(request, 'tasReject', Object.assign({ code: hex(b[4]) }, frame));
            return;
        }
        if (b.length < 10) {
            if (Number.isFinite(declaredLength)) {
                this.finish(request, 'malformed', Object.assign({ issue: 'short_frame', declaredLength }, frame));
            }
            return;
        }
        if (b[6] !== DME) return;
        const uds = b.slice(9);
        if (uds[0] === 0x7F && uds[1] === READ_DID && uds.length >= 3) {
            if (uds[2] === 0x78) {
                request.deadline = now + WAIT_MS;
                this.record('response_pending', frame, request.phase);
            } else this.finish(request, 'nrc', Object.assign({ code: hex(uds[2]) }, frame));
            return;
        }
        if (uds[0] !== 0x62 || (uds.length >= 3 && request.dids.indexOf(uds.readUInt16BE(1)) < 0)) return;
        const parsed = parseBatchReply(uds, DID_SPECS.filter(s => request.dids.indexOf(s.did) >= 0));
        if (parsed.issue) {
            this.finish(request, 'malformed', parsed);
            return;
        }
        const readings = parsed.readings.filter(r => r.value !== null);
        if (request.phase === 1) readings.forEach(r => this.discovered.add(r.did));
        if (readings.length) this.publish(readings, request.phase, parsed);
        this.finish(request, 'ok', parsed);
    }

    publish(readings, phase, details) {
        const live = this.mode === 'live';
        const now = this.clock();
        if (live) {
            this.expirePower(now);
            if (!this.powerActive || !this.subscription.available) return;
        }
        const values = {};
        for (const spec of DID_SPECS) {
            const reading = readings.find(r => r.did === spec.did);
            if (reading && values[spec.key] === undefined) values[spec.key] = reading.value;
        }
        if (values.ambient !== undefined) this.ambient = { value: values.ambient, at: now };
        const recent = this.ambient && now - this.ambient.at <= 30000;
        const ambientBar = recent ? this.ambient.value : 1.013;
        const ambientSource = recent ? '4201' : 'std_1013';
        if (values.oilAbs !== undefined) {
            values.oilPressure = values.oilAbs - ambientBar;
            Object.assign(details, { oilAbsBar: values.oilAbs, ambientBar, ambientSource, oilGaugeBar: values.oilPressure });
        }
        if (values.boostAbs !== undefined) {
            values.boost = values.boostAbs - ambientBar;
            Object.assign(details, { boostAbsBar: values.boostAbs, ambientBar, ambientSource, boostGaugeBar: values.boost });
        }
        if (!live && phase < 3) return;
        const ttl = live ? LIVE_TTL : phase === 3 ? 12000 : 6000;
        for (const key of ['iat', 'oilPressure', 'fuelRail', 'gearbox', 'boost']) {
            if (values[key] !== undefined) this.data.receiveDiag(key, values[key], ttl);
        }
    }

    finish(request, outcome, fields) {
        if (this.inFlight !== request) return;
        this.inFlight = null;
        if (request.at === null || outcome === 'cancelled') return;
        const now = this.clock();
        if (outcome === 'timeout') this.drainUntil = now + DRAIN_MS;
        const durationMs = now - request.at;
        const stats = this.mode === 'live' ? this.liveStats : this.stats[request.phase];
        stats[outcome]++;
        stats.totalMs += durationMs;
        this.record(outcome, Object.assign({ dids: request.dids.map(hex), durationMs }, fields), request.phase);
        const failed = outcome === 'tasReject' || outcome === 'tasError' || outcome === 'timeout';
        if (request.phase === 1) {
            const did = request.dids[0];
            const result = this.discovery.get(did);
            result.status = outcome === 'nrc' && UNSUPPORTED_NRC.has(fields.code) ? 'unsupported' : outcome;
            if (failed && result.attempts < 3) this.discoveryQueue.push(did);
        }
        if (request.phase === 4) {
            this.failures = failed ? this.failures + 1 : 0;
            if (this.failures === 3) {
                this.backoffUntil = this.clock() + this.backoffMs;
                this.failures = 0;
                stats.backoffs++;
                this.record('backoff_enter', { backoffMs: this.backoffMs }, request.phase);
            }
        }
    }

    summarize() {
        this.summarized = true;
        const phases = {};
        this.stats.forEach((stats, i) => {
            const { totalMs, sent } = stats;
            phases[PHASES[i]] = Object.assign({}, stats, { avgMs: sent ? totalMs / sent : null });
            delete phases[PHASES[i]].totalMs;
        });
        this.record('summary', Object.assign({ phases, discovered: Array.from(this.discovered, hex), passive: this.data.passiveStatus() }, this.status));
    }

    stop() {
        this.stopped = true;
        this.inFlight = null;
        this.updateGate();
    }
}

module.exports = { DiagProbe, TASU, TASU_INSTANCE, EXT_DIAG, DID_SPECS, PHASES, checkRequest, parseBatchReply };
