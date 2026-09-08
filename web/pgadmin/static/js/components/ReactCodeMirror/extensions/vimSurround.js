/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { Prec, Transaction } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { getCM, Vim } from '@replit/codemirror-vim';

const ADD = '<PgSurroundAdd>';
const DELETE = '<PgSurroundDelete>';
const CHANGE = '<PgSurroundChange>';
const FINISH = '<PgSurroundFinish>';
const editors = new WeakMap();
const delimiters = {
  '(': ['(', ')', true], ')': ['(', ')'],
  '[': ['[', ']', true], ']': ['[', ']'],
  '{': ['{', '}', true], '}': ['{', '}'],
  '"': ['"', '"'], '\'': ['\'', '\''], '`': ['`', '`'],
  b: ['(', ')'], B: ['{', '}'], r: ['[', ']'],
};
let registered = false;

function enabled(cm) {
  return editors.get(cm.cm6) && !cm.cm6.state.readOnly;
}

// @replit/codemirror-vim-core 0.1.0 (locked in yarn.lock) clears this shared
// replay buffer before invoking custom motions/operators. Its exported test
// hook is needed here because restoring only lastEditInputState loses the
// inserted text of a previous ciw/i edit when a surround is cancelled.
function replayState() {
  return Vim.getVimGlobalState_().macroModeState;
}

function copyReplay(replay) {
  return {
    ...replay,
    // Replay entries are strings, [text, offset] arrays, or immutable
    // InsertModeKey instances. Preserve those instances for native replay.
    changes: replay.changes.map(change => Array.isArray(change) ? change.slice() : change),
  };
}

function ownReplay(cm) {
  const state = editors.get(cm.cm6);
  if (!state) return;
  const macro = replayState();
  state.replayOwner = { macro, changes: macro.lastInsertModeChanges.changes };
}

function editSnapshot(cm) {
  const vim = cm.state.vim;
  const macro = replayState();
  return {
    input: vim.lastEditInputState, action: vim.lastEditActionCommand,
    macro, replay: copyReplay(macro.lastInsertModeChanges),
  };
}

function restoreEdit(cm, snapshot) {
  if (!snapshot) return;
  cm.state.vim.lastEditInputState = snapshot.input;
  cm.state.vim.lastEditActionCommand = snapshot.action;
  const state = editors.get(cm.cm6);
  const macro = replayState();
  const owner = state?.replayOwner;
  // Restore only the empty array cleared by this pending operation. Another
  // editor's later command replaces the array, and an ongoing insertion may
  // append to it; neither case belongs to this cancellation.
  if (snapshot.macro === macro && owner?.macro === macro &&
      owner.changes === macro.lastInsertModeChanges.changes && owner.changes.length === 0) {
    macro.lastInsertModeChanges = copyReplay(snapshot.replay);
  }
  if (state) state.replayOwner = null;
}

function cancel(cm, state) {
  if (!state?.pending) return;
  const { previous, cursor } = state.pending;
  state.pending = null;
  restoreEdit(cm, previous);
  cm.setCursor(cursor);
}

function applyChanges(cm, changes, cursor) {
  cm.cm6.dispatch({
    changes,
    selection: { anchor: cursor },
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input')],
    scrollIntoView: true,
  });
  return cm.posFromIndex(cursor);
}

function wrap(cm, ranges, delimiter, linewise) {
  const pair = delimiters[delimiter];
  if (!pair || !enabled(cm)) return;
  const doc = cm.cm6.state.doc;
  const changes = [];
  let cursor;
  for (const range of ranges) {
    let from = Math.min(cm.indexFromPos(range.anchor), cm.indexFromPos(range.head));
    let to = Math.max(cm.indexFromPos(range.anchor), cm.indexFromPos(range.head));
    if (linewise) {
      const selected = doc.sliceString(from, to);
      from += selected.match(/^[\t ]*/)[0].length;
      to -= selected.match(/[\t \n]*$/)[0].length;
    }
    if (from >= to) continue;
    const left = pair[0] + (pair[2] ? ' ' : '');
    const right = (pair[2] ? ' ' : '') + pair[1];
    changes.push({ from, insert: left }, { from: to, insert: right });
    if (cursor === undefined) cursor = from;
  }
  if (!changes.length) return;
  return applyChanges(cm, changes, cursor);
}

