'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { GHistory } = require('./g-history');
const { stateStore } = require('./framework/widgets/state');
if (process.argv[2]) {
    const history = new GHistory(() => 1000, stateStore(process.argv[3], 'boot-a'));
    if (process.argv[2] === '--save') history.sample(0.6, 0.8, true);
    else assert(history.sample(null, null, false).gEnvelope.some(p => p.lat === 0.6 && p.long === 0.8));
} else {
    let now = 1000;
    const history = new GHistory(() => now);
    history.sample(0.6, 0.8, true);
    now += 200;
    let result = history.sample(0.1, 0.2, true);
    const firstEnvelope = result.gEnvelope;
    assert(firstEnvelope.some(p => p.lat === 0.6 && p.long === 0.8), 'an older directional maximum remains on the outline');
    history.sample(-0.8, 0.2, true);
    history.sample(0.2, -0.9, true);
    const expanded = history.sample(0, 0, true).gEnvelope;
    assert.equal(expanded.length, 3);
    assert(expanded.some(p => p.lat === -0.8));
    assert(expanded.some(p => p.long === -0.9));
    assert.equal(result.gTrail.length, 2);
    assert.equal(result.gTrail[0].age, 200);
    now += 2000;
    result = history.sample(null, null, false);
    assert.equal(result.gTrail.length, 0, 'missing data lets the trail fade away');
    assert.deepEqual(result.gEnvelope, expanded, 'missing data preserves every directional extreme');
    history.powerState('WELCOME_SCREEN'); history.powerState('FULL_ON_USER_ON');
    assert.deepEqual(history.sample(null, null, false).gEnvelope, expanded, 'welcome and repeated ignition do not reset the trip');
    history.powerState('SLEEP_MODE_ALL_OFF'); history.powerState('FULL_ON_USER_ON');
    assert.deepEqual(history.sample(null, null, false).gEnvelope, [{ lat: 0, long: 0 }], 'a new trip clears the outline');

    let saves = 0;
    const jitter = new GHistory(() => now, { load: () => null, save: () => { saves++; } });
    jitter.sample(0.601, 0.801, true);
    const quantized = jitter.sample(0.604, 0.804, true);
    assert.deepStrictEqual(quantized.gEnvelope, [{ lat: 0, long: 0 }, { lat: 0.6, long: 0.8 }]);
    assert.strictEqual(saves, 1, 'sub-step noise leaves the stored outline unchanged');
    assert.strictEqual(quantized.gTrail[1].lat, 0.604, 'the red trail keeps raw coordinates');

    const sector = new GHistory(() => now);
    sector.sample(0.6, 0, true);
    assert.deepStrictEqual(sector.sample(0.61, 0.04, true).gEnvelope,
        [{ lat: 0, long: 0 }, { lat: 0.6, long: 0 }, { lat: 0.61, long: 0.04 }],
        'two vertices in the same sector are preserved below the cap');

    const stress = new GHistory(() => now);
    let outline;
    for (let frame = 0; frame < 20000; frame++, now += 100) {
        const phase = frame * 2 * Math.PI / 20000;
        outline = stress.sample(0.95 * Math.sin(3 * phase + 0.18), 0.81 * Math.sin(4 * phase), true).gEnvelope;
        assert(outline.length <= 64, 'a long drive stays within the vertex limit');
    }
    assert(Buffer.byteLength(JSON.stringify(outline)) <= 3072, 'the persisted outline stays under 3 KiB');
    for (const [axis, expected] of [['lat', 0.95], ['long', 0.81]]) {
        const values = outline.map(p => p[axis]);
        assert(Math.abs(Math.min(...values) + expected) <= 0.02, axis + ' negative extreme');
        assert(Math.abs(Math.max(...values) - expected) <= 0.02, axis + ' positive extreme');
    }

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-g-'));
    try {
        const file = path.join(directory, 'state.json');
        execFileSync(process.execPath, [__filename, '--save', file]);
        execFileSync(process.execPath, [__filename, '--restore', file]);
        const reboot = new GHistory(() => now, stateStore(file, 'boot-b'));
        assert.deepEqual(reboot.sample(null, null, false).gEnvelope, [{ lat: 0, long: 0 }], 'new boot starts a fresh trip');
        const restart = new GHistory(() => now, stateStore(file, 'boot-a'));
        restart.powerState('SHUTDOWN_MODE_USER_OFF');
        const resumed = new GHistory(() => now, stateStore(file, 'boot-a'));
        resumed.powerState('FULL_ON_USER_ON');
        assert.deepEqual(resumed.sample(null, null, false).gEnvelope, [{ lat: 0, long: 0 }], 'shutdown survives process restart');

        const storage = stateStore(file, 'boot-a');
        const oldEnvelope = Array.from({ length: 720 }, (_, i) => {
            const angle = i * Math.PI / 360;
            return { lat: 3.9 * Math.cos(angle), long: 3.9 * Math.sin(angle) };
        });
        storage.save({ boot: 'boot-a', active: true, envelope: oldEnvelope });
        const migrated = new GHistory(() => now, storage).sample(null, null, false).gEnvelope;
        assert(migrated.length <= 64, 'same-boot legacy outlines are compacted before fresh samples arrive');
        assert(fs.statSync(file).size <= 3072, 'the entire migrated state file fits in 3 KiB');
        assert.deepStrictEqual(storage.load().envelope, migrated, 'migration compacts the saved file too');
    } finally {
        for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
        fs.rmdirSync(directory);
    }
    console.log('PASS: fading trail, 20,000-frame bounded G envelope, quantization, legacy migration, independent-process persistence, trip reset and reboot');
}
