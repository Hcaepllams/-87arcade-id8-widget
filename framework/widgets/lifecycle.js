'use strict';
// One observer for all widgets, using the power sequence verified on the vehicle.
async function observe(signals, client, log, onState) {
    let wakePending = true, recoveryPending = false;
    const deliver = () => {
        if (recoveryPending && client.ready) {
            recoveryPending = false;
            client.wakeWidget();
        }
    };
    client.on('ready', deliver);
    return signals.watch('de.bmw.infotainment.lifecycle.lifecycle.Lifecycle', 'Front', {
        powerStateDetailed: state => {
            if (onState) onState(state);
            if (['WELCOME_SCREEN', 'GOODBYE_SCREEN', 'SHUTDOWN_MODE_USER_OFF', 'SLEEP_MODE_ALL_OFF'].indexOf(state) >= 0) {
                wakePending = true;
                recoveryPending = false;
            }
            if (state === 'FULL_ON_USER_ON' && wakePending) {
                wakePending = false;
                log.info('widget-manager: ignition wake');
                recoveryPending = true;
                deliver();
            }
        }
    }, log, { pollMs: 2000 });
}
module.exports = { observe };
