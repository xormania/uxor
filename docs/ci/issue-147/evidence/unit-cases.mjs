import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leakDetectorRuns } from '../../tests/e2e/leak-detector.mjs';

function probeBrowser(version, { commandFails = false, rendererFails = false } = {}) {
    const events = [];
    const browser = {
        version: () => version,
        newContext: async () => {
            events.push('context');
            const page = {
                evaluate: async (read) => {
                    events.push('renderer');
                    if (rendererFails) throw new Error('renderer crashed');
                    return read();
                },
            };
            return {
                newPage: async () => page,
                newCDPSession: async (target) => {
                    assert.equal(target, page);
                    return {
                        send: async (method) => {
                            events.push(method);
                            if (commandFails) throw new Error('Failed to run leak detection');
                        },
                    };
                },
                close: async () => { events.push('close'); },
            };
        },
    };
    return { browser, events };
}

test('the known crashing Chromium build uses the fallback without opening a probe', async () => {
    let allocated = false;
    const browser = {
        version: () => '145.0.7632.6',
        newContext: async () => {
            allocated = true;
            throw new Error('the known crashing renderer must not be started');
        },
    };
    assert.equal(await leakDetectorRuns(browser), false);
    assert.equal(allocated, false);
});

test('another build still proves that its detector and renderer work before selecting it', async () => {
    const { browser, events } = probeBrowser('145.0.7632.7');
    assert.equal(await leakDetectorRuns(browser), true);
    assert.deepEqual(events, ['context', 'Memory.prepareForLeakDetection', 'renderer', 'close']);
});

test('an unsupported detector in another build still falls back and closes its context', async () => {
    const { browser, events } = probeBrowser('146.0.0.1', { commandFails: true });
    assert.equal(await leakDetectorRuns(browser), false);
    assert.deepEqual(events, ['context', 'Memory.prepareForLeakDetection', 'close']);
});

test('a detector that loses its renderer is not selected', async () => {
    const { browser, events } = probeBrowser('146.0.0.1', { rendererFails: true });
    assert.equal(await leakDetectorRuns(browser), false);
    assert.deepEqual(events, ['context', 'Memory.prepareForLeakDetection', 'renderer', 'close']);
});
