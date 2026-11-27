"use strict";
const fs = require('fs'), net = require('net');
const { writeAtomic } = require('./registry');
function createStore(file, schema) {
    const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
    let current = saved === undefined ? schema.defaults() : schema.validate(saved);
    let revision = saved && saved.revision || 0, lastWriteId;
    const listeners = new Set();
    return {
        get: () => schema.copy(current),
        get revision() { return revision; },
        save(value, {expectedRevision, writeId, afterWriteId} = {}) {
            const followsOwnWrite = revision === expectedRevision + 1 &&
                typeof afterWriteId === 'string' && afterWriteId === lastWriteId;
            if (expectedRevision !== undefined && expectedRevision !== revision && !followsOwnWrite) {
                const e = Error('设置已在其他端更新，请重新操作');
                e.status = 409;
                throw e;
            }
            const next = schema.validate(value);
            const nextRevision = revision + 1;
            writeAtomic(file, JSON.stringify(Object.assign({}, next, {revision: nextRevision})) + '\n');
            current = next;
            revision = nextRevision;
            lastWriteId = writeId;
            listeners.forEach(fn => fn(schema.copy(current)));
            return schema.copy(current);
        },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
}
function serve(store, socketPath) {
    if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
    const server = net.createServer({allowHalfOpen: true}, socket => {
        let body = '';
        socket.setEncoding('utf8');
        socket.on('data', part => {body += part; if (body.length > 32768) socket.destroy();});
        socket.on('error', e => console.error('settings client: ' + e.message));
        socket.on('end', () => {
            try {
                const message = JSON.parse(body);
                const config = message.config === undefined ? store.get() : store.save(message.config, message);
                socket.end(JSON.stringify({config, revision: store.revision}) + '\n');
            } catch (e) {
                const response = {error: e.message};
                if (e.status === 409) Object.assign(response, {status: 409, config: store.get(), revision: store.revision});
                socket.end(JSON.stringify(response) + '\n');
            }
        });
    });
    server.listen(socketPath, () => fs.chmodSync(socketPath, 0o666));
    return server;
}
module.exports = { createStore, serve };
