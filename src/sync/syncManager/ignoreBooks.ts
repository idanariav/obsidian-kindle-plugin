import type { Book } from '~/models';

export const filterIgnoredTitles = (books: Book[], ignoredBooks: string[]): Book[] => {
  const ignoredLower = ignoredBooks.map((t) => t.toLowerCase().trim()).filter((t) => t !== '');

  if (ignoredLower.length === 0) {
    return books;
  }

  return books.filter((book) => {
    const titleLower = book.title.toLowerCase().trim();
    return !ignoredLower.some((pattern) => titleLower.includes(pattern));
  });
};
