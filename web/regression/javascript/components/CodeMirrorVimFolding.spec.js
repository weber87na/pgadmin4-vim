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
import { json } from '@codemirror/lang-json';
import { codeFolding, foldedRanges } from '@codemirror/language';
import { getCM, Vim, vim } from '@replit/codemirror-vim';
import vimFolding from 'sources/components/ReactCodeMirror/extensions/vimFolding';
import plpgsqlFoldService from 'sources/components/ReactCodeMirror/extensions/plpgsqlFoldService';

describe('Vim folding', () => {
  const documentText = '{\n  "first": {\n    "value": 1\n  },\n  "second": {\n    "value": 2\n  }\n}';
  let views;

  function create(options = {}) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: documentText,
        extensions: [json(), vim(), vimFolding()],
        ...options,
      }),
    });
    views.push(view);
    return view;
  }

  function keys(view, input) {
    for (const key of input.match(/<[^>]+>|./g) || []) Vim.handleKey(getCM(view), key, 'user');
  }

  function folds(view) {
    const ranges = [];
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      ranges.push({from, to});
    });
    return ranges;
  }

  beforeEach(() => {
    views = [];
  });

  afterEach(() => {
    for (const view of views) {
      const parent = view.dom.parentElement;
      view.destroy();
      parent.remove();
    }
  });

  it('closes, opens, and toggles folds through actual Vim key sequences', () => {
    const view = create();
    keys(view, 'zo');
    expect(folds(view)).toHaveLength(0);
    keys(view, 'zc');
    expect(folds(view)).toHaveLength(1);
    keys(view, 'zo');
    expect(folds(view)).toHaveLength(0);
    keys(view, 'za');
    expect(folds(view)).toHaveLength(1);
    keys(view, 'za');
    expect(folds(view)).toHaveLength(0);
    expect(view.state.doc.toString()).toBe(documentText);
  });

  it('zM closes nested folds and zR opens every fold', () => {
    const view = create();
    keys(view, 'zM');
    expect(folds(view)).toHaveLength(3);
    keys(view, 'zo');
    expect(folds(view)).toHaveLength(2);
    keys(view, 'zR');
    expect(folds(view)).toHaveLength(0);
  });

  it('opens the requested depth without opening siblings outside that fold', () => {
    const view = create();
    keys(view, 'zM2zo');
    expect(folds(view)).toHaveLength(0);
    keys(view, 'zMzo');
    view.dispatch({selection: {anchor: view.state.doc.line(2).from}});
    keys(view, 'zo');
    expect(folds(view)).toHaveLength(1);
    expect(view.state.doc.lineAt(folds(view)[0].from).number).toBe(5);
  });

  it('closes from within a block and uses counts to close enclosing levels', () => {
    const view = create({selection: {anchor: documentText.indexOf('"value"')}});
    keys(view, '2zc');
    expect(folds(view)).toHaveLength(2);
    expect(view.state.selection.main.head).toBe(0);
    keys(view, 'zo');
    expect(folds(view)).toHaveLength(1);
    expect(view.state.doc.lineAt(folds(view)[0].from).number).toBe(2);
  });

  it('repeated zc closes a parent instead of a hidden child', () => {
    const view = create({selection: {anchor: documentText.indexOf('"first"')}});
    keys(view, 'zc');
    expect(folds(view)).toHaveLength(1);
    keys(view, 'zc');
    expect(folds(view)).toHaveLength(2);
    keys(view, 'zc');
    expect(folds(view)).toHaveLength(2);
  });

  it('preserves a cursor on the fold header and never mutates prior state', () => {
    const view = create({selection: {anchor: documentText.indexOf('"first"')}});
    const previous = view.state;
    const selections = previous.selection.ranges.slice();
    keys(view, 'zc');
    expect(view.state.selection.main.head).toBe(documentText.indexOf('"first"'));
    expect(previous.selection.ranges).toEqual(selections);
    expect(previous.doc.toString()).toBe(documentText);
  });

  it('folds read-only editors without modifying their text', () => {
    const view = create({extensions: [json(), vim(), vimFolding(), EditorState.readOnly.of(true)]});
    keys(view, 'zM');
    expect(folds(view)).toHaveLength(3);
    keys(view, 'zR');
    expect(folds(view)).toHaveLength(0);
    expect(view.state.doc.toString()).toBe(documentText);
  });

  it('uses the PL/pgSQL fold service', () => {
    const view = create({
      doc: 'BEGIN\n  SELECT 1;\n  SELECT 2;\nEND;',
      extensions: [plpgsqlFoldService, vim(), vimFolding()],
    });
    keys(view, 'zc');
    expect(folds(view)).toEqual([{from: 5, to: 29}]);
    keys(view, 'zo');
    expect(folds(view)).toHaveLength(0);
  });

  it('folds nested PL/pgSQL blocks across a long SQL script', () => {
    const sql = [
      'DO $$', 'BEGIN', '  IF true THEN',
      ...Array.from({length: 200}, (_, index) => `    PERFORM ${index};`),
      '  END IF;', 'END;', '$$;', '',
      'DO $$', 'BEGIN', '  PERFORM 1;', '  PERFORM 2;', 'END;', '$$;',
    ].join('\n');
    const view = create({doc: sql, extensions: [plpgsqlFoldService, vim(), vimFolding()]});
    keys(view, 'zM');
    expect(folds(view)).toHaveLength(3);
    view.dispatch({selection: {anchor: view.state.doc.line(2).from}});
    keys(view, 'zo');
    expect(folds(view)).toHaveLength(2);
    expect(folds(view).map(range => view.state.doc.lineAt(range.from).number).sort((a, b) => a - b))
      .toEqual([3, 209]);
    keys(view, 'zR');
    expect(folds(view)).toHaveLength(0);
    expect(view.state.doc.toString()).toBe(sql);
  });

  it('does nothing on plain text without a fold range', () => {
    const view = create({doc: 'SELECT 1;\nSELECT 2;'});
    keys(view, 'zczozazMzR');
    expect(folds(view)).toHaveLength(0);
    expect(view.state.doc.toString()).toBe('SELECT 1;\nSELECT 2;');
  });

  it('respects the disabled code-folding preference', () => {
    const view = create({extensions: [json(), codeFolding(), vim(), vimFolding(false)]});
    keys(view, 'zMzcza');
    expect(folds(view)).toHaveLength(0);
    expect(view.state.doc.toString()).toBe(documentText);
  });

  it('keeps folds isolated between editors and disabled outside its extension', () => {
    const first = create();
    const second = create();
    const unscoped = create({extensions: [json(), codeFolding(), vim()]});
    keys(first, 'zc');
    keys(unscoped, 'zM');
    expect(folds(first)).toHaveLength(1);
    expect(folds(second)).toHaveLength(0);
    expect(folds(unscoped)).toHaveLength(0);
  });

  it('supports disabling and re-enabling Vim without accumulating mappings', () => {
    const mode = new Compartment();
    const view = create({extensions: [json(), mode.of([vim(), vimFolding()])]});
    keys(view, 'zc');
    view.dispatch({effects: mode.reconfigure([])});
    view.dispatch({effects: mode.reconfigure([vim(), vimFolding()])});
    keys(view, 'za');
    expect(folds(view)).toHaveLength(1);
    keys(view, 'za');
    expect(folds(view)).toHaveLength(0);
  });
  it('zC closes enclosing folds without closing an unrelated sibling', () => {
    const view = create({selection: {anchor: documentText.indexOf('"value"')}});
    keys(view, 'zC');
    expect(folds(view)).toHaveLength(2);
    keys(view, 'zo');
    expect(folds(view).map(range => view.state.doc.lineAt(range.from).number)).toEqual([2]);
  });
  it('zO recursively opens a subtree and leaves other subtrees closed', () => {
    const view = create();
    keys(view, 'zMzo');
    view.dispatch({selection: {anchor: view.state.doc.line(2).from}});
    keys(view, 'zO');
    expect(folds(view).map(range => view.state.doc.lineAt(range.from).number)).toEqual([5]);
    keys(view, 'ggzMzO');
    expect(folds(view)).toHaveLength(0);
  });
  it('zA recursively toggles the current subtree', () => {
    const view = create();
    keys(view, 'zA');
    expect(folds(view)).toHaveLength(3);
    keys(view, 'zA');
    expect(folds(view)).toHaveLength(0);
    view.dispatch({selection: {anchor: view.state.doc.line(2).from}});
    keys(view, 'zA');
    expect(folds(view).map(range => view.state.doc.lineAt(range.from).number)).toEqual([2]);
  });
  it('zm and zr adjust nesting levels with counts', () => {
    const view = create();
    for (const [command, count] of [['zm', 2], ['zm', 3], ['zr', 2], ['zr', 0], ['2zm', 3], ['2zr', 0], ['9zr', 0], ['zm', 0], ['zM', 3]]) {
      keys(view, command);
      expect(folds(view)).toHaveLength(count);
    }
  });
  it('zM and zR reset levels and level commands reset manual overrides', () => {
    const view = create();
    for (const [command, count] of [['zMzr', 2], ['zRzm', 2], ['zc', 3], ['zr', 0]]) {
      keys(view, command);
      expect(folds(view)).toHaveLength(count);
    }
  });
  it('keeps fold levels local to each editor', () => {
    const first = create();
    const second = create();
    keys(first, 'zM');
    keys(second, 'zm');
    keys(first, 'zr');
    expect(folds(first)).toHaveLength(2);
    expect(folds(second)).toHaveLength(2);
  });
  it('supports read-only documents and obeys folding preferences', () => {
    const readonly = create({extensions: [json(), vim(), vimFolding(), EditorState.readOnly.of(true)]});
    const disabled = create({extensions: [json(), vim(), vimFolding(false)]});
    keys(readonly, 'zA');
    expect(folds(readonly)).toHaveLength(3);
    keys(readonly, 'zO');
    expect(folds(readonly)).toHaveLength(0);
    keys(disabled, 'zCzAzm');
    expect(folds(disabled)).toHaveLength(0);
    expect(readonly.state.doc.toString()).toBe(documentText);
  });

  const ex = (view, command) => Vim.handleEx(getCM(view), command);
  const foldLines = view => folds(view).map(range => view.state.doc.lineAt(range.from).number);

  it.each(['2GV4Gzc', '4GV2Gzc', '2Gv4Gzc', '2G<C-v>4Gzc'])('folds selected lines with %s and leaves siblings open', input => {
    const view = create();
    keys(view, input);
    expect(foldLines(view)).toEqual([2]);
    expect(getCM(view).state.vim.visualMode).toBe(false);
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.doc.toString()).toBe(documentText);
  });

  it('closes one visible level across several selected blocks', () => {
    const view = create();
    keys(view, '2GV7Gzc');
    expect(foldLines(view)).toEqual([2, 5]);
    keys(view, 'ggVGzc');
    expect(foldLines(view)).toEqual([1, 2, 5]);
  });

  it('single-level visual folding does not close hidden children', () => {
    const view = create();
    keys(view, 'ggVGzc');
    expect(foldLines(view)).toEqual([1]);
    keys(view, 'Vzo');
    expect(foldLines(view)).toEqual([]);
  });

  it('visual zo opens only one level while zO opens all selected closed levels', () => {
    const view = create();
    keys(view, 'zMVzo');
    expect(foldLines(view)).toEqual([2, 5]);
    keys(view, 'ggzMVzO');
    expect(foldLines(view)).toEqual([]);
  });

  it('visual zO opens only selected subtrees', () => {
    const view = create();
    keys(view, 'zMzo2GVzO');
    expect(foldLines(view)).toEqual([5]);
  });

  it('recursive visual close includes partially selected parents without closing siblings', () => {
    const view = create();
    keys(view, '2GV3GzC');
    expect(foldLines(view)).toEqual([1, 2]);
  });

  it('preserves the last Visual selection for gv', () => {
    const view = create();
    keys(view, '2GV4Gzc');
    keys(view, 'zRgv');
    const selected = getCM(view).state.vim.sel;
    expect([selected.anchor.line, selected.head.line].sort()).toEqual([1, 3]);
    expect(getCM(view).state.vim.visualLine).toBe(true);
  });

  it.each(['foldc', 'foldcl', 'foldclose'])('supports Ex :%s ranges and one-level close', command => {
    const view = create();
    ex(view, `2,7${command}`);
    expect(foldLines(view)).toEqual([2, 5]);
  });

  it.each(['foldo', 'foldop', 'foldopen'])('supports Ex :%s and recursive bang', command => {
    const view = create();
    keys(view, 'zM');
    ex(view, `1${command}`);
    expect(foldLines(view)).toEqual([2, 5]);
    keys(view, 'zM');
    ex(view, `1${command}!`);
    expect(foldLines(view)).toEqual([]);
  });

  it('Ex recursive close supports percent, marks and a default current line', () => {
    const view = create();
    ex(view, '%foldclose!');
    expect(foldLines(view)).toEqual([1, 2, 5]);
    ex(view, '%foldopen!');
    keys(view, '2Gma4Gmb');
    ex(view, '\'a,\'bfoldclose');
    expect(foldLines(view)).toEqual([2]);
    keys(view, '5G');
    ex(view, 'foldclose');
    expect(foldLines(view)).toEqual([2, 5]);
  });

  it('opens selected Ex subtrees without opening unrelated folds', () => {
    const view = create();
    keys(view, 'zMzo');
    ex(view, '2,4foldopen!');
    expect(foldLines(view)).toEqual([5]);
  });

  it('accepts a Visual range through the actual Ex command panel', () => {
    const view = create();
    keys(view, '2GV4G:');
    const input = view.dom.querySelector('.cm-vim-panel input');
    input.value = '\'<,\'>foldclose';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, bubbles: true}));
    expect(foldLines(view)).toEqual([2]);
    expect(getCM(view).state.vim.visualMode).toBe(false);
  });

  it.each(['0foldclose', '99foldclose', '4,2foldopen', 'foldopen!!', 'foldclose garbage', 'foldopen! | delete'])('rejects %s without modifying folds or text', command => {
    const view = create();
    keys(view, 'zc');
    ex(view, command);
    expect(foldLines(view)).toEqual([1]);
    expect(view.state.doc.toString()).toBe(documentText);
    expect(view.dom.textContent).toContain('Invalid fold range');
  });

  it('zv reveals the cursor line without opening unrelated descendants', () => {
    const view = create();
    keys(view, 'zMzv');
    expect(foldLines(view)).toEqual([2, 5]);
    keys(view, '2Gzv');
    expect(foldLines(view)).toEqual([5]);
  });

  it('zX reapplies the saved level after manual overrides', () => {
    const view = create();
    keys(view, 'zRzczX');
    expect(foldLines(view)).toEqual([]);
    keys(view, 'zMzozX');
    expect(foldLines(view)).toEqual([1, 2, 5]);
  });

  it('zx reapplies the level and reveals the original cursor line', () => {
    const view = create();
    keys(view, 'zMzRzMzo2Gzo3G');
    const head = view.state.selection.main.head;
    keys(view, 'zx');
    expect(foldLines(view)).toEqual([5]);
    expect(view.state.selection.main.head).toBe(head);
    keys(view, 'zX');
    expect(foldLines(view)).toEqual([1, 2, 5]);
    expect(view.state.selection.main.head).toBe(0);
  });

  it('refreshes fold ranges after editing the document', () => {
    const view = create({doc: 'BEGIN\n  PERFORM 1;\n  PERFORM 2;\nEND;', extensions: [plpgsqlFoldService, vim(), vimFolding()]});
    keys(view, 'zMzo');
    view.dispatch({changes: {from: 6, insert: '  PERFORM 0;\n'}});
    keys(view, 'zX');
    expect(folds(view)).toEqual([{from: 5, to: view.state.doc.line(4).to}]);
  });

  it('does not add text undo entries for folding operations', () => {
    const view = create({extensions: [json(), history(), vim(), vimFolding()]});
    keys(view, '2Gx');
    keys(view, 'ggVGzCzvzXzx');
    ex(view, '%foldopen!');
    keys(view, 'u');
    expect(view.state.doc.toString()).toBe(documentText);
  });

  it('supports no-op commands on documents with no folds', () => {
    const view = create({doc: 'SELECT 1;\nSELECT 2;'});
    keys(view, 'VGzCzvzXzx');
    ex(view, '%foldopen!');
    expect(foldLines(view)).toEqual([]);
    expect(view.state.doc.toString()).toBe('SELECT 1;\nSELECT 2;');
  });

  it('supports Visual and Ex folding on read-only editors', () => {
    const view = create({extensions: [json(), vim(), vimFolding(), EditorState.readOnly.of(true)]});
    keys(view, '2GV4Gzc');
    expect(foldLines(view)).toEqual([2]);
    ex(view, '%foldopen!');
    expect(foldLines(view)).toEqual([]);
    expect(view.state.doc.toString()).toBe(documentText);
  });

  it('obeys per-editor folding preferences for Visual, Ex and refresh commands', () => {
    const first = create();
    const disabled = create({extensions: [json(), codeFolding(), vim(), vimFolding(false)]});
    keys(first, 'zM');
    keys(disabled, 'VGzC<Esc>zvzXzx');
    ex(disabled, '%foldclose!');
    expect(foldLines(disabled)).toEqual([]);
    expect(foldLines(first)).toEqual([1, 2, 5]);
  });

  const cursorLine = view => view.state.doc.lineAt(view.state.selection.main.head).number;

  it.each([
    ['3G[z', 2], ['3G2[z', 1], ['3G9[z', 1],
    ['3G]z', 4], ['3G2]z', 8], ['3G9]z', 8],
    ['zj', 2], ['2zj', 5], ['9zj', 5],
    ['Gzk', 7], ['G2zk', 4], ['G9zk', 4],
  ])('navigates nested fold boundaries with %s', (input, expected) => {
    const view = create();
    keys(view, input);
    expect(cursorLine(view)).toBe(expected);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(expected).from);
    expect(view.state.doc.toString()).toBe(documentText);
  });

  it('climbs enclosing open folds from a boundary', () => {
    const view = create();
    keys(view, '2G[z');
    expect(cursorLine(view)).toBe(1);
    keys(view, '4G]z');
    expect(cursorLine(view)).toBe(8);
  });

  it('counts a closed subtree once and does not reveal hidden children', () => {
    const view = create();
    keys(view, 'zMzj');
    expect(cursorLine(view)).toBe(1);
    expect(foldLines(view)).toEqual([1, 2, 5]);
    keys(view, 'zozj');
    expect(cursorLine(view)).toBe(2);
    keys(view, 'zj');
    expect(cursorLine(view)).toBe(5);
    keys(view, 'zk');
    expect(cursorLine(view)).toBe(2);
    expect(foldLines(view)).toEqual([2, 5]);
  });

  it('skips closed folds when finding enclosing open boundaries', () => {
    const view = create();
    keys(view, 'zMzo2G]z');
    expect(cursorLine(view)).toBe(8);
    expect(foldLines(view)).toEqual([2, 5]);
  });

  it.each(['v', 'V', '<C-v>'])('extends a %s selection through a fold motion', mode => {
    const view = create();
    keys(view, '3G' + mode + ']z');
    expect(getCM(view).state.vim.visualMode).toBe(true);
    expect(getCM(view).state.vim.sel.anchor.line).toBe(2);
    expect(getCM(view).state.vim.sel.head.line).toBe(3);
    expect(view.state.doc.toString()).toBe(documentText);
  });

  it('combines forward fold motion with yank without changing the document', () => {
    const view = create();
    keys(view, 'yzj');
    expect(Vim.getRegisterController().getRegister('"').toString()).toBe('{\n');
    expect(view.state.doc.toString()).toBe(documentText);
  });

  it('deletes to a fold boundary and undoes as one edit', () => {
    const view = create({extensions: [json(), history(), vim(), vimFolding()]});
    keys(view, 'dzj');
    expect(view.state.doc.toString()).toBe(documentText.slice(2));
    keys(view, 'u');
    expect(view.state.doc.toString()).toBe(documentText);
  });

  it('replays operator fold motions with dot using the current document', () => {
    const block = 'BEGIN\n  PERFORM 1;\n  PERFORM 2;\nEND;';
    const view = create({doc: 'intro\n' + block + '\nspacer\n' + block,
      extensions: [plpgsqlFoldService, history(), vim(), vimFolding()]});
    keys(view, 'dzj');
    expect(view.state.doc.toString()).toBe(block + '\nspacer\n' + block);
    keys(view, '.');
    expect(view.state.doc.toString()).toBe(block);
  });

  it('records and replays navigation in macros', () => {
    const view = create();
    keys(view, 'qazjq@a');
    expect(cursorLine(view)).toBe(5);
    expect(view.state.doc.toString()).toBe(documentText);
  });

  it('cancels a pending operator when no fold target exists', () => {
    const view = create({doc: 'plain text'});
    keys(view, 'dzj');
    expect(view.state.doc.toString()).toBe('plain text');
    keys(view, 'x');
    expect(view.state.doc.toString()).toBe('lain text');
  });

  it('preserves other bracket motions', () => {
    const view = create({doc: '(one (two))', selection: {anchor: 7}});
    keys(view, '[(');
    expect(view.state.selection.main.head).toBe(5);
  });

  it('moves within read-only SQL without allowing operator edits', () => {
    const view = create({extensions: [json(), vim(), vimFolding(), EditorState.readOnly.of(true)]});
    keys(view, 'zj');
    expect(cursorLine(view)).toBe(2);
    keys(view, 'dzj');
    expect(view.state.doc.toString()).toBe(documentText);
  });

  it('leaves fold motions disabled outside their extension', () => {
    const disabled = create({extensions: [json(), vim(), vimFolding(false)]});
    const unscoped = create({extensions: [json(), vim()]});
    for (const view of [disabled, unscoped]) {
      keys(view, 'zjdzj');
      expect(cursorLine(view)).toBe(1);
      expect(view.state.doc.toString()).toBe(documentText);
    }
  });

  it('zn opens temporarily and zN restores every saved nested fold', () => {
    const view = create();
    keys(view, 'zMzn');
    expect(foldLines(view)).toEqual([]);
    keys(view, 'zN');
    expect(foldLines(view)).toEqual([1, 2, 5]);
    expect(view.state.doc.toString()).toBe(documentText);
  });
  it('repeated zn does not overwrite the saved folds', () => {
    const view = create();
    keys(view, '2GzcznznzN');
    expect(foldLines(view)).toEqual([2]);
  });
  it('zi toggles and retains an empty fold snapshot', () => {
    const view = create();
    keys(view, 'zizizN');
    expect(foldLines(view)).toEqual([]);
    keys(view, 'zMzizi');
    expect(foldLines(view)).toEqual([1, 2, 5]);
  });
  it('preserves fold levels across temporary unfolding', () => {
    const view = create();
    keys(view, 'zRzmznzNzr');
    expect(foldLines(view)).toEqual([]);
  });
  it('restores valid positions after insertion while temporarily unfolded', () => {
    const view = create();
    keys(view, 'zMzn');
    view.dispatch({changes: {from: 0, insert: '\n'}});
    keys(view, 'zN');
    expect(foldLines(view)).toEqual([2, 3, 6]);
  });
  it('drops deleted blocks from the saved snapshot', () => {
    const view = create();
    keys(view, '2Gzczn');
    view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: 'null'}});
    keys(view, 'zN');
    expect(foldLines(view)).toEqual([]);
  });
  it('never applies saved folds to a replacement document', () => {
    const view = create();
    keys(view, 'zMzn');
    view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: documentText}, userEvent: 'document.replace'});
    keys(view, 'zN');
    expect(foldLines(view)).toEqual([]);
  });
  it('moves a restored hidden cursor to the visible header', () => {
    const view = create();
    keys(view, 'zMzn3GzN');
    expect(view.state.selection.main.head).toBe(0);
    expect(foldLines(view)).toEqual([1, 2, 5]);
  });
  it('zx keeps the original cursor when leaving temporary unfolding', () => {
    const view = create();
    keys(view, 'zMzn3G');
    const head = view.state.selection.main.head;
    keys(view, 'zx');
    expect(view.state.selection.main.head).toBe(head);
    expect(foldLines(view)).toEqual([5]);
  });
  it.each(['2GV7Gza', '7GV2Gza', '2Gv7Gza', '2G<C-v>7Gza'])('toggles mixed selected folds with %s', input => {
    const view = create();
    keys(view, '2Gzc');
    keys(view, input);
    expect(foldLines(view)).toEqual([5]);
    expect(getCM(view).state.vim.visualMode).toBe(false);
    expect(view.state.doc.toString()).toBe(documentText);
  });
  it('Visual zA opens a closed root and all its children', () => {
    const view = create();
    keys(view, 'zMVzA');
    expect(foldLines(view)).toEqual([]);
    keys(view, 'ggVGzA');
    expect(foldLines(view)).toEqual([1, 2, 5]);
  });
  it('Visual za opens just one level and preserves gv', () => {
    const view = create();
    keys(view, 'zMVza');
    expect(foldLines(view)).toEqual([2, 5]);
    keys(view, 'gv');
    expect(getCM(view).state.vim.visualMode).toBe(true);
  });
  it('resumes saved folds before Visual or Ex operations', () => {
    const view = create();
    keys(view, 'zMznVza');
    expect(foldLines(view)).toEqual([2, 5]);
    keys(view, 'zMzn');
    ex(view, '%foldopen!');
    expect(foldLines(view)).toEqual([]);
    keys(view, 'zN');
    expect(foldLines(view)).toEqual([]);
  });
  it('keeps suspended states separate between editors', () => {
    const first = create();
    const second = create();
    keys(first, 'zMzn');
    keys(second, 'zN');
    expect(foldLines(second)).toEqual([]);
    keys(first, 'zN');
    expect(foldLines(first)).toEqual([1, 2, 5]);
  });
  it('supports read-only views and disabled folding preferences', () => {
    const readonly = create({extensions: [json(), vim(), vimFolding(), EditorState.readOnly.of(true)]});
    const disabled = create({extensions: [json(), vim(), vimFolding(false)]});
    keys(readonly, 'zMznzNVza');
    expect(foldLines(readonly)).toEqual([2, 5]);
    keys(disabled, 'znzNziVGzA');
    expect(foldLines(disabled)).toEqual([]);
  });

});
