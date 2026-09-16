/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history } from '@codemirror/commands';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import vimInsertReplay, {insertPrevious} from 'sources/components/ReactCodeMirror/extensions/vimInsertReplay';

describe('Vim previous insertion replay', () => {
  let views;

  function editor(doc = '', extensions = []) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({parent, state: EditorState.create({
      doc, extensions: [vim(), history(), keymap.of(defaultKeymap), vimInsertReplay(), extensions],
    })});
    views.push({view, parent});
    view.focus();
    return view;
  }

  function press(view, sequence) {
    view.focus();
    for (const token of sequence.match(/<[^>]+>|./gu) || []) {
      const named = {'<Esc>': 'Escape', '<BS>': 'Backspace', '<Del>': 'Delete', '<CR>': 'Enter'};
      const ctrlKey = token.startsWith('<C-');
      const key = named[token] || (ctrlKey ? token.slice(3, -1) : token);
      const event = new KeyboardEvent('keydown', {
        key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
        keyCode: key === 'Escape' ? 27 : key === 'Enter' ? 13 : key.toUpperCase().charCodeAt(0),
        ctrlKey, shiftKey: /^[A-Z]$/.test(key), bubbles: true, cancelable: true,
      });
      view.contentDOM.dispatchEvent(event);
      if (!event.defaultPrevented && !ctrlKey && key.length === 1 && getCM(view).state.vim.insertMode) {
        view.dispatch({...view.state.replaceSelection(key), userEvent: 'input.type'});
      }
    }
  }

  beforeEach(() => {
    Vim.resetVimGlobalState_();
    views = [];
    Vim.defineAction('pgadminInsertReplayTest', insertPrevious);
    Vim.mapCommand('<C-a>', 'action', 'pgadminInsertReplayTest', {}, {context: 'insert'});
    Vim.mapCommand('<C-@>', 'action', 'pgadminInsertReplayTest', {exit: true}, {context: 'insert'});
  });

  afterEach(() => {
    for (const {view, parent} of views) { view.destroy(); parent.remove(); }
  });

  it('repeats prior text and exits synchronously with Ctrl+@', () => {
    const view = editor();
    press(view, 'iabc<Esc>A<C-a><C-@>');
    expect(view.state.doc.toString()).toBe('abcabcabc');
    expect(getCM(view).state.vim.insertMode).toBe(false);
    press(view, '.');
    expect(view.state.doc.toString()).toBe('abcabcabcabcabc');
  });

  it('replays Backspace as deletion and retains it for dot', () => {
    const view = editor();
    press(view, 'iabc<BS><Esc>A<C-a><Esc>.');
    expect(view.state.doc.toString()).toBe('ababab');
    expect(view.state.doc.toString()).not.toContain('[object Object]');
  });

  it('replays Delete against existing text rather than inserting an object', () => {
    const view = editor('XYZ\nUVW');
    press(view, 'ia<Del><Esc>j0i<C-a><Esc>');
    expect(view.state.doc.toString()).toBe('aYZ\naVW');
  });

  it('keeps a newly typed prefix and subsequent typing in the current dot change', () => {
    const view = editor();
    press(view, 'iab<Esc>Ax<C-a>y<Esc>.');
    expect(view.state.doc.toString()).toBe('abxabyxaby');
  });

  it('honors the count on the initiating Insert command', () => {
    const view = editor();
    press(view, 'iab<Esc>3A<C-a><Esc>');
    expect(view.state.doc.toString()).toBe('abababab');
  });

  it('records replay results in a macro and executes them without another snapshot lookup', () => {
    const view = editor();
    press(view, 'iabc<BS><Esc>qaA<C-@>q@a');
    expect(view.state.doc.toString()).toBe('ababab');
    expect(getCM(view).state.vim.insertMode).toBe(false);
  });

  it('repeats multiline insertions', () => {
    const view = editor();
    press(view, 'ia<CR>b<Esc>A<C-@>');
    expect(view.state.doc.toString()).toBe('a\nba\nb');
  });

  it('repeats previous Replace-mode text as insertion in Insert mode', () => {
    const view = editor('xxxxx');
    press(view, 'Rab<Esc>0i<C-@>');
    expect(view.state.doc.toString()).toBe('ababxxx');
  });

  it('overwrites when replaying in Replace mode and retains that mode for dot', () => {
    const view = editor('xxxxx\nyyyyy');
    press(view, 'iab<Esc>j0R<C-a><Esc>.');
    expect(view.state.doc.toString()).toBe('abxxxxx\naabyy');
  });

  it('replays a previous Replace backspace using the current Insert mode', () => {
    const view = editor('xxxxx\nyyyyy');
    press(view, 'Rab<BS>c<Esc>j0i<C-@>');
    expect(view.state.doc.toString()).toBe('acxxx\nacyyyyy');
  });

  it('records Replace backspace replay as a cursor move for macros', () => {
    const view = editor('xxxxx\nyyyyy\nzzzzz');
    press(view, 'iab<BS>c<Esc>2G0');
    expect(getCM(view).getCursor()).toEqual({line: 1, ch: 0});
    press(view, 'qaR');
    expect(getCM(view).getCursor()).toEqual({line: 1, ch: 0});
    press(view, '<C-@>');
    expect(view.state.doc.toString()).toBe('acxxxxx\nacyyy\nzzzzz');
    press(view, 'q3G0@a');
    expect(view.state.doc.toString()).toBe('acxxxxx\nacyyy\naczzz');
  });

  it('keeps completed insertion snapshots scoped to their editor', () => {
    const first = editor();
    const second = editor();
    press(first, 'ione<Esc>');
    press(second, 'itwo<Esc>');
    press(first, 'A<C-@>');
    press(second, 'A<C-@>');
    expect(first.state.doc.toString()).toBe('oneone');
    expect(second.state.doc.toString()).toBe('twotwo');
  });

  it('does nothing without a completed insertion and leaves Insert mode usable', () => {
    const view = editor();
    press(view, 'i<C-a>x<Esc>');
    expect(view.state.doc.toString()).toBe('x');
  });

  it.each([EditorState.readOnly.of(true), EditorView.editable.of(false)])('protects locked editors', lock => {
    const view = editor();
    press(view, 'iab<Esc>A');
    view.dispatch({effects: StateEffect.appendConfig.of(lock)});
    const cm = getCM(view);
    insertPrevious(cm, {exit: true});
    expect(view.state.doc.toString()).toBe('ab');
    expect(cm.state.vim.insertMode).toBe(true);
  });
});
