#!/usr/bin/env node
/*
 * Advisory diagnosis of a browser shard's failed test attempts with Jev (TypeSafe), one assessment per failed attempt,
 * retry-recovered ones included. It reads failed-attempts.json (tools/ci/playwright-summary.mjs), and for each
 * attempt asks two Choice questions over the same bounded evidence: `failure_kind` (a category of the policy's
 * rubric) and `causal_excerpt` (one of the supplied excerpts of the attempt's error and of the server log around the
 * attempt, or none). The answer is a hypothesis: it never changes a test result, and this script always exits 0.
 *
 * The protocol, validation, limits and credential filter follow Agentscient's CI diagnosis (.github/ci_jev.py,
 * devtools/jev.py, devtools/telemetry.py). Its policy, tools/ci/jev-ci.json, holds the enablement, model pin, endpoint,
 * transport limits, rubric, excerpt question, presentation threshold and evidence limits; `error_pattern` is a
 * JavaScript regular expression, matched case-insensitively against each line.
 *
 * Writes, under --output: attempts/<NN>-<test>/assessment.json for every failed attempt (assessed, unavailable,
 * disabled, or not assessed past the per-shard cap or the time budget) and summary.md, which is also added to
 * $GITHUB_STEP_SUMMARY; a ::warning annotation per assessed attempt, at the line that failed.
 *
 * Usage: node tools/ci/jev-diagnosis.mjs --attempts playwright-results/failed-attempts.json --output <dir>
 *            [--server-log <file>] [--config tools/ci/jev-ci.json] [--job <name>]
 * Environment: the key named by the policy (TYPESAFE_API_KEY); SHARD, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_RUN_ID,
 * GITHUB_RUN_ATTEMPT, GITHUB_STEP_SUMMARY (all optional).
 * Test: node --test tools/tests/*.test.mjs
 */
import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, constants, fstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOTE = 'Advisory hypothesis from bounded evidence; the test result is unchanged.';
const DEFAULT_POLICY = fileURLToPath(new URL('jev-ci.json', import.meta.url));
const FALLBACK_CAP = 10; // when the policy cannot be read
const MAX_ATTEMPTS_FILE = 32 * 1024 * 1024;
const MIN_SECONDS_LEFT = 0.1;
const env = process.env;

class Unavailable extends Error {
    constructor(reason, details) {
        super(reason);
        this.reason = reason;
        this.details = details;
    }
}

const invalid = (validation) => new Unavailable('invalid_response', { validation });

// --- the credential filter (devtools/telemetry.py clean) ---------------------------------------------------------

const SENSITIVE = /api.?key|authorization|password|credential|private.?key|access.?token|refresh.?token|(^|_)token($|_)|^tokens?$/i;

export function clean(value, secrets = []) {
    const known = [...new Set([
        ...Object.entries(env).filter(([name, v]) => SENSITIVE.test(name) && typeof v === 'string' && v.length >= 8).map(([, v]) => v),
        ...secrets.filter((secret) => typeof secret === 'string' && secret),
    ])].sort((a, b) => b.length - a.length);
    const redact = (text) => known.reduce((result, secret) => result.split(secret).join('[REDACTED]'), text);
    const scrub = (item) => {
        if (Array.isArray(item)) return item.map(scrub);
        if (item && typeof item === 'object') {
            return Object.fromEntries(Object.entries(item).map(([key, v]) => [redact(key), SENSITIVE.test(key) ? '[REDACTED]' : scrub(v)]));
        }
        if (typeof item === 'string') {
            let decoded = null;
            try {
                decoded = JSON.parse(item);
            } catch {
                // not JSON
            }
            if (decoded && typeof decoded === 'object') {
                item = JSON.stringify(scrub(decoded));
            }
            return redact(item).replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
        }
        return item;
    };
    return scrub(value);
}

