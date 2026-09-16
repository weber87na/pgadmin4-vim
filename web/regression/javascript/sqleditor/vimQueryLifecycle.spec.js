/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { navigateQueryTab, requestQueryFileSave, saveQueryFile } from '../../../pgadmin/tools/sqleditor/static/js/components/vimQueryLifecycle';
import { QUERY_TOOL_EVENTS as EVENTS } from '../../../pgadmin/tools/sqleditor/static/js/components/QueryToolConstants';
import { EditorState } from '@codemirror/state';
import { history, isolateHistory, undo, redo } from '@codemirror/commands';
import CustomEditorView from 'sources/components/ReactCodeMirror/CustomEditorView';

jest.mock('sources/url_for', () => jest.fn(() => '/file_manager/save_file'));

describe('Query Tool Vim lifecycle host workflows', () => {
  function context(currentFile) {
    return {currentFile, eventBus: {fireEvent: jest.fn()}, fileManager: {show: jest.fn()}, modal: {}};
  }

  it('saves named queries with completion belonging only to that request', () => {
    const ctx = context('query.sql');
    const complete = jest.fn();
    requestQueryFileSave(ctx, false, complete);
    expect(ctx.fileManager.show).not.toHaveBeenCalled();
    expect(ctx.eventBus.fireEvent).toHaveBeenCalledWith(EVENTS.SAVE_FILE, 'query.sql', complete);
  });

  it('resolves cancelled Save As once without leaving a future close listener', () => {
    const ctx = context();
    const complete = jest.fn();
    requestQueryFileSave(ctx, false, complete);
    const [, accept, cancel] = ctx.fileManager.show.mock.calls[0];
    cancel(); cancel(); accept('late.sql');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(false);
    expect(ctx.eventBus.fireEvent).not.toHaveBeenCalled();
  });

  it('ignores picker onClose after selecting a filename', () => {
    const ctx = context('old.sql');
    const complete = jest.fn();
    requestQueryFileSave(ctx, true, complete);
    const [, accept, cancel] = ctx.fileManager.show.mock.calls[0];
    accept('new.sql'); cancel();
    expect(complete).not.toHaveBeenCalled();
    expect(ctx.eventBus.fireEvent).toHaveBeenCalledTimes(1);
    expect(ctx.eventBus.fireEvent).toHaveBeenCalledWith(EVENTS.SAVE_FILE, 'new.sql', complete);
  });

  it.each([false, true])('resolves failed file picker requests (async=%s)', async asynchronous => {
    const ctx = context();
    ctx.fileManager.show.mockImplementation(() => {
      if (asynchronous) return Promise.reject(Error('picker unavailable'));
      throw Error('picker unavailable');
    });
    const complete = jest.fn();
    requestQueryFileSave(ctx, false, complete);
    await Promise.resolve();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(false);
    expect(ctx.eventBus.fireEvent).not.toHaveBeenCalled();
  });

  function saving() {
    let finish;
    const api = {post: jest.fn(() => new Promise(resolve => { finish = resolve; }))};
    const view = {state: {doc: {}}, getEOL: () => '\r\n', getValue: jest.fn(() => 'SELECT 1;\r\n'), markClean: jest.fn()};
    const ctx = {...context('query.sql'), api, editor: {current: view}, notifier: {success: jest.fn()}};
    const complete = jest.fn();
    const pending = saveQueryFile(ctx, 'query.sql', complete);
    return {ctx, view, complete, pending, finish};
  }

  it('reports success and marks clean only after the saved content is acknowledged', async () => {
    const {ctx, view, complete, pending, finish} = saving();
    expect(ctx.api.post).toHaveBeenCalledWith('/file_manager/save_file', {file_name: 'query.sql', file_content: 'SELECT 1;\r\n'});
    expect(complete).not.toHaveBeenCalled();
    expect(view.markClean).not.toHaveBeenCalled();
    finish(); await pending;
    expect(view.markClean).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(true);
    expect(ctx.eventBus.fireEvent).toHaveBeenCalledWith(EVENTS.SAVE_FILE_DONE, 'query.sql', true, false);
  });

  it('preserves dirty state and declines closing if text or EOL changes during saving', async () => {
    const {ctx, view, complete, pending, finish} = saving();
    view.getValue.mockReturnValue('SELECT 1;\n');
    finish(); await pending;
    expect(view.markClean).toHaveBeenCalledWith(view.state.doc, '\r\n');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(false);
    expect(ctx.eventBus.fireEvent).toHaveBeenCalledWith(EVENTS.SAVE_FILE_DONE, 'query.sql', true, true);
  });

  it('does not update a replacement editor after a pending save', async () => {
    const {ctx, view, complete, pending, finish} = saving();
    ctx.editor.current = {};
    finish(); await pending;
    expect(view.markClean).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(false);
    expect(ctx.eventBus.fireEvent).not.toHaveBeenCalled();
  });

  it('reports failed writes through the existing API error workflow', async () => {
    const ctx = context();
    const error = Error('Permission denied');
    ctx.api = {post: jest.fn(() => Promise.reject(error))};
    ctx.editor = {current: {state: {doc: {}}, getEOL: () => '\n', getValue: () => 'SELECT 1;', markClean: jest.fn()}};
    const complete = jest.fn();
    await saveQueryFile(ctx, 'query.sql', complete);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(false);
    expect(ctx.editor.current.markClean).not.toHaveBeenCalled();
    expect(ctx.eventBus.fireEvent).toHaveBeenCalledWith(EVENTS.SAVE_FILE_DONE, null, false);
    expect(ctx.eventBus.fireEvent).toHaveBeenCalledWith(EVENTS.HANDLE_API_ERROR, error);
  });

  it('compares undo and redo with the saved snapshot after an edit during saving', async () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new CustomEditorView({parent, state: EditorState.create({doc: 'SELECT 1;', extensions: [history()]})});
    try {
      view.dispatch({changes: {from: 7, to: 8, insert: '2'}, annotations: isolateHistory.of('full')});
      let finish;
      const ctx = {...context(), editor: {current: view}, api: {post: () => new Promise(resolve => { finish = resolve; })}, notifier: {success: jest.fn()}};
      const complete = jest.fn();
      const pending = saveQueryFile(ctx, 'query.sql', complete);
      view.dispatch({changes: {from: 7, to: 8, insert: '3'}, annotations: isolateHistory.of('full')});
      finish(); await pending;
      expect(complete).toHaveBeenCalledWith(false);
      expect(view.isDirty()).toBe(true);
      undo(view);
      expect(view.getValue()).toBe('SELECT 2;');
      expect(view.isDirty()).toBe(false);
      undo(view);
      expect(view.getValue()).toBe('SELECT 1;');
      expect(view.isDirty()).toBe(true);
      redo(view);
      expect(view.isDirty()).toBe(false);
    } finally {
      view.destroy(); parent.remove();
    }
  });

  function docker() {
    const tabs = ['id-dashboard', 'id-query-tool_1', 'id-psql-tool_1', 'id-query-tool_2', 'id-query-tool_3'].map(id => ({id}));
    tabs.forEach(tab => { tab.parent = {tabs}; });
    return {find: id => tabs.find(tab => tab.id === id), focus: jest.fn()};
  }

  it.each([
    ['next', 1, 3], ['next', 2, 1], ['previous', 1, 1], ['previous', 3, 2],
    ['first', 1, 1], ['last', 1, 3], ['index', 3, 3],
  ])('navigates %s with count %s among Query Tools only', (direction, count, target) => {
    const layout = docker();
    expect(navigateQueryTab(layout, 'id-query-tool_2', {direction, count})).toBe(true);
    expect(layout.focus).toHaveBeenCalledTimes(1);
    expect(layout.focus).toHaveBeenCalledWith(`id-query-tool_${target}`);
  });

  it('rejects unavailable tabs and standalone browser windows', () => {
    const layout = docker();
    expect(navigateQueryTab(layout, 'id-query-tool_2', {direction: 'index', count: 4})).toBe(false);
    expect(navigateQueryTab(layout, 'missing', {direction: 'next'})).toBe(false);
    expect(navigateQueryTab(undefined, 'id-query-tool_2', {direction: 'next'})).toBe(false);
    expect(layout.focus).not.toHaveBeenCalled();
  });
});
