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
import { history } from '@codemirror/commands';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import vimExLines from 'sources/components/ReactCodeMirror/extensions/vimExLines';

describe('Vim Ex copy and move', () => {
  let views;
  const original = '  one\ntwo\n  three\nfour';
  function create(doc = original, extra = [], install = true) {
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new EditorView({parent, state: EditorState.create({
      doc, extensions: [vim(), history(), install ? vimExLines() : [], extra],
    })});
    views.push(view);
    return view;
  }
  const ex = (view, input) => Vim.handleEx(getCM(view), input);
  const keys = (view, input) => {
    for (const key of input.match(/<[^>]+>|./g)) Vim.handleKey(getCM(view), key, 'user');
  };
  const text = view => view.state.doc.toString();
  beforeEach(() => { views = []; Vim.resetVimGlobalState_(); });
  afterEach(() => {
    for (const view of views) {
      const parent = view.dom.parentElement;
      view.destroy();
      parent.remove();
    }
  });

  it.each(['co', 'cop', 'copy', 't'])('copies ranges with :%s and preserves registers', command => {
    const view = create();
    keys(view, 'yy');
    const register = Vim.getRegisterController().getRegister('"').toString();
    ex(view, `1,3${command} $`);
    expect(text(view)).toBe(original + '\n  one\ntwo\n  three');
    expect(view.state.selection.main.head).toBe(view.state.doc.line(7).from + 2);
    expect(Vim.getRegisterController().getRegister('"').toString()).toBe(register);
  });
  it.each(['m', 'mo', 'mov', 'move'])('moves down with :%s', command => {
    const view = create();
    ex(view, `1,2${command} $`);
    expect(text(view)).toBe('  three\nfour\n  one\ntwo');
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(4);
  });
  it.each([
    ['3,4move 0', '  three\nfour\n  one\ntwo'],
    ['2,3t 0', 'two\n  three\n' + original],
    ['1,3t 2', '  one\ntwo\n  one\ntwo\n  three\n  three\nfour'],
    ['%copy $-2+1', '  one\ntwo\n  three\n' + original + '\nfour'],
  ])('performs %s with one-step undo and redo', (command, expected) => {
    const view = create();
    ex(view, command);
    expect(text(view)).toBe(expected);
    keys(view, 'u');
    expect(text(view)).toBe(original);
    keys(view, '<C-r>');
    expect(text(view)).toBe(expected);
  });
  it('keeps successive Ex operations as separate undo steps', () => {
    const view = create();
    ex(view, '1t $');
    const once = text(view);
    ex(view, '1t $');
    keys(view, 'u');
    expect(text(view)).toBe(once);
    keys(view, 'u');
    expect(text(view)).toBe(original);
  });
  it('defaults to current line and accepts relative destinations', () => {
    const view = create();
    keys(view, '2G');
    ex(view, 't .+1');
    expect(text(view)).toBe('  one\ntwo\n  three\ntwo\nfour');
    ex(view, 'move -2');
    expect(text(view)).toBe('  one\ntwo\ntwo\n  three\nfour');
  });
  it('accepts mark addresses and moves marks with their text', () => {
    const view = create();
    keys(view, '3Gma');
    ex(view, '1t \'a-1');
    expect(text(view)).toBe('  one\ntwo\n  one\n  three\nfour');
    ex(view, '4move 0');
    keys(view, '\'a');
    expect(view.state.selection.main.head).toBe(2);
  });
  it('copies visual ranges through the command-line panel', () => {
    const view = create();
    keys(view, '2GV3G:');
    const input = view.dom.querySelector('.cm-vim-panel input');
    expect(input).not.toBeNull();
    input.value = '\'<,\'>t $';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, bubbles: true}));
    expect(text(view)).toBe(original + '\ntwo\n  three');
    expect(getCM(view).state.vim.visualMode).toBe(false);
  });
  it.each(['', 'a', 'a\n', '\na', 'a\n\nb', '中文\n  😀'])('preserves empty lines and Unicode in %p', doc => {
    const view = create(doc);
    ex(view, '%t $');
    expect(text(view)).toBe(doc + '\n' + doc);
    keys(view, 'u');
    expect(text(view)).toBe(doc);
  });
  it.each(['1,3m 2', '0t 1', '1,99t 0', '3,1t 0', 't 99', 't -99', 't', 't /four/', 't 1 garbage', 't \'z', 'move! 0'])('rejects invalid input %s', input => {
    const view = create();
    ex(view, input);
    expect(text(view)).toBe(original);
    expect(view.dom.textContent).toMatch(/Invalid|Cannot/);
  });
  it.each(['1,2m 0', '1,2m 2', '%m $', '%m 0'])('handles no-op moves: %s', input => {
    const view = create();
    ex(view, input);
    expect(text(view)).toBe(original);
  });
  it.each([EditorState.readOnly.of(true), EditorView.editable.of(false)])('protects read-only and disabled editors', extension => {
    const view = create(original, extension);
    ex(view, '1t $');
    ex(view, '1m $');
    expect(text(view)).toBe(original);
  });
  it('keeps numeric jumps and existing mappings working', () => {
    const view = create();
    ex(view, '3');
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3);
    ex(view, 'nmap Q gg');
    keys(view, 'Q');
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(1);
    ex(view, 'unmap Q');
  });
  it('isolates editors and disables removed extensions', () => {
    const mode = new Compartment();
    const first = create(original, mode.of(vimExLines()), false);
    const second = create();
    ex(first, 't $');
    expect(text(second)).toBe(original);
    first.dispatch({effects: mode.reconfigure([])});
    const before = text(first);
    ex(first, 't $');
    expect(text(first)).toBe(before);
    ex(second, 't $');
    expect(text(second)).toBe(original + '\n  one');
  });
  it.each([
    ['a\n', '2m 0', '\na'],
    ['\na', '2m 0', 'a\n'],
    ['a\n\nb', '2m $', 'a\nb\n'],
    ['中文\n😀', '2m 0', '😀\n中文'],
  ])('moves lines with boundary whitespace and Unicode: %p', (doc, command, expected) => {
    const view = create(doc);
    ex(view, command);
    expect(text(view)).toBe(expected);
    keys(view, 'u');
    expect(text(view)).toBe(doc);
  });
  it('repeats the last Ex line operation with @:', () => {
    const view = create();
    ex(view, '1t $');
    keys(view, '@:');
    expect(text(view)).toBe(original + '\n  one\n  one');
  });

});
