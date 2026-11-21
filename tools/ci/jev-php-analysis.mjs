// The protected workflow sends fixed calibration outcomes and their counts. Paths, messages and source stay in GitHub.
import { appendFileSync, constants, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPolicy, evaluate, readJson } from './jev-diagnosis.mjs';

const POLICY_PATH = new URL('./jev-ci.json', import.meta.url);
const TOOLS = ['phpstan', 'mago'];
const CASES = ['return_type', 'nullable_receiver', 'symfony_argument', 'phpunit_narrowing'];
const OUTCOMES = {
    bad: { pass: 'true_positive', miss: 'miss', 'tool-error': 'tool_error_bad' },
    good: { pass: 'true_negative', 'false-positive': 'false_positive', 'tool-error': 'tool_error_good' },
};
const QUESTIONS = {
    next_focus: {
        type: 'choice',
        instructions: 'Select the most useful next human evaluation for these paired PHP fixtures. A miss is a known-bad fixture accepted at its marker; a false positive is a good fixture flagged there. Prefer an observed discrepancy, especially a framework-specific one. If all checks pass, select broaden_fixtures. These four cases do not establish general tool accuracy.',
        criteria: {
            return_type: 'Investigate missed or incorrectly reported PHP return types.',
            nullable_receiver: 'Investigate missed or incorrectly reported calls on nullable receivers.',
            symfony_argument: 'Investigate Symfony service type resolution and method argument checks.',
            phpunit_narrowing: 'Investigate type narrowing through PHPUnit assertions.',
            broaden_fixtures: 'Expand the fixture corpus because these examples reveal no gap.',
            unknown: 'The evidence does not identify a clear next evaluation.',
        },
    },
};

function validatedEvidence(report) {
    if (!Array.isArray(report.cases) || report.cases.length !== CASES.length) return null;
    const cases = {};
    const fields = Object.values(OUTCOMES).flatMap(Object.values);
    const totals = Object.fromEntries(TOOLS.map((tool) => [tool, Object.fromEntries(fields.map((field) => [field, 0]))]));
    for (const id of CASES) {
        const entry = report.cases.find((row) => row?.id === id);
        if (!entry) return null;
        cases[id] = {};
        for (const tool of TOOLS) {
            cases[id][tool] = {};
            for (const [variant, allowed] of Object.entries(OUTCOMES)) {
                const status = entry[variant]?.tools?.[tool]?.status;
                if (typeof status !== 'string' || !Object.hasOwn(allowed, status)) return null;
                cases[id][tool][variant] = status;
                totals[tool][allowed[status]]++;
            }
        }
    }
    for (const tool of TOOLS) {
        if (fields.some((field) => totals[tool][field] !== report.totals?.[tool]?.[field])) return null;
    }
    return { cases, totals };
}

export async function assessComparison(report, policy, key) {
    const runtime = report?.runtime?.outcome;
    if (report?.schema_version !== 1 || typeof report.complete !== 'boolean' || !['passed', 'failed', 'tool_error'].includes(runtime)) {
        return { status: 'unavailable', reason: 'invalid_evaluation' };
    }
    if (runtime !== 'passed') return { status: 'not_assessed', reason: runtime === 'failed' ? 'runtime_failed' : 'runtime_error' };
    if (!report.complete) return { status: 'not_assessed', reason: 'incomplete_evaluation' };
    const state = validatedEvidence(report);
    if (!state) return { status: 'unavailable', reason: 'invalid_evaluation' };
    const result = { ...state, model: policy.model, minimum_confidence: policy.min_confidence };
    if (TOOLS.some((tool) => state.totals[tool].tool_error_good || state.totals[tool].tool_error_bad)) {
        return { ...result, status: 'not_assessed', reason: 'tool_error' };
    }
    if (!policy.enabled) return { ...result, status: 'not_assessed', reason: 'disabled' };
    if (!key) return { ...result, status: 'unavailable', reason: 'missing_credential' };
    if (!/^[!-~]{1,4096}$/.test(key)) return { ...result, status: 'unavailable', reason: 'invalid_credential' };
    try {
        const request = { model: policy.model, state, questions: QUESTIONS };
        const response = await evaluate(request, policy, key, Date.now() + policy.limits.total_seconds * 1000);
        const { choice, confidence, probabilities } = response.answers.next_focus;
        return { ...result, status: 'assessed', next_focus: confidence >= policy.min_confidence ? choice : 'unknown',
            choice, confidence, probabilities, usage: response.usage };
    } catch (error) {
        return { ...result, status: 'unavailable', reason: error.reason ?? 'provider_unavailable' };
    }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    const [input, output] = process.argv.slice(2);
    let policy;
    let assessment;
    try {
        policy = checkPolicy(readJson(POLICY_PATH, 64 * 1024));
        const report = readJson(input, 512 * 1024, constants.O_NOFOLLOW);
        assessment = await assessComparison(report, policy, process.env[policy.connection.credential.env]);
    } catch (error) {
        let reason = 'invalid_policy';
        if (policy) reason = error.code === 'ENOENT' ? 'missing_evaluation' : 'invalid_evaluation';
        assessment = { status: 'unavailable', reason };
    }
    const source = {
        repository: process.env.GITHUB_REPOSITORY, sha: process.env.SOURCE_SHA,
        run_id: process.env.SOURCE_RUN_ID, run_attempt: process.env.SOURCE_RUN_ATTEMPT,
    };
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, JSON.stringify({ schema_version: 1, rubric_version: 1, source, model: policy?.model ?? null, ...assessment }, null, 2) + '\n');
    const summary = `Jev PHP analysis comparison (advisory): ${assessment.next_focus ?? assessment.reason}.\n`;
    console.log(summary.trim());
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