// Recognize SQL doubled quotes, backslash escapes and comments when finding
// brackets. This is deliberately bounded: HTML tags and custom pairs are not
// supported. Quotes may span lines, as PostgreSQL string literals can.
function surroundingPair(text, cursor, delimiter, repeat) {
  const pair = delimiters[delimiter];
  if (!pair) return;
  const stack = [];
  const matches = [];
  let quote = null;
  let quoteStart = 0;
  let commentDepth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (commentDepth) {
      if (ch === '/' && next === '*') { commentDepth++; i++; }
      else if (ch === '*' && next === '/') { commentDepth--; i++; }
      continue;
    }
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch !== quote) continue;
      if (next === quote) { i++; continue; }
      if (quote === pair[0] && quoteStart <= cursor && cursor <= i) {
        matches.push([quoteStart, i]);
      }
      quote = null;
      continue;
    }
    if (ch === '-' && next === '-') {
      const newline = text.indexOf('\n', i + 2);
      i = newline < 0 ? text.length : newline;
      continue;
    }
    if (ch === '/' && next === '*') { commentDepth++; i++; continue; }
    if (ch === '$') {
      const tag = text.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (tag) {
        const end = text.indexOf(tag, i + tag.length);
        i = end < 0 ? text.length : end + tag.length - 1;
        continue;
      }
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      quoteStart = i;
      continue;
    }
    if (ch === pair[0]) stack.push(i);
    else if (ch === pair[1] && stack.length) {
      const start = stack.pop();
      if (start <= cursor && cursor <= i) matches.push([start, i]);
    }
  }
  matches.sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]));
  return matches[repeat - 1];
}

function modify(cm, source, replacement, repeat) {
  if (!enabled(cm) || !delimiters[source] ||
      (replacement !== undefined && !delimiters[replacement])) return;
  const text = cm.cm6.state.doc.toString();
  const found = surroundingPair(text, cm.indexFromPos(cm.getCursor()), source, repeat);
  if (!found) return;
  const [start, end] = found;
  let innerStart = start + 1;
  let innerEnd = end;
  if (delimiters[source][2]) {
    while (innerStart < innerEnd && /[\t ]/.test(text[innerStart])) innerStart++;
    while (innerEnd > innerStart && /[\t ]/.test(text[innerEnd - 1])) innerEnd--;
  }
  const pair = delimiters[replacement];
  const left = pair ? pair[0] + (pair[2] ? ' ' : '') : '';
  const right = pair ? (pair[2] ? ' ' : '') + pair[1] : '';
  return applyChanges(cm, [
    { from: start, to: innerStart, insert: left },
    { from: innerEnd, to: end + 1, insert: right },
  ], start);
}

