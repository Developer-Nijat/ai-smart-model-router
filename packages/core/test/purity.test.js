'use strict';

const fs = require('node:fs');
const path = require('node:path');
const core = require('../src');

const SRC = path.join(__dirname, '..', 'src');

/**
 * ADR-001: the core may require only its own files and @smr/shared, uses no ESM
 * imports (it is bundled later), and reads no clock, randomness, process or global object.
 */
const ALLOWED_REQUIRE = /^(\.{1,2}\/|@smr\/shared$)/;
const REQUIRE_CALL = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
const FORBIDDEN_SYNTAX =
  /(^|\s)import\s|\bimport\(|\bprocess\b|\bglobalThis\b|\bglobal\.|\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b|\bDate\b|\bperformance\b|\bcrypto\b|\bMath\.random\b|\bfetch\(|\beval\(|\bnew Function\b/;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

describe('core purity (ADR-001)', () => {
  const files = sourceFiles(SRC);

  it('has source files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [path.relative(SRC, file), file]))('%s does no I/O and reads no clock', (_name, file) => {
    const code = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const required = [...code.matchAll(REQUIRE_CALL)].map((match) => match[1]);
    expect(required.filter((name) => !ALLOWED_REQUIRE.test(name))).toEqual([]);
    expect(code).not.toMatch(FORBIDDEN_SYNTAX);
  });

  it('the checks catch what they are meant to catch', () => {
    const bad = [
      "const fs = require('node:fs');",
      "import fs from 'fs';",
      'const t = Date.now();',
      'const d = new Date(x);',
      'globalThis.x = 1;',
      'performance.now();',
      'crypto.randomUUID();',
      'Math.random();',
      'process.env.X;',
    ];
    for (const line of bad) {
      const required = [...line.matchAll(REQUIRE_CALL)].map((match) => match[1]);
      const flagged = required.some((name) => !ALLOWED_REQUIRE.test(name)) || FORBIDDEN_SYNTAX.test(line);
      expect(flagged, line).toBe(true);
    }
    expect(FORBIDDEN_SYNTAX.test("const { z } = require('@smr/shared'); // important")).toBe(false);
  });

  it('exposes its API version', () => {
    expect(core.CORE_API_VERSION).toBe(1);
  });
});
