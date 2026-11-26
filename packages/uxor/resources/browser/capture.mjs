// Bound each section independently so the complete artifact fits the PHP reader’s 1 MiB limit.
const SECTION_BYTE_LIMIT = 256 * 1024;

/** A standalone visit identifies the application path and third-party origins without exposing URL parameters. */
export function diagnosticUrl(address, origin) {
    const url = new URL(address);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '[non-HTTP resource]';
    return url.origin === origin ? url.origin + url.pathname : url.origin;
}

/** Listen before navigating. Calling the returned function detaches the listeners and returns the artifact. */
export function startBrowserDiagnostics(context, baseURL, { standalone = false } = {}) {
    const origin = new URL(baseURL).origin;
    const evidence = { version: 1, responses: [], requestFailures: [], pageErrors: [] };
    const capturedBytes = { responses: 0, requestFailures: 0, pageErrors: 0 };
    const dropped = { responses: 0, requestFailures: 0, pageErrors: 0 };
    const requests = new WeakMap();
    const httpFailures = new WeakSet();
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
        const address = request.url();
        const local = new URL(address).origin === origin;
        const method = request.method();
        const identity = {
            requestId: nextRequestId++,
            method: standalone && !/^(GET|HEAD|POST|PUT|DELETE|CONNECT|OPTIONS|TRACE|PATCH)$/.test(method) ? 'OTHER' : method,
            url: standalone ? diagnosticUrl(address, origin) : address,
            turboFrame: local ? request.headers()['turbo-frame'] ?? null : null,
        };
        requests.set(request, identity);
        return identity;
    };
    const recordResponse = (response) => {
        const status = response.status();
        if (standalone && status >= 400) {
            const request = response.request();
            httpFailures.add(request);
            record('requestFailures', { ...identify(request), error: `HTTP ${status}` });
        }
        if (new URL(response.url()).origin !== origin) return;
        const token = response.headers()['x-debug-token'];
        if (!token) return;
        if (token.length > 128 || /[^a-zA-Z0-9_-]/.test(token)) {
            dropped.responses++;
            return;
        }
        record('responses', { ...identify(response.request()), token, status });
    };
    const recordRequestFailure = (request) => {
        // A response with an HTTP error can also abort while transferring its body.
        if (httpFailures.has(request) || (!standalone && new URL(request.url()).origin !== origin)) return;
        const reason = request.failure()?.errorText ?? '';
        const error = standalone && !/^net::ERR_[A-Z0-9_]{1,64}$/.test(reason) ? 'Transport failure' : reason;
        record('requestFailures', { ...identify(request), error });
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
