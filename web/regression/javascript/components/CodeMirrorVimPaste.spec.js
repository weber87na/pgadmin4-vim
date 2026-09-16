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
import vimPaste from 'sources/components/ReactCodeMirror/extensions/vimPaste';

describe('Vim extended puts', () => {
  let views;
  const register = (name = '"') => Vim.getRegisterController().getRegister(name);
  const text = view => view.state.doc.toString();
  const position = view => getCM(view).getCursor();
  function create(doc, extra = [], install = true) {
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new EditorView({parent, state: EditorState.create({doc,
      extensions: [vim(), history(), EditorState.allowMultipleSelections.of(true), install ? vimPaste() : [], extra],
    })});
    views.push(view);
    // Test documents have no wrapping/folds; JSDOM's zero-height rectangles
    // cannot supply the line geometry needed by real j/k keyboard commands.
    jest.spyOn(getCM(view), 'findPosV').mockImplementation((pos, amount) => ({
      line: Math.max(0, Math.min(view.state.doc.lines - 1, pos.line + amount)), ch: pos.ch,
    }));
    return view;
  }
  function press(view, sequence) {
    for (const token of sequence.match(/<[^>]+>|./g) || []) {
      const ctrlKey = /^<C-/.test(token);
      const key = token === '<Esc>' ? 'Escape' : ctrlKey ? token.slice(3, -1) : token;
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
        key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
        keyCode: key === 'Escape' ? 27 : key.toUpperCase().charCodeAt(0),
        ctrlKey, shiftKey: /^[A-Z]$/.test(key), bubbles: true, cancelable: true,
      }));
    }
  }
  beforeEach(() => { views = []; Vim.resetVimGlobalState_(); });
  afterEach(() => {
    for (const view of views) { const parent = view.dom.parentElement; view.destroy(); parent.remove(); }
    delete navigator.clipboard;
  });

  it.each([
    ['gp', 'aXYbcd', 3], ['gP', 'XYabcd', 2], ['2gp', 'aXYXYbcd', 5], ['2gP', 'XYXYabcd', 4],
  ])('puts a character register using %s and lands after the text', (keys, expected, ch) => {
    const view = create('abcd');
    register('a').setText('XY');
    press(view, '"a' + keys);
    expect(text(view)).toBe(expected);
    expect(position(view)).toEqual({line: 0, ch});
    press(view, 'u'); expect(text(view)).toBe('abcd');
    press(view, '<C-r>'); expect(text(view)).toBe(expected);
  });
  it.each([
    ['gp', 'abcd\n  XY\nZQ\nnext', 3], ['gP', '  XY\nZQ\nabcd\nnext', 2],
    ['2gp', 'abcd\n  XY\nZQ\n  XY\nZQ\nnext', 5],
  ])('puts a line register with %s and lands on the following line', (keys, expected, line) => {
    const view = create('abcd\nnext');
    register().setText('  XY\nZQ\n', true);
    press(view, keys);
    expect(text(view)).toBe(expected);
    expect(position(view)).toEqual({line, ch: 0});
  });
  it('clips the linewise gp cursor at the end of the document', () => {
    const view = create('last');
    register().setText('one\n  two\n', true);
    press(view, 'gp');
    expect(text(view)).toBe('last\none\n  two');
    expect(position(view)).toEqual({line: 2, ch: 0});
  });
  it.each([
    ['gp', 'aXYbcd\neZQfgh', {line: 1, ch: 3}],
    ['gP', 'XYabcd\nZQefgh', {line: 1, ch: 2}],
    ['2gp', 'aXYXYbcd\neZQZQfgh', {line: 1, ch: 5}],
  ])('puts a block register using %s with horizontal counts', (keys, expected, cursor) => {
    const view = create('abcd\nefgh');
    register().setText('XY\nZQ', false, true);
    press(view, keys);
    expect(text(view)).toBe(expected);
    expect(position(view)).toEqual(cursor);
  });
  it('extends short lines and appends missing lines for a block put', () => {
    const view = create('abcd\nx');
    register().setText('XY\nZQ\nJK', false, true);
    press(view, '2lgp');
    expect(text(view)).toBe('abcXYd\nx  ZQ\n   JK');
    expect(position(view)).toEqual({line: 2, ch: 4});
    press(view, 'u'); expect(text(view)).toBe('abcd\nx');
  });
  it('uses multiline character registers and respects Unicode boundaries', () => {
    const view = create('😀z');
    register().setText('XY\n中文');
    press(view, 'gp');
    expect(text(view)).toBe('😀XY\n中文z');
    expect(position(view)).toEqual({line: 1, ch: 2});
  });
  it.each(['😀', '界'])('inserts a block at a screen column without splitting %s', glyph => {
    const view = create('ab\n' + glyph + 'x');
    register('a').setText('X\nY', false, true);
    press(view, '"agp');
    expect(text(view)).toBe('aXb\n Y' + glyph + 'x');
    expect(position(view)).toEqual({line: 1, ch: 2});
  });
  it('counts graphemes when a Visual dot target contains an emoji', () => {
    const view = create('a 😀');
    register('a').setText('Q');
    press(view, 'v"aPw.');
    expect(text(view)).toBe('Q Q');
  });
  it('aligns counted block rows by display cells and preserves combining characters', () => {
    const view = create('ab\náx');
    register('a').setText('界\nZ', false, true);
    press(view, '"a2gp');
    expect(text(view)).toBe('a界界b\náZ Zx');
    expect(position(view)).toEqual({line: 1, ch: 5});
  });
  it('expands a destination tab around the inserted block cell', () => {
    const view = create('ab\n\tx', EditorState.tabSize.of(4));
    register('a').setText('X\nY', false, true);
    press(view, '"agp');
    expect(text(view)).toBe('aXb\n Y   x');
  });
  it.each(['[P', ']P'])('adds the native indentation alias %s', key => {
    const view = create('  dst\nlast');
    register('a').setText('    src\n      nested\n', true);
    press(view, '"a' + key);
    expect(text(view)).toBe('  src\n    nested\n  dst\nlast');
    expect(position(view)).toEqual({line: 0, ch: 2});
    press(view, 'u'); expect(text(view)).toBe('  dst\nlast');
  });
  it('preserves existing lowercase indent put and ordinary Normal puts', () => {
    const view = create('  dst');
    register().setText(' src\n', true);
    press(view, ']p'); expect(text(view)).toBe('  dst\n  src');
    press(view, 'u[p'); expect(text(view)).toBe('  src\n  dst');
    press(view, 'uP'); expect(text(view)).toBe(' src\n  dst');
    press(view, 'up'); expect(text(view)).toBe('  dst\n src');
  });

  // Expected replacements/cursor positions were checked against native Vim.
  it.each([
    ['char', 'lvjl', 'aXYh\nijkl\nmnop', {line: 0, ch: 2}],
    ['char', 'Vj', 'XY\nijkl\nmnop', {line: 0, ch: 0}],
    ['char', 'l<C-v>jl', 'aXYd\neXYh\nijkl\nmnop', {line: 0, ch: 2}],
    ['multichar', 'lvjl', 'aXY\nZQh\nijkl\nmnop', {line: 0, ch: 1}],
    ['multichar', 'Vj', 'XY\nZQ\nijkl\nmnop', {line: 0, ch: 0}],
    ['multichar', 'l<C-v>jl', 'aXY\nZQd\neh\nijkl\nmnop', {line: 0, ch: 1}],
    ['line', 'lvjl', 'a\nXY\nZQ\nh\nijkl\nmnop', {line: 1, ch: 0}],
    ['line', 'Vj', 'XY\nZQ\nijkl\nmnop', {line: 0, ch: 0}],
    ['line', 'l<C-v>jl', 'ad\neh\nXY\nZQ\nijkl\nmnop', {line: 2, ch: 0}],
    ['block', 'lvjl', 'aXYh\niZQjkl\nmnop', {line: 0, ch: 1}],
    ['block', 'Vj', 'XY\nZQ\nijkl\nmnop', {line: 0, ch: 0}],
    ['block', 'l<C-v>jl', 'aXYd\neZQh\nijkl\nmnop', {line: 0, ch: 1}],
  ])('puts a %s register over a %s selection', (type, selection, expected, cursor) => {
    const original = 'abcd\nefgh\nijkl\nmnop';
    const view = create(original);
    register('a').setText(type === 'char' ? 'XY' : type === 'line' ? 'XY\nZQ\n' : 'XY\nZQ', type === 'line', type === 'block');
    press(view, selection + '"ap');
    expect(text(view)).toBe(expected);
    expect(position(view)).toEqual(cursor);
    expect(getCM(view).state.vim.visualMode).toBe(false);
    press(view, 'u'); expect(text(view)).toBe(original);
    press(view, '<C-r>'); expect(text(view)).toBe(expected);
  });
  it.each(['P', 'gP'])('preserves the unnamed register for Visual %s', key => {
    const view = create('abcd');
    register().setText('keep\n', true);
    register('a').setText('XY');
    press(view, 'vl"a' + key);
    expect(text(view)).toBe('XYcd');
    expect(register().toString()).toBe('keep\n');
    expect(register().linewise).toBe(true);
    expect(register('a').toString()).toBe('XY');
    expect(position(view).ch).toBe(key === 'P' ? 1 : 2);
  });
  it('retains deleted text and register types for Visual p', () => {
    const view = create('abcd\nefgh');
    register('a').setText('XY');
    press(view, 'V"ap');
    expect(register().toString()).toBe('abcd\n');
    expect(register().linewise).toBe(true);
    press(view, 'u0l<C-v>jl"ap');
    expect(register().toString()).toBe('bc\nfg');
    expect(register().blockwise).toBe(true);
  });
  it('places line registers before a Visual block with P and after with p', () => {
    const view = create('abcd\nefgh\nlast');
    register('a').setText('XY\n', true);
    press(view, 'l<C-v>jl"aP');
    expect(text(view)).toBe('XY\nad\neh\nlast');
  });
  it('supports reverse character and block selections', () => {
    const view = create('abcd\nefgh');
    register('a').setText('XY');
    press(view, 'jlvlk"aP');
    expect(text(view)).toBe('abXYgh');
    press(view, 'uj0ll<C-v>kh"aP');
    expect(text(view)).toBe('aXYd\neXYh');
  });
  it('reselects pasted content with gv and sets the put marks', () => {
    const view = create('abcd');
    register('a').setText('LONG');
    press(view, 'vl"aPgv');
    expect(getCM(view).getSelection()).toBe('LONG');
    press(view, '<Esc>`['); expect(position(view)).toEqual({line: 0, ch: 0});
    press(view, '`]'); expect(position(view)).toEqual({line: 0, ch: 3});
  });
  it('repeats Normal puts and replacement counts using dot', () => {
    const view = create('ab cd');
    register().setText('X');
    press(view, '2gpw3.');
    expect(text(view)).toBe('aXXb cXXXd');
  });
  it('repeats selected surrogate pairs without splitting UTF-16 characters', () => {
    const view = create('😀 😀');
    register().setText('X');
    press(view, 'vPw.');
    expect(text(view)).toBe('X X');
  });
  it('uses the first nonblank column for linewise Visual puts', () => {
    const view = create('abcd');
    register('a').setText('  XY\n', true);
    press(view, 'lvl"aP');
    expect(text(view)).toBe('a\n  XY\nd');
    expect(position(view)).toEqual({line: 1, ch: 2});
  });
  it.each([
    ['ab cd', 'vlPw.', 'XY XY'],
    ['abcd efgh', 'vl"aPw.', 'XYcd XYgh'],
    ['abcd\nefgh\nijkl\nmnop', 'l<C-v>jl"aPjj0l.', 'aXYd\neXYh\niXYl\nmXYp'],
    ['one\ntwo\nthree\nfour', 'Vj"aPj.', 'XY\nXY'],
  ])('repeats Visual puts with their selected size: %s', (doc, keys, expected) => {
    const view = create(doc);
    register().setText('XY'); register('a').setText('XY');
    press(view, keys);
    expect(text(view)).toBe(expected);
  });
  it('reads the current unnamed register when repeating Visual p', () => {
    const view = create('ab cd');
    register().setText('XY');
    press(view, 'vlpw.');
    expect(text(view)).toBe('XY ab');
    expect(register().toString()).toBe('cd');
  });
  it('records and replays gp in a macro without altering the source register', () => {
    const view = create('ab\nab\nab');
    register('b').setText('XY');
    press(view, 'qa"bgp0jq@a');
    expect(text(view)).toBe('aXYb\naXYb\nab');
    expect(register('b').toString()).toBe('XY');
  });
  it('retains ordinary insert dot replay after an empty put', () => {
    const view = create('one\ntwo');
    press(view, 'ciw');
    view.dispatch(view.state.update({...view.state.replaceSelection('text'), userEvent: 'input.type'}));
    press(view, '<Esc>j0"zgp.');
    expect(text(view)).toBe('text\ntext');
  });
  it.each([EditorState.readOnly.of(true), EditorView.editable.of(false)])('protects read-only and disabled views', extra => {
    const view = create('abcd', extra);
    register().setText('XY');
    press(view, 'gpgP[P]PvlP');
    expect(text(view)).toBe('abcd');
    expect(register().toString()).toBe('XY');
  });
  it('uses native Visual puts when the extension is absent or removed', () => {
    create('');
    const mode = new Compartment();
    const view = create('abcd', mode.of(vimPaste()), false);
    view.dispatch({effects: mode.reconfigure([])});
    register().setText('XY');
    press(view, 'gp'); expect(text(view)).toBe('abcd');
    press(view, 'vlp'); expect(text(view)).toBe('XYcd');
  });
  it('puts clipboard contents only after a successful read', async () => {
    const view = create('ab');
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {readText: jest.fn().mockResolvedValue('XY')}});
    press(view, '"+gp');
    await Promise.resolve();
    expect(text(view)).toBe('aXYb');
    expect(position(view)).toEqual({line: 0, ch: 3});
  });
  it('ignores an outstanding clipboard read after the document changes', async () => {
    const view = create('ab');
    let resolve;
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {readText: () => new Promise(done => {resolve = done;})}});
    press(view, '"+gp');
    view.dispatch({changes: {from: 0, to: 2, insert: 'updated'}});
    resolve('XY');
    await Promise.resolve();
    expect(text(view)).toBe('updated');
  });
  it('does not overwrite another editor\'s insert replay when a clipboard read is cancelled', async () => {
    const first = create('abcd');
    const second = create('one');
    let reject;
    Object.defineProperty(navigator, 'clipboard', {configurable: true,
      value: {readText: () => new Promise((_resolve, fail) => {reject = fail;})}});
    press(first, 'x');
    const previous = getCM(first).state.vim.lastEditInputState;
    press(first, '"+gp');
    press(second, 'i');
    second.dispatch(second.state.update({...second.state.replaceSelection('X'), userEvent: 'input.type'}));
    press(second, '<Esc>');
    reject(new Error('cancelled'));
    await Promise.resolve(); await Promise.resolve();
    press(second, '.');
    expect(text(second)).toBe('XXone');
    expect(getCM(first).state.vim.lastEditInputState).toBe(previous);
    expect(text(first)).toBe('bcd');
  });
  it('handles rejected clipboard access and preserves the previous dot command', async () => {
    const view = create('abcd');
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {readText: jest.fn().mockRejectedValue(new Error('denied'))}});
    press(view, 'x"+gp');
    await Promise.resolve(); await Promise.resolve();
    press(view, '.');
    expect(text(view)).toBe('cd');
  });
});
