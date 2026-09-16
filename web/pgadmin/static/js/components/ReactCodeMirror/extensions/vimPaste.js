/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { ChangeSet, Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { getCM, Vim } from '@replit/codemirror-vim';
import gettext from 'sources/gettext';
import { displayColumn, visualCells } from './vimTextColumns';

const editors = new WeakMap();
let registered = false;

function writable(view) {
  return editors.has(view) && !view.state.readOnly && view.state.facet(EditorView.editable);
}

function restorePrevious(cm, previous = editors.get(cm.cm6)?.before, owner) {
  if (!previous) return;
  cm.state.vim.lastEditInputState = previous.input;
  cm.state.vim.lastEditActionCommand = previous.action;
  if (previous.macro === Vim.getVimGlobalState_().macroModeState &&
      (!owner || (previous.macro.lastInsertModeChanges.changes === owner && !owner.length))) {
    previous.macro.lastInsertModeChanges = previous.insert;
  }
}

function delegate(cm, args, command) {
  if (args.registerName) {
    Vim.handleKey(cm, '"', 'mapping');
    Vim.handleKey(cm, args.registerName, 'mapping');
  }
  if (args.repeat > 1) for (const digit of String(args.repeat)) Vim.handleKey(cm, digit, 'mapping');
  Vim.handleKey(cm, command, 'mapping');
}

function captureSelection(view, vim) {
  const doc = view.state.doc;
  let ranges = view.state.selection.ranges.map(range => {
    const firstLine = doc.lineAt(range.from);
    const lastLine = doc.lineAt(range.to);
    const first = visualCells(firstLine.text, view.state.tabSize).find(cell => cell.to > range.from - firstLine.from);
    const last = visualCells(lastLine.text, view.state.tabSize).find(cell => cell.to >= range.to - lastLine.from);
    const from = firstLine.from + (first?.from ?? firstLine.length);
    return {from, to: range.empty ? from : range.to === lastLine.from ? range.to : lastLine.from + (last?.to ?? lastLine.length)};
  });
  if (vim.visualLine) {
    const first = doc.line(Math.min(vim.sel.anchor.line, vim.sel.head.line) + 1);
    const last = doc.line(Math.max(vim.sel.anchor.line, vim.sel.head.line) + 1);
    ranges = [{from: first.from, to: last.to + (last.number < doc.lines ? 1 : 0)}];
  }
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  const firstLine = doc.lineAt(first.from);
  const lastLine = doc.lineAt(Math.max(first.from, last.to - 1));
  const tabSize = view.state.tabSize;
  // Native selections use UTF-16 offsets; save character counts for a dot
  // operation that may land on differently-sized graphemes in another word.
  const characters = visualCells(firstLine.text.slice(first.from - firstLine.from,
    Math.min(firstLine.to, last.to) - firstLine.from), tabSize).length;
  const lastCharacters = visualCells(lastLine.text.slice(0, last.to - lastLine.from), tabSize).length;
  const blockWidth = ranges.reduce((maximum, range) => {
    const line = doc.lineAt(range.from);
    return Math.max(maximum, displayColumn(line.text, range.to - line.from, tabSize) - displayColumn(line.text, range.from - line.from, tabSize));
  }, 0);
  return {ranges, shape: {
    mode: vim.visualLine ? 'line' : vim.visualBlock ? 'block' : 'char',
    lines: lastLine.number - firstLine.number + 1,
    width: vim.visualBlock ? blockWidth : characters,
    characters, lastCharacters,
    lastColumn: last.to - lastLine.from,
    toEnd: vim.sel.head.ch === Infinity || vim.sel.anchor.ch === Infinity,
  }};
}

function repeatSelection(view, shape) {
  const doc = view.state.doc;
  const cursor = normalCursor(doc, view.state.selection.main.head);
  const first = doc.lineAt(cursor);
  const last = doc.line(Math.min(doc.lines, first.number + shape.lines - 1));
  const tabSize = view.state.tabSize;
  const column = displayColumn(first.text, cursor - first.from, tabSize);
  if (shape.mode === 'line') return [{from: first.from, to: last.number < doc.lines ? last.to + 1 : last.to}];
  if (shape.mode === 'char') {
    const cells = visualCells(last.text, tabSize);
    const start = shape.lines === 1 ? Math.max(0, cells.findIndex(cell => cell.to > cursor - first.from)) : 0;
    const count = shape.lines === 1 ? shape.characters : shape.lastCharacters;
    return [{from: cursor, to: shape.toEnd ? last.to : last.from + (cells[start + count - 1]?.to ?? last.length)}];
  }
  const ranges = [];
  for (let i = first.number; i <= last.number; i++) {
    const line = doc.line(i);
    const cells = visualCells(line.text, tabSize);
    const start = cells.find(cell => cell.column + cell.width > column);
    const end = cells.find(cell => cell.column + cell.width >= column + shape.width);
    ranges.push({from: line.from + (start?.from ?? line.length),
      to: shape.toEnd ? line.to : line.from + (end?.to ?? line.length)});
  }
  return ranges;
}

function normalCursor(doc, offset) {
  const line = doc.lineAt(Math.min(doc.length, offset));
  const result = Math.min(offset, Math.max(line.from, line.to - 1)) - line.from;
  return line.from + (visualCells(line.text, 4).find(cell => cell.to > result)?.from ?? 0);
}

function applyPut(cm, args, source) {
  const view = cm.cm6;
  const vim = cm.state.vim;
  if (!writable(view) || !source.text) return restorePrevious(cm);
  const playing = Vim.getVimGlobalState_().macroModeState.isPlaying;
  const repeat = args.replay && playing ? vim.lastEditInputState?.repeatOverride || args.repeat : args.repeat;
  if (!Number.isSafeInteger(repeat) || repeat < 1 || source.text.length * repeat > 10000000) {
    restorePrevious(cm);
    cm.openNotification(document.createTextNode(gettext('Paste is too large.')), {bottom: true});
    return;
  }
  const visual = vim.visualMode;
  const selection = visual ? captureSelection(view, vim) :
    args.shape ? {shape: args.shape, ranges: repeatSelection(view, args.shape)} : null;
  const original = view.state.doc;
  let doc = original;
  let changes = ChangeSet.empty(doc.length);
  const replace = (from, to, insert) => {
    const step = ChangeSet.of({from, to, insert}, doc.length);
    changes = changes.compose(step);
    doc = step.apply(doc);
  };
  const tabSize = view.state.tabSize;
  const rows = source.blockwise ? (source.linewise ? source.text.replace(/\n$/, '') : source.text).split('\n') : null;
  const repeatedBlock = (block, column) => {
    if (repeat === 1) return block;
    const cells = block.map(row => visualCells(row, tabSize, column));
    const widths = cells.map(row => row.length ? row[row.length - 1].column + row[row.length - 1].width - column : 0);
    const width = widths.reduce((maximum, value) => Math.max(maximum, value), 0);
    return cells.map((row, i) => {
      const expanded = row.map(cell => cell.text === '\t' ? ' '.repeat(cell.width) : cell.text).join('');
      return (expanded + ' '.repeat(width - widths[i])).repeat(repeat - 1) + expanded;
    });
  };
  const raw = source.linewise && !source.text.endsWith('\n') ? source.text + '\n' : source.text;
  const text = rows ? repeatedBlock(rows, 0).join('\n') : raw.repeat(repeat);
  let cursor = normalCursor(doc, view.state.selection.main.head);
  let firstInserted;
  let lastInserted;
  let selectionMode = 'char';
  const blockPut = (lineNumber, column, block, keepFirstCursor = false) => {
    while (doc.lines < lineNumber + block.length - 1) replace(doc.length, doc.length, '\n');
    const positions = [];
    for (let i = block.length - 1; i >= 0; i--) {
      const line = doc.line(lineNumber + i);
      const cells = visualCells(line.text, tabSize);
      const cell = cells.find(value => value.column + value.width > column);
      const from = cell?.from ?? line.length;
      const before = cell?.column ?? (cells.length ? cells[cells.length - 1].column + cells[cells.length - 1].width : 0);
      const padding = ' '.repeat(Math.max(0, column - before));
      const splitTab = cell?.text === '\t' && column > cell.column;
      const right = splitTab ? ' '.repeat(cell.column + cell.width - column) : '';
      replace(line.from + from, line.from + (splitTab ? cell.to : from), padding + block[i] + right);
      positions[i] = {from: from + padding.length, to: from + padding.length + block[i].length};
    }
    firstInserted = doc.line(lineNumber).from + positions[0].from;
    const lastLine = doc.line(lineNumber + block.length - 1);
    lastInserted = lastLine.from + Math.max(positions[positions.length - 1].from, positions[positions.length - 1].to - 1);
    cursor = args.moveAfter ? (keepFirstCursor ? firstInserted + block[0].length : lastLine.from + positions[positions.length - 1].to) :
      keepFirstCursor ? firstInserted + Math.max(0, block[0].length - 1) : firstInserted;
    selectionMode = 'block';
  };
  const linePut = (lineNumber, after, body) => {
    const line = doc.line(lineNumber);
    const atEnd = after && line.number === doc.lines;
    const from = after ? line.to + (atEnd ? 0 : 1) : line.from;
    replace(from, from, atEnd ? '\n' + body : body + '\n');
    const firstLine = doc.line(lineNumber + (after ? 1 : 0));
    const count = body.split('\n').length;
    const lastLine = doc.line(firstLine.number + count - 1);
    firstInserted = firstLine.from;
    lastInserted = Math.max(lastLine.from, lastLine.to - 1);
    cursor = args.moveAfter ? doc.line(Math.min(doc.lines, lastLine.number + 1)).from :
      firstLine.from + firstLine.text.search(/\S|$/);
    selectionMode = 'line';
  };
  const characterPut = (from, to, inserted) => {
    replace(from, to, inserted);
    firstInserted = from;
    lastInserted = Math.max(from, from + inserted.length - 1);
    cursor = args.moveAfter ? from + inserted.length : inserted.includes('\n') ? from : lastInserted;
  };
  let deleted;
  if (selection) {
    const {ranges, shape} = selection;
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    const firstLine = doc.lineAt(first.from);
    const column = displayColumn(firstLine.text, first.from - firstLine.from, tabSize);
    deleted = ranges.map(range => original.sliceString(range.from, range.to)).join(shape.mode === 'block' ? '\n' : '');
    if (shape.mode === 'line') {
      if (!deleted.endsWith('\n')) deleted += '\n';
      const body = text.replace(/\n$/, '');
      replace(first.from, last.to, body + (last.to < original.length ? '\n' : ''));
      firstInserted = first.from;
      const lastLine = doc.line(firstLine.number + body.split('\n').length - 1);
      lastInserted = Math.max(lastLine.from, lastLine.to - 1);
      cursor = args.moveAfter ? doc.line(Math.min(doc.lines, lastLine.number + 1)).from :
        firstInserted + doc.line(firstLine.number).text.search(/\S|$/);
      selectionMode = 'line';
    } else {
      for (let i = ranges.length - 1; i >= 0; i--) replace(ranges[i].from, ranges[i].to, '');
      if (rows) {
        blockPut(firstLine.number, column, repeatedBlock(rows, column));
      } else if (source.linewise) {
        const body = text.replace(/\n$/, '');
        if (shape.mode === 'block') {
          linePut(args.after ? firstLine.number + ranges.length - 1 : firstLine.number, args.after, body);
        } else {
          characterPut(first.from, first.from, '\n' + body + '\n');
          firstInserted = first.from + 1;
          lastInserted = firstInserted + body.length - 1;
          cursor = args.moveAfter ? lastInserted + 2 : firstInserted + doc.lineAt(firstInserted).text.search(/\S|$/);
          selectionMode = 'line';
        }
      } else if (shape.mode === 'block' && !text.includes('\n')) {
        blockPut(firstLine.number, column, ranges.map(() => text), true);
      } else {
        characterPut(first.from, first.from, text);
      }
    }
  } else {
    const line = doc.lineAt(cursor);
    if (rows) {
      const cell = visualCells(line.text, tabSize).find(value => value.to > cursor - line.from);
      const column = displayColumn(line.text, cursor - line.from, tabSize) + (args.after ? cell?.width ?? 0 : 0);
      blockPut(line.number, column, repeatedBlock(rows, column));
    } else if (source.linewise) {
      linePut(line.number, args.after, text.replace(/\n$/, ''));
    } else {
      const cell = visualCells(line.text, tabSize).find(value => value.to > cursor - line.from);
      const advance = args.after && cell ? cell.to - (cursor - line.from) : 0;
      characterPut(cursor + advance, cursor + advance, text);
    }
  }
  if (visual) Vim.exitVisualMode(cm, false);
  if (selection && args.after) {
    Vim.getRegisterController().unnamedRegister.setText(deleted,
      selection.shape.mode === 'line', selection.shape.mode === 'block');
  }
  if (!playing) vim.lastEditActionCommand = {...vim.lastEditActionCommand,
    actionArgs: {...vim.lastEditActionCommand.actionArgs, shape: selection?.shape, replay: true}};
  view.dispatch({changes, selection: {anchor: normalCursor(doc, cursor)}, scrollIntoView: true,
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.paste')]});
  for (const [name, position] of [['[', firstInserted], [']', lastInserted]]) {
    vim.marks[name]?.clear();
    vim.marks[name] = cm.setBookmark(cm.posFromIndex(normalCursor(doc, position)));
  }
  if (selection) {
    const anchor = cm.posFromIndex(normalCursor(doc, firstInserted));
    const head = cm.posFromIndex(normalCursor(doc, lastInserted));
    vim.lastSelection?.anchorMark?.clear();
    vim.lastSelection?.headMark?.clear();
    vim.lastSelection = {anchor, head, anchorMark: cm.setBookmark(anchor), headMark: cm.setBookmark(head),
      visualMode: true, visualLine: selectionMode === 'line', visualBlock: selectionMode === 'block'};
  }
}

function put(cm, args) {
  const view = cm.cm6;
  if (!editors.has(view)) {
    if (!args.moveAfter) delegate(cm, args, args.after ? '<PgPasteAfter>' : '<PgPasteBefore>');
    return;
  }
  if (!writable(view)) return restorePrevious(cm);
  const register = Vim.getRegisterController().getRegister(args.registerName);
  if (args.registerName !== '+') {
    return applyPut(cm, args, {text: register.toString(), linewise: register.linewise, blockwise: register.blockwise});
  }
  const state = view.state;
  const previous = editors.get(view).before;
  const action = cm.state.vim.lastEditActionCommand;
  const macro = Vim.getVimGlobalState_().macroModeState;
  const replayOwner = macro.lastInsertModeChanges.changes;
  const fail = () => {
    if (!editors.has(view) || cm.state.vim.lastEditActionCommand !== action) return;
    restorePrevious(cm, previous, replayOwner);
    cm.openNotification(document.createTextNode(gettext('Unable to read the clipboard.')), {bottom: true});
  };
  if (!navigator.clipboard?.readText) return fail();
  let read;
  try { read = navigator.clipboard.readText(); }
  catch { return fail(); }
  read.then(text => {
    if (!writable(view) || view.state !== state || macro.lastInsertModeChanges.changes !== replayOwner || replayOwner.length) {
      if (editors.has(view) && cm.state.vim.lastEditActionCommand === action) restorePrevious(cm, previous, replayOwner);
      return;
    }
    applyPut(cm, args, {text, linewise: text === register.toString() ? register.linewise : text.endsWith('\n'), blockwise: false});
  }).catch(fail);
}

const pasteState = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.cm = getCM(view);
    editors.set(view, {});
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

/** Extend puts without replacing the existing Normal p/P commands. */
export default function vimPaste() {
  if (!registered) {
    Vim.defineAction('pgadminPut', put);
    Vim.defineAction('pgadminIndentPut', (cm, args) => {
      if (writable(cm.cm6)) delegate(cm, args, '<PgPasteIndent>');
      else restorePrevious(cm);
    });
    Vim.mapCommand('<PgPasteAfter>', 'action', 'paste', {after: true}, {isEdit: true});
    Vim.mapCommand('<PgPasteBefore>', 'action', 'paste', {after: false}, {isEdit: true});
    Vim.mapCommand('<PgPasteIndent>', 'action', 'paste', {after: false, matchIndent: true}, {isEdit: true});
    for (const context of ['normal', 'visual']) {
      for (const [key, after] of [['p', true], ['P', false]]) {
        Vim.mapCommand('g' + key, 'action', 'pgadminPut', {after, moveAfter: true}, {context, isEdit: true});
        if (context === 'visual') Vim.mapCommand(key, 'action', 'pgadminPut', {after}, {context, isEdit: true});
      }
    }
    for (const key of ['[P', ']P']) Vim.mapCommand(key, 'action', 'pgadminIndentPut', {}, {context: 'normal', isEdit: true});
    registered = true;
  }
  return pasteState;
}
