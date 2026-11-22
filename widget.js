'use strict';
const { render } = require('./render');
const { definitions, VehicleData } = require('./vehicle-data');
module.exports = { render, signals: definitions, createData: () => new VehicleData() };
