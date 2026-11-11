'use strict';
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
        ['FL', 'FR', 'RL', 'RR'].map(w => ['tyre' + w, 'actualValueTemperatureTyre' + w + 'H', 1, -40, 65535, -40, 150])]
];
class VehicleData {
    constructor(clock) { this.clock = clock || Date.now; this.values = {}; }
    receive(field, payload) {
        const def = definitions.find(d => d[1] === field);
        if (!def) return;
        for (const [key, member, factor, offset, invalid, min, max] of def[3]) {
            const raw = payload && payload[member];
            const v = Number.isFinite(raw) && raw >= 0 && raw < invalid ? raw * factor + offset : null;
            this.values[key] = { value: v !== null && v >= min && v <= max ? v : null, at: this.clock(), ttl: def[2] };
        }
    }
    snapshot(mode) {
        const now = this.clock(), result = { mode, valid: false, stale: false };
        for (const def of definitions) for (const [key] of def[3]) {
            const entry = this.values[key];
            const expired = !!entry && now - entry.at > entry.ttl;
            result[key] = entry && !expired ? entry.value : null;
            if (result[key] !== null) result.valid = true;
            if (expired) result.stale = true;
        }
        return result;
    }
}
module.exports = { definitions, VehicleData };
