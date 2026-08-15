import { get } from 'svelte/store';

import { settingsStore } from '~/store';

import bookTemplate from './templates/bookTemplate.njk';
import defaultHighlightTemplate from './templates/defaultHighlightTemplate.njk';
import { FileNameRenderer, FileRenderer, HighlightRenderer } from './renderer';

export const DefaultFileNameTemplate = '{{authorsLastNames}}-{{title}}';
export const DefaultFileTemplate = bookTemplate;
export const DefaultHighlightTemplate = defaultHighlightTemplate;

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export const getRenderers = () => {
  const { fileNameTemplate, fileTemplate, highlightTemplate, sectionMarkerNotes } =
    get(settingsStore);
  const userFileNameTemplate = fileNameTemplate || DefaultFileNameTemplate;
  const userFileTemplate = fileTemplate || DefaultFileTemplate;
  const userHighlighTemplate = highlightTemplate || DefaultHighlightTemplate;
  const userSectionMarkerNotes = sectionMarkerNotes ?? [];

  return {
    fileNameRenderer: new FileNameRenderer(userFileNameTemplate),
    fileRenderer: new FileRenderer(userFileTemplate, userHighlighTemplate, userSectionMarkerNotes),
    highlightRenderer: new HighlightRenderer(userHighlighTemplate, userSectionMarkerNotes),
  };
};
