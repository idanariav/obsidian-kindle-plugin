import type { Book } from '~/models';

import { filterIgnoredTitles } from './ignoreBooks';

const book = (title: string): Book => ({ id: title, title, author: 'Author' });

describe('filterIgnoredTitles', () => {
  it('returns all books when ignore list is empty', () => {
    const books = [book('Book A'), book('Book B')];
    expect(filterIgnoredTitles(books, [])).toHaveLength(2);
  });

  it('filters by exact title match (backward compat)', () => {
    const books = [book('My Book Title'), book('Other Book')];
    const result = filterIgnoredTitles(books, ['My Book Title']);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Other Book');
  });

  it('filters by substring match', () => {
    const books = [
      book(
        'Words of Radiance: Book Two of the Stormlight Archive (The Stormlight Archive, Book 2)'
      ),
      book('Atomic Habits'),
    ];
    const result = filterIgnoredTitles(books, ['Stormlight']);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Atomic Habits');
  });

  it('is case insensitive', () => {
    const books = [book('The Stormlight Archive')];
    expect(filterIgnoredTitles(books, ['stormlight'])).toHaveLength(0);
    expect(filterIgnoredTitles(books, ['STORMLIGHT'])).toHaveLength(0);
  });

  it('does not filter when ignore patterns are empty strings', () => {
    const books = [book('Book A'), book('Book B')];
    expect(filterIgnoredTitles(books, ['', '  ', ''])).toHaveLength(2);
  });

  it('applies multiple ignore patterns independently', () => {
    const books = [book('Words of Radiance'), book('Atomic Habits'), book('Deep Work')];
    const result = filterIgnoredTitles(books, ['Radiance', 'Deep']);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Atomic Habits');
  });

  it('matches partial title with subtitle and series info', () => {
    const books = [
      book("Tress of the Emerald Sea: A Cosmere Novel (Hoid's Travails)"),
      book('Project Hail Mary'),
    ];
    const result = filterIgnoredTitles(books, ['Tress of the Emerald Sea']);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Project Hail Mary');
  });
});
