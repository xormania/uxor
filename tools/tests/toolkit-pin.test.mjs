// The Symfony UX Toolkit versions ci.yml installs to lint and install the kit: one lane on the version demo/composer.lock
// holds (pinned, or read from the lock by a step at run time), and one lane on the minimum supported version, labelled
// as such, whose comment does not claim it is the lock's.
// Run: node --test tools/tests/toolkit-pin.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const workflowPath = '.github/workflows/ci.yml';
const lines = readFileSync(join(root, workflowPath), 'utf8').split('\n');
const MINIMUM = '3.5.1';

const lockVersion = (() => {
    const lock = JSON.parse(readFileSync(join(root, 'demo/composer.lock'), 'utf8'));
    const toolkit = [...lock.packages, ...(lock['packages-dev'] ?? [])].find((pkg) => pkg.name === 'symfony/ux-toolkit');
    assert.ok(toolkit, 'demo/composer.lock holds symfony/ux-toolkit');
    return toolkit.version.replace(/^v/, '');
})();

/**
 * What the `composer require … symfony/ux-toolkit:<version>` lines of ci.yml take their version from: a variable
 * (`${VAR}`, `${{ env.VAR }}`, `${{ matrix.VAR }}`) or a step's output (`${{ steps.<id>.outputs.<name> }}`).
 */
function requiredVersions() {
    const sources = [];
    for (const line of lines) {
        const at = line.indexOf('symfony/ux-toolkit:');
        if (!line.includes('composer require') || at < 0) continue;
        const version = line.slice(at + 'symfony/ux-toolkit:'.length);
        const output = /^\$\{\{\s*steps\.([A-Za-z_][\w-]*)\.outputs\.([A-Za-z_][\w-]*)\s*\}\}/.exec(version);
        if (output) {
            sources.push({ step: output[1], output: output[2] });
            continue;
        }
        const match = /^\$\{\{\s*(?:env|matrix)\.([A-Za-z_][\w-]*)\s*\}\}|^\$\{?([A-Za-z_]\w*)\}?/.exec(version);
        assert.ok(match, `the toolkit version of a composer require is a variable or a step output, not a literal: ${line.trim()}`);
        sources.push({ name: match[1] ?? match[2] });
    }
    return sources;
}

/** The variables among them. */
function requiredVariables() {
    return new Set(requiredVersions().filter(({ name }) => name).map(({ name }) => name));
}

