/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { Facet } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { Vim } from '@replit/codemirror-vim';
import gettext from 'sources/gettext';

const enabled = Facet.define({combine: values => values.some(Boolean)});
let registered = false;

// Destination addresses are one-based; zero means before the first line.
// Source ranges are parsed by the Vim engine (including visual marks and %).
function destination(cm, input) {
  const match = /^(\d+|\.|\$|'[a-zA-Z<>])?((?:\s*[+-]\s*\d*)*)$/.exec(input);
  if (!input || !match) return NaN;
  const base = match[1];
  let number;
  if (!base || base === '.') number = cm.getCursor().line + 1;
  else if (base === '$') number = cm.lastLine() + 1;
  else if (base.startsWith('\'')) number = (cm.state.vim.marks[base[1]]?.find()?.line ?? NaN) + 1;
  else number = Number(base);
  for (const offset of match[2].matchAll(/([+-])\s*(\d*)/g)) {
    number += (offset[1] === '+' ? 1 : -1) * Number(offset[2] || 1);
  }
  return number;
}

function lineCommand(cm, params, moving) {
  const view = cm.cm6;
  if (!view || !view.state.facet(enabled)) return;
  const state = view.state;
  const notify = message => cm.openNotification(document.createTextNode(message), {bottom: true});
  if (state.readOnly || !state.facet(EditorView.editable)) {
    notify(gettext('This editor is read-only.'));
    return;
  }
  const start = (params.selectionLine ?? cm.getCursor().line) + 1;
  const end = (params.selectionLineEnd ?? start - 1) + 1;
  const target = destination(cm, params.argString?.trim() || '');
  if (![start, end, target].every(Number.isSafeInteger) || start < 1 || end < start ||
      end > state.doc.lines || target < 0 || target > state.doc.lines) {
    notify(gettext('Invalid line range or destination. Use a line number, ., $, or a mark, with optional + or - offsets.'));
    return;
  }
  if (moving && target >= start && target < end) {
    notify(gettext('Cannot move lines into themselves.'));
    return;
  }
  const count = end - start + 1;
  const lastLine = moving && target >= start ? target : target + count;
  const noChange = moving && (target === start - 1 || target === end);
  const block = state.sliceDoc(state.doc.line(start).from, state.doc.line(end).to);
  const changes = [];
  if (!noChange) {
    const atEnd = target === state.doc.lines;
    changes.push({
      from: atEnd ? state.doc.length : state.doc.line(target + 1).from,
      insert: atEnd ? '\n' + block : block + '\n',
    });
    if (moving) {
      const endsDocument = end === state.doc.lines;
      changes.push({
        from: state.doc.line(start).from - (endsDocument ? 1 : 0),
        to: endsDocument ? state.doc.length : state.doc.line(end + 1).from,
      });
    }
  }
  const changeSet = state.changes(changes);
  const newDoc = changeSet.apply(state.doc);
  const line = newDoc.line(lastLine);
  // Bookmarks in moved lines must follow their text, not the deletion boundary.
  const marks = moving && !noChange ? Object.entries(cm.state.vim.marks).flatMap(([name, mark]) => {
    const position = mark.find();
    return position && position.line >= start - 1 && position.line < end
      ? [{name, mark, position: {line: lastLine - count + position.line - start + 1, ch: position.ch}}] : [];
  }) : [];
  view.dispatch({
    changes: changeSet,
    selection: {anchor: line.from + line.text.search(/\S|$/)},
    annotations: isolateHistory.of('full'),
    userEvent: 'input',
    scrollIntoView: true,
  });
  for (const {name, mark, position} of marks) {
    mark.clear();
    cm.state.vim.marks[name] = cm.setBookmark(position);
  }
}

export default function vimExLines() {
  if (!registered) {
    Vim.defineEx('copy', 'co', (cm, params) => lineCommand(cm, params, false));
    Vim.defineEx('t', 't', (cm, params) => lineCommand(cm, params, false));
    // The core uses exCommands.move internally for :42 line jumps. Register
    // a distinct implementation name whose valid prefixes include m..move.
    Vim.defineEx('movelines', 'm', (cm, params) => lineCommand(cm, params, true));
    registered = true;
  }
  return enabled.of(true);
}
