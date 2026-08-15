/* eslint-disable @typescript-eslint/restrict-plus-operands */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import nunjucks from 'nunjucks';

import { HighlightIdBlockRefPrefix } from './renderer';

type SubClass = {
  children?: SubClassValue[];
  colno: number;
  lineno: number;
};

type SubClassValue = {
  args?: SubClass;
  name?: SubClassValue;
  colno: number;
  lineno: number;
  value: string;
};

type ParsedSignature = {
  children: SubClass[];
};

type Context = {
  ctx: Record<string, string>;
};

function TrimAllEmptyLinesExtension(): void {
  this.tags = ['trim'];

  this.parse = function (parser, nodes) {
    const tok = parser.nextToken(); // Get the tag token

    // Parse the args and move after the block end.
    const args: ParsedSignature = parser.parseSignature(null, true);
    parser.advanceAfterBlockEnd(tok.value);

    // Parse the body
    const body: ParsedSignature = parser.parseUntilBlocks('trim', 'endtrim');
    parser.advanceAfterBlockEnd();

    // Actually do work on block body and arguments
    return new nodes.CallExtension(this, 'run', args, [body]);
  };

  this.run = function (_context, bodyCallback) {
    const rawCode: string = bodyCallback();
    const rawCodeNoLines = rawCode.replace(/(^[ \t]*\n)/gm, '').trim();
    return new nunjucks.runtime.SafeString(rawCodeNoLines);
  };
}

/**
 * Appends a hidden Obsidian block-reference (`^ref-<id>`) to a highlight's
 * rendered output, so incremental resync can recognize which highlights are
 * already present in a file.
 *
 * The ref is attached to whichever rendered line actually contains the
 * "needle" variable's value (e.g. the highlight's `text`), found by content
 * search at render time rather than by the needle's line position in the
 * raw template source. This makes it robust to templates where the needle
 * is rendered conditionally (e.g. inside `{% if %}` branches that produce a
 * different number of lines depending on the highlight) - a static,
 * parse-time line lookup breaks the moment two branches don't render the
 * same number of lines before the needle.
 *
 * {% blockref "text", "id" %}
 *   ...
 * {% endblockref %}
 */
function BlockReferenceExtension(): void {
  this.tags = ['blockref'];

  this.parse = function (parser, nodes) {
    const tok = parser.nextToken(); // Get the tag token

    // Parse the args and move after the block end.
    const args: ParsedSignature = parser.parseSignature(null, true);
    parser.advanceAfterBlockEnd(tok.value);

    // Parse the body
    const body: ParsedSignature = parser.parseUntilBlocks('blockref', 'endblockref');
    parser.advanceAfterBlockEnd();

    // Actually do work on block body and arguments
    return new nodes.CallExtension(this, 'run', args, [body]);
  };

  this.run = function (
    context: Context,
    needleKey: keyof Context['ctx'],
    highlightIdKey: keyof Context['ctx'],
    bodyCallback: () => string
  ) {
    const renderedTemplate: string = bodyCallback();

    // Needle value can be missing if the corresponding template variable
    // (e.g. {{text}}) is not used, or renders empty, for this highlight
    const needleValue = context.ctx[needleKey];
    if (needleValue == null || String(needleValue) === '') {
      return renderedTemplate;
    }

    const lines = renderedTemplate.split('\n');
    const targetIndex = lines.findIndex((line) => line.includes(String(needleValue)));

    if (targetIndex === -1) {
      return renderedTemplate;
    }

    const blockRef = `${HighlightIdBlockRefPrefix}${context.ctx[highlightIdKey]}`;
    lines[targetIndex] = `${lines[targetIndex]} ${blockRef}`;

    return new nunjucks.runtime.SafeString(lines.join('\n'));
  };
}

export { BlockReferenceExtension, TrimAllEmptyLinesExtension };
