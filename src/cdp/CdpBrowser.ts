import { ChildProcess,execFileSync, spawn } from 'child_process';
import { readlinkSync, rmSync } from 'fs';
import { join } from 'path';

import { assertNotAlreadyRunningArc, findBrowserExecutable } from './browserExecutable';
import { CdpConnection } from './CdpConnection';

const DEVTOOLS_WS_PATTERN = /DevTools listening on (ws:\/\/\S+)/;
const LAUNCH_TIMEOUT_MS = 20 * 1000;
/** The three files Chrome's ProcessSingleton mechanism uses (POSIX
 * only) - see clearStaleSingletonLock() below. */
const SINGLETON_FILE_NAMES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];

/** Pure parsing logic split out from waitForDevToolsUrl() below so it's
 * unit-testable without spawning a real browser process. Chrome/Edge/
 * Chromium print a line like `DevTools listening on ws://127.0.0.1:PORT/
 * devtools/browser/<uuid>` to stderr once remote debugging is ready. */
export function extractDevToolsUrl(stderrText: string): string | undefined {
  return DEVTOOLS_WS_PATTERN.exec(stderrText)?.[1];
}

export interface CdpLaunchOptions {
  userDataDir: string;
}

export interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix timestamp in seconds, or a negative number for a session
   * cookie with no fixed expiry - matches Electron's
   * `CookiesSetDetails.expirationDate` field directly. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface CdpPage {
  navigate: (url: string) => Promise<void>;
  onFrameNavigated: (listener: (url: string) => void) => void;
  getCookies: () => Promise<CdpCookie[]>;
}

/** What `clearStaleSingletonLock()` found and decided, returned (rather
 * than just logged) so `launch()` can fold it into its own failure
 * message if the subsequent launch attempt still fails. */
export type SingletonLockAction =
  | { kind: 'none' }
  | { kind: 'unparseable'; target: string }
  | { kind: 'alive'; pid: number; command: string | undefined }
  | { kind: 'cleared'; pid: number };

/**
 * Chrome's `SingletonLock` is a symlink (POSIX only - Chrome uses a
 * named mutex on Windows instead, so this is a no-op there) shaped
 * like `<hostname>-<pid>`, which Chrome uses to detect whether another
 * process already owns a given `--user-data-dir` before starting. A
 * stale one left over from an earlier crashed/leaked process makes
 * every subsequent launch fail with "Failed to create a
 * ProcessSingleton... Aborting now to avoid profile corruption," even
 * though nothing is actually still running.
 *
 * This module never intentionally runs two browser processes against
 * the same profile directory concurrently, so any lock found here is
 * either already stale, or - more cautiously assumed - still
 * legitimately alive. Two checks decide which:
 *  1. A signal-0 `process.kill()` (tests liveness without sending a
 *     real signal) - a confirmed-dead pid (`ESRCH`) is unambiguous.
 *  2. For a pid that *is* alive: cross-checked against `ps`'s report
 *     of that pid's command name, since PIDs get reused by the OS
 *     over time - a lock referencing a pid that's alive right now
 *     doesn't by itself prove the *original* browser process is still
 *     the one holding it.
 *
 * Ported (MIT license, adapted) from x5gtrn/kindle-bridge, which hit
 * this exact failure mode in production and hardened this fix across
 * two rounds of live debugging.
 */
export function clearStaleSingletonLock(
  userDataDir: string,
  getProcessCommand: (pid: number) => string | undefined = getProcessCommandViaPs
): SingletonLockAction {
  if (process.platform === 'win32') {
    return { kind: 'none' };
  }

  let target: string;
  try {
    target = readlinkSync(join(userDataDir, 'SingletonLock'));
  } catch {
    return { kind: 'none' }; // No lock, or not a symlink.
  }

  const pid = Number(target.slice(target.lastIndexOf('-') + 1));
  if (!Number.isInteger(pid)) {
    return { kind: 'unparseable', target };
  }

  if (isProcessAlive(pid)) {
    const command = getProcessCommand(pid);
    if (!command || looksLikeBrowserProcess(command)) {
      return { kind: 'alive', pid, command };
    }
    // Alive, but clearly not a browser - the pid was reused after the
    // original process died; fall through and clear it below.
  }

  for (const name of SINGLETON_FILE_NAMES) {
    try {
      rmSync(join(userDataDir, name), { force: true });
    } catch {
      // Best-effort - if this fails, launch() proceeds and Chrome's
      // own error (if any) surfaces exactly as it did before this fix.
    }
  }
  return { kind: 'cleared', pid };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH = no such process, i.e. confirmed dead. Any other error
    // (e.g. EPERM) means we can't prove it's dead, so assume alive.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function getProcessCommandViaPs(pid: number): string | undefined {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
      encoding: 'utf8',
      timeout: 2000,
    }).trim();
  } catch {
    return undefined;
  }
}

function looksLikeBrowserProcess(command: string): boolean {
  // "arc" is short enough to risk false positives as a bare substring
  // (e.g. a process named "Search" contains "arc") - word-bounded to
  // only match it as a whole word.
  return /chrome|chromium|msedge|edge|brave|\barc\b/i.test(command);
}

