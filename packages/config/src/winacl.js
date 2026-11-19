'use strict';

const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** Principals that may read any file anyway; their entries are not a leak. */
/**
 * A Windows tool by its full System32 path: a bare name is looked up in the current
 * folder first, where anyone could have planted an icacls.exe.
 */
const system32 = (exe, env = process.env) => path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', exe);

const ALWAYS_TRUSTED = [/^NT AUTHORITY\\SYSTEM$/i, /^BUILTIN\\Administrators$/i];

/** `DOMAIN\user` for the current user (icacls accepts it as a principal name). */
function windowsAccount(env = process.env, username = os.userInfo().username) {
  return env.USERDOMAIN ? `${env.USERDOMAIN}\\${username}` : username;
}

function icacls(args, run) {
  return run(system32('icacls.exe'), args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

const SID_PATTERN = /^S-1-\d+(?:-\d+)+$/;

/**
 * The current user's SID from `whoami /user`, or null. A SID names the account exactly,
 * whatever the environment says and in any Windows language.
 */
function currentUserSid(run = execFileSync) {
  try {
    const out = run(system32('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const sid = out.trim().split(',').pop()?.replace(/"/g, '');
    return sid && SID_PATTERN.test(sid) ? sid : null;
  } catch {
    return null;
  }
}

/**
 * Windows ignores POSIX file modes: this gives the file an ACL of its own with full
 * control for the current user only (inheritance removed, every other entry dropped).
 * The user is named by SID (`*S-1-5-…`) when whoami gives one. Arguments go to icacls
 * directly, never through a shell.
 *
 * @param {string} file
 * @param {{ run?: typeof execFileSync, account?: string, sid?: string | null }} [options]
 */
function restrictToOwner(file, options = {}) {
  const run = options.run ?? execFileSync;
  const sid = options.sid === undefined ? currentUserSid(run) : options.sid;
  const principal = sid ? `*${sid}` : (options.account ?? windowsAccount());
  icacls([file, '/inheritance:r', '/grant:r', `${principal}:F`], run);
}

/**
 * Who can access `file`, from `icacls <file>`: `others` lists every principal except
 * the current user, SYSTEM and Administrators. Names come from icacls as Windows shows
 * them (localised on some systems), so callers warn rather than fail on a mismatch.
 *
 * @returns {{ principals: string[], others: string[] }}
 */
function aclReport(file, options = {}) {
  const account = (options.account ?? windowsAccount()).toLowerCase();
  const output = icacls([file], options.run ?? execFileSync);
  const principals = output
    .split(/\r?\n/)
    // The first line starts with the path, as icacls spells it (any case).
    .map((line) => (line.toLowerCase().startsWith(file.toLowerCase()) ? line.slice(file.length) : line).trim())
    .map((line) => /^(.+?):\(/.exec(line)?.[1])
    .filter(Boolean);
  const others = principals.filter((p) => p.toLowerCase() !== account && !ALWAYS_TRUSTED.some((re) => re.test(p)));
  return { principals, others };
}

module.exports = { windowsAccount, currentUserSid, restrictToOwner, aclReport, system32 };
