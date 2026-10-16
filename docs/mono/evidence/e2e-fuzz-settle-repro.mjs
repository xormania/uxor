import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const path = '/workspace/uxor/tests/e2e/release.fuzz.spec.ts';
const source = readFileSync(path, 'utf8');
const start = source.indexOf('const settle = async () => {');
const finish = source.indexOf('\n        };', start);
assert.ok(start >= 0 && finish > start, 'Locate the actual source helper');
const expression = source.slice(start + 'const settle = '.length, finish + '\n        }'.length);
const calls = [];
const page = {
  waitForTimeout: async () => {},
  waitForFunction: async () => {
    calls.push('busy-check rejected: turbo-frame permanently busy');
    throw new Error('Timeout 5000ms: turbo-frame[busy] remains');
  },
  evaluate: async () => { calls.push('animation frame resolved'); },
};
await new Function('page', 'inFlight', `return (${expression})();`)(page, new Set());
assert.ok(calls.some(c => c.startsWith('busy-check rejected')));
console.log(JSON.stringify({ verdict: 'settle resolved despite busy-check timeout', evidence: 'original helper extracted and executed with mocked Playwright page, no browser run', calls }, null, 2));
