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
    for (const key of input) Vim.handleKey(getCM(view), key, 'user');
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
});
