/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { Facet } from '@codemirror/state';
import { PostgreSQL } from '@codemirror/lang-sql';
import { Vim } from '@replit/codemirror-vim';

const enabled = Facet.define({combine: values => values.some(Boolean)});
const documents = new WeakMap();
let registered = false;

function children(node) {
  const result = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

function hasError(node) {
  const cursor = node.cursor();
  do { if (cursor.type.isError) return true; } while (cursor.next());
  return false;
}

function bodyRange(token, text) {
  const source = text.slice(token.from, token.to);
  const dollar = source.match(/^\$(?:[A-Za-z_\u0080-\uFFFF][A-Za-z_0-9\u0080-\uFFFF]*)?\$/)?.[0];
  if (dollar) {
    if (source.length < dollar.length * 2 || !source.endsWith(dollar)) return;
    return {from: token.from + dollar.length, to: token.to - dollar.length, dollar: true};
  }
  const prefix = source.match(/^[eEnN]?'/)?.[0];
  if (!prefix) return;
  // A final quote can also be half of a doubled quote in an unclosed string.
  // Validate its escape structure rather than merely checking endsWith("'").
  for (let index = prefix.length; index < source.length; index++) {
    if (/^e/i.test(prefix) && source[index] === '\\') index++;
    else if (source[index] === '\'') {
      if (source[index + 1] === '\'') index++;
      else return index === source.length - 1 ? {from: token.from + prefix.length, to: token.to - 1, dollar: false} : undefined;
    }
  }
}

function routine(statement, text) {
  if (hasError(statement)) return;
  const tokens = children(statement).filter(node => !/Comment$/.test(node.name));
  const word = index => tokens[index] && text.slice(tokens[index].from, tokens[index].to).toUpperCase();
  if (word(0) !== 'CREATE') return;
  let index = 1;
  if (word(index) === 'OR' && word(index + 1) === 'REPLACE') index += 2;
  if (!['FUNCTION', 'PROCEDURE'].includes(word(index))) return;
  // Requiring a name, parameter list and terminating semicolon keeps partial
  // editor input and unquoted BEGIN ATOMIC bodies outside this object's scope.
  if (!['Identifier', 'QuotedIdentifier', 'CompositeIdentifier', 'Keyword', 'Type', 'Builtin'].includes(tokens[++index]?.name) ||
      tokens[++index]?.name !== 'Parens' || tokens.at(-1)?.name !== ';') return;
  if (tokens.some((node, position) => position > index && node.name === 'Keyword' &&
      ['CREATE', 'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALTER', 'DROP', 'DO'].includes(word(position)))) return;
  const as = tokens.findIndex((node, position) => position > index && node.name === 'Keyword' && word(position) === 'AS');
  const language = tokens.findIndex((node, position) => position > index && node.name === 'Keyword' && word(position) === 'LANGUAGE');
  if (as < 0 || language < 0 || tokens[as + 1]?.name !== 'String' || word(as + 2) === ',') return;
  const languageToken = tokens[language + 1];
  let name = word(language + 1)?.replace(/^"|"$/g, '');
  if (languageToken?.name === 'String') {
    const literal = bodyRange(languageToken, text);
    if (!literal || tokens[language + 2]?.name === 'String') return;
    name = text.slice(literal.from, literal.to).toUpperCase();
    // LANGUAGE also accepts string literals. Keep escaped spellings outside
    // this object's scope rather than misclassifying an encoded C/INTERNAL.
    if (!literal.dollar && /[\\']/.test(name)) return;
  }
  if (!name || ['C', 'INTERNAL'].includes(name)) return;
  let bodyToken = tokens[as + 1];
  let nextBody = as + 2;
  // The SQL tokenizer emits each side of a doubled quote as a separate,
  // adjacent String token even though PostgreSQL treats it as one literal.
  if (/^[eEnN]?'/i.test(text.slice(bodyToken.from, bodyToken.to))) {
    while (tokens[nextBody]?.name === 'String' && tokens[nextBody].from === bodyToken.to) {
      bodyToken = {from: bodyToken.from, to: tokens[nextBody++].to};
    }
  }
  if (word(nextBody) === ',' || tokens[nextBody]?.name === 'String') return;
  const body = bodyRange(bodyToken, text);
  if (!body) return;
  const content = text.slice(body.from, body.to);
  const inner = {from: body.from + content.search(/\S|$/), to: body.to - (content.match(/\s*$/)?.[0].length || 0)};
  return {from: tokens[0].from, to: statement.to, body, inner, language: name};
}

function parsedDocument(state) {
  let parsed = documents.get(state.doc);
  if (!parsed) {
    const text = state.doc.toString();
    // pgAdmin's display dialect intentionally tokenizes inside dollar bodies.
    // A separate PostgreSQL tree gives text objects real string/comment
    // boundaries without changing highlighting, completion or folding.
    const tree = PostgreSQL.language.parser.parse(text);
    const routines = children(tree.topNode).filter(node => node.name === 'Statement')
      .map(node => routine(node, text)).filter(Boolean);
    parsed = {text, tree, routines};
    documents.set(state.doc, parsed);
  }
  return parsed;
}

function argumentRange(parsed, position, count, inner) {
  let {tree, text} = parsed;
  let offset = 0;
  const enclosing = parsed.routines.find(item => item.body.dollar &&
    ['SQL', 'PLPGSQL'].includes(item.language) && position >= item.body.from && position < item.body.to);
  if (enclosing) {
    offset = enclosing.body.from;
    text = text.slice(offset, enclosing.body.to);
    enclosing.bodyTree ||= PostgreSQL.language.parser.parse(text);
    tree = enclosing.bodyTree;
    position -= offset;
  }
  let parent = tree.resolveInner(position, 1);
  while (parent && parent.name !== 'Parens') parent = parent.parent;
  if (!parent || hasError(parent)) return;
  const tokens = children(parent);
  if (tokens[0]?.name !== '(' || tokens.at(-1)?.name !== ')') return;
  const start = tokens[0].to;
  const end = tokens.at(-1).from;
  const commas = tokens.filter(node => node.name === 'Punctuation' && text.slice(node.from, node.to) === ',');
  const boundaries = [start, ...commas.map(node => node.to), end];
  const args = boundaries.slice(0, -1).map((from, index) => {
    const to = index < commas.length ? commas[index].from : end;
    const content = text.slice(from, to);
    const present = tokens.some(node => node.from >= from && node.to <= to && !/Comment$/.test(node.name));
    return {from, to, present, start: from + content.search(/\S|$/), end: to - (content.match(/\s*$/)?.[0].length || 0)};
  });
  const first = Math.max(0, args.findIndex((arg, index) => position <= arg.to || index === args.length - 1));
  const last = Math.min(args.length - 1, first + count - 1);
  if (args.slice(first, last + 1).some(arg => !arg.present || arg.start >= arg.end)) return;
  let from = args[first].start;
  let to = args[last].end;
  if (!inner) {
    if (first === 0 && last === args.length - 1) { from = start; to = end; }
    else if (last < args.length - 1) to = args[last + 1].start;
    else from = commas[first - 1].from;
  }
  return {from: offset + from, to: offset + to};
}

function textObject(cm, head, args, vim) {
  const state = cm.cm6?.state;
  if (!state?.facet(enabled)) return;
  const parsed = parsedDocument(state);
  const position = cm.indexFromPos(head);
  const count = Math.max(1, args.repeat || 1);
  let range;
  if (args.object === 'routine') {
    if (count !== 1) return;
    const found = parsed.routines.find(item => item.from <= position && position < item.to);
    range = found && (args.inner ? found.inner : found);
  } else range = argumentRange(parsed, position, count, args.inner);
  if (!range || range.from >= range.to) return;
  args.inclusive = false;
  args.linewise = false;
  if (vim.visualMode) {
    vim.visualLine = false;
    vim.visualBlock = false;
  }
  return [cm.posFromIndex(range.from), cm.posFromIndex(range.to - (vim.visualMode ? 1 : 0))];
}

export default function vimTextObjects(active = true) {
  if (!registered) {
    registered = true;
    Vim.defineMotion('pgadminSQLTextObject', textObject);
    for (const [keys, object, inner] of [['if', 'routine', true], ['af', 'routine', false], ['ia', 'argument', true], ['aa', 'argument', false]]) {
      for (const context of ['operatorPending', 'visual']) {
        Vim.mapCommand(keys, 'motion', 'pgadminSQLTextObject', {object, inner}, {context});
      }
    }
  }
  return enabled.of(active);
}
