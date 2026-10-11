#!/usr/bin/env node
/*
 * A failed step's captured log turned into the failed-attempts.json that tools/ci/jev-diagnosis.mjs reads (the shape
 * tools/ci/playwright-summary.mjs writes for the browser tests), for the jobs whose failure is a script's output rather
 * than a test report: one attempt per step that failed the job and captured its log. The attempt carries the step's
 * name and command (read from the workflow), the log lines the policy's `error_pattern` selects (tools/ci/jev-ci.json)
 * and the log's last lines, with their line numbers, within the policy's error budget. It never decides pass or fail:
 * the step's exit status is the verdict.
 *
 * A step captures its log one way, which tools/tests/step-attempts.test.mjs checks in every workflow: it has an id,
 * its run starts with `set -o pipefail`, and its command's output goes through `2>&1 | tee "$RUNNER_TEMP/jev-<id>.log"`.
 *
 * Usage: node tools/ci/step-attempts.mjs --steps '<toJSON(steps)>' --logs <dir> [--workflow <file>] [--job <job id>]
 *            <failed-attempts.json>
 * Environment: GITHUB_WORKFLOW_REF and GITHUB_JOB (the defaults of --workflow and --job), GITHUB_WORKSPACE (the prefix
 * removed from paths), GITHUB_SHA, GITHUB_REF_NAME (all optional).
 * Exit status 0; 64 on a usage error.
 * Test: node --test tools/tests/*.test.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const POLICY = fileURLToPath(new URL('jev-ci.json', import.meta.url));
const TAIL = 5; // the log's last lines, kept whether or not the pattern selects them
const LINE_BYTES = 1000;
const COMMAND_BYTES = 2000;
const FALLBACK_BYTES = 16384;

const indent = (line) => line.length - line.trimStart().length;
const blank = (line) => !line.trim() || line.trim().startsWith('#');
const unquote = (value) => {
    const text = value.replace(/\s+#.*$/, '').trim();
    if (/^'.*'$/.test(text)) return text.slice(1, -1).replace(/''/g, "'");
    if (/^".*"$/.test(text)) return text.slice(1, -1).replace(/\\"/g, '"');
    return text;
};
const clip = (text, limit) => {
    const data = Buffer.from(text, 'utf8');
    return data.length <= limit ? text : `${data.subarray(0, limit).toString('utf8').replace(/�$/, '')}…`;
};

/** `text` as a literal inside a regular expression: every character with a meaning there escaped. */
const escapeRegExp = (text) => String(text).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

/** A block's lines without their common indentation. */
function dedent(lines) {
    const depth = Math.min(...lines.filter((line) => line.trim()).map(indent));
    return lines.map((line) => line.slice(Number.isFinite(depth) ? depth : 0));
}

/**
 * The step of a workflow's job with this id: its name, the line of its run (1-based), its run script and its command
 * (the script without the capture). Our workflows' layout only (a mapping per step, `run: |` blocks), not YAML at large.
 */
export function stepIn(text, job, id) {
    const lines = text.split('\n');
    const start = lines.findIndex((line, i) => new RegExp(`^\\s+${escapeRegExp(job)}:\\s*(#.*)?$`).test(line) && lines.slice(0, i).some((l) => /^jobs:/.test(l)));
    if (start < 0) return null;
    let end = lines.findIndex((line, i) => i > start && !blank(line) && indent(line) <= indent(lines[start]));
    if (end < 0) end = lines.length;
    const at = lines.findIndex((line, i) => i > start && i < end && new RegExp(`^\\s*(- )?id:\\s*['"]?${escapeRegExp(id)}['"]?\\s*(#.*)?$`).test(line));
    if (at < 0) return null;
    let item = at;
    while (item > start && !(lines[item].trimStart().startsWith('- ') && indent(lines[item]) + 2 === indent(lines[at].replace(/^(\s*)- /, '$1  ')))) item--;
    const depth = indent(lines[item]);
    const keys = depth + 2;
    let stop = lines.findIndex((line, i) => i > item && !blank(line) && indent(line) <= depth);
    if (stop < 0 || stop > end) stop = end;
    const step = { name: null, line: null, run: null, command: null };
    for (let i = item; i < stop; i++) {
        const line = i === item ? lines[i].replace(/^(\s*)- /, '$1  ') : lines[i];
        const key = /^(\s*)(name|run):\s?(.*)$/.exec(line);
        if (!key || key[1].length !== keys) continue;
        if (key[2] === 'name') {
            step.name = unquote(key[3]);
            continue;
        }
        step.line = i + 1;
        if (/^[|>][-+]?\s*(#.*)?$/.test(key[3])) {
            let last = i + 1;
            while (last < stop && (!lines[last].trim() || indent(lines[last]) > keys)) last++;
            const block = dedent(lines.slice(i + 1, last));
            // a folded block (>) is one line per paragraph
            step.run = (key[3].startsWith('>') ? block.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ') : block.join('\n')).replace(/\n+$/, '');
        } else {
            step.run = unquote(key[3]);
        }
    }
    if (step.run !== null) {
        const command = step.run.split('\n')
            .filter((line) => !/^\s*set -o pipefail\s*$/.test(line) && !/^\s*\{\s*$/.test(line) && !/^\s*\}\s*2>&1 \| tee .*$/.test(line))
            .map((line) => line.replace(/\s*2>&1 \| tee "\$RUNNER_TEMP\/jev-[a-z0-9-]+\.log"\s*$/, ''));
        step.command = clip(dedent(command).join('\n').trim(), COMMAND_BYTES);
    }
    return step;
}

/** The log lines the pattern selects and the last ones, numbered, within the byte budget: first and last kept. */
export function selectedLines(log, pattern, budget) {
    const lines = log.replace(/\r?\n$/, '').split(/\r?\n/);
    const chosen = lines.map((text, i) => ({ number: i + 1, text })).filter(({ text, number }) => number > lines.length - TAIL || pattern.test(text));
    const rendered = chosen.map(({ number, text }) => `${number}: ${clip(text, LINE_BYTES)}`);
    const size = (list) => list.reduce((sum, line) => sum + Buffer.byteLength(line, 'utf8') + 1, 0);
    if (size(rendered) <= budget) return { total: lines.length, text: rendered.join('\n') };
    const head = [];
    const tail = [];
    const marker = (n) => `[${n} selected lines omitted]`;
    for (let i = 0, j = rendered.length - 1; i <= j;) {
        const next = head.length <= tail.length ? rendered[i] : rendered[j];
        if (size([...head, ...tail, next, marker(rendered.length)]) > budget) break;
        if (head.length <= tail.length) head.push(rendered[i++]);
        else tail.unshift(rendered[j--]);
    }
    return { total: lines.length, text: [...head, marker(rendered.length - head.length - tail.length), ...tail].join('\n') };
}

function policy() {
    try {
        const value = JSON.parse(readFileSync(POLICY, 'utf8'));
        return { pattern: new RegExp(value.error_pattern, 'i'), budget: value.limits.error_bytes };
    } catch {
        // jev-diagnosis.mjs reports an unreadable policy; here only the log's last lines are kept
        return { pattern: /(?!)/, budget: FALLBACK_BYTES };
    }
}

function options(argv) {
    const values = { positional: [] };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) values[argv[i].slice(2)] = argv[++i];
        else values.positional.push(argv[i]);
    }
    return values;
}

