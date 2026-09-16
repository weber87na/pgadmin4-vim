/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { EditorSelection, Facet, findClusterBreak } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { Vim } from '@replit/codemirror-vim';
import { displayColumn, visualCells } from './vimTextColumns';
import vimInsertReplay, { insertPrevious } from './vimInsertReplay';

const enabled = Facet.define({combine: values => values.some(Boolean)});
let registered = false;

function editable(cm) {
  const view = cm.cm6;
  return view?.state.facet(enabled) && cm.state.vim?.insertMode &&
    !view.state.readOnly && view.state.facet(EditorView.editable);
}

function insert(cm, textForRange) {
  const view = cm.cm6;
  const state = view.state;
  const spec = state.changeByRange(range => {
    const text = textForRange(range);
    if (!text) return {range};
    let to = range.to;
    if (cm.state.overwrite && range.empty) {
      const line = state.doc.lineAt(range.from);
      let column = range.from - line.from;
      // Replace mode consumes complete characters on the current line. A
      // newline in the insertion splits its suffix; it never deletes the next
      // existing line or half of a Unicode character.
      for (let offset = 0; offset < text.length;) {
        if (text[offset] !== '\n' && column < line.text.length) {
          column = findClusterBreak(line.text, column, true);
        }
        offset = findClusterBreak(text, offset, true);
      }
      to = line.from + column;
    }
    return {changes: {from: range.from, to, insert: text},
      range: EditorSelection.cursor(range.from + text.length)};
  });
  if (!spec.changes.empty) view.dispatch({...spec, userEvent: 'input.type', scrollIntoView: true});
}

function adjacent(cm, args) {
  if (!editable(cm)) return;
  const state = cm.cm6.state;
  insert(cm, range => {
    const line = state.doc.lineAt(range.head);
    const number = line.number + args.direction;
    if (number < 1 || number > state.doc.lines) return '';
    const column = displayColumn(line.text, range.head - line.from, state.tabSize);
    return visualCells(state.doc.line(number).text, state.tabSize)
      .find(cell => cell.column <= column && cell.column + cell.width > column)?.text || '';
  });
}

function previous(cm, args) {
  if (!editable(cm)) return;
  insertPrevious(cm, args);
}

function breakUndo(cm) {
  if (!editable(cm)) return;
  cm.onBeforeEndOperation();
  const overwrite = cm.state.overwrite;
  const column = cm.getCursor().ch;
  // Start a new insertion at the same cursor so dot repeats only the text
  // entered after the undo boundary, rather than repeating a preceding c/o.
  delete cm.state.vim.insertModeRepeat;
  Vim.exitInsertMode(cm, true);
  cm.cm6.dispatch({annotations: isolateHistory.of('full')});
  const macro = Vim.getVimGlobalState_().macroModeState;
  if (macro.isRecording && !macro.isPlaying) {
    // Macro playback ends each recorded Insert segment with a normal Escape,
    // which moves left. Resume with a to recover this boundary's insertion
    // column (i at column zero). Replace entries already encode overwrites.
    Vim.getRegisterController().getRegister(macro.latestRegister).pushText(column > 0 ? 'a' : 'i');
  }
  Vim.handleKey(cm, overwrite ? 'R' : 'i', 'mapping');
}

export default function vimInsert() {
  if (!registered) {
    Vim.defineAction('pgadminInsertAdjacent', adjacent);
    Vim.defineAction('pgadminInsertPrevious', previous);
    Vim.defineAction('pgadminInsertUndoBreak', breakUndo);
    // Insert actions deliberately do not use isEdit: recording a second edit
    // command would discard the original i/c/o and its pending insertion text.
    Vim.mapCommand('<C-y>', 'action', 'pgadminInsertAdjacent', {direction: -1}, {context: 'insert'});
    Vim.mapCommand('<C-e>', 'action', 'pgadminInsertAdjacent', {direction: 1}, {context: 'insert'});
    Vim.mapCommand('<C-a>', 'action', 'pgadminInsertPrevious', {}, {context: 'insert'});
    Vim.mapCommand('<C-@>', 'action', 'pgadminInsertPrevious', {exit: true}, {context: 'insert'});
    Vim.mapCommand('<C-S-@>', 'action', 'pgadminInsertPrevious', {exit: true}, {context: 'insert'});
    Vim.mapCommand('<C-g>u', 'action', 'pgadminInsertUndoBreak', {}, {context: 'insert'});
    registered = true;
  }
  return [enabled.of(true), vimInsertReplay()];
}
