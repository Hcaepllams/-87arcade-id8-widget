'use strict';
const fs = require('fs'), path = require('path');

function writeAtomic(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, data);
    const fd = fs.openSync(tmp, 'r');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fs.renameSync(tmp, file);
    const dir = fs.openSync(path.dirname(file), 'r');
    fs.fsyncSync(dir);
    fs.closeSync(dir);
}

function register(appsRoot, registryFile, baseConfig, outputConfig) {
    const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : {
        next: 1, widgets: { 'club-dashboard': { target: 'widget', content: 43204001, scene: '0x4d4755000001' } }
    };
    registry.widgets = Object.assign(Object.create(null), registry.widgets);
    const apps = fs.readdirSync(appsRoot).sort().filter(id => /^[a-z0-9_-]+$/.test(id)).map(id => {
        const directory = path.resolve(appsRoot, id), file = path.join(directory, 'app.json');
        if (!fs.existsSync(file)) return null;
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (manifest.target !== 'widget') return null;
        if (manifest.id !== id || !manifest.title || /[\r\n#]/.test(manifest.title) ||
            !/^[a-zA-Z0-9_-]+\.js$/.test(manifest.vehicle || ''))
            throw Error('Invalid widget manifest: ' + file);
        if (!Object.prototype.hasOwnProperty.call(registry.widgets, id)) {
            const n = registry.next++;
            registry.widgets[id] = { target: 'widget' + n, content: 43204009 + n,
                scene: '0x' + (0x4d4755001000 + n - 1).toString(16), order: 50 + n };
        }
        return { directory, manifest, spec: registry.widgets[id] };
    }).filter(Boolean);
    const base = fs.readFileSync(baseConfig, 'utf8');
    const value = key => base.split('\n').filter(l => l.trim().startsWith(key + ' =')).pop().split('=')[1].trim();
    const targets = new Set(value('id8_targets').split(','));
    const scenes = new Set(value('id8_scene_ids_allowed').split(','));
    const lines = [];
    apps.forEach(({ directory, manifest, spec }) => {
        targets.add(spec.target); scenes.add(spec.scene);
        const prefix = 'id8_' + spec.target + '_';
        const settings = { category: 43100301, content: spec.content, scene_id: spec.scene, size: '2240x896',
            linger_ms: 3000, remember: 1, description: manifest.title, order: spec.order || 50,
            preview: manifest.preview ? path.join(directory, manifest.preview) : '', focus: 0, layouts: '', background_id: '' };
        Object.keys(settings).forEach(key => lines.push(prefix + key + ' = ' + settings[key]));
    });
    lines.push('id8_targets = ' + Array.from(targets).join(','),
        'id8_scene_ids_allowed = ' + Array.from(scenes).join(','),
        'id8_widget_restore_on_layout = 1');
    // Keep allocations before publishing config so a repeated registration reuses the same identities.
    writeAtomic(registryFile, JSON.stringify(registry, null, 2) + '\n');
    writeAtomic(outputConfig, base + '\n' + lines.join('\n') + '\n');
    return apps;
}
module.exports = { register, writeAtomic };
if (require.main === module) {
    const [apps, state, base, output] = process.argv.slice(2);
    register(apps, state, base, output).forEach(a => console.log(a.manifest.id, a.spec.target));
}
