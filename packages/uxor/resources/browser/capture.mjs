// Bound each section independently so the complete artifact fits the PHP reader’s 1 MiB limit.
const SECTION_BYTE_LIMIT = 256 * 1024;

/** Listen before navigating. Calling the returned function detaches the listeners and returns the artifact. */
export function startBrowserDiagnostics(context, baseURL) {
    const origin = new URL(baseURL).origin;
    const evidence = { version: 1, responses: [], requestFailures: [], pageErrors: [] };
    const capturedBytes = { responses: 0, requestFailures: 0, pageErrors: 0 };
    const dropped = { responses: 0, requestFailures: 0, pageErrors: 0 };
    const requests = new WeakMap();
    let nextRequestId = 1;

    const record = (section, entry) => {
        // Avoid copying a giant message or stack into a new JSON string just to discard it.
        if (Object.values(entry).some((value) => typeof value === 'string' && value.length > SECTION_BYTE_LIMIT)) {
            dropped[section]++;
            return;
        }
        const bytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
        if (capturedBytes[section] + bytes > SECTION_BYTE_LIMIT) {
            dropped[section]++;
            return;
        }
        capturedBytes[section] += bytes;
        evidence[section].push(entry);
    };

    const identify = (request) => {
        const existing = requests.get(request);
        if (existing) return existing;
        const identity = {
            requestId: nextRequestId++,
            method: request.method(),
            url: request.url(),
            turboFrame: request.headers()['turbo-frame'] ?? null,
        };
        requests.set(request, identity);
        return identity;
    };
    const recordResponse = (response) => {
        const token = response.headers()['x-debug-token'];
        if (!token || new URL(response.url()).origin !== origin) return;
        if (token.length > 128 || /[^a-zA-Z0-9_-]/.test(token)) {
            dropped.responses++;
            return;
        }
        record('responses', { ...identify(response.request()), token, status: response.status() });
    };
    const recordRequestFailure = (request) => {
        if (new URL(request.url()).origin === origin) {
            record('requestFailures', { ...identify(request), error: request.failure()?.errorText ?? '' });
        }
    };
    const recordPageError = (webError) => {
        const { name, message, stack } = webError.error();
        record('pageErrors', { name, message, stack: stack ?? null });
    };

    context.on('response', recordResponse);
    context.on('requestfailed', recordRequestFailure);
    context.on('weberror', recordPageError);
    return () => {
        context.off('weberror', recordPageError);
        context.off('requestfailed', recordRequestFailure);
        context.off('response', recordResponse);
        if (Object.values(dropped).some((count) => count > 0)) evidence.dropped = dropped;
        return evidence;
    };
}