/** The steps of a workflow's text (steps at 12 spaces), their comment lines left out. */
const stepsOf = (text) => text.split(/^ {12}- /m).slice(1).map((step) => step.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n'));
const steps = stepsOf(lines.join('\n'));
const readsLock = (step) => /demo\/composer\.lock/.test(step);

/**
 * Whether a step sets `name` at run time from demo/composer.lock: it reads the lock and writes `name=` to $GITHUB_ENV
 * or $GITHUB_OUTPUT (for a step output, the step with that id, to $GITHUB_OUTPUT).
 */
function setFromLock(source, stepList = steps) {
    if (source.step) {
        const step = stepList.find((text) => new RegExp(`^(?:id: ${source.step}| {14}id: ${source.step})\\s*$`, 'm').test(text));
        return Boolean(step) && readsLock(step) && new RegExp(`\\b${source.output}=`).test(step) && /\$\{?GITHUB_OUTPUT\}?/.test(step);
    }
    return stepList.some((step) => readsLock(step) && new RegExp(`\\b${source.name}=`).test(step) && /\$\{?GITHUB_(?:ENV|OUTPUT)\}?/.test(step));
}

/** Each definition of `name` in ci.yml (an env value, or a matrix value or list), with its line and the comment above. */
function definitions(name) {
    const found = [];
    lines.forEach((line, index) => {
        const match = new RegExp(`^\\s*-?\\s*${name}:\\s*(.+?)\\s*(?:#.*)?$`).exec(line);
        if (!match) return;
        const comment = [];
        for (let above = index - 1; above >= 0 && /^\s*#/.test(lines[above]); above--) comment.unshift(lines[above].trim());
        const trailing = /#(.*)$/.exec(line.replace(/'[^']*'|"[^"]*"/g, ''))?.[1] ?? '';
        const values = [...match[1].matchAll(/['"]?(\d+\.\d+\.\d+)['"]?/g)].map((m) => m[1]);
        for (const version of values) found.push({ version, line: index + 1, comment: [...comment, trailing].join(' ') });
    });
    return found;
}

function installedLanes() {
    assert.ok(requiredVersions().length > 0, `${workflowPath} installs symfony/ux-toolkit`);
    const variables = requiredVariables();
    return [...variables].flatMap((name) => definitions(name));
}

test('ci.yml installs the toolkit version demo/composer.lock holds, pinned or read from the lock at run time', () => {
    const versions = installedLanes().map(({ version }) => version);
    const fromLock = requiredVersions().filter((source) => setFromLock(source));
    assert.ok(
        versions.includes(lockVersion) || fromLock.length > 0,
        `a toolkit lane installs ${lockVersion} (demo/composer.lock), pinned or set at run time from demo/composer.lock; pinned: ${versions.join(', ') || 'none'}`,
    );
});

test('a version set at run time counts as the lock lane only when its step reads demo/composer.lock', () => {
    const step = (id, reads, line) => [
        '            - name: The toolkit version',
        ...(id ? [`              id: ${id}`] : []),
        '              run: |',
        `                  version=$(${reads ? "jq -r '.packages[] | select(.name == \"symfony/ux-toolkit\") | .version' demo/composer.lock" : 'echo 3.7.0'})`,
        '                  [ -n "$version" ] || exit 1',
        `                  ${line}`,
        '',
    ].join('\n');
    const cases = [
        ['env, lock read', { name: 'UX_TOOLKIT_VERSION' }, step(null, true, 'echo "UX_TOOLKIT_VERSION=$version" >> "$GITHUB_ENV"'), true],
        ['env, lock not read', { name: 'UX_TOOLKIT_VERSION' }, step(null, false, 'echo "UX_TOOLKIT_VERSION=$version" >> "$GITHUB_ENV"'), false],
        ['env, lock named only in a comment', { name: 'UX_TOOLKIT_VERSION' }, step(null, false, '# the version of demo/composer.lock\n                  echo "UX_TOOLKIT_VERSION=$version" >> "$GITHUB_ENV"'), false],
        ['env, another name written', { name: 'UX_TOOLKIT_VERSION' }, step(null, true, 'echo "OTHER=$version" >> "$GITHUB_ENV"'), false],
        ['env, not written to the runner', { name: 'UX_TOOLKIT_VERSION' }, step(null, true, 'UX_TOOLKIT_VERSION=$version'), false],
        ['step output, lock read', { step: 'toolkit', output: 'version' }, step('toolkit', true, 'echo "version=$version" >> "$GITHUB_OUTPUT"'), true],
        ['step output, lock not read', { step: 'toolkit', output: 'version' }, step('toolkit', false, 'echo "version=$version" >> "$GITHUB_OUTPUT"'), false],
        ['step output, another step reads the lock', { step: 'toolkit', output: 'version' }, step('toolkit', false, 'echo "version=$version" >> "$GITHUB_OUTPUT"') + step('other', true, 'echo "version=$version" >> "$GITHUB_OUTPUT"'), false],
    ];
    for (const [label, source, text, expected] of cases) assert.equal(setFromLock(source, stepsOf(text)), expected, label);
});

test(`ci.yml keeps a minimum-supported toolkit lane on ${MINIMUM}, labelled minimum`, () => {
    const minimum = installedLanes().filter(({ version }) => version === MINIMUM);
    assert.ok(minimum.length > 0, `a toolkit lane installs ${MINIMUM}`);
    for (const { line, comment } of minimum) {
        assert.match(comment, /minimum/i, `${workflowPath}:${line} labels the ${MINIMUM} lane as the minimum supported version`);
    }
});

test('no toolkit pin claims to be the version of demo/composer.lock unless it is', () => {
    for (const { version, line, comment } of installedLanes()) {
        if (version === lockVersion) continue;
        assert.doesNotMatch(comment, /composer\.lock/, `${workflowPath}:${line} pins ${version} but its comment names demo/composer.lock (${lockVersion})`);
    }
});

/** The jobs of ci.yml (jobs at 4 spaces), with the steps of each (steps at 12 spaces), comment lines left out. */
function jobs() {
    const text = lines.join('\n');
    const body = text.slice(text.indexOf('\njobs:\n'));
    return [...body.matchAll(/^ {4}([a-z][a-z0-9_-]*):\n([\s\S]*?)(?=^ {4}[a-z][a-z0-9_-]*:\n|(?![\s\S]))/gm)].map(([, id, job]) => ({ id, text: job, steps: stepsOf(job) }));
}

const installs = (step) => /composer require\b.*symfony\/ux-toolkit:/.test(step);
const matrixCondition = (step) => /^ {14}if:\s*matrix\.([A-Za-z_][\w-]*)\s*==\s*'([^']*)'\s*$/m.exec(step);

test('each toolkit install step runs in some lane of its job: its matrix condition names a value the matrix has', () => {
    const owners = jobs().filter((job) => job.steps.some(installs));
    assert.ok(owners.length > 0, `${workflowPath} installs symfony/ux-toolkit`);
    for (const job of owners) {
        for (const step of job.steps.filter(installs)) {
            const condition = matrixCondition(step);
            if (!condition) continue;
            const [, key, value] = condition;
            const list = new RegExp(`^ {16}${key}:\\s*\\[([^\\]]*)\\]`, 'm').exec(job.text)?.[1];
            assert.ok(list !== undefined, `${job.id}: matrix.${key} is a list`);
            const values = list.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, ''));
            assert.ok(values.includes(value), `${job.id}: an install step runs only for matrix.${key} == '${value}', which the matrix (${values.join(', ')}) never takes`);
        }
    }
});

test('in a job with a toolkit matrix, each install step names its own lane, and every lane installs once', () => {
    for (const job of jobs().filter((candidate) => candidate.steps.some(installs))) {
        const matrix = /^ {16}([A-Za-z_][\w-]*):\s*\[([^\]]*)\]/m.exec(job.text);
        const steps = job.steps.filter(installs);
        if (!matrix || steps.length < 2) continue;
        const [, key, list] = matrix;
        const values = list.split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, ''));
        const lanes = steps.map((step) => {
            const condition = matrixCondition(step);
            assert.ok(condition && condition[1] === key, `${job.id}: an install step runs only in a lane of matrix.${key}: ${step.split('\n')[0]}`);
            return condition[2];
        });
        assert.deepEqual([...lanes].sort(), [...values].sort(), `${job.id}: one install step per lane of matrix.${key}`);
    }
});

