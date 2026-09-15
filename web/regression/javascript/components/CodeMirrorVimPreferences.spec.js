/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2026, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history } from '@codemirror/commands';
import { getCM, vim, Vim } from '@replit/codemirror-vim';
import vimSave from 'sources/components/ReactCodeMirror/extensions/vimSave';
import vimNumbers from 'sources/components/ReactCodeMirror/extensions/vimNumbers';
import vimFolding from 'sources/components/ReactCodeMirror/extensions/vimFolding';
import { foldedRanges } from '@codemirror/language';
import vimPreferences, { parseVimConfig } from 'sources/components/ReactCodeMirror/extensions/vimPreferences';

const settle = () => Promise.resolve();

describe('CodeMirror persistent Vim preferences', () => {
  let views;

  function editor(doc = 'one two three', config = '', leader = ',', extra = []) {
    const compartment = new Compartment();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc, extensions: [vim(), history(), vimNumbers(), vimFolding(), extra, compartment.of(vimPreferences(config, leader))] }),
    });
    views.push({view, parent});
    return { view, cm: getCM(view), compartment };
  }

  function press(view, sequence) {
    view.focus();
    for (const token of sequence.match(/<[^>]+>|./g) || []) {
      const special = { '<Esc>': 'Escape', '<CR>': 'Enter', '<Tab>': 'Tab', '<Space>': ' ' };
      const ctrlKey = /^<C-/.test(token);
      const key = special[token] || (ctrlKey ? token.slice(3, -1) : token);
      const event = new KeyboardEvent('keydown', {
        key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
        keyCode: key === 'Escape' ? 27 : key === 'Enter' ? 13 : key.toUpperCase().charCodeAt(0),
        ctrlKey, shiftKey: /^[A-Z]$/.test(key), bubbles: true, cancelable: true,
      });
      view.contentDOM.dispatchEvent(event);
      if (!event.defaultPrevented && getCM(view).state.vim.insertMode && key.length === 1) {
        view.dispatch(view.state.update({ ...view.state.replaceSelection(key), userEvent: 'input.type' }));
      }
    }
  }

  function configure(editor, config, leader = ',') {
    editor.view.dispatch({effects: editor.compartment.reconfigure(vimPreferences(config, leader))});
  }

  beforeEach(() => {
    Vim.resetVimGlobalState_();
    views = [];
  });

  afterEach(() => {
    for (const {view, parent} of views) {
      view.destroy();
      parent.remove();
    }
  });

  it('parses comments, aliases, mode-specific maps and unmaps without executing Ex', () => {
    const parsed = parseVimConfig('" My settings\nset tw=100 nf=hex,alpha fdm=manual fdl=2 nofen\nnnoremap <Leader>w :w<CR>\nvnoremap X y\ninoremap jk <Esc>\nnunmap <Leader>w');
    expect(parsed.errors).toEqual([]);
    expect(parsed.options).toEqual({textwidth: 100, nrformats: 'hex,alpha', foldmethod: 'manual', foldlevel: 2, foldenable: false});
    expect(parsed.mappings.map(map => map.context)).toEqual(['visual', 'insert']);
  });

  it.each(['source ~/.vimrc', 'javascript alert(1)', 'set nf=hex,nope', 'set nf=hex,hex', 'set fdm=expr', 'set fdl=-1', 'set tw=1', 'set ignorecase', 'nnoremap <expr> x', 'nnoremap 2 x', 'nnoremap :unsafe x'])('rejects unsupported configuration atomically: %s', command => {
    const parsed = parseVimConfig('set tw=100\nnnoremap Q x\n' + command);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.options).toEqual({});
    expect(parsed.mappings).toEqual([]);
  });

  it('validates the leader as one key and supports Space', () => {
    expect(parseVimConfig('', 'two').errors.length).toBeGreaterThan(0);
    expect(parseVimConfig('nnoremap <Leader>w x', '<Space>').mappings[0].keys).toBe('<Space>w');
  });

  it('applies normal mappings with native counts and dot repeat', () => {
    const {view} = editor('abcdef', 'nnoremap Q x');
    press(view, '2Q.');
    expect(view.state.doc.toString()).toBe('ef');
  });

  it('supports comma and Space leader sequences despite builtin prefix commands', () => {
    const item = editor('abc def', 'nnoremap <Leader>x x');
    press(item.view, ',x');
    expect(item.view.state.doc.toString()).toBe('bc def');
    configure(item, 'nnoremap <Leader>x x', '<Space>');
    press(item.view, '<Space>x');
    expect(item.view.state.doc.toString()).toBe('c def');
  });

  it('maps to the precise numeric extension without falling back to core arithmetic', () => {
    const {view} = editor('9007199254740993', 'nnoremap Q <C-a>');
    press(view, 'Q');
    expect(view.state.doc.toString()).toBe('9007199254740994');
  });

  it('maps to Query Tool navigation without leaking its callback to other editors', () => {
    const navigate = jest.fn();
    const {view} = editor('abc', 'nnoremap Q gt', ',', vimSave(undefined, undefined, navigate));
    press(view, 'Q');
    expect(navigate).toHaveBeenCalledWith(view, {direction: 'next', count: 1});
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('maps to manual fold operators with native motions', async () => {
    const {view} = editor('one\ntwo\nthree', 'set fdm=manual\nnnoremap Q zf');
    await settle();
    press(view, 'Q2G');
    expect(foldedRanges(view.state).size).toBe(1);
  });

  it('executes nonrecursive mappings without expanding another user mapping', () => {
    const {view} = editor('abc def', 'nnoremap Q x\nnnoremap x w');
    press(view, 'Q');
    expect(view.state.doc.toString()).toBe('bc def');
    press(view, 'x');
    expect(view.state.selection.main.head).toBe(3);
  });

  it('scopes mappings to their editor and retains an existing shared mapping', () => {
    Vim.map('Q', 'l', 'normal');
    try {
      const a = editor('abcdef', 'nnoremap Q x');
      const b = editor('abcdef', 'nnoremap Q w');
      const c = editor('abcdef');
      press(a.view, 'Q');
      press(b.view, 'Q');
      press(c.view, 'Q');
      expect(a.view.state.doc.toString()).toBe('bcdef');
      expect(b.view.state.doc.toString()).toBe('abcdef');
      expect(c.view.state.selection.main.head).toBe(1);
      configure(a, '');
      press(a.view, 'Q');
      expect(a.view.state.selection.main.head).toBe(1);
    } finally {
      Vim.unmap('Q', 'normal');
    }
  });

  it('applies visual mappings only to selections', () => {
    const {view, cm} = editor('one two', 'vnoremap Q y');
    press(view, 'veQ');
    expect(cm.state.vim.visualMode).toBe(false);
    expect(Vim.getRegisterController().getRegister('"').toString()).toBe('one');
    expect(view.state.doc.toString()).toBe('one two');
  });

  it('uses native insert mappings without inserting the escape sequence', () => {
    const {view, cm} = editor('', 'inoremap jk <Esc>');
    press(view, 'ihellojk');
    expect(view.state.doc.toString()).toBe('hello');
    expect(cm.state.vim.insertMode).toBe(false);
  });

  it('preserves typed prefix text when insert configuration changes', () => {
    const item = editor('', 'inoremap jk <Esc>');
    press(item.view, 'ij');
    configure(item, 'inoremap jj <Esc>');
    press(item.view, 'k<Esc>');
    expect(item.view.state.doc.toString()).toBe('jk');
  });

  it('records and replays normal and leader mappings through native macros', () => {
    const {view} = editor('abcdef', 'nnoremap <Leader>x x');
    press(view, 'qa,xq@a');
    expect(view.state.doc.toString()).toBe('cdef');
  });

  it('maps to Ex save commands using the native virtual prompt', () => {
    const saved = jest.fn();
    Vim.defineEx('preferencesavetest', 'preferencesavetest', saved);
    const {view} = editor('abc', 'nnoremap <Leader>w :preferencesavetest<CR>');
    press(view, ',w');
    expect(saved).toHaveBeenCalledTimes(1);
    expect(view.dom.querySelector('.cm-vim-panel input')).toBeNull();
  });

  it('restores local option values when a setting is removed without affecting other editors', async () => {
    const a = editor('abc', 'set tw=120');
    const b = editor('abc', 'set tw=60');
    await settle();
    expect(Vim.getOption('textwidth', a.cm)).toBe(120);
    expect(Vim.getOption('textwidth', b.cm)).toBe(60);
    configure(a, '');
    await settle();
    expect(Vim.getOption('textwidth', a.cm)).toBeUndefined();
    expect(Vim.getOption('textwidth', b.cm)).toBe(60);
  });

  it('applies number and fold options locally and restores their defaults on removal', async () => {
    const a = editor('abc', 'set nf=hex,octal fdm=manual fdl=2 nofen');
    const b = editor('abc');
    await settle();
    expect(Vim.getOption('nrformats', a.cm)).toBe('hex,octal');
    expect(Vim.getOption('foldmethod', a.cm)).toBe('manual');
    expect(Vim.getOption('foldlevel', a.cm)).toBe(2);
    expect(Vim.getOption('foldenable', a.cm)).toBe(false);
    expect(Vim.getOption('nrformats', b.cm)).toBe('bin,hex');
    expect(Vim.getOption('foldmethod', b.cm)).toBe('syntax');
    expect(Vim.getOption('foldenable', b.cm)).toBe(true);
    configure(a, '');
    await settle();
    expect(Vim.getOption('nrformats', a.cm)).toBe('bin,hex');
    expect(Vim.getOption('foldmethod', a.cm)).toBe('syntax');
    expect(Vim.getOption('foldlevel', a.cm)).toBe(99);
    expect(Vim.getOption('foldenable', a.cm)).toBe(true);
  });

  it('shows validation errors and removes previous settings without partial application', async () => {
    const item = editor('abc', 'nnoremap Q x\nset tw=120');
    await settle();
    configure(item, 'nnoremap Q w\nset tw=200\nsource test.vim');
    await settle();
    expect(item.view.dom.querySelector('.cm-vim-config-error').textContent).toContain('Line 3');
    expect(Vim.getOption('textwidth', item.cm)).toBeUndefined();
    configure(item, 'nnoremap Q x');
    expect(item.view.dom.querySelector('.cm-vim-config-error')).toBeNull();
    press(item.view, 'Q');
    expect(item.view.state.doc.toString()).toBe('bc');
  });
});
