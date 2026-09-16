/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getCM, Vim, vim } from '@replit/codemirror-vim';
import vimSave from 'sources/components/ReactCodeMirror/extensions/vimSave';

describe('Vim Query Tool lifecycle', () => {
  let views;
  function create(onSave=jest.fn(), onClose=jest.fn(), onNavigate=jest.fn(), extra=[]) {
    const compartment = new Compartment();
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new EditorView({parent, state: EditorState.create({doc: 'SELECT 1;',
      extensions: [vim(), compartment.of(vimSave(onSave, onClose, onNavigate)), extra]})});
    views.push(view);
    return {view, onSave, onClose, onNavigate, compartment};
  }
  function keys(view, sequence) {
    for (const key of sequence.match(/<[^>]+>|./g)) Vim.handleKey(getCM(view), key, 'user');
  }
  const ex = (view, command) => Vim.handleEx(getCM(view), command);
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  beforeEach(() => { views = []; Vim.resetVimGlobalState_(); });
  afterEach(() => {
    for (const view of views) { const parent = view.dom.parentElement; view.destroy(); parent?.remove(); }
  });

  it.each(['q', 'quit', 'q!'])('routes :%s through the originating close callback', command => {
    const first = create();
    const second = create();
    ex(first.view, command);
    expect(first.onClose).toHaveBeenCalledWith(first.view);
    expect(first.onSave).not.toHaveBeenCalled();
    expect(second.onClose).not.toHaveBeenCalled();
  });

  it.each(['wq', 'wquit', 'x', 'xit', 'exit'])('waits for its successful save before :%s closes', async command => {
    let resolve;
    const editor = create(jest.fn(() => new Promise(done => { resolve = done; })));
    ex(editor.view, command);
    expect(editor.onSave).toHaveBeenCalledWith(editor.view);
    expect(editor.onClose).not.toHaveBeenCalled();
    resolve(true);
    await flush();
    expect(editor.onClose).toHaveBeenCalledWith(editor.view);
  });

  it.each([false, undefined])('keeps the tab open unless save confirms success (%s)', async result => {
    const editor = create(jest.fn(() => Promise.resolve(result)));
    ex(editor.view, 'wq');
    await flush();
    expect(editor.onClose).not.toHaveBeenCalled();
  });

  it('keeps the tab open after a rejected save and permits a later retry', async () => {
    const editor = create(jest.fn().mockRejectedValueOnce(Error('network')).mockResolvedValueOnce(true));
    ex(editor.view, 'wq');
    await flush();
    expect(editor.onClose).not.toHaveBeenCalled();
    expect(editor.view.dom.textContent).toContain('could not be saved');
    ex(editor.view, 'wq');
    await flush();
    expect(editor.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when text changes during a save', async () => {
    let resolve;
    const editor = create(() => new Promise(done => { resolve = done; }));
    ex(editor.view, 'wq');
    editor.view.dispatch({changes: {from: 0, insert: '-- new edit\n'}});
    resolve(true);
    await flush();
    expect(editor.onClose).not.toHaveBeenCalled();
  });

  it('deduplicates a pending write and never turns a plain write into a later quit', async () => {
    let resolve;
    const editor = create(jest.fn(() => new Promise(done => { resolve = done; })));
    ex(editor.view, 'w');
    ex(editor.view, 'wq');
    expect(editor.onSave).toHaveBeenCalledTimes(1);
    resolve(true);
    await flush();
    expect(editor.onClose).not.toHaveBeenCalled();
  });

  it('does not close a destroyed editor when a save completes', async () => {
    let resolve;
    const editor = create(() => new Promise(done => { resolve = done; }));
    ex(editor.view, 'wq');
    editor.view.destroy();
    resolve(true);
    await flush();
    expect(editor.onClose).not.toHaveBeenCalled();
  });

  it('uses ZZ for conditional save and ZQ for the guarded close workflow', async () => {
    const editor = create(jest.fn(() => Promise.resolve(true)));
    editor.view.isDirty = () => false;
    keys(editor.view, 'ZZ');
    expect(editor.onSave).not.toHaveBeenCalled();
    expect(editor.onClose).toHaveBeenCalledTimes(1);
    editor.view.isDirty = () => true;
    keys(editor.view, 'ZZ');
    await flush();
    expect(editor.onSave).toHaveBeenCalledTimes(1);
    expect(editor.onClose).toHaveBeenCalledTimes(2);
    keys(editor.view, 'ZQ');
    expect(editor.onSave).toHaveBeenCalledTimes(1);
    expect(editor.onClose).toHaveBeenCalledTimes(3);
  });

  it.each(['1,2wq', 'wq output.sql', 'wq!', 'q other', '1q'])('rejects unsupported :%s', async command => {
    const editor = create();
    ex(editor.view, command);
    await flush();
    expect(editor.onSave).not.toHaveBeenCalled();
    expect(editor.onClose).not.toHaveBeenCalled();
  });

  it.each([EditorState.readOnly.of(true), EditorView.editable.of(false)])('blocks writes in locked editors', async lock => {
    const editor = create(jest.fn(() => true), jest.fn(), jest.fn(), lock);
    ex(editor.view, 'wq');
    keys(editor.view, 'ZZ');
    await flush();
    expect(editor.onSave).not.toHaveBeenCalled();
    expect(editor.onClose).not.toHaveBeenCalled();
    ex(editor.view, 'q');
    expect(editor.onClose).toHaveBeenCalledTimes(1);
  });

  it('explains missing host callbacks without saving first', () => {
    const editor = create(jest.fn(), null, null);
    ex(editor.view, 'wq');
    expect(editor.onSave).not.toHaveBeenCalled();
    expect(editor.view.dom.textContent).toContain('Closing is not available');
    keys(editor.view, 'gt');
    expect(editor.view.dom.textContent).toContain('tab is not available');
  });

  it('uses current per-view callbacks after reconfiguration', () => {
    const editor = create();
    const updatedClose = jest.fn();
    const updatedNavigate = jest.fn();
    editor.view.dispatch({effects: editor.compartment.reconfigure(vimSave(editor.onSave, updatedClose, updatedNavigate))});
    ex(editor.view, 'q');
    keys(editor.view, 'gt');
    expect(editor.onClose).not.toHaveBeenCalled();
    expect(editor.onNavigate).not.toHaveBeenCalled();
    expect(updatedClose).toHaveBeenCalledWith(editor.view);
    expect(updatedNavigate).toHaveBeenCalledWith(editor.view, {direction: 'next', count: 1});
  });

  it.each([
    ['gt', 'next', 1], ['gT', 'previous', 1], ['3gt', 'index', 3], ['3gT', 'previous', 3],
  ])('maps %s to the appropriate query tab', (sequence, direction, count) => {
    const editor = create();
    keys(editor.view, sequence);
    expect(editor.onNavigate).toHaveBeenCalledWith(editor.view, {direction, count});
  });

  it.each([
    ['bn', 'next', 1], ['bnext 2', 'next', 2], ['bp 2', 'previous', 2], ['bN', 'previous', 1],
    ['bf', 'first', 1], ['bl', 'last', 1], ['b 3', 'index', 3],
    ['tabn', 'next', 1], ['tabnext 3', 'index', 3], ['tabp 2', 'previous', 2],
    ['tabN', 'previous', 1], ['tabfirst', 'first', 1], ['tablast', 'last', 1],
  ])('maps :%s to query tab navigation', (command, direction, count) => {
    const editor = create();
    ex(editor.view, command);
    expect(editor.onNavigate).toHaveBeenCalledWith(editor.view, {direction, count});
  });

  it.each(['tabn 0', 'tabn -1', 'bn output.sql', '1,2bn', 'tabn 99999999999999999', 'buffer', 'tabfirst 3'])('rejects invalid :%s', command => {
    const editor = create();
    ex(editor.view, command);
    expect(editor.onNavigate).not.toHaveBeenCalled();
  });
});
