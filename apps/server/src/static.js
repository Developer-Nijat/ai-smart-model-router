'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
});
const MAX_FILES = 500;

/**
 * The built dashboard, read once into memory. Requests are answered only by exact lookup
 * in this table, so no request path ever reaches the file system (no traversal). Files
 * of unknown types are left out. Null when the dashboard is not built.
 *
 * @param {string} dir the Vite build output
 * @returns {Map<string, { type: string, body: Buffer }> | null}
 */
function loadStaticFiles(dir) {
  if (!dir || !fs.existsSync(path.join(dir, 'index.html'))) return null;
  const files = new Map();
  const walk = (folder, prefix) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      const url = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(full, url);
      else if (entry.isFile() && TYPES[path.extname(entry.name)] && files.size < MAX_FILES) {
        files.set(url, { type: TYPES[path.extname(entry.name)], body: fs.readFileSync(full) });
      }
    }
  };
  walk(dir, '');
  return files;
}

module.exports = { loadStaticFiles };
