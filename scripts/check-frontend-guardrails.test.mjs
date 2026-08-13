import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSource, approvedNetworkClientFiles, frontendExtensions } from './check-frontend-guardrails.mjs';

const breakpoints = new Set(['360px', '390px', '768px', '1024px', '1440px']);

test('covers every production frontend source extension', () => {
  assert.deepEqual([...frontendExtensions], ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.html']);
});

test('rejects HTML injection sinks and direct network clients', () => {
  const variants = [
    ['unsafe.ts', 'node.dangerouslySetInnerHTML = value', 'dangerouslySetInnerHTML'],
    ['unsafe.ts', 'node.innerHTML = value', 'innerHTML'],
    ['unsafe.jsx', 'node.outerHTML = value', 'outerHTML'],
    ['unsafe.mjs', "node.insertAdjacentHTML('beforeend', value)", 'insertAdjacentHTML'],
    ['unsafe.ts', "fetch('/api/admin')", 'network'],
    ['unsafe.js', "axios.get('/api/admin')", 'network'],
    ['unsafe.ts', 'new XMLHttpRequest()', 'network'],
    ['unsafe.ts', "navigator.sendBeacon('/audit', data)", 'network'],
    ['unsafe.ts', "new WebSocket('wss://example.test')", 'network'],
    ['unsafe.ts', "new EventSource('/events')", 'network'],
    ['unsafe.ts', "node['inner' + 'HTML'] = value", 'computed HTML sink'],
  ];
  for (const [file, source, expected] of variants) {
    assert.ok(analyzeSource(file, source, breakpoints).some((failure) => failure.includes(expected)), `${file} should reject ${expected}`);
  }
});

test('rejects global writes but allows platform reads and redirects', () => {
  for (const source of ['window.admin = api', 'globalThis.admin = api', 'self["admin"] = api']) {
    assert.ok(analyzeSource('unsafe.mjs', source, breakpoints).some((failure) => failure.includes('browser global write')));
  }
  assert.deepEqual(analyzeSource('redirect.ts', "window.location.assign('/login'); window.location.href = '/login'; const origin = globalThis.location.origin", breakpoints), []);
});

test('rejects case-insensitive inline HTML event attributes and JSX inline styles', () => {
  assert.ok(analyzeSource('unsafe.html', '<button OnClick="run()">Run</button>', breakpoints).some((failure) => failure.includes('inline event')));
  assert.ok(analyzeSource('unsafe.jsx', 'const html = `<button ONCLICK="run()">Run</button>`;', breakpoints).some((failure) => failure.includes('inline event')));
  assert.ok(analyzeSource('unsafe.tsx', '<button style={{ color: "red" }}>Run</button>', breakpoints).some((failure) => failure.includes('inline style')));
});

test('allows direct network clients only at the approved API boundary', () => {
  assert.deepEqual([...approvedNetworkClientFiles], ['src/api/client.ts']);
  assert.ok(analyzeSource('src/Showcase.tsx', "fetch('/api/admin')", breakpoints).some((failure) => failure.includes('outside approved')));
  assert.deepEqual(analyzeSource('src/api/client.ts', "fetch('/api/admin')", breakpoints, { allowNetworkClient: true }), []);
});

test('rejects aliased and computed network clients outside the approved boundary', () => {
  const variants = [
    "const request = window.fetch; request('/api/admin')",
    "const { fetch: request } = window; request('/api/admin')",
    "const request = Reflect.get(window, 'fetch'); request('/api/admin')",
    "globalThis['fetch']('/api/admin')",
    "navigator['sendBeacon']('/audit', data)",
    "import kyClient from 'ky'; kyClient('/api/admin')",
    "import request from 'superagent'; request('/api/admin')",
  ];
  for (const source of variants) assert.ok(analyzeSource('unsafe.ts', source, breakpoints).some((failure) => failure.includes('network')));
});

test('rejects aliased and logical-assignment global exposure', () => {
  assert.ok(analyzeSource('unsafe.ts', 'const host = window; host.admin = api', breakpoints).some((failure) => failure.includes('global write')));
  assert.ok(analyzeSource('unsafe.ts', 'let host; host = window; host.admin = api', breakpoints).some((failure) => failure.includes('global write')));
  assert.ok(analyzeSource('unsafe.ts', 'globalThis.admin ||= api', breakpoints).some((failure) => failure.includes('global write')));
});

test('rejects AST HTML parser and computed sink bypasses', () => {
  assert.ok(analyzeSource('unsafe.ts', "node['inner' + 'HTML'] = value", breakpoints).some((failure) => failure.includes('HTML sink')));
  assert.ok(analyzeSource('unsafe.ts', "node[`inner${'HTML'}`] = value", breakpoints).some((failure) => failure.includes('HTML sink')));
  assert.ok(analyzeSource('unsafe.ts', "new DOMParser().parseFromString(value, 'text/html')", breakpoints).some((failure) => failure.includes('parseFromString')));
  assert.deepEqual(analyzeSource('safe.ts', "customParser.parseFromString(value, 'custom')", breakpoints), []);
});

test('rejects JSX spread objects that can inject inline style', () => {
  assert.ok(analyzeSource('unsafe.tsx', '<button {...{ style: { color: "red" } }} />', breakpoints).some((failure) => failure.includes('spread')));
  assert.ok(analyzeSource('unsafe.tsx', 'const unsafe = { style: { color: "red" } }; const view = <button {...unsafe} />', breakpoints).some((failure) => failure.includes('spread')));
  assert.ok(analyzeSource('unsafe.tsx', 'const unsafe = { style: { color: "red" } }; const copy = { ...unsafe }; const view = <button {...copy} />', breakpoints).some((failure) => failure.includes('spread')));
  assert.deepEqual(analyzeSource('safe.tsx', 'const view = <button {...props} />', breakpoints), []);
});

test('allows React JSX event props and approved responsive tokens', () => {
  assert.deepEqual(analyzeSource('safe.jsx', '<button onClick={handleClick}>Run</button>', breakpoints), []);
  assert.deepEqual(analyzeSource('safe.css', '@media (max-width: 390px) { .item { display: block; } }', breakpoints), []);
  assert.deepEqual(analyzeSource('safe.ts', "function fetch(key) { return cache.get(key); } fetch('local'); const label = 'axios'; cache.fetch('local')", breakpoints), []);
});

test('tracks shadowed fetch bindings by lexical scope', () => {
  assert.deepEqual(analyzeSource('safe.ts', "function helper() { const fetch = () => 'local'; return fetch(); }", breakpoints), []);
  const failures = analyzeSource('unsafe.ts', "function helper() { const fetch = () => 'local'; return fetch(); } export function load() { return fetch('/api/admin'); }", breakpoints);
  assert.ok(failures.some((failure) => failure.includes('network client outside approved')));
});

test('distinguishes network aliases and constructors from shadowing bindings', () => {
  const safeVariants = [
    "const request = window.fetch; function render(request) { return request('local'); }",
    "function helper(fetch) { const request = fetch; return request('local'); }",
    "function helper({ fetch }) { return fetch('local'); }",
    "try { work(); } catch (fetch) { fetch('local'); }",
    "for (const fetch of callbacks) fetch('local')",
    "class WebSocket {} new WebSocket()",
  ];
  for (const source of safeVariants) assert.deepEqual(analyzeSource('safe.ts', source, breakpoints), [], source);
  assert.ok(analyzeSource('unsafe.ts', "const request = window.fetch; request('/api/admin')", breakpoints).some((failure) => failure.includes('network')));
  assert.ok(analyzeSource('unsafe.ts', "const { fetch: request } = window; request('/api/admin')", breakpoints).some((failure) => failure.includes('network')));
});

test('rejects responsive literals absent from DESIGN.md', () => {
  assert.ok(analyzeSource('unsafe.css', '@media (min-width: 500px) {}', breakpoints).some((failure) => failure.includes('500px')));
  assert.ok(analyzeSource('unsafe.css', '@media (max-width: 48rem) {}', breakpoints).some((failure) => failure.includes('exact DESIGN.md')));
});

test('rejects manual spacing and typography while allowing generated tokens', () => {
  assert.ok(analyzeSource('unsafe.css', '.item { padding: 13px; }', breakpoints).some((failure) => failure.includes('manual spacing')));
  assert.ok(analyzeSource('unsafe.css', '.item { padding-inline: 2vw; }', breakpoints).some((failure) => failure.includes('manual spacing')));
  assert.ok(analyzeSource('unsafe.css', '.item { line-height: 1.4; }', breakpoints).some((failure) => failure.includes('manual spacing')));
  assert.deepEqual(analyzeSource('src/styles/tokens.css', ':root { --spacing-custom: 13px; }', breakpoints), []);
  assert.deepEqual(analyzeSource('safe.css', '.item { padding: var(--spacing-md); line-height: var(--typography-body-lineheight); }', breakpoints), []);
});

test('rejects hardcoded CSS visual values and responsive hiding', () => {
  for (const source of [
    '.item { color: #ffffff; }',
    '.item { border: 1px solid red; }',
    '.item { box-shadow: 0 2px 4px #000; }',
    '.item { grid-template-columns: 1fr 2fr; }',
    '.item { outline: 2px solid red; }',
    '.item { --local-gap: 13px; padding: var(--local-gap); }',
    '.item { background: linear-gradient(red, blue); }',
    '.item { transform: translateX(13px); }',
    '@media (max-width: 390px) { .critical-action { display: none; } }',
    '@media (max-width: 390px) { .critical-action { visibility: hidden; } }',
  ]) {
    assert.ok(analyzeSource('unsafe.css', source, breakpoints).length > 0, source);
  }
});

test('allows unrelated border, permanent hiding, and custom object methods', () => {
  assert.deepEqual(analyzeSource('safe.css', '.table { border-collapse: collapse; }', breakpoints), []);
  assert.deepEqual(analyzeSource('safe.css', '@media (max-width: 390px) { .item { display: block; } } .always-hidden { display: none; }', breakpoints), []);
  assert.deepEqual(analyzeSource('safe.ts', "cache.fetch('local')", breakpoints), []);
});
