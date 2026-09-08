/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { EditorSelection, Facet } from '@codemirror/state';
import {
  codeFolding, ensureSyntaxTree, foldable, foldedRanges, foldEffect, unfoldEffect,
} from '@codemirror/language';
import { Vim } from '@replit/codemirror-vim';

const foldingEnabled = Facet.define({combine: values => values.some(Boolean)});
let registered = false;

function closedFolds(state) {
  const folds = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    folds.push({from, to});
  });
  return folds;
}

function contains(outer, inner) {
  return outer.from <= inner.from && outer.to >= inner.to;
}

function onLine(range, line) {
  return range.from <= line.to && range.to > line.from;
}

function outerFirst(a, b) {
  return a.from - b.from || b.to - a.to;
}

function foldCandidates(state, line) {
  const ranges = [];
  // Asking the language's fold service also handles PL/pgSQL BEGIN/IF/LOOP
  // blocks, which cannot be inferred from braces or indentation alone.
  for (let number = line.number; number >= 1; number--) {
    const current = state.doc.line(number);
    const range = foldable(state, current.from, current.to);
    if (range && onLine(range, line)) ranges.push(range);
  }
  return ranges.sort((a, b) => -outerFirst(a, b));
}

function closeAt(state, line, closed, repeat) {
  let boundary = closed.filter(range => onLine(range, line)).sort(outerFirst)[0];
  const result = [];
  for (const range of foldCandidates(state, line)) {
    if (closed.some(item => item.from === range.from && item.to === range.to)) continue;
    // Repeated zc closes the next enclosing fold, never a hidden child.
    if (boundary && !contains(range, boundary)) continue;
    result.push(range);
    boundary = range;
    if (result.length >= repeat) break;
  }
  return result;
}

function openAt(line, closed, repeat) {
  const root = closed.filter(range => onLine(range, line)).sort(outerFirst)[0];
  if (!root) return [];
  const descendants = closed.filter(range => contains(root, range)).sort(outerFirst);
  const ancestors = [];
  return descendants.filter(range => {
    while (ancestors.length && !contains(ancestors[ancestors.length - 1], range)) {
      ancestors.pop();
    }
    const depth = ancestors.length;
    ancestors.push(range);
    return depth < repeat;
  });
}

function applyFolds(view, ranges, opening) {
  if (!ranges.length) return;
  const spec = {effects: ranges.map(range => (opening ? unfoldEffect : foldEffect).of(range))};
  if (!opening) {
    const state = view.state;
    // A cursor inside a newly closed fold must remain visible. Preserve all
    // other cursors/selections; in particular, never mutate EditorState.
    const selections = state.selection.ranges.map(selection => {
      if (!selection.empty) return selection;
      const enclosing = ranges.filter(range => range.from < selection.head && range.to >= selection.head)
        .sort(outerFirst)[0];
      if (!enclosing) return selection;
      const line = state.doc.lineAt(enclosing.from);
      return EditorSelection.cursor(line.from + line.text.search(/\S|$/));
    });
    if (selections.some((selection, index) => selection !== state.selection.ranges[index])) {
      spec.selection = EditorSelection.create(selections, state.selection.mainIndex);
    }
  }
  view.dispatch(spec);
}

function runFolding(cm, args) {
  const view = cm.cm6;
  if (!view || !view.state.facet(foldingEnabled)) return;
  const state = view.state;
  const closed = closedFolds(state);
  const line = state.doc.lineAt(state.selection.main.head);
  const repeat = Math.max(1, args.repeat || 1);
  let opening = args.operation === 'open' || args.operation === 'openAll';
  let ranges;
  if (args.operation === 'openAll') {
    ranges = closed;
  } else if (args.operation === 'closeAll') {
    ensureSyntaxTree(state, state.doc.length, 100);
    ranges = [];
    for (let number = 1; number <= state.doc.lines; number++) {
      const current = state.doc.line(number);
      const range = foldable(state, current.from, current.to);
      if (range) ranges.push(range);
    }
  } else {
    if (args.operation === 'toggle') opening = closed.some(range => onLine(range, line));
    ranges = opening ? openAt(line, closed, repeat) : closeAt(state, line, closed, repeat);
  }
  applyFolds(view, ranges, opening);
}

/** Add the Vim fold commands missing from codemirror-vim-core 0.1.0. */
export default function vimFolding(enabled = true) {
  if (!registered) {
    Vim.defineAction('pgadminFold', runFolding);
    for (const [keys, operation] of Object.entries({
      zc: 'close', zo: 'open', za: 'toggle', zM: 'closeAll', zR: 'openAll',
    })) {
      Vim.mapCommand(keys, 'action', 'pgadminFold', {operation}, {context: 'normal'});
    }
    registered = true;
  }
  // Vim's command registry is shared, but each action is enabled only in
  // editors that install this extension. Folding also works in read-only SQL.
  return [foldingEnabled.of(enabled), enabled ? codeFolding() : []];
}
