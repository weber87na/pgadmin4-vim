/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { findClusterBreak } from '@codemirror/state';

function wide(code) {
  return code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) || (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1b000 && code <= 0x1b2ff) || (code >= 0x1f200 && code <= 0x1f251) ||
    (code >= 0x20000 && code <= 0x3fffd));
}

function clusterWidth(cluster) {
  if (/\p{Emoji_Presentation}|\uFE0F|\u20E3/u.test(cluster)) return 2;
  let width = 0;
  for (const character of cluster) {
    if (/[\p{Mark}\p{Cf}]/u.test(character)) continue;
    const code = character.codePointAt(0);
    width = Math.max(width, wide(code) || code < 32 || code === 127 ? 2 : 1);
  }
  return width;
}

/** Monospace display cells, with ambiguous-width symbols treated as one cell.
 * Grapheme shaping and proportional-font pixel metrics are intentionally not
 * used: these are Vim-style columns, not browser layout coordinates.
 */
export function visualCells(text, tabSize, startColumn=0) {
  const cells = [];
  let column = startColumn;
  for (let from = 0; from < text.length;) {
    const to = findClusterBreak(text, from);
    const cluster = text.slice(from, to);
    if (/[\r\n]/.test(cluster)) break;
    const width = cluster === '\t' ? tabSize - column % tabSize : clusterWidth(cluster);
    cells.push({from, to, column, width, text: cluster});
    column += width;
    from = to;
  }
  return cells;
}

/** Return the column at a UTF-16 boundary, or the beginning of its grapheme. */
export function displayColumn(text, position, tabSize) {
  let column = 0;
  for (const cell of visualCells(text, tabSize)) {
    if (position < cell.to) return cell.column;
    column = cell.column + cell.width;
  }
  return column;
}
