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
import vimChanges from 'sources/components/ReactCodeMirror/extensions/vimChanges';

describe('Vim change list', () => {
  let views;
  const doc = 'alpha\nbeta\ngamma\ndelta\nomega';
  function create(text = doc, extra = [], install = true) {
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new EditorView({parent, state: EditorState.create({doc: text,
      extensions: [vim(), history(), install ? vimChanges() : [], extra]})});
    views.push(view);
    return view;
  }
  function keys(view, sequence) {
    for (const key of sequence.match(/<[^>]+>|./g)) Vim.handleKey(getCM(view), key, 'user');
  }
  const ex = (view, command = 'changes') => Vim.handleEx(getCM(view), command);
  const line = view => view.state.doc.lineAt(view.state.selection.main.head).number;
  function editThree(view) { keys(view, 'x3Gx5Gx'); }
  beforeEach(() => { views = []; Vim.resetVimGlobalState_(); });
  afterEach(() => {
    for (const view of views) { const parent = view.dom.parentElement; view.destroy(); parent.remove(); }
  });

  it('walks older and newer changes without editing text', () => {
    const view = create();
    editThree(view);
    const text = view.state.doc.toString();
    keys(view, 'ggg;');
    expect(line(view)).toBe(5);
    keys(view, 'g;');
    expect(line(view)).toBe(3);
    keys(view, 'g;');
    expect(line(view)).toBe(1);
    keys(view, 'g,');
    expect(line(view)).toBe(3);
    keys(view, 'g,');
    expect(line(view)).toBe(5);
    expect(view.state.doc.toString()).toBe(text);
  });
  it('clamps large counts at both ends', () => {
    const view = create();
    editThree(view);
    keys(view, '99g;');
    expect(line(view)).toBe(1);
    keys(view, '99g,');
    expect(line(view)).toBe(5);
  });
  it('reports empty lists and boundaries without moving', () => {
    const view = create();
    keys(view, 'g;');
    expect(view.dom.textContent).toContain('empty');
    keys(view, 'xg,g;g;');
    expect(view.dom.textContent).toContain('No more changes');
    expect(line(view)).toBe(1);
  });
  it('coalesces nearby changes on one line', () => {
    const view = create();
    keys(view, 'xxx3Gx2g;');
    expect(line(view)).toBe(1);
    keys(view, 'g;');
    expect(view.dom.textContent).toContain('No more changes');
  });
  it('keeps distant same-line changes separate', () => {
    const view = create('a'.repeat(180));
    keys(view, 'x100lx2g;');
    expect(view.state.selection.main.head).toBe(0);
    keys(view, 'g,');
    expect(view.state.selection.main.head).toBe(100);
  });
  it('coalesces typed text and handles multiline insertion', () => {
    const view = create();
    keys(view, 'i');
    for (const text of ['a', 'b', '\nc']) view.dispatch({...view.state.replaceSelection(text), userEvent: 'input.type'});
    keys(view, '<Esc>G2g;');
    expect(line(view)).toBe(1);
    expect(view.state.doc.toString()).toContain('ab\nc');
  });
  it('maps earlier positions through inserted and deleted lines', () => {
    const view = create();
    keys(view, '3Gx');
    view.dispatch({changes: {from: 0, insert: 'prefix\n'}});
    keys(view, 'ggg;');
    expect(line(view)).toBe(4);
    view.dispatch({changes: {from: 0, to: 7}});
    keys(view, 'xggg;');
    expect(line(view)).toBe(3);
  });
  it('retains changes through undo and redo without new entries', () => {
    const view = create();
    editThree(view);
    keys(view, 'u<C-r>3g;');
    expect(line(view)).toBe(1);
    keys(view, '2g,');
    expect(line(view)).toBe(5);
  });
  it('maps deleted change locations to a valid remaining position', () => {
    const view = create();
    keys(view, '3Gx');
    view.dispatch({changes: {from: 0, to: view.state.doc.length}});
    keys(view, 'g;');
    expect(view.state.selection.main.head).toBe(0);
  });
  it('resets navigation to newest after editing while browsing', () => {
    const view = create();
    editThree(view);
    keys(view, '3g;2GxGg;');
    expect(line(view)).toBe(2);
    keys(view, 'g;');
    expect(line(view)).toBe(5);
  });
  it('limits the list to the latest 100 locations', () => {
    const view = create(Array.from({length: 105}, () => 'abc').join('\n'));
    for (let number = 1; number <= 105; number++) keys(view, number + 'Gx');
    keys(view, '999g;');
    expect(line(view)).toBe(6);
  });
  it('prints safe text and the selected entry through the real prompt', () => {
    const view = create('x<img src=x>\nsecond');
    keys(view, 'x2Gxg;:');
    const input = view.dom.querySelector('.cm-vim-panel input');
    input.value = 'changes';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, bubbles: true}));
    expect(view.dom.querySelector('pre').textContent).toContain('> 0  2  0');
    expect(view.dom.querySelector('pre').textContent).toContain('<img src=x>');
    expect(view.dom.querySelector('pre img')).toBeNull();
  });
  it.each(['1changes', 'changes!', 'changes garbage'])('rejects unsupported %s', command => {
    const view = create();
    ex(view, command);
    expect(view.dom.textContent).toContain('without a range');
    expect(view.state.doc.toString()).toBe(doc);
  });
  it('isolates editors and respects extension removal', () => {
    const mode = new Compartment();
    const first = create(doc, mode.of(vimChanges()), false);
    const second = create();
    editThree(first);
    keys(second, 'g;');
    expect(second.dom.textContent).toContain('empty');
    first.dispatch({effects: mode.reconfigure([])});
    keys(first, 'ggg;');
    expect(line(first)).toBe(1);
    first.dispatch({effects: mode.reconfigure(vimChanges())});
    keys(first, 'g;');
    expect(first.dom.textContent).toContain('empty');
  });
  it('clears history on explicit document replacement', () => {
    const view = create();
    editThree(view);
    view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: 'new'}, userEvent: 'document.replace'});
    keys(view, 'g;');
    expect(view.dom.textContent).toContain('empty');
  });
  it('navigates retained locations after switching to read-only', () => {
    const lock = new Compartment();
    const view = create(doc, lock.of(EditorState.readOnly.of(false)));
    editThree(view);
    view.dispatch({effects: lock.reconfigure(EditorState.readOnly.of(true))});
    keys(view, '2g;');
    expect(line(view)).toBe(3);
  });
  it('does not add undo entries while navigating or listing', () => {
    const view = create();
    keys(view, 'xg;');
    ex(view);
    keys(view, 'u');
    expect(view.state.doc.toString()).toBe(doc);
  });
  it('does not mutate an earlier EditorState', () => {
    const view = create();
    editThree(view);
    const previous = view.state;
    const text = previous.doc.toString();
    keys(view, '2g;x');
    expect(previous.doc.toString()).toBe(text);
    expect(previous.selection.main.head).toBe(previous.doc.line(5).from);
  });
});
