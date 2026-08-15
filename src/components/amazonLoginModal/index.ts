import { remote } from 'electron';
import { Notice } from 'obsidian';

import { currentAmazonRegion } from '~/amazonRegion';
import { ArcAlreadyRunningError, BrowserNotFoundError } from '~/cdp/browserExecutable';
import type { CdpCookie } from '~/cdp/CdpBrowser';
import { CdpBrowser } from '~/cdp/CdpBrowser';
import { ee } from '~/eventEmitter';
import type { AmazonAccount } from '~/models';
import { settingsStore } from '~/store';

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Signs a user in to Amazon by launching Amazon's own, official
 * sign-in page in a real, separate Chrome/Edge/Chromium/Brave process
 * driven via CDP (see ~/cdp/CdpBrowser.ts) - not a window or webview
 * embedded in Obsidian's own Electron process.
 *
 * This was the third design tried, not the first: an embedded
 * `remote.BrowserWindow` and an embedded `<webview>` were both tried
 * and abandoned, because Amazon's sign-in flow includes a cross-origin
 * hop (read.amazon.<tld> to www.amazon.<tld>/ap/signin) that gets
 * silently redirected to the system's default browser by something
 * outside this plugin's control - confirmed via diagnostic logging
 * (a `will-navigate` fires with no corresponding `did-navigate`
 * afterwards), and independently corroborated by another Obsidian
 * Kindle plugin (x5gtrn/kindle-bridge, MIT-licensed - this file's CDP
 * approach and cdp/ folder are ported from it) hitting the identical
 * symptom. A genuinely separate browser process has no relationship to
 * Obsidian's own window/webContents navigation policies at all, so
 * that escape cannot happen to it by construction.
 *
 * Once sign-in completes, the resulting Amazon session cookies are
 * read via CDP and injected into Electron's own `persist:kindle-
 * highlights` session, so the rest of this plugin's scraper (which
 * still uses `electron.remote.BrowserWindow` against that same
 * partition - see ~/scraper/loadRemoteDom.ts) keeps working completely
 * unchanged. Scraping never needs to cross origins the way sign-in
 * does, so it was never affected by the escape above in the first
 * place - only sign-in needed to move to a separate process.
 */
export default class AmazonLoginModal {
  private region: AmazonAccount;
  private browser: CdpBrowser | undefined;

  constructor(private profileDir: string) {
    this.region = currentAmazonRegion();
  }

  async doLogin(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;

      const finish = (success: boolean, noticeMessage?: string) => {
        if (settled) {
          return;
        }
        settled = true;

        ee.off('syncCancelRequested', handleCancel);
        clearTimeout(timeoutHandle);
        this.browser?.close();
        this.browser = undefined;

        if (noticeMessage) {
          new Notice(`Kindle: ${noticeMessage}`);
        }

        ee.emit('loginComplete', success);
        resolve(success);
      };

      const handleCancel = () => finish(false);

      const timeoutHandle = setTimeout(() => {
        finish(false, 'sign-in timed out');
      }, SIGN_IN_TIMEOUT_MS);

      ee.emit('startLogin');
      ee.on('syncCancelRequested', handleCancel);

      CdpBrowser.launch({ userDataDir: this.profileDir })
        .then(async (browser) => {
          if (settled) {
            browser.close();
            return;
          }

          this.browser = browser;
          browser.onExit(() => finish(false));

          const page = await browser.newPage();

          page.onFrameNavigated((url) => {
            if (url.startsWith(this.region.kindleReaderUrl)) {
              this.onSignedIn(page).finally(() => finish(true));
            }
          });

          await page.navigate(this.region.notebookUrl);
        })
        .catch((error) => {
          const message =
            error instanceof BrowserNotFoundError || error instanceof ArcAlreadyRunningError
              ? error.message
              : `could not open a browser to sign in (${String(error)})`;
          finish(false, message);
        });
    });
  }

  private async onSignedIn(page: { getCookies: () => Promise<CdpCookie[]> }): Promise<void> {
    const cookies = await page.getCookies();
    const amazonCookies = cookies.filter((cookie) => cookie.domain.toLowerCase().includes('amazon'));

    const electronSession = remote.session.fromPartition('persist:kindle-highlights');

    for (const cookie of amazonCookies) {
      const domain = cookie.domain.replace(/^\./, '');
      try {
        await electronSession.cookies.set({
          url: `https://${domain}${cookie.path}`,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expirationDate: cookie.expires > 0 ? cookie.expires : undefined,
          sameSite: mapSameSite(cookie.sameSite),
        });
      } catch (error) {
        console.error('Kindle: failed to transfer a cookie into the plugin session', error);
      }
    }

    settingsStore.actions.login();
  }
}

function mapSameSite(sameSite?: 'Strict' | 'Lax' | 'None'): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  switch (sameSite) {
    case 'Strict':
      return 'strict';
    case 'Lax':
      return 'lax';
    case 'None':
      return 'no_restriction';
    default:
      return 'unspecified';
  }
}
