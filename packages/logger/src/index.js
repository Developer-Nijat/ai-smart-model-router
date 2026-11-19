'use strict';

const { createLogger, createFileSink, stderrSink } = require('./logger');
const { redact, redactString, REDACTED, OMITTED } = require('./redact');

module.exports = { createLogger, createFileSink, stderrSink, redact, redactString, REDACTED, OMITTED };
