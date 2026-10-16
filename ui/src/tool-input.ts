// The complete input of a permission request, laid out by tool: a shell command in full, a file change
// with path and (folded) content, an MCP call with server, tool and parameters. Whatever a layout does
// not show goes under "More parameters", so nothing Claude Code sent is hidden.
//
// SPDX-License-Identifier: Apache-2.0

import { el, icon } from './dom.ts';
import type { Texts } from './i18n.ts';

type Input = Record<string, unknown>;

export function renderToolInput(tool: string, input: Input, mcpServer: string | null, texts: Texts): HTMLElement {
  const box = el('div', 'input');
  const shown = new Set<string>();
  const take = (key: string): string | null => {
    const value = input[key];
    if (typeof value !== 'string') return null;
    shown.add(key);
    return value;
  };
  const field = (label: string, value: string | null, mono = false) => {
    if (value === null) return;
    const row = el('p', 'input__field');
    row.append(el('span', 'input__label', label), el('span', mono ? 'input__value az-mono' : 'input__value', value));
    box.append(row);
  };

  if (tool === 'Bash' || tool === 'PowerShell') {
    const description = take('description');
    if (description) box.append(el('p', 'input__note', description));
    const command = take('command');
    if (command !== null) box.append(code(command));
  } else if (tool === 'Edit') {
    field(texts.file, take('file_path'), true);
    const before = take('old_string');
    const after = take('new_string');
    if (input.replace_all === true) {
      shown.add('replace_all');
      box.append(el('p', 'input__note', texts.replaceAll));
    }
    if (before !== null || after !== null) box.append(fold(texts.change, change(before, after, texts)));
  } else if (tool === 'MultiEdit') {
    field(texts.file, take('file_path'), true);
    if (Array.isArray(input.edits)) {
      shown.add('edits');
      const edits = input.edits.map((edit) => {
        const e = (edit ?? {}) as Input;
        return change(typeof e.old_string === 'string' ? e.old_string : null, typeof e.new_string === 'string' ? e.new_string : null, texts);
      });
      box.append(fold(texts.changes(edits.length), ...edits));
    }
  } else if (tool === 'Write') {
    field(texts.file, take('file_path'), true);
    const content = take('content');
    if (content !== null) box.append(fold(texts.content, code(content)));
  } else if (tool === 'NotebookEdit') {
    field(texts.file, take('notebook_path'), true);
    const source = take('new_source');
    if (source !== null) box.append(fold(texts.content, code(source)));
  } else if (tool === 'WebFetch') {
    field(texts.address, take('url'), true);
    const prompt = take('prompt');
    if (prompt) box.append(el('p', 'input__note', prompt));
  } else if (tool === 'WebSearch') {
    field(texts.query, take('query'));
  } else if (tool.startsWith('mcp__')) {
    // mcp__<server>__<tool>
    const [, server = '', ...rest] = tool.split('__');
    field(texts.server, mcpServer ?? server);
    field(texts.tool, rest.join('__'));
    box.append(el('p', 'input__label', texts.parameters), code(json(input)));
    for (const key of Object.keys(input)) shown.add(key);
  } else {
    box.append(code(json(input)));
    for (const key of Object.keys(input)) shown.add(key);
  }

  const more = Object.fromEntries(Object.entries(input).filter(([key]) => !shown.has(key)));
  if (Object.keys(more).length > 0) box.append(fold(texts.moreParameters, code(json(more))));
  return box;
}

function code(text: string, className = 'code'): HTMLPreElement {
  return el('pre', className, text);
}

/** The old and the new text of one change, each named in words, not told apart by colour. */
function change(before: string | null, after: string | null, texts: Texts): HTMLElement {
  const box = el('div', 'change');
  if (before !== null) box.append(el('p', 'input__label', texts.before), code(before));
  if (after !== null) box.append(el('p', 'input__label', texts.after), code(after));
  return box;
}

function fold(summary: string, ...content: HTMLElement[]): HTMLDetailsElement {
  const details = el('details', 'fold');
  const head = el('summary');
  head.append(icon('angle-right', 'az-icon fold__closed'), icon('angle-down', 'az-icon fold__open'), summary);
  details.append(head, ...content);
  return details;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
