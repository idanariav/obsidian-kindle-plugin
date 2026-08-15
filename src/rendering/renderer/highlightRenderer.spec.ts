import faker from 'faker';

import type { Book, Highlight } from '~/models';

import HighlightRenderer from './highlightRenderer';

describe('HighlightRenderer', () => {
  describe('validate', () => {
    it('should return true for valid template', () => {
      const renderer = new HighlightRenderer('');
      expect(renderer.validate('{{note}}')).toBe(true);
    });

    it('should return false for invalid template', () => {
      const renderer = new HighlightRenderer('');
      expect(renderer.validate('{{note')).toBe(false);
    });

    it.each([null, undefined])('should return true for %s template', (template) => {
      const renderer = new HighlightRenderer('');
      expect(renderer.validate(template)).toBe(true);
    });

    it('should return true for a template using "in sectionMarkerNotes", even with no sectionMarkerNotes configured', () => {
      // Regression test: nunjucks' `in` operator throws when the right-hand
      // side is undefined, and validate()'s stub context didn't previously
      // include sectionMarkerNotes at all - meaning a perfectly valid
      // template would be flagged as a syntax error in the Template Editor
      // even though real rendering (which does supply sectionMarkerNotes)
      // works fine.
      const renderer = new HighlightRenderer('');
      expect(renderer.validate('{% if note in sectionMarkerNotes %}{{ text }}{% endif %}')).toBe(
        true
      );
    });
  });

  describe('render', () => {
    const book: Book = {
      id: faker.datatype.uuid(),
      title: 'Book title',
      author: faker.name.findName(),
    };

    describe('highlight template variables', () => {
      const highlight: Highlight = {
        id: '123',
        text: 'highlighted text',
        location: '110',
        page: '3',
        note: 'my smart note',
        color: 'pink',
      };

      it.each([
        ['{{text}}', 'highlighted text ^ref-123'],
        ['{{location}}', '110'],
        ['{{page}}', '3'],
        ['{{note}}', 'my smart note'],
        ['{{color}}', 'pink'],
        ['{{createdDate}}', ''],
        ['{{title}}', 'Book title'],
        ['{{longTitle}}', 'Book title'],
      ])('template variable "%s" evaluated as "%s"', (template, expected) => {
        const renderer = new HighlightRenderer(template);
        expect(renderer.render(highlight, book)).toBe(expected);
      });

      it.each([
        [new Date('2019-11-29T18:00:13Z'), '{{createdDate | date}}', '29-11-2019'],
        [
          new Date('2016-04-18T07:28:27Z'),
          '{{createdDate | date("LLL")}}',
          'April 18, 2016 7:28 AM',
        ],
      ])(
        'createdDate template variable is set when highlight creation date is set',
        (createdDate: Date, template: string, expected: string) => {
          const highlight: Highlight = {
            id: faker.datatype.uuid(),
            text: faker.lorem.sentence(),
            createdDate,
          };

          const renderer = new HighlightRenderer(template);
          expect(renderer.render(highlight, book)).toBe(expected);
        }
      );
    });

    it('appLink template variable is set when a book has an ASIN value', () => {
      const myBook: Book = { ...book, asin: 'A1234' };
      const highlight: Highlight = {
        id: faker.datatype.uuid(),
        text: 'highlighted text',
      };

      const renderer = new HighlightRenderer('{{text}} - {{appLink}}');
      expect(renderer.render(highlight, myBook)).toMatch(
        new RegExp('^highlighted text - kindle://(.*) \\^ref-.*$')
      );
    });

    it('appLink template variable is undefined when a book is missing an ASIN value', () => {
      const highlight: Highlight = {
        id: faker.datatype.uuid(),
        text: 'highlighted text',
      };

      const renderer = new HighlightRenderer('{{text}} - {{appLink}}');

      expect(renderer.render(highlight, book)).toMatch(
        // eslint-disable-next-line no-regex-spaces
        new RegExp('^highlighted text -  \\^ref-.*$')
      );
    });

    it('Only leading and trailing lines in a template are always trimmed', () => {
      const templateWithTrailingLines = '\n\n{{text}}\n\n{{location}}\n\n';
      const highlight: Highlight = {
        id: faker.datatype.uuid(),
        text: 'highlighted text',
        location: '110',
      };

      const renderer = new HighlightRenderer(templateWithTrailingLines);

      expect(renderer.render(highlight, book)).toMatch(
        new RegExp('^highlighted text \\^ref-.*\\n\\n110$')
      );
    });

    it('Highlight template starting with if statement renders as expected', () => {
      const template = `{% if note %}{{note}}{% endif %}
{{ text }}`;

      const highlight: Highlight = {
        id: faker.datatype.uuid(),
        text: 'highlighted text',
      };

      const renderer = new HighlightRenderer(template);

      expect(renderer.render(highlight, book)).toMatch(
        new RegExp(/highlighted text \^ref-.*/)
      );
    });

    describe('templates where {{text}} renders on a different line depending on a branch', () => {
      // Regression test: a static, parse-time line lookup for {{text}} breaks
      // the moment two branches of a template render a different number of
      // lines before reaching {{text}} - every highlight would then be
      // missing its ^ref- block id, and resync would duplicate every
      // highlight on every sync. The block ref must be found by searching
      // rendered content instead.
      const branchingTemplate = `{%- if note in sectionMarkerNotes -%}
> [!Quote]- {{ text }}
{%- else -%}
> - {{ text }}{% if location %} ({{ location }}){% endif %}
{%- if note %}
    - Note: {{ note }}
{%- endif -%}
{%- endif %}`;

      it('embeds a ^ref- id on the section-header branch', () => {
        const highlight: Highlight = {
          id: 'HEADER1',
          text: 'Chapter One',
          note: '.h1',
        };

        const renderer = new HighlightRenderer(branchingTemplate, ['.h1', '.h2']);

        expect(renderer.render(highlight, book)).toBe('> [!Quote]- Chapter One ^ref-HEADER1');
      });

      it('embeds a ^ref- id on the regular-highlight branch, on the highlight line (not the note line)', () => {
        const highlight: Highlight = {
          id: 'REG1',
          text: 'A highlight.',
          note: 'my note',
          location: '99',
        };

        const renderer = new HighlightRenderer(branchingTemplate, ['.h1', '.h2']);

        expect(renderer.render(highlight, book)).toBe(
          '> - A highlight. (99) ^ref-REG1\n    - Note: my note'
        );
      });
    });
  });
});
