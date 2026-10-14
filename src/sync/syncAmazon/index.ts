import { Notice } from 'obsidian';
import { get } from 'svelte/store';

import AmazonLoginModal from '~/components/amazonLoginModal';
import { ee } from '~/eventEmitter';
import type { Book, KindleFile } from '~/models';
import { scrapeBooks, scrapeHighlightsForBook, SessionExpiredError } from '~/scraper';
import { settingsStore } from '~/store';
import type { SyncManager } from '~/sync';
import { syncCancellation } from '~/sync/syncCancellation';

export default class SyncAmazon {
  constructor(private syncManager: SyncManager, private browserProfileDir: string) {}

  /**
   * Opens a real, separate browser for the user to sign in to Amazon in
   * (see ~/components/amazonLoginModal). Meant to be triggered explicitly
   * (e.g. a "Connect to Amazon" button in Settings), not as a side effect
   * of starting a sync - so the user has a dedicated place to (re)connect
   * and a clear connected/disconnected state to look at, rather than a
   * login prompt popping up mid-sync.
   */
  public async connect(): Promise<boolean> {
    const modal = new AmazonLoginModal(this.browserProfileDir);
    return modal.doLogin();
  }

  public async startSync(): Promise<void> {
    if (syncCancellation.isActive) {
      console.warn('Kindle: Sync already in progress, ignoring request');
      return;
    }

    if (!(await this.ensureLoggedIn())) {
      return;
    }

    syncCancellation.start('amazon');
    ee.emit('syncSessionStart', 'amazon');

    try {
      ee.emit('fetchingBooks');

      const remoteBooks = await this.scrapeBooksWithReconnect();

      if (syncCancellation.isCancelled) {
        syncCancellation.complete();
        return;
      }

      const booksToSync = this.syncManager.filterBooksToSync(remoteBooks);
      syncCancellation.setTotalCount(booksToSync.length);

      ee.emit('fetchingBooksSuccess', booksToSync, remoteBooks);

      if (booksToSync.length > 0) {
        await this.syncBooks(booksToSync);
      }

      if (syncCancellation.isCancelled) {
        syncCancellation.complete();
      } else {
        syncCancellation.reset();
        ee.emit('syncSessionSuccess');
      }
    } catch (error) {
      syncCancellation.reset();
      console.error('Error while trying fetch books and to sync', error);
      ee.emit('syncSessionFailure', String(error));
    }
  }

  /**
   * Logs in and fetches the full remote library, for callers that need to
   * let the user pick a single book (e.g. a book search/picker UI).
   * Returns undefined if login failed or was cancelled.
   */
  public async fetchRemoteBooks(): Promise<Book[] | undefined> {
    if (syncCancellation.isActive) {
      console.warn('Kindle: Sync already in progress, ignoring request');
      return undefined;
    }

    if (!(await this.ensureLoggedIn())) {
      return undefined;
    }

    ee.emit('fetchingBooks');

    try {
      return await this.scrapeBooksWithReconnect();
    } catch (error) {
      console.error('Kindle: failed to fetch library', error);
      new Notice(`Kindle: could not load your library (${String(error)})`);
      return undefined;
    }
  }

  /**
   * Syncs exactly one book, regardless of the ignore list or resync-status
   * filters that normally scope a full sync - useful for testing a
   * template change against a specific book, or for topping up a single
   * book without triggering a full library sync. Creates the note if it
   * doesn't exist yet, or resyncs it (diff-only) if it does.
   */
  public async syncSingleBook(book: Book): Promise<void> {
    if (syncCancellation.isActive) {
      console.warn('Kindle: Sync already in progress, ignoring single-book sync request');
      return;
    }

    if (!(await this.ensureLoggedIn())) {
      return;
    }

    ee.emit('syncSessionStart', 'amazon');
    ee.emit('syncBook', book, 0);

    try {
      const highlights = await scrapeHighlightsForBook(book);

      await this.syncManager.syncBook(book, highlights);

      ee.emit('syncBookSuccess', book, highlights);
      ee.emit('syncSessionSuccess');
    } catch (error) {
      console.error('Error syncing single book', book, error);
      ee.emit('syncBookFailure', book, String(error));
      ee.emit('syncSessionFailure', String(error));
    }
  }

  public async resync(file: KindleFile): Promise<void> {
    if (syncCancellation.isActive) {
      console.warn('Kindle: Sync already in progress, ignoring resync request');
      return;
    }

    if (!(await this.ensureLoggedIn())) {
      return;
    }

    ee.emit('resyncBook', file);

    try {
      const remoteBooks = await this.scrapeBooksWithReconnect();
      const remoteBook = remoteBooks.find((r) => r.id === file.book.id);

      const highlights = await scrapeHighlightsForBook(file.book);

      const diffs = await this.syncManager.resyncBook(file, remoteBook, highlights);

      ee.emit('resyncComplete', file, diffs.length);
    } catch (error) {
      console.error('Error resyncing higlights for file', file, error);
      ee.emit('resyncFailure', file, String(error));
    }
  }

  /** Opens the sign-in window right away if not signed in, instead of sending the user to Settings. */
  private async ensureLoggedIn(): Promise<boolean> {
    return get(settingsStore).isLoggedIn || this.connect();
  }

  /** Scrapes the library; if the session turns out to be expired, signs in again and retries once. */
  private async scrapeBooksWithReconnect(): Promise<Book[]> {
    try {
      return await scrapeBooks();
    } catch (error) {
      if (error instanceof SessionExpiredError && (await this.connect())) {
        return scrapeBooks();
      }
      throw error;
    }
  }

  private async syncBooks(books: Book[]): Promise<void> {
    for (const [index, book] of books.entries()) {
      if (syncCancellation.isCancelled) {
        break;
      }

      try {
        ee.emit('syncBook', book, index);

        const highlights = await scrapeHighlightsForBook(
          book,
          () => syncCancellation.isCancelled
        );
        await this.syncManager.syncBook(book, highlights);

        syncCancellation.incrementSynced();
        ee.emit('syncBookSuccess', book, highlights);

        if (index < books.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error('Error syncing book', book, error);
        ee.emit('syncBookFailure', book, String(error));
      }
    }
  }
}
