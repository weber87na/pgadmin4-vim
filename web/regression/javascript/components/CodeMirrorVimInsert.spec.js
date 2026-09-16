/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import vimInsert from 'sources/components/ReactCodeMirror/extensions/vimInsert';

describe('Vim Insert shortcuts', () => {
  let view, parent;
  const text = () => view.state.doc.toString();
  const cm = () => getCM(view);
  const keys = sequence => {
    for (const key of sequence.match(/<[^>]+>|./g) || []) Vim.handleKey(cm(), key);
  };
  const type = value => {
    view.dispatch({...view.state.replaceSelection(value), userEvent: 'input.type'});
  };

  function editor(doc, extensions = []) {
    view = new EditorView({parent, state: EditorState.create({doc,
      extensions: [vim(), vimInsert(), history(), EditorState.tabSize.of(4), extensions]})});
    view.focus();
  }

  beforeEach(() => {
    Vim.resetVimGlobalState_();
    parent = document.createElement('div');
    document.body.appendChild(parent);
  });
  afterEach(() => { view?.destroy(); parent.remove(); });

  it('copies from the line above or below while retaining Insert mode', () => {
    editor('abc\nX\ndef');
    cm().setCursor({line: 1, ch: 1});
    keys('i<C-y><C-e>');
    expect(text()).toBe('abc\nXbf\ndef');
    expect(cm().state.vim.insertMode).toBe(true);
  });

  it('does nothing at document boundaries or past a short source line', () => {
    editor('ab\nx');
    keys('i<C-y>');
    expect(text()).toBe('ab\nx');
    keys('<Esc>A<C-e>');
    expect(text()).toBe('ab\nx');
    keys('<Esc>Gi<C-e>');
    expect(text()).toBe('ab\nx');
  });

  it('uses screen columns for tabs and full-width characters', () => {
    editor('    Z\n\t\n中a');
    cm().setCursor({line: 1, ch: 1});
    keys('i<C-y>');
    expect(text()).toBe('    Z\n\tZ\n中a');
    keys('<Esc>');
    cm().setCursor({line: 1, ch: 0});
    keys('i<C-e>');
    expect(text()).toBe('    Z\n中\tZ\n中a');
  });

  it('copies complete emoji and combining character clusters', () => {
    editor('😀a\n\ne\u0301b');
    cm().setCursor({line: 1, ch: 0});
    keys('i<C-y>');
    expect(text()).toBe('😀a\n😀\ne\u0301b');
    keys('<Esc>');
    cm().setCursor({line: 1, ch: 0});
    keys('i<C-e>');
    expect(text()).toBe('😀a\ne\u0301😀\ne\u0301b');
  });

  it('honors Replace mode without splitting an existing surrogate pair', () => {
    editor('A\n😀Z');
    keys('GR<C-y><Esc>');
    expect(text()).toBe('A\nAZ');
    keys('u');
    expect(text()).toBe('A\n😀Z');
  });

  it('keeps the original insertion for dot repeat and counted Insert', () => {
    editor('abcdef\n\n');
    cm().setCursor({line: 1, ch: 0});
    keys('i<C-y><C-y><Esc>');
    expect(text()).toBe('abcdef\nab\n');
    keys('G.');
    expect(text()).toBe('abcdef\nab\nab');
  });

  it('breaks one Insert session into separate undo steps', () => {
    editor('');
    keys('i'); type('abc'); keys('<C-g>u'); type('def'); keys('<Esc>');
    expect(text()).toBe('abcdef');
    keys('u'); expect(text()).toBe('abc');
    keys('u'); expect(text()).toBe('');
    keys('<C-r><C-r>'); expect(text()).toBe('abcdef');
  });

  it('dot repeats only the insertion after an undo break, not the preceding change', () => {
    editor('old next');
    keys('ciw'); type('A'); keys('<C-g>u'); type('B'); keys('<Esc>w.');
    expect(text()).toBe('AB Bnext');
  });

  it('retains both sides of an undo break during macro playback', () => {
    editor('');
    keys('qai'); type('abc'); keys('<C-g>u'); type('def'); keys('<Esc>qA<Esc>@a');
    expect(text()).toBe('abcdeabcdeff');
  });

  it('resumes macro insertions at column zero after an undo break', () => {
    editor('X\nY');
    keys('qai'); type('a\n'); keys('<C-g>u'); type('b'); keys('<Esc>qG0@a');
    expect(text()).toBe('a\nbX\na\nbY');
  });

  it('preserves Replace mode across undo breaks in live editing and macros', () => {
    editor('xxxx\nyyyy');
    const overwrite = value => {
      for (const character of value) cm().overWriteSelection(character);
    };
    keys('qaR'); overwrite('ab'); keys('<C-g>u');
    expect(cm().state.overwrite).toBe(true);
    overwrite('cd'); keys('<Esc>q2G0@a');
    expect(text()).toBe('abcd\nabcd');
  });

  it.each([EditorState.readOnly.of(true), EditorView.editable.of(false)])('protects locked content', lock => {
    editor('abc\nx\ndef');
    cm().setCursor({line: 1, ch: 0});
    // Locking an editor during an active Insert session must also be safe.
    keys('i');
    view.dispatch({effects: StateEffect.appendConfig.of(lock)});
    keys('<C-y><C-e><C-g>u');
    expect(text()).toBe('abc\nx\ndef');
  });

  it('handles actual Control key events', () => {
    editor('abc\n'); keys('Gi');
    const event = new KeyboardEvent('keydown', {key: 'y', code: 'KeyY', keyCode: 89,
      ctrlKey: true, bubbles: true, cancelable: true});
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(text()).toBe('abc\na');
  });

  it('handles Control-Shift-2 as Control-@ on a US keyboard', () => {
    editor(''); keys('i'); type('abc'); keys('<Esc>A');
    const event = new KeyboardEvent('keydown', {key: '@', code: 'Digit2', keyCode: 50,
      ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true});
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(text()).toBe('abcabc');
    expect(cm().state.vim.insertMode).toBe(false);
  });
});
