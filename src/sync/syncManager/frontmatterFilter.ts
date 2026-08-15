import type { Book, KindleFile } from '~/models';

export type FrontmatterFilterOptions = {
  ignorePropertyName?: string;
  statusPropertyName?: string;
  statusCompletedValue?: string;
};

const isTruthy = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized !== '' && normalized !== 'false';
  }
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value);
};

const matchesValue = (value: unknown, target: string): boolean => {
  const normalizedTarget = target.trim().toLowerCase();

  if (Array.isArray(value)) {
    return value.some((v) => String(v).trim().toLowerCase() === normalizedTarget);
  }

  return String(value ?? '').trim().toLowerCase() === normalizedTarget;
};

/**
 * Excludes books from sync based on frontmatter properties set on their
 * already-synced note. Books with no existing note are never excluded here,
 * since there's nowhere for these properties to live yet.
 */
export const filterByFrontmatter = (
  books: Book[],
  vaultFiles: KindleFile[],
  options: FrontmatterFilterOptions
): Book[] => {
  const { ignorePropertyName, statusPropertyName, statusCompletedValue } = options;

  if (!ignorePropertyName && !(statusPropertyName && statusCompletedValue)) {
    return books;
  }

  const fileByBookId = new Map<string, KindleFile>();
  vaultFiles.forEach((f) => {
    if (f.book != null) {
      fileByBookId.set(f.book.id, f);
    }
  });

  return books.filter((book) => {
    const file = fileByBookId.get(book.id);
    if (file == null) {
      return true;
    }

    const properties = file.properties ?? {};

    if (ignorePropertyName && isTruthy(properties[ignorePropertyName])) {
      return false;
    }

    if (
      statusPropertyName &&
      statusCompletedValue &&
      matchesValue(properties[statusPropertyName], statusCompletedValue)
    ) {
      return false;
    }

    return true;
  });
};
