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
// The core maps only Ctrl-I, leaving Tab to pgAdmin's indentation keymap.
// Handle it per view so Normal/Visual mode cannot accidentally insert spaces.
export default Prec.highest(EditorView.domEventHandlers({
  keydown(event, view) {
    const cm = getCM(view);
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey ||
        !cm?.state.vim || cm.state.vim.insertMode) return false;
    if (!event.shiftKey) Vim.handleKey(cm, '<C-i>', 'user');
    event.preventDefault();
    event.stopPropagation();
    return true;
  },
}));
