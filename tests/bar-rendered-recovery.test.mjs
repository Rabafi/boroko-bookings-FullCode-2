// Rendered-component gate: runs the Playwright suite that mounts the REAL
// HposOpenChecks recovery flows and the REAL RestaurantWorkspace per-tab
// gating with mocked IPC and synthetic fixtures. Requires the Playwright
// Chromium bundled in node_modules (present in this workspace). This is a
// real browser verdict, not a mock-renderer or source-text assertion.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('rendered recovery and finance gating behave in a real browser', { timeout: 300000 }, () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const result = spawnSync(process.execPath, [join(root, 'tests', 'browser', 'run-browser-suite.mjs')], {
    cwd: root,
    stdio: 'pipe',
    shell: false,
    timeout: 280000,
    env: { ...process.env }
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.equal(result.error, undefined, `browser runner crashed: ${result.error?.message}\n${output.slice(-3000)}`);
  assert.match(output, /browser suite passed/, `browser suite did not pass:\n${output.slice(-4000)}`);
  assert.doesNotMatch(output, /\nFAIL - /, `browser scenario failed:\n${output.slice(-4000)}`);
});
