/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { Facet } from '@codemirror/state';
import { EditorView, showPanel, ViewPlugin } from '@codemirror/view';
import { getCM, Vim } from '@replit/codemirror-vim';

const aliases = {
  tw: 'textwidth', nf: 'nrformats', fdm: 'foldmethod',
  fdl: 'foldlevel', fen: 'foldenable',
};
const modes = { nnoremap: 'normal', vnoremap: 'visual', inoremap: 'insert' };
const unmaps = { nunmap: ['normal'], vunmap: ['visual'], iunmap: ['insert'], unmap: ['normal', 'visual', 'insert'] };
const specialKeys = {
  esc: 'Esc', escape: 'Esc', cr: 'CR', enter: 'CR', return: 'CR',
  space: 'Space', tab: 'Tab', bs: 'BS', backspace: 'BS', del: 'Del',
  delete: 'Del', ins: 'Ins', insert: 'Ins', left: 'Left', right: 'Right',
  up: 'Up', down: 'Down', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', lt: 'lt', bar: 'Bar',
};

function keys(value, leader, rhs = false) {
  if (!value || value.length > 1024) throw Error('Key sequence must contain 1 to 1024 characters.');
  if (rhs && /^<nop>$/i.test(value)) return '';
  const expanded = value.replace(/<leader>/gi, () => leader);
  let result = '';
  for (const token of expanded.match(/<[^>]*>|[^<]|</gu) || []) {
    if (!token.startsWith('<')) {
      result += token === ' ' ? '<Space>' : token;
      continue;
    }
    if (token === '<') throw Error('Use <lt> for a literal less-than key.');
    const match = /^<((?:[CSMA]-)*)([^<>]+)>$/i.exec(token);
    if (!match) throw Error('Unsupported key: ' + token);
    const modifiers = match[1].toUpperCase();
    const key = match[2];
    const special = specialKeys[key.toLowerCase()];
    if (special === 'lt' && !modifiers) result += '<';
    else if (special === 'Bar' && !modifiers) result += '|';
    else if (special) result += '<' + modifiers + special + '>';
    else if (/^f(?:[1-9]|1[0-2])$/i.test(key)) result += '<' + modifiers + key.toUpperCase() + '>';
    else if (modifiers && /^[a-z0-9]$/i.test(key)) result += '<' + modifiers + key.toLowerCase() + '>';
    else throw Error('Unsupported key: ' + token);
  }
  return result;
}


function option(token) {
  const match = /^(no)?([a-z]+)(?:=(.*))?$/.exec(token);
  if (!match) throw Error('Invalid setting: ' + token);
  const name = aliases[match[2]] || match[2];
  const value = match[3];
  if (name === 'foldenable' && value === undefined) return [name, !match[1]];
  if (match[1] || value === undefined) throw Error('Setting requires a value: ' + token);
  if (name === 'textwidth' && /^\d+$/.test(value) && +value >= 2 && +value <= 10000) return [name, +value];
  if (name === 'foldlevel' && /^\d+$/.test(value) && +value <= 999) return [name, +value];
  if (name === 'foldmethod' && ['manual', 'syntax'].includes(value)) return [name, value];
  if (name === 'nrformats') {
    const formats = value ? value.split(',') : [];
    if (new Set(formats).size === formats.length && formats.every(format =>
      ['bin', 'octal', 'hex', 'alpha', 'unsigned'].includes(format))) return [name, value];
  }
  throw Error('Unsupported setting or value: ' + token);
}

/** Parse a deliberately small, non-executable vimrc subset before applying it. */
export function parseVimConfig(source = '', leader = ',') {
  const result = { source, leader, options: {}, mappings: [], errors: [] };
  try {
    if (typeof source !== 'string' || source.length > 32768) throw Error('Configuration must be at most 32768 characters.');
    if (typeof leader !== 'string') throw Error('Leader must be a single key.');
    leader = keys(leader, '');
    if ((leader.match(/<[^>]+>|./gu) || []).length !== 1) throw Error('Leader must be a single key.');
  } catch (error) {
    result.errors.push(error.message);
    return result;
  }
  const mappings = new Map();
  source.split(/\r?\n/).forEach((line, index) => {
    line = line.trim();
    if (!line || line.startsWith('"')) return;
    try {
      const match = /^:?(\w+)\s+(.+)$/.exec(line);
      if (!match) throw Error('Expected set, a nonrecursive mapping, or unmap.');
      const [, command, args] = match;
      if (command === 'set' || command === 'setlocal') {
        for (const token of args.split(/\s+/)) {
          const [name, value] = option(token);
          result.options[name] = value;
        }
      } else if (Object.hasOwn(modes, command)) {
        const mapping = /^(\S+)\s+(.+)$/.exec(args);
        if (!mapping) throw Error('A mapping requires both keys and a replacement.');
        const lhs = keys(mapping[1], leader);
        if (/^[0-9]/.test(lhs) || (lhs.startsWith(':') && lhs !== ':')) {
          throw Error('Mapping keys cannot start with a count or an Ex command.');
        }
        const context = modes[command];
        const replacement = keys(mapping[2], leader, true);
        mappings.set(context + ':' + lhs, {
          keys: lhs, toKeys: replacement,
          context, type: 'keyToKey', noremap: true,
        });
      } else if (Object.hasOwn(unmaps, command)) {
        if (/\s/.test(args)) throw Error('Unmap accepts one key sequence.');
        const lhs = keys(args, leader);
        for (const mode of unmaps[command]) mappings.delete(mode + ':' + lhs);
      } else throw Error('Unsupported command: ' + command);
    } catch (error) {
      result.errors.push('Line ' + (index + 1) + ': ' + error.message);
    }
  });
  // Atomic application: a typo must never leave half a configuration active.
  if (result.errors.length) result.options = {};
  else result.mappings = [...mappings.values()];
  return result;
}