/**
 * Launches and drives a real, separate Chrome/Edge/Chromium/Brave
 * process via the Chrome DevTools Protocol (see CdpConnection.ts) -
 * not a window or webview embedded in Obsidian's own Electron process.
 * This is a deliberate architectural choice, not the first one tried:
 * both an embedded `remote.BrowserWindow` and an embedded `<webview>`
 * were tried and abandoned first, because Amazon's sign-in flow
 * includes a cross-origin hop (read.amazon.<tld> to
 * www.amazon.<tld>/ap/signin) that gets silently redirected to the
 * system's default browser by something outside this plugin's control
 * - confirmed via live diagnostic logging showing `will-navigate`
 * firing with no matching `did-navigate` afterwards, and independently
 * corroborated by another Obsidian Kindle plugin (x5gtrn/kindle-bridge)
 * hitting and documenting the identical symptom. A genuinely separate
 * browser process has no relationship to Obsidian's own
 * window/webContents policies at all, so that escape cannot happen to
 * it by construction.
 *
 * Ported (MIT license, adapted/trimmed to only what sign-in needs)
 * from x5gtrn/kindle-bridge's CdpBrowser.ts.
 */
export class CdpBrowser {
  private readonly exitListeners = new Set<(code: number | null) => void>();

  private constructor(
    private readonly childProcess: ChildProcess,
    private readonly connection: CdpConnection
  ) {
    this.childProcess.on('exit', (code) => {
      this.exitListeners.forEach((listener) => listener(code));
    });
  }

  static launch = async (options: CdpLaunchOptions): Promise<CdpBrowser> => {
    const lockAction = clearStaleSingletonLock(options.userDataDir);
    const executablePath = findBrowserExecutable();
    assertNotAlreadyRunningArc(executablePath);
    const args = [
      `--user-data-dir=${options.userDataDir}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ];

    const childProcess = spawn(executablePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const webSocketDebuggerUrl = await waitForDevToolsUrl(childProcess, executablePath, lockAction);
      const connection = await CdpConnection.connect(webSocketDebuggerUrl);
      return new CdpBrowser(childProcess, connection);
    } catch (error) {
      // Chrome has already started by this point - if connecting to it
      // then fails, the process would otherwise leak silently,
      // permanently holding this profile directory's singleton lock.
      childProcess.kill();
      throw error;
    }
  };

  /** Fires if the browser process exits on its own (e.g. the user
   * closes the window) after a successful launch. */
  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.add(listener);
  }

  async newPage(): Promise<CdpPage> {
    const { targetId } = await this.connection.send<{ targetId: string }>('Target.createTarget', {
      url: 'about:blank',
    });
    const { sessionId } = await this.connection.send<{ sessionId: string }>(
      'Target.attachToTarget',
      { targetId, flatten: true }
    );

    await this.connection.send('Page.enable', {}, sessionId);
    await this.connection.send('Network.enable', {}, sessionId);

    const connection = this.connection;
    return {
      navigate: async (url: string) => {
        await connection.send('Page.navigate', { url }, sessionId);
      },
      // Only one page is ever open per CdpBrowser instance (a fresh
      // process is launched per sign-in), so events aren't filtered by
      // sessionId.
      onFrameNavigated: (listener: (url: string) => void) => {
        connection.on('Page.frameNavigated', (params) => {
          const frame = (params as { frame?: { url?: string; parentId?: string } }).frame;
          if (frame?.url && !frame.parentId) {
            listener(frame.url);
          }
        });
      },
      getCookies: async () => {
        const result = await connection.send<{ cookies: CdpCookie[] }>(
          'Network.getAllCookies',
          {},
          sessionId
        );
        return result.cookies;
      },
    };
  }

  close(): void {
    this.connection.close();
    this.childProcess.kill();
  }
}

/** Caps how much of the child process's stdout/stderr is echoed back in
 * a failure message - just enough to diagnose why launch failed
 * without dumping unbounded output into a Notice. */
const DIAGNOSTIC_OUTPUT_LIMIT = 2000;

function describeLockAction(action: SingletonLockAction): string {
  switch (action.kind) {
    case 'alive':
      return action.command
        ? ` A SingletonLock referencing pid ${action.pid} (command: "${action.command}") was found and left in place because that process still appears to be running.`
        : ` A SingletonLock referencing pid ${action.pid} was found; that pid appears alive but its command could not be determined, so it was left in place to be safe.`;
    case 'unparseable':
      return ` A SingletonLock was found but its target ("${action.target}") didn't look like the expected "<hostname>-<pid>" shape, so it was left in place.`;
    case 'cleared':
    case 'none':
      return '';
  }
}

function waitForDevToolsUrl(
  childProcess: ChildProcess,
  executablePath: string,
  lockAction: SingletonLockAction
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stderrBuffer = '';
    let combinedBuffer = '';

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      childProcess.stdout?.off('data', onStdoutData);
      childProcess.stderr?.off('data', onStderrData);
      childProcess.off('error', onError);
      childProcess.off('exit', onExit);
    };

    const describeFailure = (reason: string): Error => {
      const output = combinedBuffer.trim().slice(0, DIAGNOSTIC_OUTPUT_LIMIT);
      return new Error(
        `${reason} (launched "${executablePath}")` +
          (output.length > 0 ? ` - output: ${output}` : ' - no output was produced.') +
          describeLockAction(lockAction)
      );
    };

    const timeoutHandle = setTimeout(() => {
      cleanup();
      reject(describeFailure('Timed out waiting for the browser to start.'));
    }, LAUNCH_TIMEOUT_MS);

    const onStdoutData = (chunk: Buffer) => {
      combinedBuffer += chunk.toString();
    };
    const onStderrData = (chunk: Buffer) => {
      const text = chunk.toString();
      stderrBuffer += text;
      combinedBuffer += text;
      const url = extractDevToolsUrl(stderrBuffer);
      if (url) {
        cleanup();
        resolve(url);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(describeFailure(`Browser exited before becoming ready (code ${code ?? 'unknown'}).`));
    };

    childProcess.stdout?.on('data', onStdoutData);
    childProcess.stderr?.on('data', onStderrData);
    childProcess.on('error', onError);
    childProcess.on('exit', onExit);
  });
}
