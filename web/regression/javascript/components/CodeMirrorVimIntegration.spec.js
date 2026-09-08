/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { getCM, Vim } from '@replit/codemirror-vim';
import CodeMirror from 'sources/components/ReactCodeMirror';
import usePreferences from 'pgadmin.preferences/store';
import { withTheme } from '../fake_theme';

const ThemedCM = withTheme(CodeMirror);

describe('Query editor Vim integration', () => {
  let previousPreferences;

  function mountEditor(props = {}) {
    let view;
    let currentProps = {
      value: 'SELECT 1;\nSELECT 2;',
      vimMode: true,
      currEditor: instance => { view = instance; },
      ...props,
    };
    const component = render(<ThemedCM {...currentProps} />);
    return {
      view,
      rerender(changes) {
        currentProps = {...currentProps, ...changes};
        component.rerender(<ThemedCM {...currentProps} />);
      },
    };
  }

  function keys(view, sequence) {
    act(() => {
      for (const key of sequence) Vim.handleKey(getCM(view), key);
    });
  }

  function ex(view, command) {
    act(() => { Vim.handleEx(getCM(view), command); });
  }

  beforeEach(() => {
    previousPreferences = usePreferences.getState().data;
    const editorPrefs = {
      tab_size: 4,
      use_spaces: true,
      code_folding: true,
      plain_editor_mode: false,
      sql_font_size: 1,
      sql_font_family: 'monospace',
    };
    usePreferences.setState({data: Object.entries(editorPrefs).map(([name, value]) => ({
      module: 'editor', name, value,
    }))});
  });

  afterEach(() => {
    cleanup();
    usePreferences.setState({data: previousPreferences});
  });

  it('enables and disables Vim on an existing editor without losing its document', () => {
    const editor = mountEditor({vimMode: false});
    expect(getCM(editor.view)).toBeNull();

    editor.rerender({vimMode: true});
    keys(editor.view, ['d', 'd']);
    expect(editor.view.getValue()).toBe('SELECT 2;');

    editor.rerender({vimMode: false});
    expect(getCM(editor.view)).toBeNull();
    expect(editor.view.getValue()).toBe('SELECT 2;');

    editor.rerender({vimMode: true});
    expect(getCM(editor.view).state.vim.insertMode).toBe(false);
    expect(editor.view.getValue()).toBe('SELECT 2;');
  });

  it('preserves Normal and Insert mode when status and save callback preferences change', () => {
    const editor = mountEditor({onVimSave: jest.fn()});
    const cm = getCM(editor.view);
    keys(editor.view, ['j']);
    const head = editor.view.state.selection.main.head;
    editor.rerender({vimShowStatus: false, onVimSave: jest.fn()});
    expect(getCM(editor.view)).toBe(cm);
    expect(cm.state.vim.insertMode).toBe(false);
    expect(editor.view.state.selection.main.head).toBe(head);

    keys(editor.view, ['i']);
    editor.rerender({vimShowStatus: true, onVimSave: jest.fn()});
    expect(getCM(editor.view)).toBe(cm);
    expect(cm.state.vim.insertMode).toBe(true);
    expect(editor.view.state.selection.main.head).toBe(head);
  });

  it.each(['readonly', 'disabled'])('blocks editing commands while %s is enabled', property => {
    const editor = mountEditor({[property]: true});
    const original = editor.view.getValue();
    expect(editor.view.state.readOnly).toBe(true);
    for (const sequence of [['d', 'd'], ['>', '>'], ['g', 'c', 'c'], ['u']]) {
      keys(editor.view, ['<Esc>', ...sequence]);
      expect(editor.view.getValue()).toBe(original);
    }

    // The ordinary CodeMirror Tab path must also respect the same lock.
    editor.rerender({vimMode: false});
    fireEvent.keyDown(editor.view.contentDOM, {key: 'Tab', code: 'Tab', keyCode: 9});
    expect(editor.view.getValue()).toBe(original);
  });

  it.each(['readonly', 'disabled'])('locks an active Insert session immediately when %s changes', property => {
    const editor = mountEditor();
    keys(editor.view, ['i']);
    editor.rerender({[property]: true});
    const original = editor.view.getValue();
    fireEvent.keyDown(editor.view.contentDOM, {key: 'Tab', code: 'Tab', keyCode: 9});
    expect(editor.view.getValue()).toBe(original);
    expect(editor.view.state.readOnly).toBe(true);

    editor.rerender({[property]: false});
    expect(editor.view.state.readOnly).toBe(false);
    expect(editor.view.state.facet(EditorView.editable)).toBe(true);
  });

  it('routes :w to the originating editor and picks up a changed save callback', () => {
    const firstSave = jest.fn();
    const secondSave = jest.fn();
    const updatedSave = jest.fn();
    const first = mountEditor({onVimSave: firstSave});
    const second = mountEditor({onVimSave: secondSave});

    ex(first.view, 'w');
    expect(firstSave).toHaveBeenCalledWith(first.view);
    expect(secondSave).not.toHaveBeenCalled();
    ex(second.view, 'write');
    expect(secondSave).toHaveBeenCalledWith(second.view);

    first.rerender({onVimSave: updatedSave});
    ex(first.view, 'w');
    expect(updatedSave).toHaveBeenCalledWith(first.view);
    expect(firstSave).toHaveBeenCalledTimes(1);
    expect(secondSave).toHaveBeenCalledTimes(1);
  });

  it('keeps an open Ex prompt while changing the status preference and save callback', () => {
    const previousSave = jest.fn();
    const updatedSave = jest.fn();
    const editor = mountEditor({onVimSave: previousSave});
    keys(editor.view, [':']);
    const input = editor.view.dom.querySelector('.cm-vim-panel input');
    fireEvent.input(input, {target: {value: 'w'}});

    editor.rerender({vimShowStatus: false, onVimSave: updatedSave});
    expect(editor.view.dom.querySelector('.cm-vim-panel input')).toBe(input);
    expect(input).toHaveValue('w');
    expect(input).toHaveFocus();
    expect(input).toBeVisible();
    fireEvent.keyDown(input, {key: 'Enter', keyCode: 13});
    expect(updatedSave).toHaveBeenCalledWith(editor.view);
    expect(previousSave).not.toHaveBeenCalled();
  });

  it.each(['w output.sql', 'w!', '1,2w', '%w'])('rejects unsupported :%s instead of saving a different scope', command => {
    const save = jest.fn();
    const editor = mountEditor({onVimSave: save, vimShowStatus: false});
    ex(editor.view, command);
    expect(save).not.toHaveBeenCalled();
    const panel = editor.view.dom.querySelector('.cm-vim-panel');
    expect(panel).toBeVisible();
    expect(panel).toHaveTextContent('Use :w to save the entire query');
  });

  it('explains when the current editor has no save callback', () => {
    const editor = mountEditor({vimShowStatus: false});
    ex(editor.view, 'w');
    const panel = editor.view.dom.querySelector('.cm-vim-panel');
    expect(panel).toBeVisible();
    expect(panel).toHaveTextContent('Saving is not available in this editor');
  });

  it('does not save while the editor is disabled', () => {
    const save = jest.fn();
    const editor = mountEditor({onVimSave: save, disabled: true});
    ex(editor.view, 'w');
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps application function keys available and gives Vim ownership of Normal keys', () => {
    const runQuery = jest.fn(() => true);
    const plainJ = jest.fn(() => true);
    const editor = mountEditor({customKeyMap: [
      {key: 'F5', run: runQuery},
      {key: 'j', run: plainJ},
    ]});
    fireEvent.keyDown(editor.view.contentDOM, {key: 'F5', code: 'F5', keyCode: 116});
    expect(runQuery).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(editor.view.contentDOM, {key: 'j', code: 'KeyJ', keyCode: 74});
    expect(plainJ).not.toHaveBeenCalled();
    expect(editor.view.getCursor().line).toBe(2);
  });

  it('uses Tab for indentation only in Insert mode and Escape returns to Normal mode', () => {
    const editor = mountEditor();
    const original = editor.view.getValue();
    fireEvent.keyDown(editor.view.contentDOM, {key: 'Tab', code: 'Tab', keyCode: 9});
    expect(editor.view.getValue()).toBe(original);
    fireEvent.keyDown(editor.view.contentDOM, {key: 'i', code: 'KeyI', keyCode: 73});
    fireEvent.keyDown(editor.view.contentDOM, {key: 'Tab', code: 'Tab', keyCode: 9});
    expect(editor.view.getValue()).toBe('    ' + original);
    fireEvent.keyDown(editor.view.contentDOM, {key: 'Escape', code: 'Escape', keyCode: 27});
    expect(getCM(editor.view).state.vim.insertMode).toBe(false);
  });

  it('uses Normal Tab to move forward in the Vim jump list', () => {
    const editor = mountEditor();
    keys(editor.view, ['G', '<C-o>']);
    expect(editor.view.getCursor().line).toBe(1);

    fireEvent.keyDown(editor.view.contentDOM, {key: 'Tab', code: 'Tab', keyCode: 9});
    expect(editor.view.getCursor().line).toBe(2);
    expect(editor.view.getValue()).toBe('SELECT 1;\nSELECT 2;');
  });

  it('does not unindent a Visual selection when Shift+Tab is pressed', () => {
    const original = '    SELECT 1;\n    SELECT 2;';
    const editor = mountEditor({value: original});
    keys(editor.view, ['V']);
    const selection = editor.view.getSelection();
    fireEvent.keyDown(editor.view.contentDOM, {
      key: 'Tab', code: 'Tab', keyCode: 9, shiftKey: true,
    });
    expect(editor.view.getValue()).toBe(original);
    expect(editor.view.getSelection()).toBe(selection);
    expect(getCM(editor.view).state.vim.visualMode).toBe(true);
  });
});
