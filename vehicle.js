'use strict';
// Compatibility entry for the shared widget runtime.
const path = require('path');
const runtime = process.env.WIDGET_RUNTIME || path.resolve(__dirname, './framework/widgets/runtime');
require(runtime).run(__dirname, 'widget');
