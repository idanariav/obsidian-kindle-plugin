import { Environment } from 'nunjucks';

import type { BookHighlight } from '~/models';

import { TrimAllEmptyLinesExtension } from '../nunjucks.extensions';

import HighlightRenderer from './highlightRenderer';
import { fileTemplateVariables } from './templateVariables';

export default class FileRenderer {
  private nunjucks: Environment;
  private highlightRenderer: HighlightRenderer;

  constructor(
    private fileTemplate: string,
    highlightTemplate: string,
    private sectionMarkerNotes: string[] = []
  ) {
    this.nunjucks = new Environment(null, { autoescape: false });
    this.nunjucks.addExtension('Trim', new TrimAllEmptyLinesExtension());

    this.highlightRenderer = new HighlightRenderer(highlightTemplate, sectionMarkerNotes);
  }

  public validate(template: string): boolean {
    try {
      this.nunjucks.renderString(template ?? '', { text: '' });
      return true;
    } catch (error) {
      return false;
    }
  }

  public render(entry: BookHighlight): string {
    const { book, highlights } = entry;

    // A blank line is inserted before any highlight whose note marks it as a
    // new section (e.g. a chapter title), so the rendered markdown starts a
    // fresh block there - required for consecutive Obsidian callouts to
    // render as separate callouts rather than one continuous blockquote.
    const renderedHighlights = highlights.reduce((acc, h, i) => {
      const rendered = this.highlightRenderer.render(h, book);
      const isSectionMarker =
        h.note != null && this.sectionMarkerNotes.includes(h.note.trim());
      const separator = i === 0 ? '' : isSectionMarker ? '\n\n' : '\n';
      return acc + separator + rendered;
    }, '');

    const templateVariables = fileTemplateVariables(entry, renderedHighlights);

    return this.nunjucks.renderString(this.fileTemplate, templateVariables);
  }
}
