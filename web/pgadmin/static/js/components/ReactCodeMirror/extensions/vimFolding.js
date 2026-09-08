/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { EditorSelection, Facet, StateEffect, StateField } from '@codemirror/state';
import {
  codeFolding, ensureSyntaxTree, foldable, foldedRanges, foldEffect, unfoldEffect,
} from '@codemirror/language';
import { Vim } from '@replit/codemirror-vim';
import gettext from 'sources/gettext';

const foldingEnabled = Facet.define({combine: values => values.some(Boolean)});
const setLevel = StateEffect.define();
const foldLevel = StateField.define({
  create: () => Infinity,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setLevel)) value = effect.value;
    }
    return value;
  },
});
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

function closeAt(state, line, closed, repeat, candidates = foldCandidates(state, line)) {
  let boundary = closed.filter(range => onLine(range, line)).sort(outerFirst)[0];
  const result = [];
  for (const range of candidates) {
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

function allFolds(state) {
  ensureSyntaxTree(state, state.doc.length, 100);
  const ranges = [];
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    const range = foldable(state, line.from, line.to);
    if (range) ranges.push(range);
  }
  const ancestors = [];
  return ranges.sort(outerFirst).map(range => {
    while (ancestors.length && !contains(ancestors[ancestors.length - 1], range)) ancestors.pop();
    ancestors.push(range);
    return {...range, depth: ancestors.length};
  });
}

function applyFolds(view, ranges, opening, effects = []) {
  if (!ranges.length && !effects.length) return;
  const spec = {effects: [...effects, ...ranges.map(range => (opening ? unfoldEffect : foldEffect).of(range))]};
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

// A selected closed fold represents its entire displayed line, including the
// hidden text. Expand only the end; containing folds are still found by overlap.
function rangeFolds(state, start, end, opening, recursive) {
  const closed = closedFolds(state);
  for (const range of closed) {
    const first = state.doc.lineAt(range.from).number;
    if (first >= start && first <= end) end = Math.max(end, state.doc.lineAt(range.to).number);
  }
  const overlaps = range => state.doc.lineAt(range.from).number <= end &&
    state.doc.lineAt(range.to).number >= start;
  if (opening) {
    const matching = closed.filter(overlaps).sort(outerFirst);
    if (recursive) return matching;
    // A single-level open must not also remove hidden descendants.
    const roots = [];
    for (const range of matching) {
      if (!roots.some(root => contains(root, range))) roots.push(range);
    }
    return roots;
  }
  const available = allFolds(state).filter(overlaps);
  if (recursive) return available;
  const result = [];
  for (let number = start; number <= end; number++) {
    const line = state.doc.line(number);
    const candidates = available.filter(range => onLine(range, line)).sort((a, b) => -outerFirst(a, b));
    const ranges = closeAt(state, line, [...closed, ...result], 1, candidates);
    result.push(...ranges);
    // Walk visible lines only. Do not close the same fold or its hidden
    // descendants again just because several selected lines were inside it.
    const covering = [...closed, ...ranges].filter(range => onLine(range, line)).sort(outerFirst)[0];
    if (covering) number = Math.max(number, state.doc.lineAt(covering.to).number);
  }
  return result;
}

function visualFolding(cm, args) {
  const view = cm.cm6;
  if (!view || !view.state.facet(foldingEnabled)) return;
  const {anchor, head} = cm.state.vim.sel;
  const start = Math.min(anchor.line, head.line) + 1;
  const end = Math.max(anchor.line, head.line) + 1;
  // Retain Vim's last selection/marks for gv, and remove block selections
  // before closing folds so the resulting Normal cursor can stay visible.
  const ranges = rangeFolds(view.state, start, end, args.opening, args.recursive);
  Vim.exitVisualMode(cm);
  applyFolds(view, ranges, args.opening);
}

function exFolding(cm, params, opening) {
  const view = cm.cm6;
  if (!view || !view.state.facet(foldingEnabled)) return;
  const start = (params.selectionLine ?? cm.getCursor().line) + 1;
  const end = (params.selectionLineEnd ?? start - 1) + 1;
  const argument = params.argString?.trim() || '';
  if (![start, end].every(Number.isSafeInteger) || start < 1 || end < start ||
      end > view.state.doc.lines || !/^!?$/.test(argument)) {
    cm.openNotification(document.createTextNode(gettext('Invalid fold range or argument. Use :[range]foldopen[!] or :[range]foldclose[!].')), {bottom: true});
    return;
  }
  applyFolds(view, rangeFolds(view.state, start, end, opening, argument === '!'), opening);
}

function runFolding(cm, args) {
  const view = cm.cm6;
  if (!view || !view.state.facet(foldingEnabled)) return;
  const state = view.state;
  const closed = closedFolds(state);
  const line = state.doc.lineAt(state.selection.main.head);
  const repeat = Math.max(1, args.repeat || 1);
  let opening = args.operation === 'open' || args.operation === 'openRecursive';
  let ranges;
  if (['openAll', 'closeAll', 'more', 'less', 'refresh', 'refreshView'].includes(args.operation)) {
    const available = allFolds(state);
    const maximum = available.reduce((max, range) => Math.max(max, range.depth), 0);
    const previous = state.field(foldLevel);
    const level = args.operation === 'openAll' ? maximum
      : args.operation === 'closeAll' ? 0
        : args.operation === 'more' ? Math.max(0, (Number.isFinite(previous) ? previous : maximum) - repeat)
          : args.operation === 'less' ? (Number.isFinite(previous) ? previous : maximum) + repeat
            : previous;
    // Reset manual overrides to the requested level in the same transaction.
    applyFolds(view, available.filter(range => range.depth > level &&
      (args.operation !== 'refreshView' || !onLine(range, line))), false,
    [...closed.map(range => unfoldEffect.of(range)), setLevel.of(level)]);
    return;
  } else if (args.operation === 'view') {
    opening = true;
    ranges = closed.filter(range => onLine(range, line));
  } else if (args.operation === 'closeRecursive') {
    ranges = foldCandidates(state, line);
  } else if (args.operation === 'openRecursive') {
    ranges = openAt(line, closed, Infinity);
  } else if (args.operation === 'toggleRecursive') {
    opening = closed.some(range => onLine(range, line));
    if (opening) {
      ranges = openAt(line, closed, Infinity);
    } else {
      const root = foldCandidates(state, line)[0];
      ranges = root ? allFolds(state).filter(range => contains(root, range)) : [];
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
      zC: 'closeRecursive', zO: 'openRecursive', zA: 'toggleRecursive', zm: 'more', zr: 'less',
      zv: 'view', zx: 'refreshView', zX: 'refresh',
    })) {
      Vim.mapCommand(keys, 'action', 'pgadminFold', {operation}, {context: 'normal'});
    }
    Vim.defineAction('pgadminVisualFold', visualFolding);
    for (const [keys, opening, recursive] of [
      ['zo', true, false], ['zc', false, false], ['zO', true, true], ['zC', false, true],
    ]) {
      Vim.mapCommand(keys, 'action', 'pgadminVisualFold', {opening, recursive}, {context: 'visual'});
    }
    Vim.defineEx('foldopen', 'foldo', (cm, params) => exFolding(cm, params, true));
    Vim.defineEx('foldclose', 'foldc', (cm, params) => exFolding(cm, params, false));
    registered = true;
  }
  // Vim's command registry is shared, but each action is enabled only in
  // editors that install this extension. Folding also works in read-only SQL.
  return [foldingEnabled.of(enabled), enabled ? [codeFolding(), foldLevel] : []];
}