/** A log line whose payload is JSON (FrankenPHP, Monolog): its sensitive fields are filtered too. */
function cleanLine(line, secrets) {
    const json = /^(.*?)(\{.*\})\s*$/.exec(line);
    if (json) {
        try {
            const decoded = JSON.parse(json[2]);
            if (decoded && typeof decoded === 'object') {
                return clean(json[1] + JSON.stringify(clean(decoded, secrets)), secrets);
            }
        } catch {
            // not JSON
        }
    }
    return clean(line, secrets);
}

// --- the policy (.github/jev-ci.json + devtools/configuration.cue bounds) ------------------------------------------

const number = (value, low = 0, high = 1) => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export function checkPolicy(value) {
    const fail = (why) => { throw new Error(`invalid policy: ${why}`); };
    if (!keysAre(value, ['version', 'enabled', 'model', 'connection', 'transport', 'min_confidence', 'limits', 'error_pattern', 'failure_question', 'excerpt_instructions'])
        || value.version !== 1) fail('unsupported version or keys');
    if (typeof value.enabled !== 'boolean' || !number(value.min_confidence)) fail('enabled or min_confidence');
    if (typeof value.model !== 'string' || !/^jev-[0-9]+\.[0-9]+\.[0-9]+$/.test(value.model)) fail('the model must be a pinned Jev version');

    const connection = value.connection;
    if (!keysAre(connection, ['adapter', 'endpoint', 'credential']) || connection.adapter !== 'typesafe') fail('connection');
    let url;
    try {
        url = new URL(connection.endpoint);
    } catch {
        fail('endpoint');
    }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) || !url.hostname || url.username || url.password
        || url.search || url.hash || /\s/.test(connection.endpoint)) fail('the endpoint must be an HTTPS URL without credentials, query or fragment');
    if (!keysAre(connection.credential, ['env']) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(connection.credential.env)) fail('credential reference');

    const transport = value.transport;
    const transportBounds = { timeout: [0.1, 60], max_attempts: [1, 3, true], retry_delay: [0, 5], max_retry_delay: [0, 5],
        max_request_bytes: [1000, 48000, true], max_response_bytes: [1000, 131072, true] };
    if (!keysAre(transport, [...Object.keys(transportBounds), 'retry_statuses'])) fail('transport keys');
    for (const [name, [low, high, whole]] of Object.entries(transportBounds)) {
        if (!(whole ? integer(transport[name], low, high) : number(transport[name], low, high))) fail(`transport.${name}`);
    }
    if (!Array.isArray(transport.retry_statuses) || !transport.retry_statuses.every((status) => integer(status, 400, 599))) fail('retry_statuses');

    const limits = value.limits;
    const limitBounds = { attempts: [1, 25], total_seconds: [1, 110], error_bytes: [100, 1048576], server_log_bytes: [1000, 8388608],
        server_window_seconds: [0, 300], candidates: [1, 16], error_candidates: [1, 16], excerpt_lines: [1, 100], before_lines: [0, 99],
        excerpt_bytes: [100, 8000] };
    if (!keysAre(limits, Object.keys(limitBounds))) fail('limits keys');
    for (const [name, [low, high]] of Object.entries(limitBounds)) {
        if (!integer(limits[name], low, high)) fail(`limits.${name}`);
    }
    if (limits.before_lines >= limits.excerpt_lines) fail('context before the match must fit in the excerpt');
    if (limits.error_candidates > limits.candidates) fail('error_candidates exceeds candidates');

    if (typeof value.error_pattern !== 'string' || !value.error_pattern) fail('error_pattern');
    new RegExp(value.error_pattern, 'i');

    const question = value.failure_question;
    if (!keysAre(question, ['type', 'instructions', 'criteria']) || question.type !== 'choice' || !isObject(question.criteria)) fail('failure_question');
    const criteria = Object.entries(question.criteria);
    if (criteria.length < 2 || criteria.length > 16 || !Object.hasOwn(question.criteria, 'unknown')
        || criteria.some(([key, text]) => !/^[a-z][a-z0-9_]{0,63}$/.test(key) || typeof text !== 'string' || !text)) {
        fail('failure classification needs Choice criteria including unknown');
    }
    for (const text of [question.instructions, value.excerpt_instructions]) {
        if (typeof text !== 'string' || text.length < 1 || text.length > 2000) fail('questions need bounded instructions');
    }
    return value;
}

