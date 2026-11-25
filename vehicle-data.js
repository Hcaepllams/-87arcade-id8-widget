'use strict';
const { GHistory } = require('./g-history');
// Read-only SOME/IP fields, verified against this car's interface catalog and M Vitals scaling.
const definitions = [
    ['de.bmw.infotainment.vehicle.CDS', 'statusEngineTemperature', 6000, [
        ['oil', 'temperatureEngineOilDrive', 1, -48, 255, -48, 170],
        ['coolant', 'temperatureEngineDrive', 1, -48, 255, -48, 160]]],
    ['de.bmw.infotainment.vehicle.CDS2', 'statusLongitudinalAccelerationMassCenter', 2000, [
        ['gLong', 'longitudinalAccelerationCentreOfGravity', 0.002 / 9.80665, -65 / 9.80665, 65535, -4, 4]]],
    ['de.bmw.infotainment.vehicle.CDS2', 'statusLateralAccelerationMassCenter', 2000, [
        ['gLat', 'lateralAccelerationCentreOfGravity', 0.002 / 9.80665, -65 / 9.80665, 65535, -4, 4]]],
    ['de.bmw.infotainment.vehicle.TPMS', 'statusTyrePressure', 25000,
        ['FL', 'FR', 'RL', 'RR'].map(w => ['pressure' + w, 'actualValuePressureTyre' + w + 'H', 0.1, 0, 65532, 0.1, 6])],
    ['de.bmw.infotainment.vehicle.TPMS', 'statusTyreTemperature', 25000,
        ['FL', 'FR', 'RL', 'RR'].map(w => ['tyre' + w, 'actualValueTemperatureTyre' + w + 'H', 1, -40, 65535, -40, 150])],
    ['de.bmw.infotainment.drivingexcitement.FES', 'statusSwitchDriveDynamicSport2', 6000,
        [['boost', 'displayBoostPressure', 0.01, 0, 255, -0.5, 4]], { optional: true }],
    ['de.bmw.infrastructure.analytics.BasicDataSet', 'basicDataSet', 10000,
        [['gearbox', 'valueTemperatureTransmissionOil', 1, -48, 255, -40, 160]], { optional: true, rejectStuckZero: true }]
];
const diagRanges = { iat: [-40, 150], oilPressure: [-0.5, 15], fuelRail: [0, 450], gearbox: [-40, 170], boost: [-1, 4] };
const inRange = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
const expired = (entry, now) => !!entry && now - entry.at > entry.ttl;

class VehicleData {
    constructor(clock, storage) {
        this.clock = clock || Date.now;
        this.values = {};
        this.diagValues = {};
        this.passive = {};
        this.history = new GHistory(this.clock, storage);
    }
    powerState(state) {
        if (this.history.powerState(state)) {
            delete this.values.gLat;
            delete this.values.gLong;
            delete this.values.gearbox;
            delete this.passive.gearbox;
        }
    }
    receive(field, payload) {
        const def = definitions.find(d => d[1] === field);
        if (!def) return;
        for (const [key, member, factor, offset, invalid, min, max] of def[3]) {
            const raw = payload && payload[member];
            const scaled = Number.isFinite(raw) && raw >= 0 && raw < invalid ? raw * factor + offset : null;
            let value = inRange(scaled, min, max) ? scaled : null;
            if (def[4] && def[4].optional) {
                const observation = this.passive[key] || (this.passive[key] = { firstRaw: null, everValid: false });
                if (observation.firstRaw === null && Number.isFinite(raw)) observation.firstRaw = raw;
                if (def[4].rejectStuckZero && value === 0 && !observation.everValid) value = null;
                if (value !== null) observation.everValid = true;
                observation.raw = Number.isFinite(raw) ? raw : null;
            }
            this.values[key] = { value, at: this.clock(), ttl: def[2] };
        }
    }
    receiveDiag(key, value, ttlMs) {
        if (!Object.prototype.hasOwnProperty.call(diagRanges, key)) return;
        const [min, max] = diagRanges[key];
        this.diagValues[key] = { value: inRange(value, min, max) ? value : null, at: this.clock(), ttl: ttlMs || 8000 };
    }
    passiveStatus() {
        const now = this.clock();
        const status = key => {
            const entry = this.values[key];
            const stale = expired(entry, now);
            const value = entry && !stale ? entry.value : null;
            return Object.assign({ seen: !!entry, value, valid: value !== null, stale }, this.passive[key]);
        };
        return { FES: status('boost'), BasicDataSet: status('gearbox') };
    }
    snapshot(mode) {
        const now = this.clock(), result = { mode, valid: false, stale: false };
        for (const def of definitions) for (const [key] of def[3]) {
            const entry = this.values[key];
            const stale = expired(entry, now);
            result[key] = entry && !stale ? entry.value : null;
            if (stale) result.stale = true;
        }
        for (const key of Object.keys(diagRanges)) {
            const entry = this.diagValues[key];
            const stale = expired(entry, now);
            if (result[key] == null) result[key] = entry && !stale ? entry.value : null;
            if (stale) result.stale = true;
        }
        result.valid = Object.keys(result).some(key => typeof result[key] === 'number');
        return Object.assign(result, this.history.sample(result.gLat, result.gLong, result.valid));
    }
}
module.exports = { definitions, VehicleData };
