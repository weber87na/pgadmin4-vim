/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getCM, Vim } from '@replit/codemirror-vim';

// Browsers distinguish Tab from Ctrl-I, while Vim treats both as jump-forward.
// Register the alias in the engine too, so mappings and macros can use Tab.
// The DOM guard prevents Normal/Visual Tab from reaching SQL indentation.
Vim.defineAction('pgadminShiftTab', () => {});
for (const context of ['normal', 'visual']) {
  Vim.mapCommand('<Tab>', 'action', 'jumpListWalk', {forward: true}, {context});
  Vim.mapCommand('<S-Tab>', 'action', 'pgadminShiftTab', {}, {context});
}
export default Prec.highest(EditorView.domEventHandlers({
  keydown(event, view) {
    const cm = getCM(view);
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey ||
        !cm?.state.vim || cm.state.vim.insertMode) return false;
    Vim.handleKey(cm, event.shiftKey ? '<S-Tab>' : '<Tab>', 'user');
    event.preventDefault();
    event.stopPropagation();
    return true;
  },
}));