// --- evidence --------------------------------------------------------------------------------------------------------

function clipped(text, limit) {
    const data = Buffer.from(text, 'utf8');
    if (data.length <= limit) return [text, false];
    return [data.subarray(0, limit).toString('utf8').replace(/�$/, ''), true];
}

const bytes = (text) => Buffer.byteLength(text, 'utf8');

/** Complete lines from both ends of a file within one byte budget, with their line numbers (ci_jev.py log_regions). */
function logRegions(path, limit, secrets) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const info = fstatSync(fd);
        if (!info.isFile()) throw new Error('not a regular file');
        const read = (length, position) => {
            const buffer = Buffer.alloc(length);
            const got = readSync(fd, buffer, 0, length, position);
            return buffer.subarray(0, got);
        };
        let regions;
        const partial = info.size > limit;
        if (!partial) {
            regions = [[1, read(info.size, 0)]];
        } else {
            let head = read(Math.floor(limit / 2), 0);
            const tailBytes = limit - head.length;
            let position = head.length;
            let remaining = info.size - tailBytes - head.length;
            let newlines = count(head);
            let previous = head.subarray(-1);
            // Count the omitted middle in bounded chunks, so tail lines keep their numbers
            while (remaining > 0) {
                const block = read(Math.min(limit, remaining), position);
                if (!block.length) throw new Error('log changed during collection');
                remaining -= block.length;
                position += block.length;
                newlines += count(block);
                previous = block.subarray(-1);
            }
            let tail = read(tailBytes, position);
            if (previous.toString() !== '\n') {
                const at = tail.indexOf(10);
                tail = at < 0 ? Buffer.alloc(0) : tail.subarray(at + 1);
                newlines += at < 0 ? 0 : 1;
            }
            // Never filter or publish a cut line: it may hold half a credential
            head = head.subarray(0, head.lastIndexOf(10) + 1);
            regions = [[1, head], [newlines + 1, tail]];
        }
        return {
            partial,
            regions: regions.filter(([, data]) => data.length).map(([first, data]) => {
                let text = data.toString('utf8');
                if (text.endsWith('\n')) text = text.slice(0, -1);
                return [first, text.split('\n').map((line) => cleanLine(line.replace(/\r$/, ''), secrets))];
            }),
        };
    } finally {
        closeSync(fd);
    }
}

function count(buffer) {
    let n = 0;
    for (const byte of buffer) if (byte === 10) n++;
    return n;
}

const TIMESTAMP = /^(?:[^|]*\|\s*)?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})\s/;

/** Each server log line with its time (`docker compose logs --timestamps`); an untimed line takes the previous one's. */
function readServerLog(path, limits, secrets) {
    if (!path) return { selection: 'none', reason: 'not_supplied' };
    let log;
    try {
        log = logRegions(path, limits.server_log_bytes, secrets);
    } catch (error) {
        return { selection: 'none', reason: error.code === 'ENOENT' ? 'not_supplied' : 'unreadable' };
    }
    let timed = 0;
    const regions = log.regions.map(([first, lines]) => {
        let time = null;
        return [first, lines.map((text) => {
            const match = TIMESTAMP.exec(text);
            if (match) {
                const parsed = Date.parse(`${match[1]}${(match[2] ?? '').slice(0, 4)}${match[3]}`);
                if (!Number.isNaN(parsed)) {
                    time = parsed;
                    timed++;
                }
            }
            return { text, time };
        })];
    });
    return { selection: 'attempt_window', partial: log.partial, regions, timed };
}

