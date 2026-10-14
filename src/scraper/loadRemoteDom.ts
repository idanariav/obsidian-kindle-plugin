import cheerio, { Root } from 'cheerio';
import { BrowserWindow, remote } from 'electron';

import { ee } from '~/eventEmitter';

const { BrowserWindow: RemoteBrowserWindow } = remote;

type DomResult = {
  dom: Root;
  didNavigateUrl: string;
};

type LoadRemoteDomOptions = {
  log?: boolean;
  label?: string;
  /**
   * When set, `timeout` becomes the *maximum* wait: the page is read as soon
   * as this selector exists in the DOM, instead of always sleeping the full
   * `timeout`.
   */
  waitForSelector?: string;
};

const POLL_INTERVAL_MS = 250;
const LOAD_TIMEOUT_MS = 60000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const loadRemoteDom = async (
  targetUrl: string,
  timeout = 0,
  options: LoadRemoteDomOptions = {}
): Promise<DomResult> => {
  const shouldLog = options.log !== false;
  const labelPrefix = options.label ? `${options.label}: ` : '';
  const log = (message: string) => {
    console.log(`Kindle: ${labelPrefix}${message}`);
    if (shouldLog) {
      ee.emit('syncLog', `${labelPrefix}${message}`);
    }
  };

  const window: BrowserWindow = new RemoteBrowserWindow({
    width: 1000,
    height: 600,
    webPreferences: {
      webSecurity: false,
      nodeIntegration: false,
      partition: 'persist:kindle-highlights',
    },
    show: false,
  });

  const destroy = () => {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  };

  let didNavigateUrl: string = null;

  window.webContents.on('did-navigate', (_event, url) => {
    didNavigateUrl = url;

    if (url !== targetUrl) {
      log(`Navigated to ${url}`);
    }
  });

  const loaded = new Promise<void>((resolve, reject) => {
    // did-finish-load can fire again after redirects; only the first matters
    window.webContents.once('did-finish-load', () => resolve());
    window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      // -3 is ERR_ABORTED, which fires on benign redirects
      if (isMainFrame && code !== -3) {
        reject(new Error(`Failed to load ${url}: ${description} (${code})`));
      }
    });
    setTimeout(() => reject(new Error(`Timed out loading ${targetUrl}`)), LOAD_TIMEOUT_MS);
  });

  try {
    log('Loading page…');
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    window.loadURL(targetUrl).catch(() => undefined); // failures surface via did-fail-load
    await loaded;
    log('Page loaded');

    if (options.waitForSelector) {
      const selector = JSON.stringify(options.waitForSelector);
      const deadline = Date.now() + timeout;
      log(`Waiting up to ${Math.round(timeout / 1000)}s for content to render…`);

      while (Date.now() < deadline) {
        // Redirected to sign-in: the selector will never appear, don't wait
        if (didNavigateUrl?.includes('signin')) {
          break;
        }
        const found = await window.webContents.executeJavaScript(
          `!!document.querySelector(${selector})`
        );
        if (found) {
          break;
        }
        await sleep(POLL_INTERVAL_MS);
      }
    } else if (timeout > 0) {
      log(`Waiting ${Math.round(timeout / 1000)}s for content to render…`);
      await sleep(timeout);
    }

    log('Extracting page content…');
    const html = await window.webContents.executeJavaScript(`document.querySelector('body').innerHTML`);

    log('Parsing HTML…');
    const $ = cheerio.load(html);

    log('Page ready');
    return { dom: $, didNavigateUrl };
  } finally {
    destroy();
  }
};
