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
import { sql } from '@codemirror/lang-sql';
import { getCM, Vim, vim } from '@replit/codemirror-vim';
import PgSQL from 'sources/components/ReactCodeMirror/extensions/dialect';
import vimTextObjects from 'sources/components/ReactCodeMirror/extensions/vimTextObjects';

describe('Vim SQL text objects', () => {
  let views;
  const body = '\nBEGIN\n  RETURN coalesce(value, 0);\nEND;\n';
  const definition = 'CREATE OR REPLACE FUNCTION public.answer(value integer)\nRETURNS integer AS $body$' + body + '$body$\nLANGUAGE plpgsql IMMUTABLE;';
  function create(doc, cursor = 0, extensions = [], objects = vimTextObjects()) {
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new EditorView({parent, state: EditorState.create({
      doc, selection: {anchor: typeof cursor === 'string' ? doc.indexOf(cursor) : cursor},
      extensions: [sql({dialect: PgSQL}), history(), vim(), objects, extensions],
    })});
    views.push(view);
    return view;
  }
  const keys = (view, sequence) => {
    for (const key of sequence.match(/<[^>]+>|./g) || []) Vim.handleKey(getCM(view), key, 'user');
  };
  const text = view => view.state.doc.toString();
  const selected = view => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  const register = () => Vim.getRegisterController().getRegister('"').toString();
  beforeEach(() => { views = []; Vim.resetVimGlobalState_(); });
  afterEach(() => { for (const view of views) { const parent = view.dom.parentElement; view.destroy(); parent.remove(); } });

  it.each(['value integer', 'coalesce', '$body$', 'IMMUTABLE'])('selects the routine body with yif from %s', cursor => {
    const view = create(definition, cursor);
    keys(view, 'yif');
    expect(register()).toBe(body.trim());
    expect(text(view)).toBe(definition);
  });

  it('selects the complete definition including options and semicolon with yaf', () => {
    const doc = '-- preceding comment\n' + definition + '\nSELECT 1;';
    const view = create(doc, 'RETURN');
    keys(view, 'yaf');
    expect(register()).toBe(definition);
    expect(text(view)).toBe(doc);
  });

  it('deletes only the body and undoes as a single edit', () => {
    const view = create(definition, 'RETURN');
    keys(view, 'dif');
    expect(text(view)).toBe(definition.replace(body.trim(), ''));
    keys(view, 'u');
    expect(text(view)).toBe(definition);
    keys(view, '<C-r>');
    expect(text(view)).toBe(definition.replace(body.trim(), ''));
  });

  it('supports whole routine deletion and dot on the next definition', () => {
    const second = definition.replace('answer', 'other');
    const view = create(definition + '\n' + second, 'RETURN');
    keys(view, 'daf');
    expect(text(view)).toBe('\n' + second);
    keys(view, 'G.');
    expect(text(view)).toBe('\n');
  });

  it.each(['vif', 'Vif', '<C-v>if'])('uses a character selection for %s', command => {
    const view = create(definition, 'RETURN');
    keys(view, command);
    expect(selected(view)).toBe(body.trim());
    expect(getCM(view).state.vim.visualMode).toBe(true);
    expect(getCM(view).state.vim.visualLine).toBe(false);
    expect(getCM(view).state.vim.visualBlock).toBe(false);
    keys(view, 'y');
    expect(register()).toBe(body.trim());
  });

  it('handles procedures, language-before-AS, quoted names and single-quoted bodies', () => {
    const doc = 'CREATE PROCEDURE "schema"."do work"() LANGUAGE SQL AS \'SELECT \'\'quoted\'\';\';';
    const view = create(doc, 'SELECT');
    keys(view, 'yif');
    expect(register()).toBe('SELECT \'\'quoted\'\';');
    keys(view, 'yaf');
    expect(register()).toBe(doc);
  });

  it('supports escaped quote bodies and routine names tokenized as keywords', () => {
    const doc = 'CREATE FUNCTION lower(value text) RETURNS text LANGUAGE SQL AS E\'SELECT \\\'quoted\\\';\';';
    const view = create(doc, 'SELECT');
    keys(view, 'yif');
    expect(register()).toBe('SELECT \\\'quoted\\\';');
    keys(view, 'yaf');
    expect(register()).toBe(doc);
  });

  it('protects routine-looking text, delimiters, comments and semicolons in dollar bodies', () => {
    const tricky = '\nBEGIN\n PERFORM \'CREATE FUNCTION fake() AS $$x$$;\';\n /* $wrong$ ; */\nEND;\n';
    const doc = definition.replace(body, () => tricky);
    const view = create(doc, 'fake');
    keys(view, 'yif');
    expect(register()).toBe(tricky.trim());
    keys(view, 'yaf');
    expect(register()).toBe(doc);
  });

  it.each([
    'SELECT \'CREATE FUNCTION f() RETURNS int AS $$x$$ LANGUAGE SQL;\';',
    '-- CREATE FUNCTION f() RETURNS int AS $$x$$ LANGUAGE SQL;',
    'DO $$ BEGIN PERFORM 1; END $$;',
    'CREATE FUNCTION f() RETURNS int AS \'library\', \'symbol\' LANGUAGE C;',
    'CREATE FUNCTION f() RETURNS int AS \'library\' LANGUAGE C;',
    'CREATE FUNCTION f() RETURNS int LANGUAGE SQL BEGIN ATOMIC SELECT 1; END;',
    'CREATE FUNCTION f() RETURNS int AS $$unterminated LANGUAGE SQL;',
    'CREATE FUNCTION f() RETURNS text LANGUAGE SQL AS \'not closed\'\';',
    'CREATE FUNCTION f() RETURNS int AS $$SELECT 1$$ LANGUAGE SQL',
    'CREATE FUNCTION f() RETURNS int AS $$SELECT 1$$ LANGUAGE SQL SELECT 2;',
    'CREATE FUNCTION f() RETURNS text AS \'one\' \'two\' LANGUAGE SQL;',
  ])('cancels unsupported or incomplete routine scopes: %s', doc => {
    const view = create(doc);
    keys(view, 'daf');
    expect(text(view)).toBe(doc);
    expect(getCM(view).state.vim.inputState.operator).toBeFalsy();
    keys(view, 'x');
    expect(text(view)).toBe(doc.slice(1));
  });

  it('cancels routine counts instead of crossing unrelated SQL statements', () => {
    const doc = definition + '\nSELECT 1;\n' + definition;
    const view = create(doc, 'RETURN');
    keys(view, '2daf');
    expect(text(view)).toBe(doc);
  });

  it.each(['\'c\'', '\'internal\'', '\'INTERNAL\'', 'E\'c\'', '$$c$$', '"c"', 'internal'])('protects native routine symbols with LANGUAGE %s', language => {
    const doc = `CREATE FUNCTION f() RETURNS int AS 'libexample' LANGUAGE ${language};`;
    const view = create(doc, 'libexample');
    for (const command of ['dif', 'daf', 'cif']) {
      keys(view, command);
      expect(text(view)).toBe(doc);
      expect(getCM(view).state.vim.insertMode).toBe(false);
      expect(getCM(view).state.vim.inputState.operator).toBeFalsy();
    }
  });

  it.each(['\'sql\'', 'E\'sql\'', '$$sql$$'])('recognizes quoted SQL languages for routine and argument objects: %s', language => {
    const doc = `CREATE FUNCTION f() RETURNS int AS $body$SELECT coalesce(value, 0);$body$ LANGUAGE ${language};`;
    const view = create(doc, 'value');
    keys(view, 'yif');
    expect(register()).toBe('SELECT coalesce(value, 0);');
    keys(view, 'yia');
    expect(register()).toBe('value');
  });

  it('rejects encoded language literals whose native status is ambiguous', () => {
    const doc = 'CREATE FUNCTION f() RETURNS int AS \'libexample\' LANGUAGE E\'\\143\';';
    const view = create(doc, 'libexample');
    keys(view, 'dif');
    expect(text(view)).toBe(doc);
  });

  it.each([
    ['first', 'first'], ['second', 'second'], ['third', 'third'],
    [',', 'first'], ['(', 'first'], [')', 'third'],
  ])('selects argument %s without surrounding whitespace', (cursor, expected) => {
    const view = create('SELECT fn( first,  second , third );', cursor);
    keys(view, 'yia');
    expect(register()).toBe(expected);
  });

  it.each([
    ['first', 'SELECT fn(second, third);'],
    ['second', 'SELECT fn(first, third);'],
    ['third', 'SELECT fn(first, second);'],
  ])('removes the correct comma with daa at %s', (cursor, expected) => {
    const doc = 'SELECT fn(first, second, third);';
    const view = create(doc, cursor);
    keys(view, 'daa');
    expect(text(view)).toBe(expected);
    keys(view, 'u');
    expect(text(view)).toBe(doc);
  });

  it('supports inner and around counts, clipping to the remaining arguments', () => {
    const doc = 'SELECT fn(first, second, third, fourth);';
    const view = create(doc, 'second');
    keys(view, '2yia');
    expect(register()).toBe('second, third');
    keys(view, '2daa');
    expect(text(view)).toBe('SELECT fn(first, fourth);');
    keys(view, '9daa');
    expect(text(view)).toBe('SELECT fn(first);');
  });

  it('finds the innermost argument while preserving nested commas, arrays and quoted names', () => {
    const doc = 'SELECT outer_fn(first, inner_fn("comma,name", ARRAY[1,2], third), last);';
    const view = create(doc, 'third');
    keys(view, 'yia');
    expect(register()).toBe('third');
    view.dispatch({selection: {anchor: doc.indexOf('ARRAY')}});
    keys(view, 'yia');
    expect(register()).toBe('ARRAY[1,2]');
    view.dispatch({selection: {anchor: doc.indexOf('comma,name')}});
    keys(view, 'yia');
    expect(register()).toBe('"comma,name"');
    view.dispatch({selection: {anchor: doc.indexOf('inner_fn')}});
    keys(view, 'yia');
    expect(register()).toBe('inner_fn("comma,name", ARRAY[1,2], third)');
  });

  it('ignores fake delimiters in SQL strings and nested comments', () => {
    const doc = 'SELECT fn(\'comma, and )\', $$another, )$$, /* nested /* , ) */ comment */ final);';
    const view = create(doc, 'another');
    keys(view, 'yia');
    expect(register()).toBe('$$another, )$$');
    view.dispatch({selection: {anchor: doc.indexOf('final')}});
    keys(view, 'yia');
    expect(register()).toBe('/* nested /* , ) */ comment */ final');
  });

  it('supports argument objects inside SQL and PL/pgSQL dollar bodies', () => {
    const view = create(definition, 'value,');
    keys(view, 'yia');
    expect(register()).toBe('value');
    keys(view, 'daa');
    expect(text(view)).toBe(definition.replace('coalesce(value, 0)', 'coalesce(0)'));
  });

  it('does not parse arbitrary strings or unsupported language bodies as SQL argument lists', () => {
    for (const doc of ['SELECT \'fn(first, second)\';', '-- fn(first, second)', definition.replace('plpgsql', 'plpython3u')]) {
      const view = create(doc, doc.includes('first') ? 'first' : 'value,');
      keys(view, 'dia');
      expect(text(view)).toBe(doc);
    }
  });

  it.each(['SELECT fn();', 'SELECT fn(,);', 'SELECT fn(/* comment */);', 'SELECT fn(first, second', 'SELECT first, second;'])('cancels empty or unmatched argument groups: %s', doc => {
    const view = create(doc, Math.max(0, doc.indexOf('(') + 1));
    keys(view, 'daa');
    expect(text(view)).toBe(doc);
  });

  it('supports argument Visual selection, macros and dot repetition', () => {
    const doc = 'SELECT fn(first, second, third);';
    const view = create(doc, 'first');
    keys(view, 'v2ia');
    expect(selected(view)).toBe('first, second');
    keys(view, '<Esc>0');
    view.dispatch({selection: {anchor: doc.indexOf('first')}});
    keys(view, 'qadaaq');
    expect(text(view)).toBe('SELECT fn(second, third);');
    keys(view, '@a');
    expect(text(view)).toBe('SELECT fn(third);');
    keys(view, '.');
    expect(text(view)).toBe('SELECT fn();');
  });

  it('enters Insert mode with cia and cif without touching surrounding syntax', () => {
    const argument = create('SELECT fn(first, second);', 'first');
    keys(argument, 'cia');
    expect(text(argument)).toBe('SELECT fn(, second);');
    expect(getCM(argument).state.vim.insertMode).toBe(true);
    const routine = create(definition, 'RETURN');
    keys(routine, 'cif');
    expect(text(routine)).toBe(definition.replace(body.trim(), ''));
    expect(getCM(routine).state.vim.insertMode).toBe(true);
  });

  it('supports readonly yanks and Visual selections while blocking operator edits', () => {
    const view = create(definition, 'RETURN', EditorState.readOnly.of(true));
    keys(view, 'yif');
    expect(register()).toBe(body.trim());
    keys(view, 'dif');
    expect(text(view)).toBe(definition);
    keys(view, 'cif');
    expect(text(view)).toBe(definition);
    expect(getCM(view).state.vim.insertMode).toBe(false);
    keys(view, 'vaf');
    expect(selected(view)).toBe(definition);
  });

  it('scopes mappings to enabled editors and supports reconfiguration', () => {
    const mode = new Compartment();
    const doc = 'SELECT fn(first, second);';
    const view = create(doc, 'first', [], mode.of(vimTextObjects()));
    const unscoped = new EditorView({parent: document.body, state: EditorState.create({
      doc: definition, extensions: [vim()],
    })});
    keys(unscoped, 'daf');
    expect(text(unscoped)).toBe(definition);
    unscoped.destroy();
    view.dispatch({effects: mode.reconfigure(vimTextObjects(false))});
    keys(view, 'daa');
    expect(text(view)).toBe(doc);
    view.dispatch({effects: mode.reconfigure([])});
    keys(view, 'daa');
    expect(text(view)).toBe(doc);
    view.dispatch({effects: mode.reconfigure(vimTextObjects())});
    keys(view, 'yia');
    expect(register()).toBe('first');
  });

  it('preserves built-in word, paragraph, sentence, brackets and insert commands', () => {
    const view = create('First sentence. Second sentence.\n\nnext paragraph', 'First');
    keys(view, 'yiw');
    expect(register()).toBe('First');
    keys(view, 'yis');
    expect(register()).toContain('First sentence.');
    keys(view, 'yip');
    expect(register()).toContain('Second sentence.');
    const brackets = create('SELECT fn(first, second);', 'first');
    keys(brackets, 'yi(');
    expect(register()).toBe('first, second');
    keys(brackets, 'i');
    expect(getCM(brackets).state.vim.insertMode).toBe(true);
  });
});