/** The server log lines inside the attempt's time span (plus the policy's margin), in runs of consecutive lines. */
function serverWindow(server, attempt, limits) {
    if (server.selection !== 'attempt_window') return { info: { selection: server.selection, reason: server.reason }, regions: [] };
    const start = Date.parse(attempt.startTime ?? '');
    if (Number.isNaN(start)) return { info: { selection: 'none', reason: 'no_attempt_time' }, regions: [] };
    if (!server.timed) return { info: { selection: 'none', reason: 'no_timestamps' }, regions: [] };
    const from = start - limits.server_window_seconds * 1000;
    const to = start + (attempt.durationMs ?? 0) + limits.server_window_seconds * 1000;
    const regions = [];
    for (const [first, lines] of server.regions) {
        let run = null;
        lines.forEach(({ text, time }, index) => {
            if (time !== null && time >= from && time <= to) {
                if (!run) {
                    run = [first + index, []];
                    regions.push(run);
                }
                run[1].push(text);
            } else {
                run = null;
            }
        });
    }
    return {
        info: { selection: 'attempt_window', window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() }, partial: server.partial,
            read_lines: regions.reduce((sum, [, lines]) => sum + lines.length, 0) },
        regions,
    };
}

/** The attempt's error, complete lines within the budget, numbered from 1. */
function errorRegion(text, limits, secrets) {
    let [kept, cut] = clipped(String(text ?? ''), limits.error_bytes);
    if (cut) kept = kept.slice(0, kept.lastIndexOf('\n') + 1);
    const lines = kept.replace(/\n$/, '').split('\n').map((line) => cleanLine(line, secrets));
    const regions = kept.trim() ? [[1, lines]] : [];
    return { info: { partial: cut, read_lines: regions.length ? lines.length : 0 }, regions };
}

/** One excerpt around a line, keeping the matched line within the byte budget (ci_jev.py log_excerpt). */
function excerptAt(firstLine, lines, anchor, limits, matchAt) {
    const before = matchAt !== null ? limits.before_lines : limits.excerpt_lines - 1;
    const preferred = Math.max(0, anchor - before);
    let start = preferred;
    const end = Math.min(lines.length, start + limits.excerpt_lines);
    const budget = limits.excerpt_bytes;
    while (start < anchor && bytes(lines.slice(start, anchor + 1).join('\n')) > budget) start++;
    if (bytes(lines[anchor]) > budget) {
        const [text] = clipped(lines[anchor].slice(matchAt ?? 0), budget);
        return [{ line_start: firstLine + anchor, line_end: firstLine + anchor, text, partial: true }, anchor];
    }
    const [text, cut] = clipped(lines.slice(start, end).join('\n'), budget);
    const last = start + (text.match(/\n/g)?.length ?? 0);
    const coveredUntil = last + (text.split('\n').at(-1) === lines[last] ? 1 : 0);
    return [{ line_start: firstLine + start, line_end: firstLine + last, text, partial: cut || start !== preferred }, coveredUntil];
}

/** Excerpts at the lines matching the error pattern (or a region's end when none does); early and late kept. */
function excerpts(regions, pattern, limits, cap) {
    const found = [];
    for (const [first, lines] of regions) {
        let coveredUntil = 0;
        let matched = false;
        lines.forEach((line, index) => {
            const match = pattern.exec(line);
            if (!match) return;
            matched = true;
            if (index >= coveredUntil) {
                const [excerpt, covered] = excerptAt(first, lines, index, limits, match.index);
                found.push(excerpt);
                coveredUntil = covered;
            }
        });
        if (lines.length && !matched) found.push(excerptAt(first, lines, lines.length - 1, limits, null)[0]);
    }
    if (found.length <= cap) return { kept: found, omitted: 0 };
    const early = Math.ceil(cap / 2);
    return { kept: [...found.slice(0, early), ...(cap > early ? found.slice(-(cap - early)) : [])], omitted: found.length - cap };
}

