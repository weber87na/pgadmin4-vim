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
import { getCM, Vim, vim } from '@replit/codemirror-vim';
import { vimSurround } from 'sources/components/ReactCodeMirror/extensions/vimSurround';

describe('Vim surround', () => {
  let views;

  function create(doc, anchor = 0, extensions = [], useVim = true) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: { anchor },
        extensions: [history(), ...(useVim ? [vim(), vimSurround()] : []), ...extensions],
      }),
    });
    views.push(view);
    view.focus();
    return view;
  }

  function keys(view, sequence) {
    for (const token of sequence.match(/<[^>]+>|./g) || []) {
      const ctrlKey = /^<C-/.test(token);
      const key = token === '<Esc>' ? 'Escape' : ctrlKey ? token.slice(3, -1) : token;
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
        key, ctrlKey,
        code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
        keyCode: key === 'Escape' ? 27 : key.toUpperCase().charCodeAt(0),
        shiftKey: /^[A-Z]$/.test(key),
        bubbles: true, cancelable: true,
      }));
    }
  }

  function insert(view, value) {
    // JSDOM has no native contenteditable input; this is the real CM6 input
    // transaction, including Vim's insertion-history recorder.
    view.dispatch(view.state.update({
      ...view.state.replaceSelection(value), userEvent: 'input.type',
    }));
  }

  const text = view => view.state.doc.toString();

  beforeEach(() => {
    views = [];
    Vim.resetVimGlobalState_();
  });

  afterEach(() => {
    for (const view of views) {
      const parent = view.dom.parentElement;
      view.destroy();
      parent.remove();
    }
  });

  it('adds a tight pair around a native inner-word text object', () => {
    const view = create('SELECT name FROM users', 8);
    keys(view, 'ysiw)');
    expect(text(view)).toBe('SELECT (name) FROM users');
    expect(view.state.selection.main.head).toBe(7);
    expect(getCM(view).state.vim.insertMode).toBe(false);
  });

  it.each([
    ['(', '( name )'], ['[', '[ name ]'], ['{', '{ name }'],
    [']', '[name]'], ['}', '{name}'], ['"', '"name"'],
    ['\'', '\'name\''], ['`', '`name`'], ['b', '(name)'],
    ['B', '{name}'], ['r', '[name]'],
  ])('supports delimiter %s', (delimiter, result) => {
    const view = create('name');
    keys(view, 'ysiw' + delimiter);
    expect(text(view)).toBe(result);
  });

  it('uses native motions and counts after ys', () => {
    const view = create('one two three');
    keys(view, 'ys2w]');
    expect(text(view)).toBe('[one two ]three');
  });

  it.each(['2ysiw]', 'y2siw]'])('supports a count before the surround operator: %s', sequence => {
    const view = create('one two three');
    keys(view, sequence);
    expect(text(view)).toBe('[one ]two three');
  });

  it('keeps a character-search motion distinct from the surround delimiter', () => {
    const view = create('one, two');
    keys(view, 'ysf,]');
    expect(text(view)).toBe('[one,] two');
  });

  it('adds yss around the current line while preserving indentation', () => {
    const view = create('  SELECT 1;  \nSELECT 2;', 5);
    keys(view, 'yss)');
    expect(text(view)).toBe('  (SELECT 1;)  \nSELECT 2;');
  });

  it('supports a count before yss', () => {
    const view = create('  one\n  two\nthree');
    keys(view, '2yss}');
    expect(text(view)).toBe('  {one\n  two}\nthree');
  });

  it('surrounds a backwards visual selection', () => {
    const view = create('one two', 2);
    keys(view, 'vhhS"');
    expect(text(view)).toBe('"one" two');
    expect(getCM(view).state.vim.visualMode).toBe(false);
  });

  it('surrounds every row in a visual block in one undo step', () => {
    const view = create('ab cd\nef gh');
    keys(view, '<C-v>jlS]');
    expect(text(view)).toBe('[ab] cd\n[ef] gh');
    keys(view, 'u');
    expect(text(view)).toBe('ab cd\nef gh');
  });

  it('deletes the nearest enclosing pair, preserving registers', () => {
    const view = create('outer(inner)', 8);
    const register = Vim.getRegisterController().getRegister('"');
    register.setText('copied SQL');
    keys(view, 'ds)');
    expect(text(view)).toBe('outerinner');
    expect(register.toString()).toBe('copied SQL');
  });

  it('deletes a counted enclosing pair and leaves the inner pair', () => {
    const view = create('((name))', 3);
    keys(view, '2ds)');
    expect(text(view)).toBe('(name)');
  });

  it('changes the surround and repeats it on another pair', () => {
    const view = create('(one) (two)', 1);
    keys(view, 'cs)]');
    expect(text(view)).toBe('[one] (two)');
    getCM(view).setCursor({ line: 0, ch: 8 });
    keys(view, '.');
    expect(text(view)).toBe('[one] [two]');
  });

  it('trims inner horizontal padding only with an opening source delimiter', () => {
    const view = create('(  name  )', 4);
    keys(view, 'cs(]');
    expect(text(view)).toBe('[name]');
  });

  it('matches SQL doubled quotes and ignores brackets in quoted strings', () => {
    const view = create('(\'it\'\'s ) fine\')', 3);
    keys(view, 'cs)]');
    expect(text(view)).toBe('[\'it\'\'s ) fine\']');
    keys(view, 'lcs\'"');
    expect(text(view)).toBe('["it\'\'s ) fine"]');
  });

  it('does not match parentheses inside SQL comments', () => {
    const view = create('(name /* ) */ + 1)', 2);
    keys(view, 'ds)');
    expect(text(view)).toBe('name /* ) */ + 1');
  });

  it.each(['$$ ) $$', '$text$ ) $text$'])('ignores brackets in a dollar-quoted SQL string: %s', literal => {
    const view = create('(SELECT ' + literal + ')', 2);
    keys(view, 'ds)');
    expect(text(view)).toBe('SELECT ' + literal);
  });

  it('does not change text when there is no enclosing pair', () => {
    const view = create('one (two)', 0);
    keys(view, 'ds)');
    expect(text(view)).toBe('one (two)');
  });

  it('preserves registers, dot repeat, and one-step undo for ys', () => {
    const view = create('one two');
    const register = Vim.getRegisterController().getRegister('"');
    register.setText('saved');
    keys(view, 'ysiw)');
    getCM(view).setCursor({ line: 0, ch: 6 });
    keys(view, '.');
    expect(text(view)).toBe('(one) (two)');
    expect(register.toString()).toBe('saved');
    keys(view, 'u');
    expect(text(view)).toBe('(one) two');
    keys(view, 'u');
    expect(text(view)).toBe('one two');
  });

  it('records and replays a complete surround macro', () => {
    const view = create('one two');
    keys(view, 'qaysiw)q');
    getCM(view).setCursor({ line: 0, ch: 6 });
    keys(view, '@a');
    expect(text(view)).toBe('(one) (two)');
  });

  it('cancels a pending delimiter with Escape and keeps the previous dot edit', () => {
    const view = create('one two');
    keys(view, 'xysiw<Esc>');
    expect(text(view)).toBe('ne two');
    keys(view, '.');
    expect(text(view)).toBe('e two');
  });

  it.each(['ys', 'cs', 'cs)', 'ds'])('cancels %s and preserves the previous dot edit', sequence => {
    const view = create('one two');
    keys(view, 'x' + sequence + '<Esc>.');
    expect(text(view)).toBe('e two');
  });

  it.each(['ysiw<Esc>', 'cs)<Esc>', 'ys<Esc>', 'ysiwx', 'cs)x'])('preserves inserted ciw text after cancelling %s', sequence => {
    const view = create('one two three');
    keys(view, 'ciw');
    insert(view, 'changed');
    keys(view, '<Esc>');
    getCM(view).setCursor({ line: 0, ch: 8 });
    keys(view, sequence);
    getCM(view).setCursor({ line: 0, ch: 12 });
    keys(view, '.');
    expect(text(view)).toBe('changed two changed');
  });

  it('preserves plain Insert repetition after cancelling surround', () => {
    const view = create('one two');
    keys(view, 'i');
    insert(view, 'pre');
    keys(view, '<Esc>ysiw<Esc>');
    getCM(view).setCursor({ line: 0, ch: 7 });
    keys(view, '.');
    expect(text(view)).toBe('preone pretwo');
  });

  it('does not restore an old shared replay buffer over another editor\'s later insertion', () => {
    const first = create('one two');
    const second = create('one two');
    first.focus();
    keys(first, 'ciw');
    insert(first, 'first');
    keys(first, '<Esc>ysiw');
    // Dispatch without transferring focus, so first's pending operation is
    // cancelled only after the second editor has recorded its later edit.
    keys(second, 'ciw');
    insert(second, 'second');
    keys(second, '<Esc>');
    first.contentDOM.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    getCM(second).setCursor({ line: 0, ch: 7 });
    keys(second, '.');
    expect(text(second)).toBe('second second');
  });

  it('cancels an unsupported delimiter and keeps normal mode', () => {
    const view = create('one two');
    keys(view, 'ysiwx');
    expect(text(view)).toBe('one two');
    keys(view, 'l');
    expect(view.state.selection.main.head).toBe(1);
    expect(getCM(view).state.vim.insertMode).toBe(false);
  });

  it('abandons an invalid surround motion without changing the next native dot edit', () => {
    const view = create('one two three');
    keys(view, 'ysxdw.');
    expect(text(view)).toBe('three');
  });

  it.each(['ysiw', 'ys', 'cs)', 'cs', 'ds'])('clears the native %s prefix on blur so the next x edits normally', sequence => {
    const view = create('one two');
    keys(view, sequence);
    view.contentDOM.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    view.focus();
    keys(view, 'x');
    expect(text(view)).toBe('ne two');
  });

  it('preserves native y/d/c commands', () => {
    const view = create('one two');
    keys(view, 'yiw');
    expect(Vim.getRegisterController().getRegister('"').toString()).toBe('one');
    keys(view, 'dw');
    expect(text(view)).toBe('two');
    keys(view, 'ciw');
    expect(text(view)).toBe('');
    expect(getCM(view).state.vim.insertMode).toBe(true);
  });

  it('does not modify a read-only editor', () => {
    const view = create('(one)', 2, [EditorState.readOnly.of(true)]);
    keys(view, 'ds)cs)]ysiw"');
    expect(text(view)).toBe('(one)');
  });

  it('checks read-only again when finishing an already pending surround', () => {
    const readonly = new Compartment();
    const view = create('one', 0, [readonly.of(EditorState.readOnly.of(false))]);
    keys(view, 'ysiw');
    view.dispatch({ effects: readonly.reconfigure(EditorState.readOnly.of(true)) });
    keys(view, ')');
    expect(text(view)).toBe('one');
  });

  it('keeps a pending surround during unrelated editor reconfiguration', () => {
    const option = new Compartment();
    const view = create('one', 0, [option.of(EditorState.tabSize.of(2))]);
    keys(view, 'ysiw');
    view.dispatch({ effects: option.reconfigure(EditorState.tabSize.of(4)) });
    keys(view, ')');
    expect(text(view)).toBe('(one)');
  });

  it('discards a pending surround when the Vim extension is disabled', () => {
    const mode = new Compartment();
    const view = create('one two', 0, [mode.of([vim(), vimSurround()])], false);
    keys(view, 'ysiw');
    view.dispatch({ effects: mode.reconfigure([]) });
    view.dispatch({ effects: mode.reconfigure([vim(), vimSurround()]) });
    keys(view, 'l');
    expect(text(view)).toBe('one two');
    expect(view.state.selection.main.head).toBe(1);
  });
});
