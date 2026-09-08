/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { Facet } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { getCM } from '@replit/codemirror-vim';

const showStatus = Facet.define({
  combine: values => values.length ? values[0] : true,
});

const hiddenStatusAttribute = 'data-pgadmin-vim-hide-status';

const statusVisibility = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.cm = getCM(view);
    this.onDialog = () => this.updateVisibility();
    this.cm?.on('dialog', this.onDialog);
    this.updateVisibility();
  }

  update() {
    this.updateVisibility();
  }

  updateVisibility() {
    // CodeMirror rewrites the editor's class attribute on focus and theme
    // updates. Keep our flag in an attribute it does not manage instead.
    this.view.dom.toggleAttribute(hiddenStatusAttribute,
      !this.view.state.facet(showStatus) && !this.cm?.state.dialog);
  }

  destroy() {
    this.cm?.off('dialog', this.onDialog);
    this.view.dom.removeAttribute(hiddenStatusAttribute);
  }
});

const statusTheme = EditorView.theme({
  ['&[' + hiddenStatusAttribute + '] .cm-vim-panel']: {
    display: 'none',
  },
});

/**
 * Use after vim({status: true}). Keep the upstream panel mounted when the
 * indicator is hidden: codemirror-vim 6.4.0 retains its statusbar reference
 * after removing that panel, causing subsequent /, ? and : prompts to be
 * attached to detached DOM. Dialogs and notifications always remain visible.
 */
export default function vimStatus(visible = true) {
  return [showStatus.of(visible), statusVisibility, statusTheme];
}
