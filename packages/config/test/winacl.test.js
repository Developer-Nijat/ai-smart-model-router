'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { windowsAccount, currentUserSid, restrictToOwner, aclReport, system32 } = require('../src/winacl');

const ICACLS = system32('icacls.exe');
const { ensureToken } = require('../src/token');

const FILE = 'C:\\Users\\me\\AppData\\Roaming\\smart-model-router\\token';

describe('Windows token ACL', () => {
  it('names the account with its domain when there is one', () => {
    expect(windowsAccount({ USERDOMAIN: 'CORP' }, 'me')).toBe('CORP\\me');
    expect(windowsAccount({}, 'me')).toBe('me');
  });

  it('narrows the ACL with icacls arguments, naming the user by SID when whoami gives one', () => {
    const run = vi.fn((command) => (command.endsWith('whoami.exe') ? '"corp\\me","S-1-5-21-1-2-3-1000"\r\n' : ''));
    restrictToOwner(FILE, { run, account: 'CORP\\me' });
    expect(run).toHaveBeenLastCalledWith(ICACLS, [FILE, '/inheritance:r', '/grant:r', '*S-1-5-21-1-2-3-1000:F'], expect.objectContaining({ windowsHide: true }));
    const noSid = vi.fn(() => '');
    restrictToOwner(FILE, { run: noSid, account: 'CORP\\me', sid: null });
    expect(noSid).toHaveBeenCalledWith(ICACLS, [FILE, '/inheritance:r', '/grant:r', 'CORP\\me:F'], expect.anything());
  });

  it('runs Windows tools from System32, never by a bare name', () => {
    expect(system32('icacls.exe', { SystemRoot: 'D:\\Win' })).toBe('D:\\Win\\System32\\icacls.exe');
    expect(system32('icacls.exe', {})).toBe('C:\\Windows\\System32\\icacls.exe');
  });

  it('reads the SID, and gives null for anything that is not one', () => {
    expect(currentUserSid(() => '"corp\\me","S-1-5-21-1-2-3-1000"')).toBe('S-1-5-21-1-2-3-1000');
    expect(currentUserSid(() => '"corp\\me","nonsense"')).toBeNull();
    expect(
      currentUserSid(() => {
        throw new Error('no whoami');
      }),
    ).toBeNull();
  });

  it('reports principals other than the owner, SYSTEM and Administrators', () => {
    const output = [
      `${FILE} CORP\\me:(F)`,
      '                       NT AUTHORITY\\SYSTEM:(I)(F)',
      '                       BUILTIN\\Administrators:(I)(F)',
      '                       BUILTIN\\Users:(I)(RX)',
      '',
      'Successfully processed 1 files; Failed processing 0 files',
    ].join('\r\n');
    const report = aclReport(FILE, { run: () => output, account: 'corp\\ME' });
    expect(report.principals).toEqual(['CORP\\me', 'NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators', 'BUILTIN\\Users']);
    expect(report.others).toEqual(['BUILTIN\\Users']);
    expect(aclReport(FILE, { run: () => `${FILE} CORP\\me:(F)\r\n`, account: 'CORP\\me' }).others).toEqual([]);
    // icacls may spell the path in another case.
    expect(aclReport(FILE, { run: () => `${FILE.toLowerCase()} CORP\\me:(F)\r\n`, account: 'CORP\\me' }).others).toEqual([]);
  });

  it('ensureToken narrows a new file before the token is in it, and refuses to leave it open', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-acl-'));
    try {
      const file = path.join(tmp, 'token');
      const failing = vi.fn(() => {
        throw new Error('icacls missing');
      });
      expect(() => ensureToken(file, { platform: 'win32', restrict: failing })).toThrow(/Cannot restrict token file .* icacls missing/);
      expect(fs.existsSync(file)).toBe(false);
      const sizes = [];
      const restrict = vi.fn((f) => sizes.push(fs.statSync(f).size));
      expect(ensureToken(file, { platform: 'win32', restrict }).created).toBe(true);
      expect(sizes).toEqual([0]);
      // An existing token is narrowed again, best effort: mr doctor reports a failure.
      expect(ensureToken(file, { platform: 'win32', restrict: failing }).created).toBe(false);
      const posix = vi.fn();
      ensureToken(path.join(tmp, 'other'), { platform: 'linux', restrict: posix });
      expect(posix).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform === 'win32')('really leaves only the owner on this Windows machine', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-acl-real-'));
    try {
      const file = path.join(tmp, 'token');
      ensureToken(file);
      const report = aclReport(file);
      expect(report.others).toEqual([]);
      expect(report.principals).toHaveLength(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
