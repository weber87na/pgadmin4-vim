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
import { indentUnit } from '@codemirror/language';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import vimExEditing from 'sources/components/ReactCodeMirror/extensions/vimExEditing';
import { displayColumn, visualCells } from 'sources/components/ReactCodeMirror/extensions/vimTextColumns';

describe('Vim Ex retab and alignment', () => {
  let views;
  function create(doc, extra=[], install=true) {
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new EditorView({parent, state: EditorState.create({doc,
      extensions: [vim(), history(), extra, EditorState.tabSize.of(4), indentUnit.of('    '), install ? vimExEditing() : []]})});
    views.push(view);
    return view;
  }
  const ex = (view, command) => Vim.handleEx(getCM(view), command);
  const keys = (view, input) => {
    for (const key of input.match(/<[^>]+>|./gu)) Vim.handleKey(getCM(view), key, 'user');
  };
  const text = view => view.state.doc.toString();
  beforeEach(() => { views = []; Vim.resetVimGlobalState_(); });
  afterEach(() => {
    for (const view of views) { const parent = view.dom.parentElement; view.destroy(); parent.remove(); }
  });

  it.each(['ret', 'reta', 'retab', 'retab 0'])('expands existing tabs throughout the document with :%s', command => {
    const view = create('\tone\na\tb\n  no tabs\n');
    keys(view, '2G');
    ex(view, command);
    expect(text(view)).toBe('    one\na   b\n  no tabs\n');
    expect(view.state.tabSize).toBe(4);
  });

  it('limits retab to explicit numeric, relative and marked ranges', () => {
    const view = create('\tone\n\ttwo\n\tthree\n\tfour');
    keys(view, '2Gma');
    ex(view, '\'a,\'a+1retab');
    expect(text(view)).toBe('\tone\n    two\n    three\n\tfour');
    ex(view, '.retab');
    expect(text(view)).toBe('\tone\n    two\n    three\n\tfour');
  });

  it('accepts a Visual range through the Ex panel', () => {
    const view = create('\tone\n\ttwo\n\tthree');
    keys(view, 'V2G:');
    expect(getCM(view).state.vim.marks['>'].find().line).toBe(1);
    const input = view.dom.querySelector('.cm-vim-panel input');
    input.value = '\'<,\'>retab';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, bubbles: true}));
    expect(text(view)).toBe('    one\n    two\n\tthree');
    expect(getCM(view).state.vim.visualMode).toBe(false);
  });

  it('uses new tab stops while preserving original display columns', () => {
    const mode = new Compartment();
    const view = create('\tone\na\tb\nabc\tz\n\t\tend', mode.of(indentUnit.of('\t')));
    // Higher precedence chooses tabs over the general four-space preference.
    view.dispatch({effects: mode.reconfigure(indentUnit.of('\t'))});
    ex(view, 'retab 2');
    expect(view.state.tabSize).toBe(2);
    expect(text(view)).toBe('\t\tone\na\t\tb\nabc\tz\n\t\t\t\tend');
    keys(view, 'u');
    expect(text(view)).toBe('\tone\na\tb\nabc\tz\n\t\tend');
    expect(view.state.tabSize).toBe(2);
  });

  it('plain retab leaves spaces-only runs alone and bang compresses them', () => {
    const view = create('    one\na       b\nabc d\n  \tend', indentUnit.of('\t'));
    ex(view, 'retab');
    expect(text(view)).toBe('    one\na       b\nabc d\n\tend');
    ex(view, 'retab!');
    expect(text(view)).toBe('\tone\na\t\tb\nabc d\n\tend');
  });

  it('does not replace spaces with tabs unless the result is shorter', () => {
    const view = create('abc  x\na  y', indentUnit.of('\t'));
    ex(view, 'retab!');
    expect(text(view)).toBe('abc  x\na  y');
  });

  it('preserves Unicode screen columns before tabs', () => {
    const view = create('中\tx\ne\u0301\tx\n👩‍💻\tx\n🇹🇼\tx');
    ex(view, 'retab');
    expect(text(view)).toBe('中  x\ne\u0301   x\n👩‍💻  x\n🇹🇼  x');
  });

  it('preserves end-of-line style, trailing whitespace and final line breaks', () => {
    const view = create('x\t \r\n\ty\r\n', EditorState.lineSeparator.of('\r\n'));
    ex(view, 'retab');
    expect(view.state.sliceDoc()).toBe('x    \r\n    y\r\n');
    expect(view.state.doc.lines).toBe(3);
  });

  it('keeps retab cursor columns and named marks attached to unchanged text', () => {
    const view = create('\talpha\tbeta');
    keys(view, 'wma');
    const before = displayColumn(text(view), view.state.selection.main.head, 4);
    ex(view, 'retab');
    expect(displayColumn(text(view), view.state.selection.main.head, 4)).toBe(before);
    keys(view, '`a');
    expect(text(view).slice(view.state.selection.main.head)).toBe('alpha   beta');
  });

  it.each([
    ['left', '  alpha  ', 'alpha  '], ['le 3', '\talpha\t ', '   alpha\t '],
    ['center 12', '  alpha  ', '   alpha  '], ['ce 0', 'alpha', ' '.repeat(37) + 'alpha'],
    ['right 12', '  alpha  ', '       alpha  '], ['ri 2', '  alpha', 'alpha'],
  ])('aligns with :%s without modifying trailing content', (command, original, expected) => {
    const view = create(original);
    ex(view, command);
    expect(text(view)).toBe(expected);
    keys(view, 'u');
    expect(text(view)).toBe(original);
    keys(view, '<C-r>');
    expect(text(view)).toBe(expected);
  });

  it('defaults alignment to the current line and supports whole-buffer ranges', () => {
    const view = create('  one\n    two\n  three\n');
    keys(view, '2G');
    ex(view, 'left');
    expect(text(view)).toBe('  one\ntwo\n  three\n');
    ex(view, '%left 1');
    expect(text(view)).toBe(' one\n two\n three\n');
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2);
  });

  it('uses a local textwidth setting for default center and right widths', () => {
    const view = create('word');
    ex(view, 'setlocal textwidth=12');
    ex(view, 'center');
    expect(text(view)).toBe('    word');
    ex(view, 'right');
    expect(text(view)).toBe('        word');
  });

  it('right-aligns around internal tabs without crossing the margin', () => {
    const view = create('a\tb\n  a\tb');
    ex(view, '%right 10');
    expect(text(view)).toBe('      a\tb\n      a\tb');
    for (const line of text(view).split('\n')) expect(displayColumn(line, line.length, 4)).toBe(9);
  });

  it('centers embedded tabs using the original displayed content width', () => {
    const view = create('  a\tb');
    ex(view, 'center 10');
    expect(text(view)).toBe('   a\tb');
  });

  it('uses tabs for alignment when the editor uses tab indentation', () => {
    const view = create('word', indentUnit.of('\t'));
    ex(view, 'right 14');
    expect(text(view)).toBe('\t\t  word');
    ex(view, 'left 5');
    expect(text(view)).toBe('\t word');
  });

  it('aligns CJK, combining marks and emoji by display cells', () => {
    const view = create('中文\ne\u0301\n😀\n👩‍💻\n🇹🇼');
    ex(view, '%right 8');
    expect(text(view)).toBe('    中文\n       e\u0301\n      😀\n      👩‍💻\n      🇹🇼');
  });

  it.each(['center 12', 'right 12'])('leaves blank lines unchanged for :%s', command => {
    const view = create(' \t \n\n  text\n');
    ex(view, '%' + command);
    expect(text(view).startsWith(' \t \n\n')).toBe(true);
    expect(text(view).endsWith('\n')).toBe(true);
  });

  it('keeps successive operations separate and the entire range in one undo step', () => {
    const original = '\tone\n\ttwo';
    const view = create(original);
    ex(view, 'retab');
    const expanded = text(view);
    ex(view, '%left 1');
    keys(view, 'u'); expect(text(view)).toBe(expanded);
    keys(view, 'u'); expect(text(view)).toBe(original);
  });

  it('preserves registers and can repeat Ex formatting with @:', () => {
    const view = create('  one\n  two');
    keys(view, 'yy');
    const saved = Vim.getRegisterController().getRegister('"').toString();
    ex(view, 'left');
    keys(view, 'j@:');
    expect(text(view)).toBe('one\ntwo');
    expect(Vim.getRegisterController().getRegister('"').toString()).toBe(saved);
  });

  it.each(['0retab', '2,1retab', '1,99left', 'retab -1', 'retab 1.5', 'retab 10001',
    'retab! 2 extra', 'retab!!', 'retab -indentonly', 'left -1', 'center!', 'right 3 4',
    'center 99999999999999999', 'left 10001'])('rejects invalid :%s atomically', command => {
    const view = create('\tone\n  two');
    ex(view, command);
    expect(text(view)).toBe('\tone\n  two');
    expect(view.state.tabSize).toBe(4);
    expect(view.dom.textContent).toMatch(/Invalid|Use/);
  });

  it.each([EditorState.readOnly.of(true), EditorView.editable.of(false)])('blocks edits and tabstop changes in locked editors', lock => {
    const view = create('\talpha', lock);
    for (const command of ['retab! 2', 'left', 'center 20', 'right 20']) ex(view, command);
    expect(text(view)).toBe('\talpha');
    expect(view.state.tabSize).toBe(4);
  });

  it('isolates tab settings, retains them on reconfiguration, and disables removed extensions', () => {
    const mode = new Compartment();
    const first = create('\tfirst', mode.of(vimExEditing()), false);
    const second = create('\tsecond');
    ex(first, 'retab 2');
    expect(first.state.tabSize).toBe(2);
    expect(second.state.tabSize).toBe(4);
    first.dispatch({effects: mode.reconfigure(vimExEditing())});
    expect(first.state.tabSize).toBe(2);
    first.dispatch({effects: mode.reconfigure([])});
    expect(first.state.tabSize).toBe(4);
    const previous = text(first);
    ex(first, 'right 20');
    expect(text(first)).toBe(previous);
    ex(second, 'retab');
    expect(text(second)).toBe('    second');
  });

  it('retabs an empty document without introducing text or undo entries', () => {
    const view = create('');
    ex(view, 'retab 8');
    expect(text(view)).toBe('');
    expect(view.state.tabSize).toBe(8);
    keys(view, 'u');
    expect(text(view)).toBe('');
  });
});

