// Portable replay of the bounded observer proof; the retained JSON records the original run.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const output = process.argv[2];
if (!output) throw new Error('Usage: node docs/ci/issue-134/evidence/flake/late-frame-observer-repro.mjs <output.json>');
const require = createRequire(join(root, 'package.json'));
const { chromium, expect } = require('@playwright/test');
const filename = join(root, 'tests/e2e/lab.data-table-back.spec.ts');
const source = readFileSync(filename, 'utf8');
const start = source.indexOf('async function recordFirstFrameValues(');
const end = source.indexOf('\n}\n', start) + 2;
const helper = source.slice(start, end)
 .replace('page: Page): Promise<() => Promise<State[]>>', 'page)')
 .replace('const records: State[]', 'const records')
 .replaceAll('(window as any)', 'window')
 .replace('(event: any)', '(event)')
 .replace('(selector: string)', '(selector)')
 .replace('(document.querySelector(selector) as HTMLInputElement | HTMLSelectElement)', 'document.querySelector(selector)')
 .replace(' as State[]', '');
const recordFirstFrameValues = new Function(`${helper}; return recordFirstFrameValues;`)();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium', timeout: 20000, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.setDefaultTimeout(5000);
const defaults = { search: '', status: '', size: '10' };
const markup = '<input id="orders-search" value=""><select id="orders-filter-status"><option value="" selected>All</option></select><select id="orders-size"><option selected value="10">10</option></select>';
try {
 await page.setContent(markup);
 const frames = await recordFirstFrameValues(page);
 // Queue frames explicitly to demonstrate the missing observation barrier deterministically.
 // This is not a reproduction of the actual CI browser scheduler or full Turbo application.
 await page.evaluate(() => {
  window.__queuedFrames = [];
  window.requestAnimationFrame = callback => (window.__queuedFrames.push(callback), window.__queuedFrames.length);
 });
 await page.evaluate(markup => {
  const body = document.createElement('body');
  body.innerHTML = markup;
  document.dispatchEvent(new CustomEvent('turbo:before-render', { detail: { newBody: body } }));
  document.body.replaceWith(body);
  document.dispatchEvent(new CustomEvent('turbo:load'));
 }, markup);
 const controls = await page.evaluate(() => ({ search: document.querySelector('#orders-search').value, status: document.querySelector('#orders-filter-status').value, size: document.querySelector('#orders-size').value }));
 expect(controls).toEqual(defaults);
 const before = await frames();
 let assertionFailedBeforeFrame = false;
 try { expect(before).toEqual([defaults]); } catch { assertionFailedBeforeFrame = true; }
 await page.evaluate(() => { const queue = window.__queuedFrames.splice(0); for (const callback of queue) callback(0); });
 const after = await frames();
 expect(after).toEqual([defaults]);
 if (!assertionFailedBeforeFrame) throw new Error('Expected the original immediate assertion to fail before the scheduled frame ran');
 const result = { evidence: 'isolated observer ordering with explicitly queued animation frames; not CI/WebKit/full-app reproduction', sourceFile: filename, sourceSha256: createHash('sha256').update(source).digest('hex'), browser: await browser.version(), originalAssertionFailedBeforeFrame: assertionFailedBeforeFrame, beforeFrame: before, afterFrame: after, controlsAlreadyShowDefaults: JSON.stringify(controls) === JSON.stringify(defaults), controls };
 writeFileSync(resolve(output), `${JSON.stringify(result,null,2)}\n`);
 process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
} finally { await browser.close(); }
