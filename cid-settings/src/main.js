'use strict';
const OnlineApp = require('oap-sdk/src/core/OnlineApp.js');
const logging = require('oap-sdk/src/logging/logging');
const { Menu } = require('./menu.js');
const { request } = require('./client.js');
const { RenderClient } = require('./renderd.js');
const { Cockpit, placement, claims } = require('./cockpit.js');
const logger = logging.getSDKLogger();
const STATE = 'ST_Settings', ROWS = 16;

class SettingsApp extends OnlineApp {
    constructor() {
        super();
        this.menu = null;
        this.ready = false;
        this.writing = false;
        this.visible = false;
        this.graphical = false;
        this.rows = [];
        const gpu = this.gpu = new RenderClient('arcade_settings', logger, { native: true });
        this.cockpit = new Cockpit(() => this.paint(), run => this.perform(run), () => this.leave());
        gpu.on('ready', () => this.showGraphics());
        gpu.on('state', ({ onScreen, front }) => this.presentation(this.visible && gpu.visible && onScreen && front));
        gpu.on('close', () => {
            gpu.show(false);
            this.presentation(false);
        });
        gpu.on('closed', () => {
            this.presentation(false);
            if (!this.visible) return;
            clearTimeout(this.reshowTimer);
            this.reshowTimer = setTimeout(() => {
                if (this.visible && !gpu.visible) this.showGraphics();
            }, 700);
            if (this.reshowTimer.unref) this.reshowTimer.unref();
        });
        gpu.on('touch', (phase, x, y) => { if (this.graphical) this.cockpit.touch(phase, x, y); });
        gpu.on('ccu', event => { if (this.graphical) this.cockpit.ccu(event); });
        this.on('initialized', () => this.setup().catch(e => logger.error('arcade-settings setup: ' + e.message)));
        this.on('entryPointExecute', uuid => this.open(uuid).catch(e => logger.warn(e.message)));
        this.on('changeVisibility', e => { if (e && e.visible === false) this.refreshing(false); });
        this.on('error', e => logger.warn('arcade-settings: ' + e.message));
        this.on('shutdown', () => {
            clearInterval(this.heartbeat);
            gpu.close();
            this.refreshing(false);
            Promise.resolve().then(() => this.destroyBundles()).catch(e => logger.warn(e.message))
                .then(() => process.exit(0));
        });
    }

    async setup() {
        if (!this.rhmiApplication) return this.initialized();
        const state = this.rhmiApplication.getByName(STATE);
        if (!state) throw Error('Missing settings page');
        state.on('visible', e => this.refreshing(e.visible === true || e.visible === 1));
        this.rhmiApplication.on('restoreHmi', () => this.update());
        for (let i = 0; i < ROWS; i++) this.rhmiApplication.getByName('row' + i).on('action', () => this.select(i));
        const entry = this.getEntryPoints().find(e => e.getDescription().name === 'arcade_settings');
        if (!entry) throw Error('Missing entry point');
        await state.updateResources();
        await entry.init();
        await this.rhmiApplication.mapEntryState(entry.getDescription().uuid, state);
        if (entry.entryPoint && typeof entry.entryPoint.setText === 'function') {
            try {
                const description = entry.getDescription();
                await entry.entryPoint.setText(description.textId);
                if (description.icon) await entry.entryPoint.setIcon(description.icon);
            } catch (e) { logger.warn('settings drawer: ' + e.message); }
        }
        await entry.setAvailability('ENABLED');
        this.ready = true;
        this.gpu.connect();
        // Layer clients go off screen after three seconds without a frame.
        this.heartbeat = setInterval(() => {
            if (this.gpu.ready && this.gpu.visible) this.gpu.frame(this.cockpit.g);
        }, 1200);
        this.heartbeat.unref();
        await this.update();
        await this.initialized();
        const uuid = this.getLastExecutedEntryPointUuid && this.getLastExecutedEntryPointUuid();
        if (uuid) await this.open(uuid);
    }

    async open(uuid) {
        if (!this.ready || !uuid) return;
        await this.rhmiApplication.openEntryState(uuid);
        await this.refreshing(true);
        this.showGraphics();
    }

    async leave() {
        this.refreshing(false);
        await this.rhmiApplication.closeState(STATE);
    }

