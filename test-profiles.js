'use strict';
const fs = require('fs');
const path = require('path');
const simulator = path.resolve(process.env.SIMULATOR_DIR || path.join(__dirname, '../simulator'), 'profiles.js');

// Synthetic driving inputs for public renderer tests when the simulator is unavailable.
const initial = { mode: 'road', demo: true, missing: false, stale: false, hidden: false,
    speed: 86, rpm: 2850, oil: 98, coolant: 92, gLat: 0.23, gLong: -0.12,
    iat: 35, gearbox: 82, boost: 1.15, oilPressure: 4.2, fuelRail: 170,
    torque: 310, power: 310 * 2850 / 9549, pedal: 58, steer: 27,
    outside: 18.5, battery: 84, tank: 41, range: 452,
    pressureFL: 2.35, pressureFR: 2.36, pressureRL: 2.51, pressureRR: 2.50,
    tyreFL: 36, tyreFR: 37, tyreRL: 39, tyreRR: 38 };
function sample(state, seconds) {
    const s = Object.assign({}, state);
    if (s.demo) {
        s.speed = Math.round(86 + 18 * Math.sin(seconds / 6));
        s.rpm = Math.round(2900 + 800 * Math.sin(seconds / 4));
        s.gLat = 0.65 * Math.sin(seconds / 2);
        s.gLong = 0.35 * Math.cos(seconds / 3);
        s.oil = Math.round(98 + 3 * Math.sin(seconds / 20));
        s.coolant = Math.round(92 + 2 * Math.sin(seconds / 17));
        s.iat = Math.round(35 + 4 * Math.sin(seconds / 13));
        s.gearbox = Math.round(82 + 2 * Math.sin(seconds / 19));
        s.boost = 0.85 + 0.55 * Math.sin(seconds / 4);
        s.oilPressure = 3.8 + 0.7 * Math.sin(seconds / 5);
        s.fuelRail = Math.round(170 + 25 * Math.sin(seconds / 4));
        s.pedal = 48 + 32 * Math.sin(seconds / 4);
        s.torque = 530 * s.pedal / 100 - 30;
        s.power = Math.max(0, s.torque) * s.rpm / 9549;
        s.steer = s.gLat * 120;
        s.outside = 18.5 + 1.5 * Math.sin(seconds / 50);
        s.battery = 84 + 2 * Math.sin(seconds / 60);
        s.tank = 41 - 2 * (1 - Math.cos(seconds / 90));
        s.range = 11 * s.tank + 7 * Math.sin(seconds / 25);
        ['FL', 'FR', 'RL', 'RR'].forEach((wheel, i) => {
            s['pressure' + wheel] = initial['pressure' + wheel] + 0.09 * Math.sin(seconds / 27 + i / 3);
            s['tyre' + wheel] = initial['tyre' + wheel] + 3 * Math.sin(seconds / 34 + i / 3);
        });
    }
    s.gTotal = Math.hypot(s.gLat, s.gLong);
    s.valid = !s.missing && !s.stale;
    return s;
}
module.exports = fs.existsSync(simulator) ? require(simulator) : { initial, sample };
