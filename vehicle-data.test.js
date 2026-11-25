'use strict';
const assert = require('assert');
const { VehicleData } = require('./vehicle-data');
let now = 1000;
const data = new VehicleData(() => now);
assert.equal(data.snapshot('road').valid, false);
data.receive('statusEngineTemperature', { temperatureEngineDrive: 98, temperatureEngineOilDrive: 90 });
assert.equal(data.snapshot('road').oil, 42);
assert.equal(data.snapshot('road').coolant, 50);
data.receive('statusTyrePressure', { actualValuePressureTyreFLH: 21, actualValuePressureTyreFRH: 65535 });
assert.equal(data.snapshot('road').pressureFL, 2.1);
assert.equal(data.snapshot('road').pressureFR, null);
data.receive('statusLateralAccelerationMassCenter', { lateralAccelerationCentreOfGravity: 32500 });
assert(Math.abs(data.snapshot('sport').gLat) < 1e-10);
now += 2100;
assert.equal(data.snapshot('sport').gLat, null);
assert.equal(data.snapshot('sport').oil, 42);
data.receive('statusEngineTemperature', { temperatureEngineDrive: 255, temperatureEngineOilDrive: 255 });
assert.equal(data.snapshot('road').oil, null);
now += 25001;
assert.equal(data.snapshot('road').valid, false);
assert.equal(data.snapshot('road').stale, true);
data.receive('statusLateralAccelerationMassCenter', { lateralAccelerationCentreOfGravity: 35442 });
data.receive('statusLongitudinalAccelerationMassCenter', { longitudinalAccelerationCentreOfGravity: 36423 });
const peak = data.snapshot('road').gEnvelope.find(p => p.lat > 0);
assert(Math.hypot(peak.lat, peak.long) > 0.99);
assert(data.snapshot('sport').gEnvelope.some(p => p.lat === peak.lat), 'mode switching preserves the outline');
data.powerState('SHUTDOWN_MODE_USER_OFF'); data.powerState('FULL_ON_USER_ON');
assert.deepEqual(data.snapshot('sport').gEnvelope, [{ lat: 0, long: 0 }], 'a new trip waits for fresh acceleration samples');

const powertrain = new VehicleData(() => now);
function gearbox(raw) { powertrain.receive('basicDataSet', { valueTemperatureTransmissionOil: raw }); }
function boost(raw) { powertrain.receive('statusSwitchDriveDynamicSport2', { displayBoostPressure: raw }); }
for (const key of ['oil', 'coolant', 'gearbox', 'iat', 'oilPressure', 'fuelRail', 'boost']) {
    assert.strictEqual(powertrain.snapshot('sport')[key], null, key);
}
gearbox(48); gearbox(48);
assert.strictEqual(powertrain.snapshot('sport').gearbox, null);
assert.deepStrictEqual(powertrain.passiveStatus().BasicDataSet,
    { seen: true, firstRaw: 48, raw: 48, value: null, valid: false, stale: false, everValid: false });
powertrain.receiveDiag('gearbox', 72, 15000);
powertrain.receiveDiag('boost', 1.7, 15000);
powertrain.receiveDiag('iat', 25, 6000);
powertrain.receiveDiag('oilPressure', 4);
powertrain.receiveDiag('fuelRail', 450);
assert.strictEqual(powertrain.snapshot('sport').gearbox, 72);
boost(90); gearbox(49);
assert.strictEqual(powertrain.snapshot('sport').boost, 0.9);
assert.strictEqual(powertrain.snapshot('sport').gearbox, 1);
gearbox(48);
assert.strictEqual(powertrain.snapshot('sport').gearbox, 0, 'a later zero is valid after a real reading');
powertrain.powerState('FULL_ON_USER_ON');
assert.strictEqual(powertrain.snapshot('sport').gearbox, 0, 'a repeated heartbeat does not reset trust');
powertrain.powerState('SHUTDOWN_MODE_USER_OFF');
powertrain.powerState('FULL_ON_USER_ON');
assert.strictEqual(powertrain.passiveStatus().BasicDataSet.seen, false, 'new trip clears the previous sample');
gearbox(48); gearbox(48);
assert.strictEqual(powertrain.snapshot('sport').gearbox, 72, 'a fixed zero in the new trip still uses the diagnostic fallback');
assert.strictEqual(powertrain.passiveStatus().BasicDataSet.everValid, false);
gearbox(49); gearbox(48);
assert.strictEqual(powertrain.snapshot('sport').gearbox, 0, 'fresh variation restores trust in the new trip');
gearbox(255); boost(255);
assert.strictEqual(powertrain.snapshot('sport').boost, 1.7);
assert.strictEqual(powertrain.snapshot('sport').gearbox, 72);
boost(100); gearbox(80);
now += 6001;
assert.strictEqual(powertrain.snapshot('sport').iat, null);
assert.strictEqual(powertrain.snapshot('sport').boost, 1.7);
assert.strictEqual(powertrain.snapshot('sport').gearbox, 32);
assert.strictEqual(powertrain.snapshot('sport').oilPressure, 4);
assert.strictEqual(powertrain.snapshot('sport').fuelRail, 450);
now += 4000;
assert.strictEqual(powertrain.snapshot('sport').gearbox, 72);
assert.strictEqual(powertrain.snapshot('sport').oilPressure, null);
assert.strictEqual(powertrain.snapshot('sport').fuelRail, null);
now += 5000;
assert.strictEqual(powertrain.snapshot('sport').boost, null);
assert.strictEqual(powertrain.snapshot('sport').gearbox, null);
assert.strictEqual(powertrain.snapshot('sport').valid, false);
assert.strictEqual(powertrain.snapshot('sport').stale, true);
for (const [key, value] of [['iat', Infinity], ['oilPressure', -0.51], ['fuelRail', 451], ['boost', 4.01], ['gearbox', '40']]) {
    powertrain.receiveDiag(key, value);
    assert.strictEqual(powertrain.snapshot('sport')[key], null, key);
}
console.log('PASS: passive conversion and fixed-zero handling, diagnostic ranges, precedence and independent expiry');
