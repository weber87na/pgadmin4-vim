/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { EditorState, Prec, StateEffect, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { Vim } from '@replit/codemirror-vim';
import gettext from 'sources/gettext';
import { displayColumn, visualCells } from './vimTextColumns';

const setTabSize = StateEffect.define();
const tabSizeOverride = StateField.define({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setTabSize)) value = effect.value;
    return value;
  },
  provide: field => Prec.highest(EditorState.tabSize.computeN([field], state => {
    const value = state.field(field);
    return value === null ? [] : [value];
  })),
});
const MAX_COLUMNS = 10000;
const MAX_GROWTH = 10000000;
let registered = false;

function notify(cm, message) {
  cm.openNotification(document.createTextNode(message), {bottom: true});
}

function range(cm, params, wholeDocument=false) {
  const state = cm.cm6?.state;
  if (!state || state.field(tabSizeOverride, false) === undefined) return;
  if (state.readOnly || !state.facet(EditorView.editable)) {
    notify(cm, gettext('This editor is read-only.'));
    return;
  }
  const implicit = params.line === undefined && params.selectionLineEnd === undefined;
  const start = wholeDocument && implicit ? 1 : (params.selectionLine ?? cm.getCursor().line) + 1;
  const end = wholeDocument && implicit ? state.doc.lines : (params.selectionLineEnd ?? start - 1) + 1;
  if (![start, end].every(Number.isSafeInteger) || start < 1 || end < start || end > state.doc.lines) {
    notify(cm, gettext('Invalid line range.'));
    return;
  }
  return {state, start, end};
}

function padding(from, to, tabSize, useTabs) {
  const width = to - from;
  if (!useTabs) return ' '.repeat(width);
  const firstTab = tabSize - from % tabSize;
  if (width < firstTab) return ' '.repeat(width);
  return '\t'.repeat(1 + Math.floor((width - firstTab) / tabSize)) +
    ' '.repeat((width - firstTab) % tabSize);
}

function endColumn(text, column, tabSize) {
  const cells = visualCells(text, tabSize, column);
  const last = cells[cells.length - 1];
  return last ? last.column + last.width : column;
}

function retabLine(text, oldTabSize, newTabSize, useTabs, force) {
  const changes = [];
  let offset = 0, column = 0;
  for (const match of text.matchAll(/[ \t]+/g)) {
    const before = text.slice(offset, match.index);
    column = endColumn(before, column, oldTabSize);
    const end = endColumn(match[0], column, oldTabSize);
    let replacement = match[0];
    const hasTab = replacement.includes('\t');
    if (hasTab || force && replacement.length > 1) {
      const changed = padding(column, end, newTabSize, useTabs);
      if (hasTab || !useTabs || changed.length < replacement.length) replacement = changed;
    }
    if (replacement !== match[0]) changes.push({from: match.index, to: match.index + match[0].length, insert: replacement});
    column = end;
    offset = match.index + match[0].length;
  }
  return changes;
}

function changedPart(before, after) {
  if (before === after) return [];
  let start = 0, end = before.length, afterEnd = after.length;
  while (start < end && start < afterEnd && before[start] === after[start]) start++;
  while (end > start && afterEnd > start && before[end - 1] === after[afterEnd - 1]) { end--; afterEnd--; }
  return [{from: start, to: end, insert: after.slice(start, afterEnd)}];
}