test('the locked and the minimum installs each run in a lane, and the locked one where its version is read', () => {
    for (const job of jobs().filter((candidate) => candidate.steps.some(installs))) {
        for (const step of job.steps.filter(installs)) {
            const output = /symfony\/ux-toolkit:\$\{\{\s*steps\.([A-Za-z_][\w-]*)\.outputs\./.exec(step)?.[1];
            if (!output) continue;
            const reader = job.steps.find((candidate) => new RegExp(`^(?:id: ${output}| {14}id: ${output})\\s*$`, 'm').test(candidate));
            assert.ok(reader, `${job.id}: the step ${output}, whose output the install takes, is in the same job`);
            const needed = matrixCondition(step)?.slice(1).join('==');
            const given = matrixCondition(reader)?.slice(1).join('==');
            assert.ok(given === undefined || given === needed, `${job.id}: the step ${output} runs in the install's lane (${given} vs ${needed})`);
        }
    }
    const versions = new Set(installedLanes().map(({ version }) => version));
    assert.ok(versions.has(MINIMUM), `a toolkit install takes ${MINIMUM}`);
});

test('a change to demo/composer.lock alone runs the job that reads the toolkit version from it', () => {
    const readers = jobs().filter((job) => job.steps.some((step) => installs(step) || readsLock(step)) && job.steps.some(readsLock));
    if (readers.length === 0) return; // a literal lock lane: the lock's version is checked by the first test
    const selected = spawnSync('bash', ['tools/ci-changes.sh'], { cwd: root, input: 'demo/composer.lock\n', encoding: 'utf8' });
    assert.equal(selected.status, 0, selected.stderr);
    const outputs = new Set(selected.stdout.split('\n').filter((line) => line.endsWith('=true')).map((line) => line.slice(0, -'=true'.length)));
    for (const job of readers) {
        const gate = /^ {8}if:.*\bneeds\.changes\.outputs\.([a-z0-9_-]+)\b/m.exec(job.text)?.[1];
        if (!gate) continue;
        assert.ok(outputs.has(gate), `${job.id} reads demo/composer.lock but tools/ci-changes.sh does not select it (${gate}) for a change to that lock alone`);
    }
});