    async refreshing(visible) {
        if (!visible) clearTimeout(this.reshowTimer);
        if (visible === this.visible) return;
        this.visible = visible;
        if (!visible) {
            this.gpu.show(false);
            this.presentation(false);
        }
        if (this._initialized && this._appStatusService) {
            const reports = visible ? [this.registerActive(), this.registerHmiVisible()] :
                [this.unregisterHmiVisible(), this.unregisterInactive()];
            reports.forEach(p => Promise.resolve(p).catch(e => logger.warn(e.message)));
        }
        if (visible && this.ready) {
            this.showGraphics();
            await this.update();
        }
    }

    showGraphics() {
        clearTimeout(this.reshowTimer);
        const gpu = this.gpu;
        if (!this.visible || !gpu.ready || !gpu.native || !gpu.info.touch || gpu.visible) return;
        const placed = placement(gpu.screen, gpu.info.appArea);
        this.cockpit.resize(placed.ox === 0 ? placed.w / placed.scale : 1836);
        gpu.place(placed);
        // The renderer maps both claims from the cockpit canvas into the placed app area.
        gpu.claim(claims(placed));
        gpu.show(true);
        this.paint();
    }

    presentation(graphical) {
        this.gpu.grab(graphical && !!(this.gpu.info && this.gpu.info.controller));
        if (graphical === this.graphical) return;
        this.graphical = graphical;
        this.cockpit.ccuLast = null;
        this.cockpit.gesture = null;
        if (!graphical) this.cockpit.cancelReset();
        this.emit('presentation', graphical);
        if (!graphical && this.visible) this.drawRhmi();
    }

    paint() {
        if (this.visible && this.gpu.visible) {
            this.gpu.frame(this.cockpit.frame(this.menu, this.notice, this.error));
        }
    }

    select(index) {
        if (this.graphical || !this.rows[index]) return;
        return this.perform(this.rows[index].run);
    }

    async perform(run) {
        if (this.writing) return;
        this.writing = true;
        const before = this.menu.config;
        try {
            await run();
            if (before !== this.menu.config) this.notice = '已保存';
            else if (this.error) this.notice = '';
            this.error = false;
        } catch (e) {
            if (e.status === 409) {
                this.menu.config = e.config;
                this.revision = e.revision;
                this.notice = '设置已在其他端更新';
            } else this.notice = '保存失败';
            this.error = true;
            logger.warn('settings: ' + e.message);
        }
        this.writing = false;
        this.paint();
        if (!this.graphical) await this.drawRhmi();
    }

    async update() {
        if (!this.ready || this.writing) return;
        this.writing = true;
        try {
            const {config, revision} = await request(undefined, undefined, {withRevision: true});
            this.revision = revision;
            if (this.menu) this.menu.config = config;
            else this.menu = new Menu(config, async next => {
                const snapshot = await request(next, undefined, {withRevision: true, expectedRevision: this.revision});
                this.revision = snapshot.revision;
                return snapshot.config;
            });
            if (this.error) this.notice = '';
            this.error = false;
        } catch (e) {
            logger.warn('settings: ' + e.message);
            this.notice = '读取失败';
            this.error = true;
        }
        this.writing = false;
        this.paint();
        if (!this.graphical) await this.drawRhmi();
    }

    drawRhmi() {
        const rhmi = this.rhmiApplication;
        this.rows = this.menu ? this.menu.rows() : [];
        const title = rhmi.getByName('SettingsTitle');
        const notice = rhmi.getByName('SettingsNotice');
        return Promise.all([
            title.setValue(0, 'Text', this.menu ? this.menu.title() : '87 Arcade 设置', 'Text'),
            notice.setProperty('Visible', this.notice ? 1 : 0, 'UInt'),
            notice.setValue(0, 'Text', this.notice || '', 'Text'),
            ...Array.from({ length: ROWS }, (_, i) => {
                const component = rhmi.getByName('row' + i), row = this.rows[i];
                return Promise.all([
                    component.setProperty('Visible', row ? 1 : 0, 'UInt'),
                    component.setValue(0, 'PrimaryText', row ? row.label : '', 'Text'),
                    component.setValue(0, 'FrequencyText', row ? row.value : '', 'Text'),
                    component.setValue(0, 'FrequencyVisible', !!(row && row.value), 'Bool')
                ]);
            })
        ]).catch(e => logger.warn('settings RHMI: ' + e.message));
    }
}
const app = new SettingsApp();
app.start().catch(e => logger.error('arcade-settings start: ' + e.message));
