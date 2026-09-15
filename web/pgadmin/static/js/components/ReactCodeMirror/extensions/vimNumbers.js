/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

/* global BigInt */

import { Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { getCM, Vim } from '@replit/codemirror-vim';

const editors = new WeakMap();
const localFormats = new WeakMap();
const allowedFormats = new Set(['bin', 'octal', 'hex', 'alpha', 'unsigned']);
const globalFormats = 'bin,hex';
let registered = false;

function numberFormats(value, cm) {
  if (value === undefined) return cm ? localFormats.get(cm) ?? globalFormats : globalFormats;
  const formats = typeof value === 'string' && value ? value.split(',') : [];
  if (typeof value !== 'string' || formats.some(format => !allowedFormats.has(format)) ||
      formats.length !== new Set(formats).size) {
    throw new Error('Invalid nrformats: use bin, octal, hex, alpha, unsigned, or an empty value.');
  }
  if (cm) localFormats.set(cm, value);
  // Core :set calls the callback once globally and once locally. This editor
  // integration intentionally keeps numeric preferences local to each view.
}

function findNumber(text, from, formats) {
  const patterns = [];
  if (formats.has('hex')) patterns.push('0[xX][0-9a-fA-F]+');
  if (formats.has('bin')) patterns.push('0[bB][01]+');
  patterns.push('[0-9]+');
  const regex = new RegExp((formats.has('unsigned') ? '' : '-?') + '(?:' + patterns.join('|') + ')' +
    (formats.has('alpha') ? '|[a-zA-Z]' : ''), 'g');
  let match;
  while ((match = regex.exec(text))) {
    if (match.index + match[0].length > from) return match;
  }
}

function changeNumber(token, amount, formats) {
  if (/^[a-zA-Z]$/.test(token)) {
    const first = token === token.toLowerCase() ? 97 : 65;
    const value = BigInt(token.charCodeAt(0)) + amount;
    return String.fromCharCode(Number(value < BigInt(first) ? BigInt(first) :
      value > BigInt(first + 25) ? BigInt(first + 25) : value));
  }
  const unsigned = token.replace(/^-/, '');
  const radix = /^0[xX]/.test(unsigned) ? 16 : /^0[bB]/.test(unsigned) ? 2 :
    formats.has('octal') && /^0[0-7]+$/.test(unsigned) ? 8 : 10;
  if (radix !== 10) {
    const prefix = radix === 8 ? '0' : unsigned.slice(0, 2);
    const digits = unsigned.slice(radix === 8 ? 1 : 2);
    const value = BigInt((radix === 8 ? '0o' : prefix.toLowerCase()) + digits);
    // Vim treats binary, octal and hexadecimal literals as unsigned 64-bit.
    let output = BigInt.asUintN(64, value + amount).toString(radix).padStart(digits.length, '0');
    if (radix === 16) {
      const letter = token.match(/[a-fA-F](?!.*[a-fA-F])/);
      if (letter ? letter[0] === letter[0].toUpperCase() : prefix === '0X') output = output.toUpperCase();
    }
    return (token.startsWith('-') ? '-' : '') + prefix + output;
  }
  let value = BigInt(token) + amount;
  if (formats.has('unsigned') && value < BigInt(0)) value = BigInt(0);
  const digits = token.replace(/^-/, '');
  // With octal enabled, invalid octal literals such as 009 are decimal and
  // lose leading zeros, matching Vim. Without octal, preserve decimal width.
  const width = !formats.has('octal') && digits.startsWith('0') ? digits.length : 0;
  return (value < BigInt(0) ? '-' : '') +
    (value < BigInt(0) ? -value : value).toString().padStart(width, '0');
}

function selectedLines(view) {
  const doc = view.state.doc;
  const lines = [];
  for (const range of view.state.selection.ranges) {
    let line = doc.lineAt(range.from);
    while (line.from < range.to || (range.empty && line.from <= range.from)) {
      const from = Math.max(line.from, range.from);
      const to = Math.min(line.to, range.to);
      lines.push({from, to, line: line.number});
      if (line.to >= range.to || line.number === doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }
  return lines.sort((a, b) => a.from - b.from);
}

function selectionShape(view, vim, lines) {
  const first = lines[0];
  const last = lines[lines.length - 1];
  return {
    mode: vim.visualLine ? 'line' : vim.visualBlock ? 'block' : 'char',
    lines: last.line - first.line + 1,
    width: Math.abs(vim.sel.head.ch - vim.sel.anchor.ch) + 1,
    lastColumn: last.to - view.state.doc.line(last.line).from,
    toEnd: vim.sel.head.ch === Infinity || vim.sel.anchor.ch === Infinity,
  };
}

function replayLines(view, shape) {
  const doc = view.state.doc;
  const cursor = view.state.selection.main.head;
  const first = doc.lineAt(cursor);
  const column = cursor - first.from;
  const result = [];
  for (let i = 0; i < shape.lines && first.number + i <= doc.lines; i++) {
    const line = doc.line(first.number + i);
    let from = shape.mode === 'line' || (shape.mode === 'char' && i > 0) ? line.from : line.from + column;
    from = Math.min(from, line.to);
    let to = line.to;
    if (!shape.toEnd && (shape.mode === 'block' || (shape.mode === 'char' && shape.lines === 1))) {
      to = Math.min(line.to, from + shape.width);
    } else if (shape.mode === 'char' && i === shape.lines - 1 && !shape.toEnd) {
      to = Math.min(line.to, line.from + shape.lastColumn);
    }
    result.push({from, to: Math.max(from, to), line: line.number});
  }
  return result;
}

function increment(cm, args, vim) {
  const view = cm.cm6;
  if (!editors.has(view)) {
    // Registrations are global in the Vim core. Editors without this extension
    // must continue using their original numeric action.
    if (!args.sequence) {
      if (args.repeat > 1) for (const digit of String(args.repeat)) Vim.handleKey(cm, digit, 'mapping');
      Vim.handleKey(cm, args.increase ? '<PgNativeIncrement>' : '<PgNativeDecrement>', 'mapping');
    }
    return;
  }
  const restorePrevious = () => {
    const previous = editors.get(view).before;
    if (!previous) return;
    vim.lastEditInputState = previous.input;
    vim.lastEditActionCommand = previous.action;
    if (previous.macro === Vim.getVimGlobalState_().macroModeState) {
      previous.macro.lastInsertModeChanges = previous.insert;
    }
  };
  if (view.state.readOnly || !view.state.facet(EditorView.editable)) return restorePrevious();
  const visual = vim.visualMode;
  const lines = visual ? selectedLines(view) : args.shape ? replayLines(view, args.shape) : [];
  const shape = visual && lines.length ? selectionShape(view, vim, lines) : args.shape;
  const start = visual || shape ? lines[0]?.from : view.state.selection.main.head;
  const formats = new Set(numberFormats(undefined, cm).split(','));
  const input = vim.lastEditInputState;
  // The core converts counts to Number; retain their original decimal digits
  // for SQL integers larger than Number.MAX_SAFE_INTEGER.
  const playing = Vim.getVimGlobalState_().macroModeState.isPlaying;
  const repeat = playing ? (args.exactRepeat !== undefined ? input?.repeatOverride ?? args.exactRepeat : args.repeat) :
    input?.prefixRepeat?.join('') ?? args.repeat;
  const amount = BigInt(repeat || 1) * BigInt(args.increase ? 1 : -1);
  const changes = [];
  let ordinal = BigInt(0);
  if (!visual && !shape) {
    const line = view.state.doc.lineAt(start);
    const match = findNumber(line.text, start - line.from, formats);
    if (match) changes.push({from: line.from + match.index, to: line.from + match.index + match[0].length,
      insert: changeNumber(match[0], amount, formats)});
  } else {
    for (const range of lines) {
      const match = findNumber(view.state.sliceDoc(range.from, range.to), 0, formats);
      if (!match) continue;
      ordinal++;
      changes.push({from: range.from + match.index, to: range.from + match.index + match[0].length,
        insert: changeNumber(match[0], amount * (args.sequence ? ordinal : BigInt(1)), formats)});
    }
  }
  if (visual) Vim.exitVisualMode(cm, false);
  const edits = changes.filter(change => view.state.sliceDoc(change.from, change.to) !== change.insert);
  if (!edits.length) {
    if (visual && start !== undefined) cm.setCursor(cm.posFromIndex(start));
    restorePrevious();
    return;
  }
  if (!playing) {
    // Never mutate the shared mapping: each editor's last visual shape belongs
    // to its own repeat command and survives another editor's numeric command.
    vim.lastEditActionCommand = {...vim.lastEditActionCommand,
      actionArgs: {...vim.lastEditActionCommand.actionArgs, shape, exactRepeat: String(repeat || 1)}};
  }
  const cursor = visual || shape ? start : changes[0].from + changes[0].insert.length - 1;
  view.dispatch({changes: edits, selection: {anchor: cursor}, scrollIntoView: true,
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input')]});
}

const enabledEditors = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.cm = getCM(view);
    editors.set(view, {});
    // The core emits command-done after parsing the count and before recording
    // the pending edit. Capture here so no-op/readonly commands preserve dot.
    this.beforeCommand = () => {
      const vim = this.cm.state.vim;
      const macro = Vim.getVimGlobalState_().macroModeState;
      editors.get(view).before = {input: vim.lastEditInputState, action: vim.lastEditActionCommand,
        macro, insert: {...macro.lastInsertModeChanges, changes: macro.lastInsertModeChanges.changes.slice()}};
    };
    this.cm.on('vim-command-done', this.beforeCommand);
  }
  destroy() { this.cm.off('vim-command-done', this.beforeCommand); editors.delete(this.view); }
});

/** Add alongside vim() in editors with the Vim preference enabled. */
export default function vimNumbers() {
  if (!registered) {
    Vim.defineOption('nrformats', 'bin,hex', 'string', ['nf'], numberFormats);
    Vim.defineAction('pgadminIncrementNumber', increment);
    Vim.mapCommand('<PgNativeIncrement>', 'action', 'incrementNumberToken', {increase: true, backtrack: false}, {isEdit: true});
    Vim.mapCommand('<PgNativeDecrement>', 'action', 'incrementNumberToken', {increase: false, backtrack: false}, {isEdit: true});
    for (const context of ['normal', 'visual']) {
      for (const [key, increase] of [['<C-a>', true], ['<C-x>', false]]) {
        Vim.mapCommand(key, 'action', 'pgadminIncrementNumber', {increase}, {context, isEdit: true});
        if (context === 'visual') {
          Vim.mapCommand('g' + key, 'action', 'pgadminIncrementNumber', {increase, sequence: true}, {context, isEdit: true});
        }
      }
    }
    registered = true;
  }
  return enabledEditors;
}
