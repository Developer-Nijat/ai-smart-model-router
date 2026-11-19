'use strict';

/** Base error: carries a stable machine-readable code and optional details. */
class SmrError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

class ValidationError extends SmrError {
  constructor(message, issues) {
    super('E_VALIDATION', message, { issues });
    this.issues = issues;
  }
}

class ConfigError extends SmrError {
  constructor(message, details) {
    super('E_CONFIG', message, details);
  }
}

class StorageError extends SmrError {
  constructor(message, details) {
    super('E_STORAGE', message, details);
  }
}

module.exports = { SmrError, ValidationError, ConfigError, StorageError };
