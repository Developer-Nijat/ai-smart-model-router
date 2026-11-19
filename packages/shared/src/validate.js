'use strict';

const { ValidationError } = require('./errors');

/**
 * Flattens Zod issues into `path: message` lines a person can act on.
 * @param {import('zod').ZodError} error
 * @returns {string[]}
 */
function formatIssues(error) {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

/**
 * Parses `input` with `schema`, returning the parsed (new) value or throwing ValidationError.
 * @template T
 * @param {import('zod').ZodType<T>} schema
 * @param {unknown} input
 * @param {string} label what is being validated, used in the error message
 * @returns {T}
 */
function parseOrThrow(schema, input, label) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = formatIssues(result.error);
  throw new ValidationError(`Invalid ${label}: ${issues.join('; ')}`, issues);
}

module.exports = { parseOrThrow, formatIssues };
