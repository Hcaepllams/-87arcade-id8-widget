'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { register } = require('./registry');
const { observe } = require('./lifecycle');
(async () => {
    let receive, calls = 0, watched;
    const client = new (require('events').EventEmitter)();
    client.ready = true; client.wakeWidget = () => calls++;
    await observe({ watch: async (iface, instance, fields) => {
        watched = [iface, instance]; receive = fields.powerStateDetailed;
        return { shutdown: async () => {} };
    } }, client, { info() {} });
    assert(watched[0].endsWith('.Lifecycle') && watched[1] === 'Front');
    receive('FULL_ON_USER_ON'); assert.equal(calls, 1, 'cold startup already in ignition state requests recovery');
    receive('WELCOME_SCREEN'); receive('FULL_ON_USER_ON'); assert.equal(calls, 2);
    receive('FULL_ON_USER_ON'); receive('ENTERTAINMENT_MODE_USER_ON'); receive('FULL_ON_USER_ON');
    assert.equal(calls, 2);
    receive('GOODBYE_SCREEN'); receive('SHUTDOWN_MODE_USER_OFF');
    receive('WELCOME_SCREEN'); receive('FULL_ON_USER_ON'); assert.equal(calls, 3);
    client.ready = false;
    receive('WELCOME_SCREEN'); receive('FULL_ON_USER_ON'); assert.equal(calls, 3);
    client.ready = true; client.emit('ready'); assert.equal(calls, 4, 'a wake survives the connection handshake');
    client.emit('ready'); assert.equal(calls, 4, 'reconnect does not duplicate an already delivered wake');
    client.ready = false;
    receive('WELCOME_SCREEN'); receive('FULL_ON_USER_ON'); receive('GOODBYE_SCREEN');
    client.ready = true; client.emit('ready'); assert.equal(calls, 4, 'shutdown cancels an undelivered old wake');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'id8-widget-registry-'));
    try {
        const apps = path.join(tmp, 'apps'); fs.mkdirSync(apps);
        const state = path.join(tmp, 'registry.json'), config = path.join(tmp, 'cluster-render.conf');
        const base = path.resolve(__dirname, 'cluster-render.conf');
        function app(id, title) {
            const dir = path.join(apps, id); fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({
                id, title, target: 'widget', entry: 'render.js', vehicle: 'widget.js'
            }));
        }
        app('club-dashboard', '87 Arcade'); app('track-view', 'Track View');
        const first = register(apps, state, base, config);
        const original = JSON.parse(fs.readFileSync(state, 'utf8'));
        assert.equal(first[0].spec.target, 'widget');
        assert.notEqual(first[0].spec.content, first[1].spec.content);
        assert.notEqual(first[0].spec.scene, first[1].spec.scene);
        assert.equal(new Set(first.map(a => a.spec.target)).size, 2);
        const once = fs.readFileSync(config, 'utf8');
        register(apps, state, base, config);
        assert.equal(fs.readFileSync(config, 'utf8'), once, 're-registration is idempotent');
        app('another-widget', 'Another Widget');
        register(apps, state, base, config);
        const more = JSON.parse(fs.readFileSync(state, 'utf8'));
        assert.deepEqual(more.widgets['track-view'], original.widgets['track-view'], 'adding earlier-sorted app preserves IDs');
        fs.renameSync(path.join(apps, 'track-view'), path.join(tmp, 'track-removed'));
        register(apps, state, base, config);
        const removed = JSON.parse(fs.readFileSync(state, 'utf8'));
        assert.deepEqual(removed.widgets['track-view'], original.widgets['track-view'], 'removed identities remain reserved');
        fs.renameSync(path.join(tmp, 'track-removed'), path.join(apps, 'track-view'));
        register(apps, state, base, config);
        assert.deepEqual(JSON.parse(fs.readFileSync(state, 'utf8')).widgets['track-view'], original.widgets['track-view']);
        assert(fs.readFileSync(config, 'utf8').includes('id8_widget1_remember = 1'));
        console.log('PASS: one power observer, one event per wake, two widgets, stable identities, idempotent registration, reinstall');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