function registerCommands() {
  if (registered) return;
  registered = true;

  // `y`, `d`, and `c` are already native operators. An operator-pending `s`
  // motion delegates their suffix to unique API commands without replacing
  // those operators, so yy/dw/ciw and their counts remain native Vim behavior.
  Vim.defineOperator('pgSurroundAdd', (cm, args, ranges, oldAnchor) => {
    ownReplay(cm);
    if (!enabled(cm)) return oldAnchor;
    const state = editors.get(cm.cm6);
    // Native text objects use selectedCharacter for their own suffix (e.g.
    // the w in iw); only our saved delimiter denotes a completed surround.
    const delimiter = args.delimiter;
    if (delimiter) return wrap(cm, ranges, delimiter, args.linewise) || oldAnchor;
    state.pending = {
      args, ranges, cursor: oldAnchor, stage: 'delimiter',
      previous: state.pending?.previous || state.beforeKey,
    };
    Vim.handleKey(cm, FINISH, 'mapping');
    return oldAnchor;
  });
  Vim.mapCommand(ADD, 'operator', 'pgSurroundAdd', {}, { context: 'normal' });

  // Dispatch every operator-pending s, including the linewise yss shortcut.
  Vim.defineMotion('pgSurroundDispatch', (cm, head, args, vim, input) => {
    ownReplay(cm);
    const state = editors.get(cm.cm6);
    if (!enabled(cm)) {
      restoreEdit(cm, state?.beforeKey);
      return;
    }
    if (input.operator === 'pgSurroundAdd') {
      args.linewise = true;
      return { line: head.line + args.repeat - 1, ch: Infinity };
    }
    const prefix = { yank: ADD, delete: DELETE, change: CHANGE }[input.operator];
    if (!prefix) {
      restoreEdit(cm, state.beforeKey);
      return;
    }
    state.previous = state.beforeKey;
    state.pending = {
      stage: prefix === ADD ? 'motion' : 'delimiter',
      cursor: head,
      previous: state.previous,
    };
    Vim.handleKey(cm, (args.repeat > 1 ? String(args.repeat) : '') + prefix, 'mapping');
  });
  Vim.mapCommand('s', 'motion', 'pgSurroundDispatch', {}, { context: 'operatorPending' });

  Vim.defineAction('pgSurroundFinish', (cm, args) => {
    const state = editors.get(cm.cm6);
    if (!state?.pending) return;
    const pending = state.pending;
    if (!delimiters[args.selectedCharacter]) { cancel(cm, state); return; }
    state.pending = null;
    pending.args.delimiter = args.selectedCharacter;
    const cursor = wrap(cm, pending.ranges, pending.args.delimiter, pending.args.linewise);
    if (cursor) cm.setCursor(cursor);
    else restoreEdit(cm, pending.previous);
  });
  Vim.mapCommand(FINISH + '<character>', 'action', 'pgSurroundFinish', {}, {});

  Vim.defineAction('pgSurroundDelete', (cm, args) => {
    ownReplay(cm);
    const state = editors.get(cm.cm6);
    const previous = state?.pending?.previous || state?.beforeKey;
    if (state) state.pending = null;
    const cursor = modify(cm, args.selectedCharacter, undefined, args.repeat);
    if (cursor) cm.setCursor(cursor);
    else restoreEdit(cm, previous);
  });
  Vim.mapCommand(DELETE + '<character>', 'action', 'pgSurroundDelete', {}, { context: 'normal', isEdit: true });

  Vim.defineAction('pgSurroundChange', (cm, args) => {
    ownReplay(cm);
    const state = editors.get(cm.cm6);
    const previous = state?.pending?.previous || state?.beforeKey;
    if (state) state.pending = null;
    const cursor = modify(cm, args.source, args.selectedCharacter, args.repeat);
    if (cursor) cm.setCursor(cursor);
    else restoreEdit(cm, previous);
  });
  for (const source of Object.keys(delimiters)) {
    Vim.mapCommand(CHANGE + source + '<character>', 'action', 'pgSurroundChange', { source }, { context: 'normal', isEdit: true });
  }
  Vim.mapCommand('S', 'operator', 'pgSurroundAdd', {}, { context: 'visual' });
}

const surroundState = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.cm = getCM(view);
    editors.set(view, { pending: null });
    this.afterKey = () => {
      const state = editors.get(view);
      const input = this.cm.state.vim?.inputState;
      if (!state?.pending || !input) return;
      const buffer = input.keyBuffer.join('');
      const awaitingDelimiter = [FINISH, DELETE, CHANGE].some(prefix => buffer.startsWith(prefix));
      if (input.operator !== 'pgSurroundAdd' && !awaitingDelimiter) cancel(this.cm, state);
    };
    this.cm?.on('vim-keypress', this.afterKey);
  }
  update(update) {
    const state = editors.get(this.view);
    // An external edit invalidates captured positions. Our completed edit
    // clears pending before dispatching, so it does not enter this branch.
    if (update.docChanged && state.pending) {
      restoreEdit(getCM(this.view), state.pending.previous);
      state.pending = null;
    }
  }
  destroy() {
    this.cm?.off('vim-keypress', this.afterKey);
    editors.delete(this.view);
  }
});

const surroundEvents = Prec.highest(EditorView.domEventHandlers({
  keydown(event, view) {
    const cm = getCM(view);
    const state = editors.get(view);
    if (!cm?.state.vim || !state) return false;
    if (!cm.state.vim.insertMode) state.beforeKey = editSnapshot(cm);
    if (state.pending && (event.key === 'Escape' ||
        (event.ctrlKey && (event.key === '[' || event.key === 'c')))) {
      cancel(cm, state);
    }
    return false;
  },
  blur(event, view) {
    const cm = getCM(view);
    const state = editors.get(view);
    if (cm && state?.pending) {
      cancel(cm, state);
      // Abandon the native synthetic prefix too, so the next focused key is
      // interpreted as a new command instead of a missing surround suffix.
      Vim.handleKey(cm, '<Esc>', 'mapping');
    }
    return false;
  },
}));

/** Add alongside vim() only in editors where the Vim preference is enabled. */
export function vimSurround() {
  registerCommands();
  return [surroundState, surroundEvents];
}

export default vimSurround;