function collect(attempt, server, policy, job, secrets) {
    const { limits } = policy;
    const pattern = new RegExp(policy.error_pattern, 'i');
    const error = errorRegion(attempt.error, limits, secrets);
    const window = serverWindow(server, attempt, limits);
    const fromError = excerpts(error.regions, pattern, limits, limits.error_candidates);
    const fromServer = excerpts(window.regions, pattern, limits, limits.candidates - fromError.kept.length);
    const candidates = [
        ...fromError.kept.map((excerpt) => ({ source: 'test_error', ...excerpt })),
        ...fromServer.kept.map((excerpt) => ({ source: 'server_log', ...excerpt })),
    ].map((candidate, index) => ({ id: `excerpt_${index}`, ...candidate }));
    return clean({
        job,
        test: {
            id: attempt.testId ?? null,
            project: attempt.project ?? null,
            file: attempt.file ?? null,
            line: attempt.line ?? null,
            title: attempt.title ?? null,
            retry: attempt.retry ?? 0,
            status: attempt.status ?? null,
            outcome: attempt.outcome ?? null,
            duration_ms: attempt.durationMs ?? null,
            error_location: attempt.errorLocation ?? null,
        },
        sources: {
            test_error: { ...error.info, omitted_candidates: fromError.omitted },
            server_log: { ...window.info, omitted_candidates: fromServer.omitted },
        },
        candidates,
    }, secrets);
}

const SOURCE = { test_error: 'test error', server_log: 'server log' };

function questionsFor(state, policy) {
    const choices = Object.fromEntries(state.candidates.map((c) => [c.id, `Supplied ${SOURCE[c.source]} lines ${c.line_start}-${c.line_end}`]));
    choices.none = 'No supplied excerpt usefully identifies the cause of this failed attempt.';
    return { failure_kind: policy.failure_question, causal_excerpt: { type: 'choice', instructions: policy.excerpt_instructions, criteria: choices } };
}

/** The request within the transport budget: server log excerpts dropped first, then error excerpts, each recorded. */
function requestFor(state, policy) {
    for (;;) {
        const request = { model: policy.model, state, questions: questionsFor(state, policy) };
        if (bytes(JSON.stringify(request)) <= policy.transport.max_request_bytes) return request;
        const last = state.candidates.at(-1);
        if (last?.source === 'server_log' || (last && state.candidates.length > 1)) {
            state.candidates.pop();
            state.sources[last.source].omitted_candidates++;
        } else {
            throw new Unavailable('request_budget_exceeded', { max_request_bytes: policy.transport.max_request_bytes });
        }
    }
}

// --- the provider (devtools/jev.py TypeSafeAdapter and checked_response) -------------------------------------------

export function checkedResponse(value, questions, model) {
    if (!isObject(value) || value.model !== model) throw invalid('model_mismatch');
    const answers = value.answers;
    if (!keysAre(answers, Object.keys(questions))) throw invalid('incomplete_evaluation');
    const checked = {};
    for (const [name, question] of Object.entries(questions)) {
        const answer = answers[name];
        if (!isObject(answer) || answer.type !== question.type) throw invalid('answer_type');
        const options = Object.keys(question.criteria);
        const probabilities = answer.probabilities;
        if (!keysAre(probabilities, options) || !Object.values(probabilities).every((p) => number(p))
            || Math.abs(Object.values(probabilities).reduce((sum, p) => sum + p, 0) - 1) > 0.01 || !number(answer.confidence)) {
            throw invalid('probability_distribution');
        }
        if (typeof answer.choice !== 'string' || !options.includes(answer.choice)) throw invalid('choice');
        checked[name] = { type: question.type, choice: answer.choice, probabilities, confidence: answer.confidence };
    }
    const usage = value.usage;
    if (!isObject(usage) || ['input_tokens', 'output_tokens'].some((key) => !Number.isInteger(usage[key]) || usage[key] < 0)) throw invalid('usage');
    return { model, answers: checked, usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens } };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readBounded(response, limit) {
    const chunks = [];
    let size = 0;
    if (response.body) {
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > limit) throw invalid('response_budget_exceeded');
            chunks.push(chunk);
        }
    }
    return Buffer.concat(chunks).toString('utf8');
}

