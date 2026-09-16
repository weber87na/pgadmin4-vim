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
import vimNumbers from 'sources/components/ReactCodeMirror/extensions/vimNumbers';

describe('Vim precise numeric edits', () => {
  let views;
  function create(doc, extra = []) {
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new EditorView({parent, state: EditorState.create({
      doc, extensions: [vim(), history(), vimNumbers(), EditorState.allowMultipleSelections.of(true), extra],
    })});
    views.push(view);
    // JSDOM has zero-height lines: the adapter's geometry-based vertical move
    // otherwise jumps to the document end. These documents have no folds or
    // wrapping, so provide their logical line geometry for real j/k key tests.
    const cm = getCM(view);
    jest.spyOn(cm, 'findPosV').mockImplementation((pos, amount) => ({
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
  const text = view => view.state.doc.toString();
  beforeEach(() => { views = []; Vim.resetVimGlobalState_(); });
  afterEach(() => {
    for (const view of views) { const parent = view.dom.parentElement; view.destroy(); parent.remove(); }
  });

  it.each([
    ['9007199254740993', '<C-a>', '9007199254740994'],
    ['-9007199254740993', '2<C-x>', '-9007199254740995'],
    ['0', '9007199254740993<C-a>', '9007199254740993'],
    ['x 009 tail', '<C-a>', 'x 010 tail'],
    ['x -003 tail', '<C-a>', 'x -002 tail'],
    ['x 123 tail', '3l<C-a>', 'x 124 tail'],
    ['0x0f', '<C-a>', '0x10'],
    ['0XFF', '<C-a>', '0X100'],
    ['-0xff', '<C-a>', '-0x100'],
    ['0b0011', '<C-a>', '0b0100'],
    ['0x00', '<C-x>', '0xffffffffffffffff'],
    ['1000', '999<C-x>', '1'],
  ])('changes %s with %s without rounding or losing format', (doc, keys, expected) => {
    const view = create(doc);
    press(view, keys);
    expect(text(view)).toBe(expected);
    press(view, 'u');
    expect(text(view)).toBe(doc);
    press(view, '<C-r>');
    expect(text(view)).toBe(expected);
  });
  it.each([
    ['ggVG<C-a>', 'x 02 y 90\nno digits\nx 02 y 90\nx 02 y 90'],
    ['ggVGg<C-a>', 'x 02 y 90\nno digits\nx 03 y 90\nx 04 y 90'],
    ['GVggg<C-a>', 'x 02 y 90\nno digits\nx 03 y 90\nx 04 y 90'],
    ['ggVG3g<C-x>', 'x -02 y 90\nno digits\nx -05 y 90\nx -08 y 90'],
  ])('applies selected-line operations in document order: %s', (keys, expected) => {
    const doc = 'x 01 y 90\nno digits\nx 01 y 90\nx 01 y 90';
    const view = create(doc);
    press(view, keys);
    expect(text(view)).toBe(expected);
    expect(getCM(view).state.vim.visualMode).toBe(false);
    expect(view.state.selection.main.head).toBe(0);
    press(view, 'u');
    expect(text(view)).toBe(doc);
  });
  it.each([
    ['lv<C-a>', 'a223 b20'],
    ['3lv2l<C-a>', 'a124 b20'],
    ['$v3h<C-a>', 'a123 b21'],
  ])('limits character selection changes to selected digits: %s', (keys, expected) => {
    const view = create('a123 b20');
    press(view, keys);
    expect(text(view)).toBe(expected);
  });
  it('supports block selections, partial integers and reverse block selections', () => {
    const view = create('100 100\n100 100\n100 100');
    press(view, '<C-v>jjlg<C-a>');
    expect(text(view)).toBe('110 100\n120 100\n130 100');
    press(view, 'uG0l<C-v>gg0g<C-a>');
    expect(text(view)).toBe('110 100\n120 100\n130 100');
  });
  it('preserves Unicode and skips empty selected lines', () => {
    const view = create('中文 😀 9007199254740993\n\n中文 009');
    press(view, 'VGg<C-a>');
    expect(text(view)).toBe('中文 😀 9007199254740994\n\n中文 011');
  });
  it('does not scan past the selected character range or wrap to another line', () => {
    const view = create('plain 10\n20');
    press(view, 'v3l<C-a>');
    expect(text(view)).toBe('plain 10\n20');
    press(view, '$l<C-a>');
    expect(text(view)).toBe('plain 11\n20');
  });
  it('repeats normal numeric edits and replacement counts with dot', () => {
    const view = create('1 1 1');
    press(view, '3<C-a>w.w2.');
    expect(text(view)).toBe('4 4 3');
  });
  it('retains exact large counts when replayed with dot', () => {
    const view = create('0');
    press(view, '9007199254740993<C-a>.');
    expect(text(view)).toBe('18014398509481986');
  });
  it.each([
    ['123 123', 'vl<C-a>w.', '133 133'],
    ['1 x9\n1 x9\n1 x9\n1 x9', 'vjl<C-a>jj.', '2 x9\n2 x9\n2 x9\n2 x9'],
    ['100 100\n100 100\n100 100\n100 100', '<C-v>jlg<C-a>jj.', '110 100\n120 100\n110 100\n120 100'],
    ['1\n1\n1\n1', 'Vj2g<C-a>jj3.', '3\n5\n4\n7'],
  ])('replays selection shape and counts: %s', (doc, keys, expected) => {
    const view = create(doc);
    press(view, keys);
    expect(text(view)).toBe(expected);
  });
  it('repeats visual sequence shape with dot and records keys in macros', () => {
    const view = create('1\n1\n1\n1\n1\n1');
    press(view, 'Vjg<C-a>jj.');
    expect(text(view)).toBe('2\n3\n2\n3\n1\n1');
    press(view, 'ggqaVjg<C-a>q4j@a');
    expect(text(view)).toBe('3\n5\n2\n3\n2\n3');
  });
  it('keeps separate edits as separate undo steps', () => {
    const view = create('1');
    press(view, '<C-a><C-a>u');
    expect(text(view)).toBe('2');
    press(view, 'u');
    expect(text(view)).toBe('1');
  });
  it('preserves the previous repeat when no number is found', () => {
    const view = create('abc\nxyz');
    press(view, 'xj<C-a>.');
    expect(text(view)).toBe('bc\nyz');
  });
  it('preserves inserted text for dot after an unsuccessful numeric command', () => {
    const view = create('one\ntwo');
    press(view, 'ciw');
    view.dispatch(view.state.update({...view.state.replaceSelection('text'), userEvent: 'input.type'}));
    press(view, '<Esc>j0<C-a>.');
    expect(text(view)).toBe('text\ntext');
  });
  it.each([
    ['octal', '007 009 -077', '<C-a>w<C-a>w<C-a>', '010 10 -0100'],
    ['', '0x10 007', '<C-a>w<C-a>', '1x10 008'],
    ['alpha', 'a Z', '<C-a>w<C-a>', 'b Z'],
    ['unsigned', '1 -2', '5<C-x>w<C-a>', '0 -3'],
  ])('honors nrformats=%s', (formats, doc, keys, expected) => {
    const view = create(doc);
    Vim.handleEx(getCM(view), 'setlocal nrformats=' + formats);
    press(view, keys);
    expect(text(view)).toBe(expected);
  });
  it('supports nf alias, rejects invalid formats and isolates local options', () => {
    const first = create('007');
    const second = create('007');
    Vim.setOption('nf', 'octal', getCM(first), {scope: 'local'});
    expect(() => Vim.setOption('nrformats', 'hex,bogus', getCM(first), {scope: 'local'})).toThrow(/Invalid nrformats/);
    press(first, '<C-a>'); press(second, '<C-a>');
    expect(text(first)).toBe('010'); expect(text(second)).toBe('008');
  });
  it('keeps :set nrformats local and leaves new editors at their defaults', () => {
    const first = create('007');
    Vim.handleEx(getCM(first), 'set nrformats=octal');
    const second = create('007');
    press(first, '<C-a>'); press(second, '<C-a>');
    expect(text(first)).toBe('010'); expect(text(second)).toBe('008');
  });
  it('preserves the original core behavior in editors without this extension', () => {
    create('0');
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new EditorView({parent, state: EditorState.create({doc: '12', extensions: [vim(), history()]})});
    views.push(view);
    press(view, '3<C-a>.');
    expect(text(view)).toBe('18');
  });
  it.each([EditorState.readOnly.of(true), EditorView.editable.of(false)])('protects non-editable documents', extra => {
    const view = create('1\n1', extra);
    press(view, '<C-a>Vjg<C-a>');
    expect(text(view)).toBe('1\n1');
  });
  it('keeps visual repeats independent between editors', () => {
    const first = create('1\n1\n1\n1');
    const second = create('1\n1\n1');
    press(first, 'Vjg<C-a>');
    press(second, 'VGg<C-x>');
    press(first, 'jj.');
    expect(text(first)).toBe('2\n3\n2\n3');
  });
  it('falls back to the original core after the extension is removed', () => {
    const mode = new Compartment();
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new EditorView({parent, state: EditorState.create({
      doc: '1', extensions: [vim(), history(), mode.of(vimNumbers())],
    })});
    views.push(view);
    view.dispatch({effects: mode.reconfigure([])});
    press(view, '<C-a>');
    expect(text(view)).toBe('2');
  });
});
