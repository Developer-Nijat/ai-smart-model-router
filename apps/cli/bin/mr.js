#!/usr/bin/env node
'use strict';

// Before anything loads node:sqlite.
require('@smr/config').quietSqliteWarning();

const { run } = require('../src/program');

run(process.argv);
