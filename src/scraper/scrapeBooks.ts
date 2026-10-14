import type { Root } from 'cheerio';
import moment from 'moment';
import { get } from 'svelte/store';

import { currentAmazonRegion } from '~/amazonRegion';
import { ee } from '~/eventEmitter';
import type { AmazonAccountRegion, Book } from '~/models';
import { settingsStore } from '~/store';
import { hash } from '~/utils';

import { loadRemoteDom } from './loadRemoteDom';

/**
 * Amazon dates in the Kindle notebook looks like "Sunday October 24, 2021"
 * This method will parse this string and return a valid Date object
 */
export const parseToDateString = (kindleDate: string, region: AmazonAccountRegion): Date => {
  switch (region) {
    case 'japan': {
      const amazonDateString = kindleDate.substring(0, kindleDate.indexOf(' '));
      return moment(amazonDateString, 'YYYY MM DD', 'ja').toDate();
    }
    case 'france': {
      return moment(kindleDate, 'MMMM D, YYYY', 'fr').toDate();
    }
    default: {
      const amazonDateString = kindleDate.substr(kindleDate.indexOf(' ') + 1);
      return moment(amazonDateString, 'MMM DD, YYYY').toDate();
    }
  }
};

export const parseAuthor = (scrapedAuthor: string): string => {
  return scrapedAuthor.replace(/.*: /, '')?.trim();
};

export const parseImageUrl = (scrapedImageUrl: string): string => {
  return scrapedImageUrl.replace(/\._SY\d+\./, '._SX1024.')?.trim();
};

export const parseBooks = ($: Root): Book[] => {
  const region = currentAmazonRegion();
  const domainURL = `https://${region.hostname}`;
  const booksEl = $('.kp-notebook-library-each-book').toArray();

  return booksEl.map((bookEl): Book => {
    const title = $('h2.kp-notebook-searchable', bookEl).text()?.trim();

    const scrapedLastAnnotatedDate = $('[id^="kp-notebook-annotated-date"]', bookEl).val();
    const scrapedAuthor = $('p.kp-notebook-searchable', bookEl).text();
    const scrapedImageUrl = $('.kp-notebook-cover-image', bookEl).attr('src');

    return {
      id: hash(title),
      asin: $(bookEl).attr('id'),
      title,
      author: parseAuthor(scrapedAuthor),
      url: `${domainURL}/dp/${$(bookEl).attr('id')}`,
      imageUrl: parseImageUrl(scrapedImageUrl),
      lastAnnotatedDate: parseToDateString(
        scrapedLastAnnotatedDate,
        get(settingsStore).amazonRegion
      ),
    };
  });
};

export class SessionExpiredError extends Error {
  constructor() {
    super('Amazon session expired - please reconnect from plugin Settings');
  }
}

const scrapeBooks = async (): Promise<Book[]> => {
  const region = currentAmazonRegion();
  ee.emit('syncLog', `Loading Kindle notebook from ${region.hostname}…`);
  const { dom, didNavigateUrl } = await loadRemoteDom(region.notebookUrl, 30000, {
    waitForSelector: '.kp-notebook-library-each-book',
  });

  if (didNavigateUrl?.includes('signin')) {
    settingsStore.actions.logout();
    throw new SessionExpiredError();
  }

  const books = parseBooks(dom);

  // Amazon's Kindle notebook page typically shows up to 54 books per page
  // If we get exactly 54, there may be more books on additional pages
  // However, pagination requires complex interaction with Amazon's interface
  // Users with more than 54 books may need to sync multiple times
  // The sync process is intelligent and will only sync new/changed books
  if (books.length === 54) {
    console.log(
      'Found 54 books. If you have more books, you may need to sync multiple times to get them all.'
    );
    ee.emit('syncLog', 'Note: Kindle notebook may show only 54 books per page');
  }

  return books;
};

export default scrapeBooks;
