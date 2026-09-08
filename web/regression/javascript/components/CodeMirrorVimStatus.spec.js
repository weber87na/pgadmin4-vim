/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { Compartment, EditorState, StateEffect } from '@codemirror/state';
import { drawSelection, EditorView } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { getCM, Vim, vim } from '@replit/codemirror-vim';
import { fireEvent } from '@testing-library/react';
import vimStatus from 'sources/components/ReactCodeMirror/extensions/vimStatus';

describe('Vim status visibility', () => {
  let view, parent, status;

  const setStatus = visible => view.dispatch({
    effects: status.reconfigure(vimStatus(visible)),
  });

  beforeEach(() => {
    parent = document.createElement('div');
    document.body.appendChild(parent);
    status = new Compartment();
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'foo bar foo',
        extensions: [vim({status: true}), status.of(vimStatus()), history(), drawSelection()],
      }),
    });
  });

  afterEach(() => {
    view.destroy();
    parent.remove();
  });

  it('hides only the idle indicator while preserving the Vim instance and mode', () => {
    const cm = getCM(view);
    const panel = view.dom.querySelector('.cm-vim-panel');
    Vim.handleKey(cm, 'i');

    setStatus(false);
    expect(getCM(view)).toBe(cm);
    expect(cm.state.vim.insertMode).toBe(true);
    expect(panel).not.toBeVisible();

    setStatus(true);
    expect(view.dom.querySelector('.cm-vim-panel')).toBe(panel);
    expect(cm.state.vim.insertMode).toBe(true);
    expect(panel).toBeVisible();
  });

  it.each(['/', '?'])('shows the %s search prompt after disabling the indicator', key => {
    setStatus(false);
    Vim.handleKey(getCM(view), key);
    const input = view.dom.querySelector('.cm-vim-panel input');
    expect(input).toBeVisible();
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, {key: 'Escape', keyCode: 27});
    expect(view.dom.querySelector('.cm-vim-panel')).not.toBeVisible();
  });

  it('keeps a partially entered search and focus when toggling the indicator', () => {
    Vim.handleKey(getCM(view), '/');
    const input = view.dom.querySelector('.cm-vim-panel input');
    fireEvent.input(input, {target: {value: 'bar'}});

    setStatus(false);
    setStatus(true);
    setStatus(false);
    expect(view.dom.querySelector('.cm-vim-panel input')).toBe(input);
    expect(input).toHaveValue('bar');
    expect(input).toHaveFocus();
    expect(input).toBeVisible();

    fireEvent.keyDown(input, {key: 'Enter', keyCode: 13});
    expect(view.state.selection.main.head).toBe(4);
    expect(view.dom.querySelector('.cm-vim-panel')).not.toBeVisible();
  });

  it('keeps Ex commands usable after repeated visibility changes', () => {
    setStatus(false);
    setStatus(true);
    setStatus(false);
    Vim.handleKey(getCM(view), ':');
    const input = view.dom.querySelector('.cm-vim-panel input');
    expect(input).toBeVisible();
    fireEvent.input(input, {target: {value: 's/foo/baz/'}});
    setStatus(true);
    setStatus(false);
    expect(view.dom.querySelector('.cm-vim-panel input')).toBe(input);
    expect(input).toHaveValue('s/foo/baz/');
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, {key: 'Enter', keyCode: 13});

    expect(view.state.doc.toString()).toBe('baz bar foo');
    expect(input).not.toBeInTheDocument();
    // A substitution notification is still useful with the indicator hidden.
    getCM(view).state.currentNotificationClose?.();
    expect(view.dom.querySelector('.cm-vim-panel')).not.toBeVisible();
  });

  it('cleans up its dialog listener and visibility flag when removed', () => {
    const cm = getCM(view);
    const off = jest.spyOn(cm, 'off');
    setStatus(false);
    view.dispatch({effects: status.reconfigure([])});

    expect(off).toHaveBeenCalledWith('dialog', expect.any(Function));
    expect(view.dom).not.toHaveAttribute('data-pgadmin-vim-hide-status');
    expect(view.dom.querySelector('.cm-vim-panel')).toBeVisible();
  });

  it('shows command notifications even when the idle indicator is hidden', () => {
    setStatus(false);
    const close = getCM(view).openNotification(document.createTextNode('Pattern not found'));
    const panel = view.dom.querySelector('.cm-vim-panel');
    expect(panel).toBeVisible();
    expect(panel).toHaveTextContent('Pattern not found');

    close();
    expect(panel).not.toBeVisible();
  });

  it('keeps the indicator hidden when editor focus and theme classes change', () => {
    setStatus(false);
    view.focus();
    view.dispatch({effects: StateEffect.appendConfig.of(EditorView.theme({
      '.cm-content': {fontSize: '16px'},
    }))});

    expect(view.dom).toHaveAttribute('data-pgadmin-vim-hide-status');
    expect(view.dom.querySelector('.cm-vim-panel')).not.toBeVisible();
  });
});
