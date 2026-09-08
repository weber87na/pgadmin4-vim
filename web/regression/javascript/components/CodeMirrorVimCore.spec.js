/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { PostgreSQL, sql } from '@codemirror/lang-sql';
import { getCM, vim, Vim } from '@replit/codemirror-vim';

// Exercise the installed Vim engine through real editor keyboard handlers. This
// inventory prevents extensions from accidentally replacing working core keys.
describe('CodeMirror Vim core commands', () => {
  let view, parent;

  function editor(doc, anchor = 0) {
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        selection: { anchor },
        extensions: [vim(), history(), sql({ dialect: PostgreSQL })],
      }),
    });
    view.focus();
    return getCM(view);
  }

  function press(sequence) {
    for (const token of sequence.match(/<[^>]+>|./g) || []) {
      const special = { '<Esc>': 'Escape', '<CR>': 'Enter', '<Tab>': 'Tab' };
      const ctrlKey = /^<C-/.test(token);
      const key = special[token] || (ctrlKey ? token.slice(3, -1) : token);
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
        key,
        code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
        keyCode: key === 'Escape' ? 27 : key === 'Enter' ? 13 : key.toUpperCase().charCodeAt(0),
        ctrlKey,
        shiftKey: /^[A-Z]$/.test(key),
        bubbles: true,
        cancelable: true,
      }));
    }
  }

  function insert(text) {
    // JSDOM does not perform contenteditable's native text insertion. Dispatch
    // its actual CodeMirror transaction, retaining Vim's insert-change recorder.
    view.dispatch(view.state.update({
      ...view.state.replaceSelection(text),
      userEvent: 'input.type',
    }));
  }

  function prompt(prefix, value) {
    press(prefix);
    const input = view.dom.querySelector('.cm-vim-panel input');
    expect(input).not.toBeNull();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', keyCode: 13, bubbles: true, cancelable: true,
    }));
  }

  const text = () => view.state.doc.toString();
  const cursor = () => view.state.selection.main.head;

  beforeEach(() => {
    Vim.resetVimGlobalState_();
    parent = document.createElement('div');
    document.body.appendChild(parent);
  });

  afterEach(() => {
    view?.destroy();
    view = null;
    parent.remove();
  });

  it('moves with counts and distinguishes line start from first nonblank', () => {
    editor('  SELECT column');
    press('3l');
    expect(cursor()).toBe(3);
    press('0');
    expect(cursor()).toBe(0);
    press('^');
    expect(cursor()).toBe(2);
    press('$');
    expect(cursor()).toBe(14);
    press('2h');
    expect(cursor()).toBe(12);
  });

  it('moves by words and back to their boundaries', () => {
    editor('one two three');
    press('2w');
    expect(cursor()).toBe(8);
    press('b');
    expect(cursor()).toBe(4);
    press('e');
    expect(cursor()).toBe(6);
  });

  it('jumps to first, last and numbered lines', () => {
    editor('one\ntwo\nthree\nfour');
    press('G');
    expect(cursor()).toBe(14);
    press('gg');
    expect(cursor()).toBe(0);
    press('3G');
    expect(cursor()).toBe(8);
  });

  it('repeats and reverses character searches', () => {
    editor('a,b,c,d');
    press('f,');
    expect(cursor()).toBe(1);
    press(';');
    expect(cursor()).toBe(3);
    press(',');
    expect(cursor()).toBe(1);
  });

  it('matches nested parentheses with percent', () => {
    editor('SELECT (a + (b));', 7);
    press('%');
    expect(cursor()).toBe(15);
    press('%');
    expect(cursor()).toBe(7);
  });

  it('multiplies operator and motion counts when deleting words', () => {
    editor('one two three four five');
    press('2d2w');
    expect(text()).toBe('five');
  });

  it('deletes complete lines and puts them back as lines', () => {
    editor('one\ntwo\nthree');
    press('ddp');
    expect(text()).toBe('two\none\nthree');
  });

  it('changes an inner word, records inserted text and repeats the change', () => {
    const cm = editor('one two', 1);
    press('ciw');
    expect(cm.state.vim.insertMode).toBe(true);
    insert('new');
    press('<Esc>w.');
    expect(text()).toBe('new new');
    expect(cm.state.vim.insertMode).toBe(false);
  });

  it('deletes nested parenthesis contents without deleting delimiters', () => {
    editor('SELECT (one + (two));', 16);
    press('di(');
    expect(text()).toBe('SELECT (one + ());');
  });

  it('deletes around quoted text including its delimiters', () => {
    editor('SELECT("column");', 10);
    press('da"');
    expect(text()).toBe('SELECT();');
  });

  it('joins lines and normalizes indentation with uppercase J', () => {
    editor('SELECT one\n  FROM tbl');
    press('J');
    expect(text()).toBe('SELECT one FROM tbl');
  });

  it('joins lines without changing whitespace with gJ', () => {
    editor('SELECT one\n  FROM tbl');
    press('gJ');
    expect(text()).toBe('SELECT one  FROM tbl');
  });

  it('undoes and redoes an edit using u and Ctrl-r', () => {
    editor('one two');
    press('dw');
    expect(text()).toBe('two');
    press('u');
    expect(text()).toBe('one two');
    press('<C-r>');
    expect(text()).toBe('two');
  });

  it('repeats a deletion using dot with a replacement count', () => {
    editor('abcdef');
    press('x2.');
    expect(text()).toBe('def');
  });

  it('restores the last characterwise visual selection with gv', () => {
    const cm = editor('one two');
    press('ve');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('one');
    press('<Esc>$gv');
    expect(cm.state.vim.visualMode).toBe(true);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('one');
  });

  it('deletes a linewise visual selection as one undoable edit', () => {
    editor('one\ntwo\nthree');
    // Numbered line motion does not depend on JSDOM's missing text geometry.
    press('V2Gd');
    expect(text()).toBe('three');
    press('u');
    expect(text()).toBe('one\ntwo\nthree');
  });

  it('yanks into a named register and puts its linewise contents', () => {
    editor('one\ntwo');
    press('"ayyG"ap');
    expect(text()).toBe('one\ntwo\none');
  });

  it('keeps the unnamed register when deleting into the black hole', () => {
    editor('one two three');
    press('yiww"_dwP');
    expect(text()).toBe('one onethree');
  });

  it('records a macro, plays it and repeats the last macro with @@', () => {
    editor('abc def ghi jkl');
    press('qaxwq@a@@');
    expect(text()).toBe('bc ef hi jkl');
  });

  it('returns to a mark at its exact character position', () => {
    editor('one\ntwo\nthree', 1);
    press('maG`a');
    expect(cursor()).toBe(1);
  });

  it('walks the jump list backward and forward', () => {
    editor('one\ntwo\nthree');
    press('G<C-o>');
    expect(cursor()).toBe(0);
    press('<C-i>');
    expect(cursor()).toBe(8);
  });

  it('searches from the real prompt and navigates with n and N', () => {
    editor('one two one three one');
    prompt('/', 'one');
    expect(cursor()).toBe(8);
    press('n');
    expect(cursor()).toBe(18);
    press('N');
    expect(cursor()).toBe(8);
  });

  it('searches backward for the current whole word using #', () => {
    editor('one someone one', 12);
    press('#');
    expect(cursor()).toBe(0);
    press('n');
    expect(cursor()).toBe(12);
  });

  it('substitutes all matches in the document from the Ex prompt', () => {
    editor('SELECT foo, foo;\nSELECT foo;');
    prompt(':', '%s/foo/bar/g');
    expect(text()).toBe('SELECT bar, bar;\nSELECT bar;');
  });

  it('toggles SQL line comments with gcc and counted gcc', () => {
    editor('SELECT 1;\nSELECT 2;');
    press('2gcc');
    expect(text()).toBe('-- SELECT 1;\n-- SELECT 2;');
    press('gggcc');
    expect(text()).toBe('SELECT 1;\n-- SELECT 2;');
  });
});
