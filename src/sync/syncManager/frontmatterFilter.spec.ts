import type { Book, KindleFile } from '~/models';

import { filterByFrontmatter } from './frontmatterFilter';

const book = (id: string): Book => ({ id, title: `Title ${id}`, author: 'Author' });

const kindleFile = (id: string, properties: Record<string, unknown>): KindleFile =>
  ({
    file: {} as KindleFile['file'],
    frontmatter: {} as KindleFile['frontmatter'],
    book: book(id),
    properties,
  } as KindleFile);

describe('filterByFrontmatter', () => {
  it('returns all books when no property names are configured', () => {
    const books = [book('1'), book('2')];
    const vaultFiles = [kindleFile('1', { ignored: true })];

    expect(filterByFrontmatter(books, vaultFiles, {})).toHaveLength(2);
  });

  it('excludes a book whose file has a truthy ignore property', () => {
    const books = [book('1'), book('2')];
    const vaultFiles = [kindleFile('1', { 'kindle-ignore': true }), kindleFile('2', {})];

    const result = filterByFrontmatter(books, vaultFiles, { ignorePropertyName: 'kindle-ignore' });

    expect(result.map((b) => b.id)).toEqual(['2']);
  });

  it('does not exclude a book whose ignore property is false or empty', () => {
    const books = [book('1'), book('2')];
    const vaultFiles = [
      kindleFile('1', { 'kindle-ignore': false }),
      kindleFile('2', { 'kindle-ignore': '' }),
    ];

    const result = filterByFrontmatter(books, vaultFiles, { ignorePropertyName: 'kindle-ignore' });

    expect(result).toHaveLength(2);
  });

  it('excludes a book whose status property matches the completed value (case-insensitive)', () => {
    const books = [book('1'), book('2')];
    const vaultFiles = [kindleFile('1', { Status: 'finished' }), kindleFile('2', { Status: 'Reading' })];

    const result = filterByFrontmatter(books, vaultFiles, {
      statusPropertyName: 'Status',
      statusCompletedValue: 'Finished',
    });

    expect(result.map((b) => b.id)).toEqual(['2']);
  });

  it('never excludes a book with no existing vault file', () => {
    const books = [book('1')];

    const result = filterByFrontmatter(books, [], {
      ignorePropertyName: 'kindle-ignore',
      statusPropertyName: 'Status',
      statusCompletedValue: 'Finished',
    });

    expect(result).toHaveLength(1);
  });

  it('applies ignore and status filters independently', () => {
    const books = [book('1'), book('2'), book('3')];
    const vaultFiles = [
      kindleFile('1', { 'kindle-ignore': true }),
      kindleFile('2', { Status: 'Finished' }),
      kindleFile('3', { Status: 'Reading' }),
    ];

    const result = filterByFrontmatter(books, vaultFiles, {
      ignorePropertyName: 'kindle-ignore',
      statusPropertyName: 'Status',
      statusCompletedValue: 'Finished',
    });

    expect(result.map((b) => b.id)).toEqual(['3']);
  });
});
