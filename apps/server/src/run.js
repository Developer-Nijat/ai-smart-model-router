'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolvePaths, loadSettings, ensureToken, layout } = require('@smr/config');
const { openStorage } = require('@smr/storage');
const { createLogger, createFileSink, stderrSink } = require('@smr/logger');
const { createApp } = require('./app');
const { createServices } = require('./services');
const { createDashboardAuth } = require('./auth');
const { loadStaticFiles } = require('./static');
const { version } = require('../package.json');

const DASHBOARD_DIR = layout().dashboardDir;

/**
 * Starts the daemon: settings, token, database, HTTP on loopback; writes the pid file
 * once listening and removes it on shutdown.
 *
 * @param {{
 *   paths?: ReturnType<typeof resolvePaths>,
 *   port?: number,
 *   logToFile?: boolean,
 *   onShutdown?: () => void,
 *   dashboardDir?: string,
 *   dataDir?: string,
 * }} [options]
 * @returns {Promise<{ app: import('fastify').FastifyInstance, port: number, close: () => Promise<void> }>}
 */
async function startServer(options = {}) {
  const paths = options.paths ?? resolvePaths();
  const settings = loadSettings(paths.configFile);
  const sinks = options.logToFile ? [createFileSink(paths.serverLogFile)] : [stderrSink];
  const logger = createLogger({ level: settings.logging.level, sinks, bindings: { component: 'server' } });
  const port = options.port ?? settings.server.port;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`invalid port ${port}`);

  let storage = null;
  let app;
  try {
    const { token } = ensureToken(paths.tokenFile);
    storage = openStorage(paths.dbFile);
    const dashboard = {
      services: createServices({ paths, storage, dataDir: options.dataDir }),
      auth: createDashboardAuth(),
      files: loadStaticFiles(options.dashboardDir ?? DASHBOARD_DIR),
    };
    app = createApp({ storage, token, port, version, logger, dashboard, onShutdown: () => options.onShutdown?.() });
    await app.listen({ host: settings.server.host, port });
  } catch (error) {
    // `mr start` runs us detached with no console: the log is the only place to say why.
    logger.error('could not start', { error: error.message, port });
    storage?.close();
    throw error;
  }
  fs.mkdirSync(path.dirname(paths.pidFile), { recursive: true });
  fs.writeFileSync(paths.pidFile, `${process.pid}
`, { mode: 0o600 });
  logger.info('listening', { host: settings.server.host, port, pid: process.pid });

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await app.close();
    storage.close();
    try {
      if (fs.readFileSync(paths.pidFile, 'utf8').trim() === String(process.pid)) fs.rmSync(paths.pidFile, { force: true });
    } catch {
      // Already gone.
    }
    logger.info('stopped', { pid: process.pid });
  }
  return { app, port, close };
}

module.exports = { startServer, DASHBOARD_DIR };
