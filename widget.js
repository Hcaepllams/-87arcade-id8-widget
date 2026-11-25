'use strict';
const { render } = require('./render');
const { definitions, VehicleData } = require('./vehicle-data');
const { DiagProbe } = require('./diag-probe');
module.exports = {
    render, signals: definitions, createData: storage => new VehicleData(undefined, storage),
    createDiagProbe: (data, signals, log) => process.env.ID8_DIAG_PROBE === '0' ? null : new DiagProbe(data, signals, log)
};
