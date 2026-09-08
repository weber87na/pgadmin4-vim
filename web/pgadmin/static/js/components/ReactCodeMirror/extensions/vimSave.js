/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { Facet } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Vim } from '@replit/codemirror-vim';
import gettext from 'sources/gettext';

const saveHandler = Facet.define({
  combine: values => values[0],
});

let registered = false;

export default function vimSave(onSave) {
  if (!registered) {
    Vim.defineEx('write', 'w', (cm, params) => {
      const view = cm.cm6;
      const save = view.state.facet(saveHandler);
      if (!view.state.facet(EditorView.editable)) return;
      if (params.argString?.trim() || params.line !== undefined) {
        cm.openNotification(document.createTextNode(gettext('Use :w to save the entire query. Choose a filename in the Save dialog.')), {bottom: true});
        return;
      }
      if (save) {
        // Reuse pgAdmin's save workflow, including Save As for unnamed tabs.
        // A callback belongs to this view, never to the last opened Query Tool.
        save(view);
      } else {
        cm.openNotification(document.createTextNode(gettext('Saving is not available in this editor.')), {bottom: true});
      }
    });
    registered = true;
  }
  return saveHandler.of(onSave);
}
