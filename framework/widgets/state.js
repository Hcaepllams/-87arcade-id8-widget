'use strict';
const fs = require('fs');
const { writeAtomic } = require('./registry');
function stateStore(file, boot) {
    return {
        boot,
        load: () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null,
        save: value => writeAtomic(file, JSON.stringify(value) + '\n')
    };
}
function appState(id) {
    return stateStore('/var/opt/id8-widgets/state/' + id + '.json',
        fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim());
}
module.exports = { appState, stateStore };
