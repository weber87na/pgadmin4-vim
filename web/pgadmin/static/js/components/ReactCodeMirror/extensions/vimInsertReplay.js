/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { EditorSelection, findClusterBreak } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { CodeMirror, getCM, Vim } from '@replit/codemirror-vim';

const editors = new WeakMap();

function copyChanges(changes) {
  // Preserve InsertModeKey prototypes: the core's dot/macro player uses
  // instanceof to distinguish deletion keys from replacement arrays.
  return changes.map(change => Array.isArray(change) ? [...change] : change);
}

function insertText(cm, text) {
  const view = cm.cm6;
  const state = view.state;
  view.dispatch({...state.changeByRange(range => {
    let to = range.to;
    if (cm.state.overwrite && range.empty && text !== '\n') {
      const line = state.doc.lineAt(to);
      to = line.from + findClusterBreak(line.text, to - line.from, true);
    }
    return {changes: {from: range.from, to, insert: text},
      range: EditorSelection.cursor(range.from + text.length)};
  }), userEvent: 'input.type', scrollIntoView: true});
}

function replayText(cm, text, changes) {
  if (!cm.state.overwrite) {
    insertText(cm, text);
    changes.push(text);
    return;
  }
  for (let from = 0; from < text.length;) {
    const to = findClusterBreak(text, from, true);
    const character = text.slice(from, to);
    insertText(cm, character);
    changes.push(character === '\n' ? character : [character]);
    from = to;
  }
}

function replayKey(cm, key, changes) {
  let recorded = key;
  // In Replace mode Backspace moves left. Record a Left key so the engine's
  // later dot/macro replay also moves instead of deleting an existing cell.
  if (cm.state.overwrite && /Backspace/.test(key.keyName)) {
    recorded = Object.assign(Object.create(Object.getPrototypeOf(key)), key, {keyName: 'Left'});
  }
  CodeMirror.lookupKey(recorded.keyName, 'vim-insert', binding => {
    if (typeof binding === 'string') CodeMirror.commands[binding](cm);
    else binding(cm);
    return true;
  });
  changes.push(recorded);
}

/** Repeat a completed insertion without serializing deletion keys as text. */
export function insertPrevious(cm, {exit = false} = {}) {
  const item = editors.get(cm);
  const view = cm.cm6;
  if (!item || !cm.state.vim?.insertMode || view.state.readOnly ||
      !view.state.facet(EditorView.editable)) return;
  const previous = copyChanges(item.previous);
  if (!previous.length) return;

  // The adapter batches notifications within an operation. Flush the prefix
  // before suppressing replay notifications, otherwise it would be omitted.
  cm.onBeforeEndOperation();
  const macro = Vim.getVimGlobalState_().macroModeState;
  const playing = macro.isPlaying;
  const changes = [];
  macro.isPlaying = true;
  try {
    for (const change of previous) {
      if (typeof change === 'string') replayText(cm, change, changes);
      else if (change && typeof change.keyName === 'string') replayKey(cm, change, changes);
      else if (Array.isArray(change)) {
        // A plain array records Replace-mode text. Repeat it using the current
        // mode; an insertion after R must not overwrite the new target.
        if (!change[1]) replayText(cm, change[0], changes);
        else {
          const start = cm.getCursor();
          cm.replaceRange(change[0], start, start);
          cm.setCursor({line: start.line, ch: start.ch + change[0].length - change[1]});
          changes.push([...change]);
        }
      }
      cm.onBeforeEndOperation();
    }
  } finally {
    cm.onBeforeEndOperation();
    macro.isPlaying = playing;
  }
  if (!playing) {
    const current = macro.lastInsertModeChanges;
    if (current.maybeReset) {
      current.changes = [];
      current.maybeReset = false;
    }
    current.changes.push(...changes);
    current.expectCursorActivityForChange = false;
  }
  if (exit) Vim.exitInsertMode(cm);
}

const rememberInsert = ViewPlugin.fromClass(class {
  constructor(view) {
    this.cm = getCM(view);
    this.inserting = !!this.cm.state.vim?.insertMode;
    this.previous = [];
    editors.set(this.cm, this);
    this.overwriteSelection = this.cm.overWriteSelection;
    this.batchedOverwrite = (...args) => this.cm.operation(() => {
      // The adapter selects the old cell before inserting its replacement.
      // Keep both transactions in one Vim operation, otherwise that temporary
      // selection resets the insertion recorder before every typed character.
      this.cm.curOp.isVimOp = true;
      return this.overwriteSelection.apply(this.cm, args);
    });
    this.cm.overWriteSelection = this.batchedOverwrite;
    this.beforeInput = event => {
      if (event.type === 'keydown' && event.key === 'Backspace' && this.cm.state.overwrite) {
        // The adapter implements Replace Backspace as a cursor movement. It
        // belongs to this insertion, unlike an ordinary arrow-key movement.
        Vim.getVimGlobalState_().macroModeState.lastInsertModeChanges.expectCursorActivityForChange = true;
      }
    };
    this.cm.on('inputEvent', this.beforeInput);
    this.modeChange = () => {
      const inserting = !!this.cm.state.vim?.insertMode;
      if (this.inserting && !inserting) {
        const changes = Vim.getVimGlobalState_().macroModeState.lastInsertModeChanges.changes;
        // Visiting Insert without typing must not erase the last useful entry.
        if (changes.length) this.previous = copyChanges(changes);
      }
      this.inserting = inserting;
    };
    this.cm.on('vim-mode-change', this.modeChange);
  }

  destroy() {
    this.cm.off('vim-mode-change', this.modeChange);
    this.cm.off('inputEvent', this.beforeInput);
    if (this.cm.overWriteSelection === this.batchedOverwrite) {
      this.cm.overWriteSelection = this.overwriteSelection;
    }
    editors.delete(this.cm);
  }
});

export default function vimInsertReplay() {
  return rememberInsert;
}
