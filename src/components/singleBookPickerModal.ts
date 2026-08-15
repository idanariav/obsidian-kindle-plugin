import { App, FuzzySuggestModal } from 'obsidian';

import type { Book } from '~/models';

export class SingleBookPickerModal extends FuzzySuggestModal<Book> {
  constructor(
    app: App,
    private books: Book[],
    private syncedBookIds: Set<string>,
    private onChoose: (book: Book) => void
  ) {
    super(app);
    this.setPlaceholder('Sync a single book — search your Kindle library…');
  }

  getItems(): Book[] {
    return this.books;
  }

  getItemText(book: Book): string {
    const synced = this.syncedBookIds.has(book.id) ? ' (already synced)' : '';
    return `${book.title} — ${book.author}${synced}`;
  }

  onChooseItem(book: Book): void {
    this.onChoose(book);
  }
}