async function evaluate(request, policy, key, deadline) {
    const { transport, connection } = policy;
    const payload = JSON.stringify(request);
    if (bytes(payload) > transport.max_request_bytes) throw new Unavailable('request_budget_exceeded');
    for (let attempt = 0; attempt < transport.max_attempts; attempt++) {
        const left = deadline - Date.now();
        if (left < MIN_SECONDS_LEFT * 1000) throw new Unavailable('deadline');
        let response;
        let body;
        try {
            response = await fetch(connection.endpoint, {
                method: 'POST',
                redirect: 'manual',
                headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'uxor-ci' },
                body: payload,
                signal: AbortSignal.timeout(Math.min(transport.timeout * 1000, left)),
            });
            if (response.status >= 200 && response.status < 300) {
                body = await readBounded(response, transport.max_response_bytes);
            } else {
                await response.body?.cancel().catch(() => {});
            }
        } catch (error) {
            if (error instanceof Unavailable) throw error;
            // A network error or a timeout: not retried, like the reference
            throw new Unavailable('transport_unavailable');
        }
        if (body !== undefined) {
            let value;
            try {
                value = JSON.parse(body);
            } catch {
                throw invalid('invalid_json');
            }
            return checkedResponse(value, request.questions, request.model);
        }
        const status = response.status;
        const fallback = transport.retry_delay * 2 ** attempt;
        const header = response.headers.get('retry-after');
        const retry = header ?? String(fallback);
        const delay = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?\s*$/.test(retry) ? Number(retry) : Infinity;
        const wait = Math.min(transport.max_retry_delay, Math.max(fallback, delay)) * 1000;
        if (attempt + 1 < transport.max_attempts && transport.retry_statuses.includes(status) && number(delay, 0, transport.max_retry_delay)
            && Date.now() + wait < deadline) {
            await sleep(wait);
            continue;
        }
        throw new Unavailable('provider_http_error', { status, retryable: transport.retry_statuses.includes(status) });
    }
    throw new Unavailable('provider_http_error');
}

// --- one attempt ---------------------------------------------------------------------------------------------------

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

function identity(attempt) {
    const pick = ['testId', 'project', 'file', 'line', 'title', 'shard', 'retry', 'status', 'outcome', 'durationMs', 'startTime', 'errorLocation'];
    return Object.fromEntries(pick.map((key) => [key, attempt[key] ?? null]));
}

async function assess(attempt, context, deadline) {
    const started = Date.now();
    const { policy, policyError, server, job } = context;
    let secrets = [];
    const result = { version: 1, status: 'unavailable', note: NOTE, job, attempt: identity(attempt), context: context.run };
    try {
        if (policyError) {
            result.reason = 'invalid_policy';
            return result;
        }
        result.policy = policy;
        if (!policy.enabled) {
            result.status = 'disabled';
            result.reason = 'disabled_by_configuration';
            return result;
        }
        const key = env[policy.connection.credential.env] ?? '';
        if (!key) {
            result.reason = 'missing_credential';
            return result;
        }
        if (key.length > 4096 || [...key].some((char) => char.charCodeAt(0) < 33 || char.charCodeAt(0) > 126)) {
            result.reason = 'invalid_credential';
            return result;
        }
        secrets = [key];
        const state = collect(attempt, server, policy, job, secrets);
        if (!state.candidates.length) {
            result.reason = 'no_evidence';
            return result;
        }
        const request = requestFor(state, policy);
        result.request = request;
        result.input_sha256 = createHash('sha256').update(canonical({ request, policy })).digest('hex');
        const response = await evaluate(request, policy, key, deadline);
        const { failure_kind: kind, causal_excerpt: excerpt } = response.answers;
        Object.assign(result, {
            status: 'assessed',
            response,
            likely_cause: kind.confidence >= policy.min_confidence ? kind.choice : 'unknown',
            selected_excerpt: excerpt.confidence >= policy.min_confidence ? state.candidates.find((c) => c.id === excerpt.choice) ?? null : null,
        });
    } catch (error) {
        // Never a provider's or a log's exception text: a reason, and the validation or status that led to it
        result.reason = error instanceof Unavailable ? error.reason : 'assessment_unavailable';
        if (error instanceof Unavailable && error.details) result.details = error.details;
        if (!(error instanceof Unavailable)) result.error_type = error?.name ?? 'Error';
    } finally {
        result.elapsed_seconds = Math.round(Date.now() - started) / 1000;
        // Every path, early returns included, leaves through the credential filter
        const sanitized = clean(result, secrets);
        for (const key of Object.keys(result)) delete result[key];
        Object.assign(result, sanitized);
    }
    return result;
}