function applyLines(cm, lines, transform, effects=[], keepColumn=false) {
  const {state, start, end} = lines;
  const changes = [];
  let growth = 0;
  for (let number = start; number <= end; number++) {
    const line = state.doc.line(number);
    const updated = transform(line.text);
    const lineChanges = typeof updated === 'string' ? changedPart(line.text, updated) : updated;
    for (const change of lineChanges) {
      growth += change.insert.length - (change.to - change.from);
      changes.push({...change, from: change.from + line.from, to: change.to + line.from});
    }
    if (growth > MAX_GROWTH) {
      notify(cm, gettext('Formatting would add too much text. Use a smaller range or width.'));
      return;
    }
  }
  const changeSet = state.changes(changes);
  const newDoc = changeSet.apply(state.doc);
  const previous = state.doc.lineAt(state.selection.main.head);
  const current = newDoc.line(previous.number);
  let position = current.from + current.text.search(/[^ \t]|$/);
  if (keepColumn) {
    const wanted = displayColumn(previous.text, state.selection.main.head - previous.from, state.tabSize);
    const tabSize = effects.length ? effects[0].value : state.tabSize;
    const cells = visualCells(current.text, tabSize);
    const target = cells.find(cell => cell.column + cell.width > wanted);
    position = current.from + (target?.from ?? cells[cells.length - 1]?.from ?? 0);
  }
  cm.cm6.dispatch({changes: changeSet, effects, selection: {anchor: position},
    annotations: isolateHistory.of('full'), userEvent: 'input', scrollIntoView: true});
}

function retab(cm, params) {
  const lines = range(cm, params, true);
  if (!lines) return;
  const match = /^(!)?\s*(\d+)?$/.exec(params.argString?.trim() || '');
  const size = Number(match?.[2] || 0);
  if (!match || !Number.isSafeInteger(size) || size > MAX_COLUMNS) {
    notify(cm, gettext('Use :retab[!] with an optional tab width from 0 to 10000.'));
    return;
  }
  const oldSize = lines.state.tabSize;
  const newSize = size || oldSize;
  const tabs = cm.getOption('indentWithTabs');
  applyLines(cm, lines, text => retabLine(text, oldSize, newSize, tabs, Boolean(match[1])),
    size ? [setTabSize.of(size)] : [], true);
}

function align(cm, params, alignment) {
  const lines = range(cm, params);
  if (!lines) return;
  const argument = params.argString?.trim() || '';
  const explicit = argument ? Number(argument) : 0;
  if (argument && (!/^\d+$/.test(argument) || !Number.isSafeInteger(explicit) || explicit > MAX_COLUMNS)) {
    notify(cm, gettext('Use an optional width or indent from 0 to 10000.'));
    return;
  }
  const configured = Number(Vim.getOption('textwidth', cm)) || 80;
  const width = alignment === 'left' ? explicit : explicit || configured;
  if (!Number.isSafeInteger(width) || width < 0 || width > MAX_COLUMNS) {
    notify(cm, gettext('The configured text width must be from 0 to 10000.'));
    return;
  }
  const tabSize = lines.state.tabSize;
  const tabs = cm.getOption('indentWithTabs');
  applyLines(cm, lines, text => {
    // Keep empty lines (including the final empty line after an EOL) intact.
    if (!text) return text;
    const body = text.replace(/^[ \t]*/, '');
    const visible = body.replace(/[ \t]*$/, '');
    let indent = width;
    if (alignment !== 'left') {
      if (!visible) return text;
      const originalIndent = endColumn(text.slice(0, text.length - body.length), 0, tabSize);
      const length = endColumn(visible, originalIndent, tabSize) - originalIndent;
      indent = Math.max(0, alignment === 'center' ? Math.floor((width - length) / 2) : width - length);
      if (alignment === 'right' && visible.includes('\t')) {
        // Embedded tabs change width with indentation. Find the furthest
        // indent whose last nonblank cell still fits inside the right margin.
        let low = 0, high = width;
        while (low < high) {
          const middle = Math.ceil((low + high) / 2);
          if (endColumn(visible, middle, tabSize) <= width) low = middle;
          else high = middle - 1;
        }
        indent = low;
      }
    }
    return padding(0, indent, tabSize, tabs) + body;
  });
}

export default function vimExEditing() {
  if (!registered) {
    Vim.defineEx('retab', 'ret', retab);
    for (const [name, prefix] of [['left', 'le'], ['center', 'ce'], ['right', 'ri']]) {
      Vim.defineEx(name, prefix, (cm, params) => align(cm, params, name));
    }
    registered = true;
  }
  return tabSizeOverride;
}