describe('Vim display columns', () => {
  it('returns grapheme boundaries and cell widths, excluding the newline', () => {
    const cells = visualCells('a\t中e\u0301👩‍💻🇹🇼\nignored', 4);
    expect(cells.map(({column, width, text}) => [column, width, text])).toEqual([
      [0, 1, 'a'], [1, 3, '\t'], [4, 2, '中'], [6, 1, 'e\u0301'], [7, 2, '👩‍💻'], [9, 2, '🇹🇼'],
    ]);
    expect(cells.every(cell => 'a\t中e\u0301👩‍💻🇹🇼'.slice(cell.from, cell.to) === cell.text)).toBe(true);
  });

  it('uses the beginning of a grapheme for interior UTF-16 positions', () => {
    expect(displayColumn('\t😀x', 2, 4)).toBe(4);
    expect(displayColumn('\t😀x', 3, 4)).toBe(6);
    expect(displayColumn('e\u0301x', 1, 4)).toBe(0);
    expect(displayColumn('e\u0301x', 2, 4)).toBe(1);
  });

  it('counts fullwidth text, keycaps, control characters and ambiguous symbols', () => {
    expect(visualCells('Ａ©1️⃣\u0001\u0301', 4).map(cell => cell.width)).toEqual([2, 1, 2, 2]);
    expect(visualCells('\u0301', 4).map(cell => cell.width)).toEqual([0]);
  });
});