// --- output --------------------------------------------------------------------------------------------------------

const html = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// GitHub's workflow command escaping: https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts
const message = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const property = (text) => message(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
const confidence = (value) => value.toFixed(2);

function where(excerpt) {
    return `${SOURCE[excerpt.source]} lines ${excerpt.line_start}-${excerpt.line_end}`;
}

function entry(result, cap) {
    const a = result.attempt;
    const head = `- **[${html(a.project)}] ${html(a.file)}:${a.line} › ${html(a.title)}**, attempt ${a.retry + 1} (retry ${a.retry}, ${a.outcome})`;
    if (result.status === 'assessed') {
        const answers = result.response.answers;
        const lines = [`${head}: likely cause **${result.likely_cause}** (classifier confidence ${confidence(answers.failure_kind.confidence)})`];
        if (result.selected_excerpt) {
            lines[0] += `; selected ${where(result.selected_excerpt)} (excerpt confidence ${confidence(answers.causal_excerpt.confidence)}):`;
            // One line of HTML: a blank line inside the excerpt would end GitHub's HTML block
            lines.push('', `  <pre>${html(result.selected_excerpt.text).replace(/\r?\n/g, '&#10;')}</pre>`);
        } else {
            lines[0] += '; no excerpt selected with sufficient confidence';
        }
        return lines.join('\n');
    }
    if (result.status === 'not_assessed') {
        return `${head}: not assessed: ${result.reason}${result.reason === 'cap' ? ` (${cap} per shard)` : ' (time budget spent)'}`;
    }
    if (result.status === 'disabled') return `${head}: disabled by the policy`;
    const detail = result.details?.validation ?? result.details?.status ?? result.error_type;
    return `${head}: unavailable (${result.reason}${detail !== undefined ? `: ${detail}` : ''})`;
}

function annotate(result) {
    const a = result.attempt;
    const at = a.errorLocation ?? { file: a.file, line: a.line, column: null };
    const answers = result.response.answers;
    let text = `${NOTE}\nLikely cause: ${result.likely_cause} (classifier confidence ${confidence(answers.failure_kind.confidence)}).`;
    text += result.selected_excerpt
        ? `\nSelected ${where(result.selected_excerpt)} (excerpt confidence ${confidence(answers.causal_excerpt.confidence)}):\n${result.selected_excerpt.text}`
        : '\nNo excerpt selected with sufficient confidence.';
    const props = [`file=${property(at.file ?? '')}`, `line=${at.line ?? 1}`, ...(at.column ? [`col=${at.column}`] : []),
        `title=${property(`Jev diagnosis: [${a.project}] ${a.title} (retry ${a.retry})`)}`];
    console.log(`::warning ${props.join(',')}::${message(text)}`);
}

function slug(attempt) {
    const name = `${attempt.project ?? ''}-${String(attempt.file ?? '').split('/').at(-1).replace(/\.spec\.ts$/, '')}-retry${attempt.retry ?? 0}`;
    return name.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').slice(0, 80);
}

// --- main ----------------------------------------------------------------------------------------------------------

function options(argv) {
    const values = { attempts: 'playwright-results/failed-attempts.json', config: DEFAULT_POLICY };
    for (let i = 0; i < argv.length; i++) {
        const name = argv[i].replace(/^--/, '');
        values[name === 'server-log' ? 'serverLog' : name] = argv[++i];
    }
    return values;
}

function readJson(path, limit) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
        const info = fstatSync(fd);
        if (!info.isFile() || info.size > limit) throw new Error('not a bounded regular file');
        const buffer = Buffer.alloc(info.size);
        readSync(fd, buffer, 0, info.size, 0);
        return JSON.parse(buffer.toString('utf8'));
    } finally {
        closeSync(fd);
    }
}

