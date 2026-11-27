"use strict";
const net = require('net');
function request(config, socketPath = '/var/opt/id8-widgets/state/club-dashboard-settings.sock', {withRevision, expectedRevision} = {}) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath);
        let body = '';
        socket.setEncoding('utf8');
        socket.setTimeout(5000, () => {
            socket.destroy();
            reject(Error('Settings socket timed out'));
        });
        socket.on('connect', () => socket.end(JSON.stringify(config ? {config, expectedRevision} : {}) + '\n'));
        socket.on('data', chunk => { body += chunk; });
        socket.on('error', reject);
        socket.on('end', () => {
            try {
                const response = JSON.parse(body);
                if (!response || response.config === undefined && !response.error) throw Error();
                if (response.error) reject(Object.assign(Error(response.error), response));
                else resolve(withRevision ? response : response.config);
            } catch (e) {
                reject(Error('Invalid settings socket response'));
            }
        });
    });
}
module.exports = { request };
