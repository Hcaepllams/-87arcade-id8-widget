'use strict';
const maxVertices = 64;

function convexHull(points) {
    const sorted = points.sort((a, b) => a.lat - b.lat || a.long - b.long)
        .filter((p, i, all) => !i || p.lat !== all[i - 1].lat || p.long !== all[i - 1].long);
    if (sorted.length < 3) return sorted;
    const cross = (a, b, c) => (b.lat - a.lat) * (c.long - a.long) - (b.long - a.long) * (c.lat - a.lat);
    function half(list) {
        const hull = [];
        for (const point of list) {
            while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
            hull.push(point);
        }
        return hull;
    }
    const lower = half(sorted), upper = half(sorted.slice().reverse());
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function envelope(points) {
    // Integer centi-g coordinates keep collinear comparisons exact.
    let hull = convexHull(points.map(p => ({ lat: Math.round(p.lat * 100) || 0, long: Math.round(p.long * 100) || 0 })));
    if (hull.length > maxVertices) {
        const sectors = new Array(maxVertices);
        for (const { lat, long } of hull) {
            const sector = Math.floor((Math.atan2(long, lat) + Math.PI) / (2 * Math.PI) * maxVertices) % maxVertices;
            const radius = lat * lat + long * long;
            if (!sectors[sector] || radius > sectors[sector].radius) sectors[sector] = { lat, long, radius };
        }
        hull = convexHull(sectors.filter(Boolean));
    }
    return hull.map(p => ({ lat: p.lat / 100, long: p.long / 100 }));
}
class GHistory {
    constructor(clock, storage) {
        this.clock = clock || Date.now;
        this.storage = storage;
        const saved = storage && storage.load();
        this.state = saved && saved.boot === storage.boot ? saved : {
            boot: storage && storage.boot, active: true, envelope: [{ lat: 0, long: 0 }]
        };
        if (this.state === saved) this.updateEnvelope(saved.envelope);
        this.trail = [];
    }
    save() { if (this.storage) this.storage.save(this.state); }
    updateEnvelope(points) {
        const next = envelope(points);
        if (JSON.stringify(next) !== JSON.stringify(this.state.envelope)) {
            this.state.envelope = next;
            this.save();
        }
    }
    powerState(state) {
        if (['SHUTDOWN_MODE_USER_OFF', 'SLEEP_MODE_ALL_OFF'].indexOf(state) >= 0 && this.state.active) {
            this.state.active = false;
            this.save();
        }
        if (state === 'FULL_ON_USER_ON' && !this.state.active) {
            this.state.active = true;
            this.state.envelope = [{ lat: 0, long: 0 }];
            this.trail = [];
            this.save();
            return true;
        }
        return false;
    }
    sample(lat, longitudinal, valid) {
        const now = this.clock();
        this.trail = this.trail.filter(p => now - p.at < 2000);
        if (this.state.active && valid && Number.isFinite(lat) && Number.isFinite(longitudinal)) {
            this.trail.push({ lat, long: longitudinal, at: now });
            this.updateEnvelope(this.state.envelope.concat({ lat, long: longitudinal }));
        }
        return {
            gTrail: this.trail.map(p => ({ lat: p.lat, long: p.long, age: now - p.at })),
            gEnvelope: this.state.envelope
        };
    }
}
module.exports = { GHistory };
