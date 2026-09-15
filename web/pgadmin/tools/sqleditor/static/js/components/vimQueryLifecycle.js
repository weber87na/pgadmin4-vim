/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import url_for from 'sources/url_for';
import gettext from 'sources/gettext';
import { BROWSER_PANELS } from '../../../../../browser/static/js/constants';
import { QUERY_TOOL_EVENTS } from './QueryToolConstants';

export function requestQueryFileSave({eventBus, currentFile, fileManager, modal}, isSaveAs=false, onComplete) {
  let selected = false;
  const save = fileName => {
    if (selected) return;
    selected = true;
    eventBus.fireEvent(QUERY_TOOL_EVENTS.SAVE_FILE, fileName, onComplete);
  };
  if (!isSaveAs && currentFile) {
    save(currentFile);
    return;
  }
  const cancel = () => {
    if (!selected) { selected = true; onComplete?.(false); }
  };
  try {
    Promise.resolve(fileManager.show({
      supported_types: ['sql', '*'], dialog_type: 'create_file',
      dialog_title: 'Save File', btn_primary: 'Save',
    }, save, cancel, modal)).catch(cancel);
  } catch {
    cancel();
  }
}

export async function saveQueryFile({api, editor, eventBus, notifier}, fileName, onComplete) {
  // Keep the view and exact serialized content belonging to this request.
  const view = editor.current;
  const savedDoc = view.state.doc;
  const savedEOL = view.getEOL();
  const content = view.getValue(false, true);
  try {
    await api.post(url_for('file_manager.save_file'), {
      file_name: decodeURI(fileName), file_content: content,
    });
  } catch (error) {
    eventBus.fireEvent(QUERY_TOOL_EVENTS.SAVE_FILE_DONE, null, false);
    eventBus.fireEvent(QUERY_TOOL_EVENTS.HANDLE_API_ERROR, error);
    onComplete?.(false);
    return;
  }
  if (editor.current !== view || view.destroyed || view.isDestroyed) {
    onComplete?.(false);
    return;
  }
  const unchanged = view.getValue(false, true) === content;
  view.markClean(savedDoc, savedEOL);
  eventBus.fireEvent(QUERY_TOOL_EVENTS.SAVE_FILE_DONE, fileName, true, !unchanged);
  notifier.success(gettext('File saved successfully.'));
  onComplete?.(unchanged);
}

export function navigateQueryTab(docker, currentId, {direction, count=1}) {
  const current = docker?.find(currentId);
  const tabs = current?.parent?.tabs?.filter(tab => tab.id.startsWith(`${BROWSER_PANELS.QUERY_TOOL}_`));
  if (!tabs?.length || !Number.isSafeInteger(count) || count < 1) return false;
  const index = tabs.findIndex(tab => tab.id === currentId);
  if (index < 0) return false;
  let next;
  switch (direction) {
  case 'next': next = (index + count % tabs.length) % tabs.length; break;
  case 'previous': next = (index - count % tabs.length + tabs.length) % tabs.length; break;
  case 'first': next = 0; break;
  case 'last': next = tabs.length - 1; break;
  case 'index': next = count - 1; break;
  default: return false;
  }
  if (!tabs[next]) return false;
  docker.focus(tabs[next].id);
  return true;
}
