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
import { Vim } from '@replit/codemirror-vim';
import gettext from 'sources/gettext';

const handlers = Facet.define({combine: values => values[0] || {}});
const pendingWrites = new WeakMap();
let registered = false;

function notify(cm, message) {
  cm.openNotification(document.createTextNode(message), {bottom: true});
}

function close(cm) {
  const view = cm.cm6;
  const handler = view?.state.facet(handlers).onClose;
  if (!handler) return notify(cm, gettext('Closing is not available in this editor.'));
  // The host owns its unsaved query, result data and transaction prompts.
  handler(view);
}

function write(cm, closeAfter=false, onlyIfDirty=false) {
  const view = cm.cm6;
  if (!view || !view.state.facet(EditorView.editable) || view.state.readOnly) return;
  const {onSave, onClose} = view.state.facet(handlers);
  if (closeAfter && !onClose) return notify(cm, gettext('Closing is not available in this editor.'));
  if (onlyIfDirty && view.isDirty?.() === false) return close(cm);
  if (!onSave) return notify(cm, gettext('Saving is not available in this editor.'));
  if (pendingWrites.has(view)) return notify(cm, gettext('A save is already in progress.'));
  const original = view.state.doc;
  const request = {};
  pendingWrites.set(view, request);
  let result;
  try {
    result = onSave(view);
  } catch {
    pendingWrites.delete(view);
    return notify(cm, gettext('The query could not be saved. The editor remains open.'));
  }
  if (!result || typeof result.then !== 'function') pendingWrites.delete(view);
  // Only an explicit successful completion may close a Query Tool. A cancelled
  // file picker, rejected request, or edit made during saving leaves it open.
  Promise.resolve(result).then(success => {
    if (closeAfter && success === true && !view.destroyed && !view.isDestroyed &&
        view.state.doc.eq(original) && view.state.facet(handlers).onClose) close(cm);
  }).catch(() => {
    if (!view.destroyed && !view.isDestroyed) notify(cm, gettext('The query could not be saved. The editor remains open.'));
  }).finally(() => {
    if (pendingWrites.get(view) === request) pendingWrites.delete(view);
  });
}

function navigate(cm, request) {
  const view = cm.cm6;
  const handler = view?.state.facet(handlers).onNavigate;
  if (!handler || handler(view, request) === false) {
    notify(cm, gettext('That Query Tool tab is not available in this tab group.'));
  }
}

function exNavigate(cm, params, direction, absolute=false) {
  const argument = params.argString?.trim() || '';
  if (params.line !== undefined || (argument && !/^[1-9]\d*$/.test(argument))) {
    return notify(cm, gettext('Use a positive tab number or count without a range.'));
  }
  if (direction === 'index' && !argument) return notify(cm, gettext('Use :buffer with a positive tab number.'));
  if (['first', 'last'].includes(direction) && argument) return notify(cm, gettext('This tab command does not accept a count.'));
  const count = argument ? Number(argument) : 1;
  if (!Number.isSafeInteger(count)) return notify(cm, gettext('Invalid tab number.'));
  navigate(cm, {direction: absolute && argument ? 'index' : direction, count});
}

export default function vimSave(onSave, onClose, onNavigate) {
  if (!registered) {
    Vim.defineEx('write', 'w', (cm, params) => {
      if (params.argString?.trim() || params.line !== undefined) {
        return notify(cm, gettext('Use :w to save the entire query. Choose a filename in the Save dialog.'));
      }
      write(cm);
    });
    Vim.defineEx('quit', 'q', (cm, params) => {
      if (params.line !== undefined || !['', '!'].includes(params.argString?.trim() || '')) {
        return notify(cm, gettext('Use :q to close this Query Tool through its confirmation dialogs.'));
      }
      close(cm);
    });
    for (const [name, prefix, onlyIfDirty] of [['wquit', 'wq', false], ['xit', 'x', true], ['exit', 'exi', true]]) {
      Vim.defineEx(name, prefix, (cm, params) => {
        if (params.line !== undefined || params.argString?.trim()) {
          return notify(cm, gettext('Save and close does not accept a range, filename or !.'));
        }
        write(cm, true, onlyIfDirty);
      });
    }
    Vim.defineAction('pgadminQueryClose', (cm, args) => args.save ? write(cm, true, true) : close(cm));
    Vim.mapCommand('ZZ', 'action', 'pgadminQueryClose', {save: true}, {context: 'normal'});
    Vim.mapCommand('ZQ', 'action', 'pgadminQueryClose', {save: false}, {context: 'normal'});
    Vim.defineAction('pgadminQueryTab', (cm, args) => navigate(cm, {
      direction: args.direction === 'next' && args.repeatIsExplicit ? 'index' : args.direction,
      count: Math.max(1, args.repeat || 1),
    }));
    Vim.mapCommand('gt', 'action', 'pgadminQueryTab', {direction: 'next'}, {context: 'normal'});
    Vim.mapCommand('gT', 'action', 'pgadminQueryTab', {direction: 'previous'}, {context: 'normal'});
    for (const [name, prefix, direction, absolute] of [
      ['bnext', 'bn', 'next'], ['bprevious', 'bp', 'previous'], ['bNext', 'bN', 'previous'],
      ['bfirst', 'bf', 'first'], ['blast', 'bl', 'last'], ['buffer', 'b', 'index', true],
      ['tabnext', 'tabn', 'next', true], ['tabprevious', 'tabp', 'previous'], ['tabNext', 'tabN', 'previous'],
      ['tabfirst', 'tabfir', 'first'], ['tablast', 'tabl', 'last'],
    ]) {
      Vim.defineEx(name, prefix, (cm, params) => exNavigate(cm, params, direction, absolute));
    }
    registered = true;
  }
  return handlers.of({onSave, onClose, onNavigate});
}
