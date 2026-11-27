'use strict';
const fs = require('fs'), path = require('path'), { fork } = require('child_process');
const { ClusterRender } = require('/var/opt/cluster-render/current/cluster_render_client');
const { observe } = require('./lifecycle');
const { createStore, serve } = require('./preferences');
const appsRoot = path.resolve(process.argv[2]), registry = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const kit = process.env.WIDGET_MANAGER_KIT || path.join(__dirname, 'source/javascript/kit');
const client = new ClusterRender('id8-widget-manager'), children = [], preferenceServers = [];
const log = { info: console.log, warn: console.error };
let subscription;
client.on('error', e => console.error(String(e)));
client.connect();
for (const id of fs.readdirSync(appsRoot).sort()) {
    if (!Object.prototype.hasOwnProperty.call(registry.widgets, id)) continue;
    const directory = path.join(appsRoot, id);
    if (!fs.existsSync(path.join(directory, 'app.json'))) continue;
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'app.json'), 'utf8'));
    if (manifest.target !== 'widget') continue;
    const child = fork(path.join(__dirname, 'runtime.js'), [directory, registry.widgets[id].target], { stdio: 'inherit' });
    // Let systemd restart the group if a widget process exits unexpectedly.
    child.on('exit', () => process.exit(1));
    children.push(child);
    if (manifest.preferences) {
        const state = '/var/opt/id8-widgets/state/' + id + '-settings';
        const store = createStore(state + '.json', require(path.join(directory, manifest.preferences)));
        store.subscribe(config => child.send({type: 'widget-settings', config}));
        child.send({type: 'widget-settings', config: store.get()});
        const server = serve(store, state + '.sock');
        server.on('error', e => { console.error(e.stack); process.exit(1); });
        preferenceServers.push(server);
    }
}
function stop() {
    preferenceServers.forEach(server => server.close());
    children.forEach(c => { c.removeAllListeners('exit'); c.kill('SIGTERM'); });
    client.close();
    if (subscription) subscription.shutdown().then(() => process.exit(0));
    else process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('exit', () => children.forEach(c => c.kill('SIGTERM')));
observe(require(path.join(kit, 'signals')), client, log,
    state => children.forEach(child => child.send({ type: 'power-state', state }))).then(sub => {
    subscription = sub;
    if (sub.error) throw Error(sub.error);
    log.info('widget-manager: shared power subscription ready');
}).catch(e => { console.error(e.stack); process.exit(1); });
