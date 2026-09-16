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
import vimSearch from 'sources/components/ReactCodeMirror/extensions/vimSearch';
import vimPreferences from 'sources/components/ReactCodeMirror/extensions/vimPreferences';

const highlightsReady = () => new Promise(resolve => setTimeout(resolve, 70));

describe('CodeMirror Vim local search options', () => {
  let views;

  function editor(doc, anchor = 0, config = '') {
    const compartment = new Compartment();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({parent, state: EditorState.create({
      doc, selection: {anchor}, extensions: [vim(), vimSearch(), history(), compartment.of(vimPreferences(config))],
    })});
    views.push({view, parent});
    return {view, cm: getCM(view), compartment};
  }

  function press(view, sequence) {
    view.focus();
    for (const token of sequence.match(/<[^>]+>|./g) || []) {
      const specials = {'<Esc>': 'Escape', '<CR>': 'Enter'};
      const key = specials[token] || token;
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
        key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key,
        keyCode: key === 'Escape' ? 27 : key === 'Enter' ? 13 : key.toUpperCase().charCodeAt(0),
        shiftKey: /^[A-Z]$/.test(key), bubbles: true, cancelable: true,
      }));
    }
  }

  function startPrompt(view, prefix, value) {
    press(view, prefix);
    const input = view.dom.querySelector('.cm-vim-panel input');
    expect(input).not.toBeNull();
    input.value = value;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new KeyboardEvent('keyup', {key: 'a', keyCode: 65, bubbles: true}));
    return input;
  }

  function finish(input, key = 'Enter') {
    input.dispatchEvent(new KeyboardEvent('keydown', {key, keyCode: key === 'Enter' ? 13 : 27, bubbles: true, cancelable: true}));
  }

  function prompt(view, prefix, value) { finish(startPrompt(view, prefix, value)); }
  function set(item, options) { prompt(item.view, ':', 'set ' + options); }
  const head = item => item.view.state.selection.main.head;

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

  it('retains compatibility defaults and exposes aliases in each editor', () => {
    const item = editor('foo');
    for (const name of ['ic', 'scs', 'hls', 'is', 'ws']) expect(Vim.getOption(name, item.cm)).toBe(true);
    set(item, 'noic');
    expect(Vim.getOption('ignorecase', item.cm)).toBe(false);
    expect(Vim.getOption('ic', editor('bar').cm)).toBe(true);
  });

  it('applies ignorecase to forward searches and repeat motions', () => {
    const item = editor('foo FOO foo');
    set(item, 'noic');
    prompt(item.view, '/', 'foo');
    expect(head(item)).toBe(8);
    press(item.view, 'n');
    expect(head(item)).toBe(0);
    set(item, 'ic');
    press(item.view, 'n');
    expect(head(item)).toBe(4);
  });

  it('applies smartcase only with ignorecase and recompiles the previous pattern', () => {
    const item = editor('foo Foo FOO');
    prompt(item.view, '/', 'Foo');
    expect(head(item)).toBe(4);
    set(item, 'noscs');
    press(item.view, 'n');
    expect(head(item)).toBe(8);
    set(item, 'noic');
    press(item.view, 'n');
    expect(head(item)).toBe(4);
    set(item, 'scs');
    prompt(item.view, '/', 'foo');
    expect(head(item)).toBe(0);
  });

  it('preserves backward search direction for n and reverses it for N', () => {
    const item = editor('foo FOO foo', 8);
    set(item, 'noic');
    prompt(item.view, '?', 'foo');
    expect(head(item)).toBe(0);
    press(item.view, 'n');
    expect(head(item)).toBe(8);
    press(item.view, 'N');
    expect(head(item)).toBe(0);
  });

  it('uses ignorecase but deliberately ignores smartcase for star and hash', () => {
    const item = editor('FOO foo FOO');
    press(item.view, '*');
    expect(head(item)).toBe(4);
    press(item.view, '#');
    expect(head(item)).toBe(0);
    set(item, 'noic');
    press(item.view, '*');
    expect(head(item)).toBe(8);
  });

  it('keeps search patterns and direction independent across editors', () => {
    const a = editor('foo FOO foo');
    const b = editor('bar BAR bar', 8);
    set(a, 'noic');
    prompt(a.view, '/', 'foo');
    prompt(b.view, '?', 'bar');
    expect(head(a)).toBe(8);
    expect(head(b)).toBe(4);
    press(a.view, 'n');
    press(b.view, 'n');
    expect(head(a)).toBe(0);
    expect(head(b)).toBe(0);
  });

  it.each([
    ['foo\\c', 'noic', 4], ['foo\\C', 'ic', 8],
    ['foo/i', 'noic', 4], ['foo/I', 'ic', 8],
  ])('honors an explicit case override %s', (pattern, setting, expected) => {
    const item = editor('foo FOO foo');
    set(item, setting);
    prompt(item.view, '/', pattern);
    expect(head(item)).toBe(expected);
  });

  it('retains literal escaped backslashes before c instead of treating them as a case override', () => {
    const item = editor('x \\c \\c');
    prompt(item.view, '/', '\\\\c');
    expect(head(item)).toBe(2);
  });

  it('stops at boundaries when wrapscan is disabled, including counted searches', () => {
    const item = editor('foo x foo x foo');
    set(item, 'nows');
    prompt(item.view, '/', 'foo');
    expect(head(item)).toBe(6);
    press(item.view, '2n');
    expect(head(item)).toBe(6);
    press(item.view, 'n');
    expect(head(item)).toBe(12);
    press(item.view, 'n');
    expect(head(item)).toBe(12);
    set(item, 'ws');
    press(item.view, 'n');
    expect(head(item)).toBe(0);
  });

  it('does not wrap backward past the first match', () => {
    const item = editor('foo x foo', 6);
    set(item, 'nows');
    prompt(item.view, '?', 'foo');
    expect(head(item)).toBe(0);
    press(item.view, 'n');
    expect(head(item)).toBe(0);
  });

  it('previews incrementally and restores the original cursor and pattern on Escape', () => {
    const item = editor('foo bar foo bar');
    prompt(item.view, '/', 'foo');
    expect(head(item)).toBe(8);
    const input = startPrompt(item.view, '/', 'bar');
    expect(head(item)).toBe(12);
    finish(input, 'Escape');
    expect(head(item)).toBe(8);
    expect(Vim.getRegisterController().getRegister('/').toString()).toBe('foo');
    press(item.view, 'n');
    expect(head(item)).toBe(0);
  });

  it('keeps an operator anchored at its original position while previewing a search', () => {
    const item = editor('one two end');
    press(item.view, 'd');
    const input = startPrompt(item.view, '/', 'two');
    expect(head(item)).toBe(4);
    finish(input);
    expect(item.view.state.doc.toString()).toBe('two end');
  });

  it('replays a recorded search using smartcase consistently', () => {
    const item = editor('foo Foo foo Foo');
    press(item.view, 'qa');
    prompt(item.view, '/', 'Foo');
    press(item.view, 'q');
    expect(head(item)).toBe(4);
    press(item.view, '@a');
    expect(head(item)).toBe(12);
  });

  it('keeps the previous valid query when an invalid expression is submitted', () => {
    const item = editor('foo bar foo bar');
    prompt(item.view, '/', 'foo');
    const input = startPrompt(item.view, '/', '[');
    expect(head(item)).toBe(8);
    finish(input);
    expect(head(item)).toBe(8);
    press(item.view, 'n');
    expect(head(item)).toBe(0);
  });

  it('does not preview with noincsearch but searches normally on Enter', async () => {
    const item = editor('foo bar foo bar');
    set(item, 'nois');
    const input = startPrompt(item.view, '/', 'bar');
    await highlightsReady();
    expect(head(item)).toBe(0);
    expect(item.cm.state.vim.searchState_.getOverlay()).toBeFalsy();
    finish(input);
    expect(head(item)).toBe(4);
    await highlightsReady();
    expect(item.cm.state.vim.searchState_.getOverlay()).toBeTruthy();
  });

  it('restores a visual selection when an incremental search is cancelled', () => {
    const item = editor('foo bar foo bar');
    press(item.view, 've');
    const original = item.view.state.selection.toJSON();
    const input = startPrompt(item.view, '/', 'bar');
    finish(input, 'Escape');
    expect(item.cm.state.vim.visualMode).toBe(true);
    expect(item.view.state.selection.toJSON()).toEqual(original);
  });

  it('reuses the original search when a preview is cleared before Enter', () => {
    const item = editor('foo bar foo bar');
    prompt(item.view, '/', 'foo');
    const input = startPrompt(item.view, '/', 'bar');
    input.value = '';
    input.dispatchEvent(new KeyboardEvent('keyup', {key: 'Backspace', keyCode: 8, bubbles: true}));
    finish(input);
    expect(head(item)).toBe(0);
    expect(Vim.getRegisterController().getRegister('/').toString()).toBe('foo');
  });

  it('disables highlights immediately, keeps matching, and supports temporary nohlsearch', async () => {
    const item = editor('foo foo foo');
    prompt(item.view, '/', 'foo');
    await highlightsReady();
    expect(item.cm.state.vim.searchState_.getOverlay()).toBeTruthy();
    set(item, 'nohls');
    expect(item.cm.state.vim.searchState_.getOverlay()).toBeNull();
    press(item.view, 'n');
    await highlightsReady();
    expect(head(item)).toBe(8);
    expect(item.cm.state.vim.searchState_.getOverlay()).toBeNull();
    set(item, 'hls');
    await highlightsReady();
    expect(item.cm.state.vim.searchState_.getOverlay()).toBeTruthy();
    prompt(item.view, ':', 'nohlsearch');
    expect(item.cm.state.vim.searchState_.getOverlay()).toBeNull();
    press(item.view, 'n');
    await highlightsReady();
    expect(item.cm.state.vim.searchState_.getOverlay()).toBeTruthy();
  });

  it('does not cancel another editor’s pending highlight timer', async () => {
    const a = editor('foo foo');
    const b = editor('bar bar');
    prompt(a.view, '/', 'foo');
    prompt(b.view, '/', 'bar');
    await highlightsReady();
    expect(a.cm.state.vim.searchState_.getOverlay()).toBeTruthy();
    expect(b.cm.state.vim.searchState_.getOverlay()).toBeTruthy();
    set(a, 'nohls');
    expect(b.cm.state.vim.searchState_.getOverlay()).toBeTruthy();
  });

  it.each([
    ['noic', '%s/foo/x/g', 'x FOO x'],
    ['noic', '%s/foo/x/gi', 'x x x'],
    ['ic', '%s/foo/x/gI', 'x FOO x'],
    ['noic', '%s/foo\\c/x/g', 'x x x'],
    ['ic', '%s/foo\\C/x/gi', 'x FOO x'],
  ])('honors %s and substitution case flags for %s', (setting, command, expected) => {
    const item = editor('foo FOO foo');
    set(item, setting);
    prompt(item.view, ':', command);
    expect(item.view.state.doc.toString()).toBe(expected);
  });

  it('uses this editor’s last pattern for an empty substitute pattern with flags', () => {
    const item = editor('foo FOO foo');
    set(item, 'noic');
    prompt(item.view, '/', 'foo');
    prompt(item.view, ':', '%s//x/gi');
    expect(item.view.state.doc.toString()).toBe('x x x');
  });

  it('uses local case options for global commands', () => {
    const item = editor('foo\nFOO\nfoo');
    set(item, 'noic');
    prompt(item.view, ':', 'g/foo/d');
    expect(item.view.state.doc.toString()).toBe('FOO');
  });

  it('persists search option values through configuration and restores defaults on removal', async () => {
    const item = editor('foo FOO foo', 0, 'set noic noscs nohls nois nows');
    await Promise.resolve();
    for (const name of ['ic', 'scs', 'hls', 'is', 'ws']) expect(Vim.getOption(name, item.cm)).toBe(false);
    prompt(item.view, '/', 'foo');
    expect(head(item)).toBe(8);
    item.view.dispatch({effects: item.compartment.reconfigure(vimPreferences(''))});
    await Promise.resolve();
    for (const name of ['ic', 'scs', 'hls', 'is', 'ws']) expect(Vim.getOption(name, item.cm)).toBe(true);
    press(item.view, 'n');
    expect(head(item)).toBe(0);
  });
});