function main(argv) {
    const env = process.env;
    const args = options(argv);
    const output = args.positional[0];
    if (!output || args.steps === undefined || !args.logs) {
        console.error('Usage: node tools/ci/step-attempts.mjs --steps <json> --logs <dir> [--workflow <file>] [--job <id>] <failed-attempts.json>');
        return 64;
    }
    const prefix = env.GITHUB_WORKSPACE ? `${env.GITHUB_WORKSPACE.replace(/\/$/, '')}/` : '';
    const workflow = args.workflow ?? /\/(\.github\/workflows\/[^@]+)@/.exec(env.GITHUB_WORKFLOW_REF ?? '')?.[1] ?? null;
    const job = args.job ?? env.GITHUB_JOB ?? null;
    let steps = {};
    try {
        steps = JSON.parse(args.steps) ?? {};
    } catch {
        console.log('step-attempts: the steps context is not JSON; no attempt');
    }
    let text = null;
    try {
        text = workflow ? readFileSync(workflow, 'utf8') : null;
    } catch {
        // the attempt is named by the step's id
    }
    const file = workflow && prefix && isAbsolute(workflow) && workflow.startsWith(prefix) ? workflow.slice(prefix.length) : workflow;
    const { pattern, budget } = policy();

    const attempts = [];
    let passed = 0;
    for (const [id, result] of Object.entries(steps)) {
        const log = join(args.logs, `jev-${id}.log`);
        if (!/^[a-z0-9-]+$/i.test(id) || !existsSync(log)) continue;
        if (result?.conclusion !== 'failure') {
            passed += result?.conclusion === 'success' ? 1 : 0;
            continue;
        }
        const step = (text && job && stepIn(text, job, id)) || { name: null, line: null, command: null };
        const name = step.name ?? id;
        const header = [`Step "${name}" failed (job ${job ?? 'unknown'}).`, `Command: ${step.command ?? 'unknown'}`];
        const content = readFileSync(log, 'utf8').replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replaceAll(prefix || '\u0000', '');
        const intro = (total) => `Log lines the policy's pattern selects, and the last ${TAIL} (of ${total}):`;
        const reserve = Buffer.byteLength([...header, intro(Number.MAX_SAFE_INTEGER), ''].join('\n'), 'utf8');
        const selected = selectedLines(content, pattern, budget - reserve);
        attempts.push({
            testId: `${job ?? 'job'}::${id}`,
            project: 'step',
            file,
            line: step.line,
            title: name,
            shard: null,
            retry: 0,
            status: 'failed',
            outcome: 'failed',
            durationMs: null,
            startTime: null,
            errorLocation: file && step.line ? { file, line: step.line, column: null } : null,
            error: [...header, intro(selected.total), selected.text].join('\n'),
        });
    }

    writeFileSync(output, `${JSON.stringify({
        schema: 1,
        status: 'valid',
        reason: null,
        sha: env.GITHUB_SHA ?? null,
        ref: env.GITHUB_REF_NAME ?? null,
        shard: null,
        projects: ['step'],
        counts: { passed, failed: attempts.length, flaky: 0, skipped: 0 },
        tests: attempts.map(({ error, errorLocation, retry, startTime, ...test }) => test),
        attempts,
        globalErrors: [],
    }, null, 2)}\n`);
    console.log(`step-attempts: ${attempts.length} failed step(s) with a captured log`);

    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
