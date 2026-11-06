import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';
import { join } from 'path';

/**
 * Locates an installed Chrome/Edge/Chromium/Brave/Arc executable to
 * drive via CDP (see CdpBrowser.ts). Deliberately does not depend on
 * Playwright/Puppeteer to launch or download a browser - see
 * CdpConnection.ts's doc comment for why. This only ever looks for a
 * browser already installed by the user; it never downloads one.
 *
 * Chrome/Edge/Chromium/Brave are ported (MIT license) from
 * x5gtrn/kindle-bridge. Arc support was added afterwards for this
 * fork and is unverified beyond confirming the executable path and
 * that Arc is Chromium-based (so should, in principle, accept the
 * same `--remote-debugging-port`/`--user-data-dir` CDP flags) - Arc
 * wraps its own UI/profile behavior around Chromium and hasn't been
 * live-tested here the way the other four have been over time.
 */
export class BrowserNotFoundError extends Error {
  constructor() {
    super(
      'Could not find an installed Chrome, Edge, Chromium, Brave, Arc, or Dia browser. ' +
        'Signing in to Amazon needs one of these installed.'
    );
    this.name = 'BrowserNotFoundError';
  }
}

function macCandidates(): string[] {
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Arc.app/Contents/MacOS/Arc',
    // Dia (same maker as Arc). macOS only; assumed to share Arc's
    // single-instance restriction (unverified) - see assertNotAlreadyRunningArc.
    '/Applications/Dia.app/Contents/MacOS/Dia',
  ];
}

function windowsCandidates(): string[] {
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = process.env['LOCALAPPDATA'];

  const candidates = [
    join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
    join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
    join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
    join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
  ];
  if (localAppData) {
    candidates.push(join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'));
    // Arc for Windows installs per-user; path unverified against a real
    // install, based on Arc's documented install location pattern.
    candidates.push(join(localAppData, 'Programs\\Arc\\Arc.exe'));
  }
  return candidates;
}

function linuxCandidates(): string[] {
  return [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/microsoft-edge',
    '/snap/bin/chromium',
  ];
}

/** Pure decision logic (which candidate list to use per OS), separated
 * from filesystem access so it's unit-testable without depending on
 * what's actually installed on the machine running the tests. */
export function candidatesForPlatform(platformId: string): string[] {
  switch (platformId) {
    case 'darwin':
      return macCandidates();
    case 'win32':
      return windowsCandidates();
    default:
      return linuxCandidates();
  }
}

export function findBrowserExecutable(): string {
  for (const candidate of candidatesForPlatform(platform())) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new BrowserNotFoundError();
}

/**
 * Confirmed live (2026-08-15): unlike Chrome/Edge/Chromium/Brave, which
 * all happily run multiple fully independent instances against
 * different `--user-data-dir` values simultaneously, Arc enforces a
 * hard "only one instance of Arc" restriction at the OS level -
 * launching a second, plugin-controlled instance while the user's own
 * Arc is already open fails with a native Arc dialog ("Arc is already
 * open. Only one instance of Arc can be opened at a time."), not a
 * file lock this code could clear. Confirmed the same launch succeeds
 * once the user's Arc is fully quit first. There is no known way to
 * work around this from outside Arc itself, so this only exists to
 * fail fast with an actionable message instead of leaving the user
 * looking at Arc's own confusing dialog (or a 20-second launch
 * timeout, if they don't notice it) with no explanation of what to do.
 */
export class ArcAlreadyRunningError extends Error {
  constructor(browserName = 'Arc') {
    super(
      `${browserName} only allows one running instance. Please fully quit ${browserName}, then try connecting again.`
    );
    this.name = 'ArcAlreadyRunningError';
  }
}

function singleInstanceBrowserName(executablePath: string): 'Arc' | 'Dia' | undefined {
  if (/Arc\.app|Arc\.exe/i.test(executablePath)) return 'Arc';
  if (/Dia\.app/i.test(executablePath)) return 'Dia';
  return undefined;
}

function isBrowserRunning(name: 'Arc' | 'Dia'): boolean {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('tasklist', ['/FI', `IMAGENAME eq ${name}.exe`], {
        encoding: 'utf8',
        timeout: 2000,
      });
      return new RegExp(`${name}\\.exe`, 'i').test(output);
    }
    // pgrep exits 0 (and prints matching pids) if found, non-zero if not -
    // execFileSync throws on a non-zero exit, which the catch below
    // treats the same as "not running".
    execFileSync('pgrep', ['-x', name], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/** Throws `ArcAlreadyRunningError` if `executablePath` is Arc or Dia and
 * an instance is already running; a no-op for every other browser. */
export function assertNotAlreadyRunningArc(executablePath: string): void {
  const name = singleInstanceBrowserName(executablePath);
  if (name && isBrowserRunning(name)) {
    throw new ArcAlreadyRunningError(name);
  }
}
