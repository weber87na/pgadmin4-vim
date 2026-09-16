/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { StateEffect, StateField } from '@codemirror/state';
import { Vim } from '@replit/codemirror-vim';
import gettext from 'sources/gettext';

const selectChange = StateEffect.define();
const changes = StateField.define({
  create: () => ({positions: [], index: 0}),
  update(value, transaction) {
    if (transaction.isUserEvent('document.replace')) return {positions: [], index: 0};
    let positions = value.positions;
    let index = value.index;
    if (transaction.docChanged) {
      positions = positions.map(position => transaction.changes.mapPos(position, -1));
      // Programmatic updates and undo/redo map existing locations, but do not
      // invent another user edit. Each transaction contributes one position.
      if (transaction.isUserEvent('input') || transaction.isUserEvent('delete') || transaction.isUserEvent('move')) {
        let position;
        transaction.changes.iterChanges((_from, _to, from) => { position ??= from; });
        if (position !== undefined) {
          const previous = positions[positions.length - 1];
          const line = transaction.newDoc.lineAt(position);
          if (previous !== undefined && transaction.newDoc.lineAt(previous).number === line.number &&
              Math.abs(previous - position) < 79) positions.pop();
          positions.push(position);
          if (positions.length > 100) positions.shift();
          index = positions.length;
        }
      }
    }
    for (const effect of transaction.effects) {
      if (effect.is(selectChange)) index = effect.value;
    }
    return {positions, index};
  },
});
let registered = false;

function notify(cm, message) {
  cm.openNotification(document.createTextNode(message), {bottom: true});
}

function navigate(cm, args) {
  const view = cm.cm6;
  const list = view?.state.field(changes, false);
  if (!list) return;
  if (!list.positions.length) return notify(cm, gettext('Change list is empty.'));
  const direction = args.forward ? 1 : -1;
  const index = Math.max(0, Math.min(list.positions.length - 1, list.index + direction * Math.max(1, args.repeat || 1)));
  if (index === list.index || (args.forward && list.index === list.positions.length)) {
    return notify(cm, gettext('No more changes in this direction.'));
  }
  let position = list.positions[index];
  const line = view.state.doc.lineAt(position);
  position = Math.min(position, Math.max(line.from, line.to - 1));
  // Do not leave a Normal cursor between a UTF-16 surrogate pair.
  if (position > line.from && /[\uDC00-\uDFFF]/.test(view.state.sliceDoc(position, position + 1))) position--;
  view.dispatch({selection: {anchor: position}, effects: selectChange.of(index), scrollIntoView: true});
}

export default function vimChanges() {
  if (!registered) {
    Vim.defineAction('pgadminChangePosition', navigate);
    Vim.mapCommand('g;', 'action', 'pgadminChangePosition', {forward: false}, {context: 'normal'});
    Vim.mapCommand('g,', 'action', 'pgadminChangePosition', {forward: true}, {context: 'normal'});
    Vim.defineEx('changes', 'changes', (cm, params) => {
      const view = cm.cm6;
      const list = view?.state.field(changes, false);
      if (!list) return;
      if (params.line !== undefined || params.argString?.trim()) return notify(cm, gettext('Use :changes without a range or arguments.'));
      const output = document.createElement('pre');
      output.style.maxHeight = '16em';
      output.style.overflow = 'auto';
      output.textContent = gettext('change  line  col  text') + '\n' + list.positions.map((position, index) => {
        const line = view.state.doc.lineAt(position);
        return `${index === list.index ? '>' : ' '} ${Math.abs(index - list.index)}  ${line.number}  ${position - line.from}  ${line.text.slice(0, 120)}`;
      }).join('\n') + (list.index === list.positions.length ? '\n>' : '');
      cm.openNotification(output, {bottom: true});
    });
    registered = true;
  }
  return changes;
}
