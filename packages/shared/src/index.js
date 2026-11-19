'use strict';

const constants = require('./constants');
const errors = require('./errors');
const validate = require('./validate');
const model = require('./schemas/model');
const routing = require('./schemas/routing');
const agent = require('./schemas/agent');
const settings = require('./schemas/settings');
const record = require('./schemas/record');

module.exports = {
  ...constants,
  ...errors,
  ...validate,
  ...model,
  ...routing,
  ...agent,
  ...settings,
  ...record,
};