async function main() {
    const started = Date.now();
    const args = options(process.argv.slice(2));
    const shard = env.SHARD ?? null;
    const job = args.job ?? `Demo + Playwright${shard ? ` (${shard})` : ''}`;
    const output = args.output ?? 'jev';
    const run = Object.fromEntries(['GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'].map((key) => [key, env[key] ?? '']));

    let policy = null;
    let policyError = null;
    try {
        policy = checkPolicy(readJson(args.config, 1024 * 1024));
    } catch (error) {
        policyError = error;
    }

    let attempts = [];
    let nothing = null;
    try {
        const report = readJson(args.attempts, MAX_ATTEMPTS_FILE);
        if (report?.schema !== 1 || report.status !== 'valid' || !Array.isArray(report.attempts)) {
            nothing = `no valid failed-attempts.json (status: ${report?.status ?? 'unknown'})`;
        } else {
            run.shard = report.shard ?? shard;
            attempts = report.attempts.filter(isObject);
            if (!attempts.length) nothing = 'no failed attempt';
        }
    } catch (error) {
        nothing = `failed-attempts.json not read (${error.code ?? error.name})`;
    }

    // First attempts of every test before their retries, so the cap covers as many tests as it can
    const ordered = attempts.map((attempt, index) => ({ attempt, index }))
        .sort((a, b) => (a.attempt.retry ?? 0) - (b.attempt.retry ?? 0) || a.index - b.index).map(({ attempt }) => attempt);
    const cap = policy?.limits.attempts ?? FALLBACK_CAP;
    const deadline = started + (policy?.limits.total_seconds ?? 90) * 1000;
    const server = policy && policy.enabled ? readServerLog(args.serverLog, policy.limits, []) : { selection: 'none', reason: 'not_read' };
    const context = { policy, policyError, server, job, run };

    const heading = `### Jev diagnosis${run.shard ?? shard ? `, shard ${run.shard ?? shard}` : ''}`;
    const entries = [];
    const write = () => {
        const body = nothing ? [`Nothing to assess: ${nothing}.`] : entries;
        const markdown = clean([heading, '', NOTE, 'Each failed attempt\'s assessment (category, confidence, the selected excerpt, the request sent) is kept 30 days in the shard\'s `jev-<browser>-<shard>-<run>-<attempt>` artifact.', '', ...body, ''].join('\n'));
        writeFileSync(join(output, 'summary.md'), markdown);
        return markdown;
    };

    mkdirSync(join(output, 'attempts'), { recursive: true });
    for (const [index, attempt] of ordered.entries()) {
        let result;
        if (index >= cap) {
            result = clean({ version: 1, status: 'not_assessed', reason: 'cap', note: NOTE, job, attempt: identity(attempt), context: run });
        } else if (deadline - Date.now() < MIN_SECONDS_LEFT * 1000) {
            result = clean({ version: 1, status: 'not_assessed', reason: 'deadline', note: NOTE, job, attempt: identity(attempt), context: run });
        } else {
            result = await assess(attempt, context, deadline);
        }
        const dir = join(output, 'attempts', `${String(index + 1).padStart(2, '0')}-${slug(attempt)}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'assessment.json'), JSON.stringify(clean(result), null, 2) + '\n');
        entries.push(entry(result, cap));
        if (result.status === 'assessed') {
            annotate(result);
        } else {
            console.log(`Jev diagnosis: ${result.status} (${result.reason}) for [${result.attempt.project}] ${result.attempt.title} (retry ${result.attempt.retry})`);
        }
        write();
    }
    const markdown = write();
    if (env.GITHUB_STEP_SUMMARY) {
        appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
        console.log(heading.replace(/^### /, ''));
    } else {
        console.log(markdown);
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    // Advisory: whatever happens here, the job's verdict is the tests'
    process.exitCode = 0;
    try {
        await main();
    } catch (error) {
        console.log(`Jev diagnosis: unavailable (${error?.code ?? error?.name ?? 'Error'}); the test result is unchanged`);
    }
    process.exitCode = 0;
}