const configuration = Facet.define({ combine: values => values[0] });
const instances = new WeakMap();
let installed = false;

function installLocalLookup() {
  if (installed) return;
  installed = true;
  const findKey = Vim.findKey;
  Vim.findKey = function(cm, key, origin) {
    const mappings = origin !== 'mapping' && instances.get(cm)?.config.mappings;
    if (!mappings?.length) return findKey.call(this, cm, key, origin);
    const state = cm.state.vim;
    const mode = state?.visualMode ? 'visual' : 'normal';
    if (state && !state.insertMode && !state.inputState.operator && !state.expectLiteralNext && key !== '<Esc>') {
      const matching = mappings.filter(mapping => mapping.context === mode);
      const sequence = (state.inputState.keyBuffer.join('') + key).replace(/^[1-9]\d*/, '');
      const macro = Vim.getVimGlobalState_().macroModeState;
      if (!(macro.isRecording && key === 'q') &&
          !matching.some(mapping => mapping.keys === sequence) &&
          matching.some(mapping => mapping.keys.startsWith(sequence))) {
        // Core prefers a complete builtin (e.g. comma) over a custom prefix
        // (,w). Reserve the prefix before lookup so <Leader> works normally.
        state.inputState.keyBuffer.push(key);
        if (macro.isRecording && !macro.isPlaying) {
          Vim.getRegisterController().getRegister(macro.latestRegister)?.pushText(key);
        }
        return () => true;
      }
    }
    // Core 0.1.0 exposes only a shared keymap. Lookup is synchronous and
    // returns a closure capturing the matched command: prepend this editor's
    // entries only for lookup, then remove them BEFORE any command executes.
    // Native counts, insert-prefix buffering and macro recording stay intact.
    for (const mapping of mappings) Vim._mapCommand(mapping);
    try {
      return findKey.call(this, cm, key, origin);
    } finally {
      for (let index = mappings.length - 1; index >= 0; index--) {
        Vim.unmap(mappings[index].keys, mappings[index].context);
      }
    }
  };
}

const applyConfiguration = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.cm = getCM(view);
    this.baselines = new Map();
    this.activeOptions = new Set();
    this.configure();
  }

  configure() {
    const config = this.view.state.facet(configuration);
    if (this.config?.source === config.source && this.config?.leader === config.leader) return;
    const mappingsChanged = JSON.stringify(this.config?.mappings) !== JSON.stringify(config.mappings);
    this.config = config;
    if (!this.cm) return;
    instances.set(this.cm, this);
    if (mappingsChanged && this.cm.state.vim?.inputState) {
      // Insert-prefix characters already belong to the document. Clearing the
      // queue leaves them there and prevents a replacement config deleting them.
      this.cm.state.vim.inputState.keyBuffer.length = 0;
      this.cm.state.vim.inputState.changeQueue = undefined;
    }
    // Fold options dispatch transactions, which cannot run during a plugin
    // constructor or update. Keep mapping changes synchronous and defer options.
    Promise.resolve().then(() => {
      if (instances.get(this.cm) !== this || this.config !== config || !this.cm.state.vim) return;
      for (const name of this.activeOptions) {
        if (!Object.hasOwn(config.options, name)) {
          this.restore(name);
          this.activeOptions.delete(name);
        }
      }
      for (const [name, value] of Object.entries(config.options)) {
        if (!this.baselines.has(name)) this.baselines.set(name, Vim.getOption(name, this.cm));
        Vim.setOption(name, value, this.cm, {scope: 'local'});
        this.activeOptions.add(name);
      }
    });
  }

  restore(name) {
    const value = this.baselines.get(name);
    if (name === 'textwidth' && value === undefined) this.cm.setOption('textwidth', undefined);
    else Vim.setOption(name, value, this.cm, {scope: 'local'});
  }

  update() { this.configure(); }

  destroy() {
    instances.delete(this.cm);
    Promise.resolve().then(() => {
      if (instances.has(this.cm) || !this.cm?.state.vim) return;
      for (const name of this.activeOptions) {
        this.restore(name);
      }
    });
  }
});

function errorPanel(view) {
  const dom = document.createElement('div');
  dom.className = 'cm-vim-config-error';
  dom.setAttribute('role', 'status');
  const update = () => {
    dom.textContent = 'Vim configuration was not applied. ' + view.state.facet(configuration).errors.join(' ');
  };
  update();
  return {dom, update};
}

/** Place after vim(), vimNumbers() and vimFolding(). */
export default function vimPreferences(source = '', leader = ',') {
  installLocalLookup();
  const config = parseVimConfig(source, leader);
  return [
    configuration.of(config), applyConfiguration,
    showPanel.of(config.errors.length ? errorPanel : null),
    EditorView.theme({ '.cm-vim-config-error': { padding: '4px 8px', whiteSpace: 'normal' } }),
  ];
}
