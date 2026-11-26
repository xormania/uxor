import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { startBrowserDiagnostics } from '../../packages/uxor/resources/browser/capture.mjs';

const origin = 'https://app.example';

function request(url, headers = {}, error = 'net::ERR_FAILED') {
    return { url: () => url, headers: () => headers, method: () => 'GET', failure: () => ({ errorText: error }) };
}

function respond(context, target, status, token) {
    context.emit('response', {
        url: target.url,
        request: () => target,
        status: () => status,
        headers: () => token ? { 'x-debug-token': token } : {},
    });
}

test('standalone capture counts HTTP failures discarded by the artifact size limit', () => {
    const context = new EventEmitter();
    const finish = startBrowserDiagnostics(context, origin, { standalone: true });
    for (let i = 0; i < 20; ++i) {
        respond(context, request(origin + '/' + i + '/' + 'a'.repeat(32000)), 404);
    }
    const evidence = finish();
    assert.ok(evidence.requestFailures.length > 0);
    assert.ok(evidence.dropped?.requestFailures > 0);
    assert.equal(evidence.requestFailures.length + evidence.dropped.requestFailures, 20);
    assert.ok(Buffer.byteLength(JSON.stringify(evidence)) < 1024 * 1024);
    for (const row of evidence.requestFailures) assert.equal(row.error, 'HTTP 404');
});

test('standalone capture keeps external failure attribution out of private request data', () => {
    const context = new EventEmitter();
    const finish = startBrowserDiagnostics(context, origin, { standalone: true });
    const foreign = 'https://cdn.example';
    const privateText = 'private-canary';
    const target = request(foreign + '/' + privateText + '?key=' + privateText,
        { 'turbo-frame': privateText }, 'failure detail ' + privateText);
    respond(context, target, 500, privateText);
    // A failed HTTP response can lose its body later. Both events belong to one request.
    context.emit('requestfailed', target);
    context.emit('requestfailed', request(foreign + '/another-' + privateText, {}, privateText));
    respond(context, request(foreign + '/successful-' + privateText), 200, privateText);
    const evidence = finish();
    assert.equal(evidence.requestFailures.length, 2);
    assert.deepEqual(evidence.responses, []);
    assert.ok(!JSON.stringify(evidence).includes(privateText));
    for (const row of evidence.requestFailures) {
        assert.equal(row.url.replace(/\/$/, ''), foreign);
        assert.equal(row.turboFrame, null);
    }
    assert.notEqual(evidence.requestFailures[0].requestId, evidence.requestFailures[1].requestId);
});

test('the existing Playwright fixture keeps its same-origin transport semantics', () => {
    const context = new EventEmitter();
    const finish = startBrowserDiagnostics(context, origin);
    respond(context, request(origin + '/expected'), 422, 'abc123');
    context.emit('requestfailed', request('https://cdn.example/third-party'));
    const evidence = finish();
    assert.deepEqual(evidence.requestFailures, []);
    assert.equal(evidence.responses[0].token, 'abc123');
});
