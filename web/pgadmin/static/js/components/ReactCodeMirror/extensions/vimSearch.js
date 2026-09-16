/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { Vim } from '@replit/codemirror-vim';

const values = new WeakMap();
const options = {
  ignorecase: 'ic', smartcase: 'scs', hlsearch: 'hls',
  incsearch: 'is', wrapscan: 'ws',
};
let registered = false;

/** Register real editor-local search options, implemented by the core patch. */
export default function vimSearch() {
  if (!registered) {
    for (const [name, alias] of Object.entries(options)) {
      // pgAdmin compatibility defaults retain the original engine's behavior.
      // Ignore the global callback of :set: Query Tool options remain local.
      Vim.defineOption(name, true, 'boolean', [alias], (value, cm) => {
        if (!cm) return true;
        if (value === undefined) return values.get(cm)?.[name] ?? true;
        if (!values.has(cm)) values.set(cm, {});
        values.get(cm)[name] = value;
        Vim.refreshSearchOptions(cm);
      });
    }
    registered = true;
  }
  return [];
}
