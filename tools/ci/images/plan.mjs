import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { roles } from './stage.mjs';

const validSha = (sha) => typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha);

function isGreenMainPush(run, repository, sha) {
    return run?.event === 'push' && run.status === 'completed' && run.conclusion === 'success'
        && run.path === '.github/workflows/ci.yml' && run.head_branch === 'main'
        && run.repository?.full_name === repository && run.head_repository?.full_name === repository
        && run.head_sha === sha;
}

export function publishCandidate(eventName, event, { repository, sha, ref, protectedRef }) {
    if (ref !== 'refs/heads/main' || protectedRef !== true || !validSha(sha)) return null;
    if (eventName === 'workflow_run' && isGreenMainPush(event.workflow_run, repository, sha)) return sha;
    if (eventName === 'schedule' && isGreenMainPush(event.ci, repository, sha)) return sha;
    return null;
}

export function changedRoles(paths) {
    const prefix = 'tools/ci/images/';
    const chosen = new Set();
    for (const path of paths) {
        if (path === '.github/workflows/images.yml' || path === 'tools/tests/image-pipeline.test.mjs') return roles;
        if (!path.startsWith(prefix)) continue;
        const [area] = path.slice(prefix.length).split('/');
        if (!roles.includes(area)) return roles;
        chosen.add(area);
    }
    return roles.filter((role) => chosen.has(role));
}

function verifiedReceiptRun(repository) {
    const path = `repos/${repository}/actions/workflows/images.yml/runs?branch=main&status=success&per_page=12`;
    try {
        const listing = JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }));
        for (const run of listing.workflow_runs) {
            if (!Number.isSafeInteger(run.id) || run.path !== '.github/workflows/images.yml'
                || run.head_branch !== 'main' || run.status !== 'completed' || run.conclusion !== 'success'
                || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository
                || !['workflow_run', 'schedule'].includes(run.event)) continue;
            const artifacts = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/actions/runs/${run.id}/artifacts?name=uxor-image-cache-receipt`], { encoding: 'utf8' }));
            if (artifacts.artifacts.some((entry) => entry.name === 'uxor-image-cache-receipt' && entry.expired === false)) {
                return String(run.id);
            }
        }
    } catch (error) {
        console.warn(`Prior image cache receipt unavailable: ${error.message}`);
    }
    return '';
}

function main() {
    const { GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: repository, GITHUB_OUTPUT: output,
        GITHUB_SHA: sha, GITHUB_REF: ref, PROTECTED_REF: protectedRef, SELECT_ROLE: selected } = process.env;
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    const facts = { repository, sha, ref, protectedRef: protectedRef === 'true' };
    if (eventName === 'schedule' && facts.protectedRef && ref === 'refs/heads/main' && validSha(sha)) {
        const query = `repos/${repository}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${sha}&status=success&per_page=10`;
        const listing = JSON.parse(execFileSync('gh', ['api', query], { encoding: 'utf8' }));
        event.ci = listing.workflow_runs.find((run) => isGreenMainPush(run, repository, sha));
    }
    let publish = repository === 'xormania/uxor' ? publishCandidate(eventName, event, facts) : null;
    if (publish) {
        const run = eventName === 'schedule' ? event.ci : event.workflow_run;
        if (!Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt) || run.id < 1 || run.run_attempt < 1) {
            throw new Error('invalid source CI attempt identity');
        }
        const url = `repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`;
        const listing = JSON.parse(execFileSync('gh', ['api', url], { encoding: 'utf8' }));
        const verdicts = listing.jobs.filter((job) => job.name === 'CI result');
        if (verdicts.length !== 1 || verdicts[0].status !== 'completed' || verdicts[0].conclusion !== 'success') {
            console.warn('The image pipeline requires a successful CI result from the exact source CI attempt.');
            publish = null;
        }
    }
    let affected = [];
    if (publish) {
        affected = roles;
    } else if (eventName === 'workflow_dispatch') {
        if (selected === 'all') affected = roles;
        else if (roles.includes(selected)) affected = [selected];
        else throw new Error(`unknown requested image role ${selected}`);
    } else if (['push', 'pull_request'].includes(eventName)) {
        const before = eventName === 'push' ? event.before : event.pull_request?.base?.sha;
        if (!validSha(before) || /^0+$/.test(before)) {
            affected = roles;
        } else {
            // The checkout uses full history. A missing comparison proves no narrower selection.
            try {
                const changed = execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', before, sha], { encoding: 'utf8' });
                affected = changedRoles(changed.split('\0').filter(Boolean));
            } catch {
                affected = roles;
            }
        }
    }
    const cacheRun = repository === 'xormania/uxor' && affected.length > 0 && eventName !== 'schedule'
        ? verifiedReceiptRun(repository)
        : '';
    appendFileSync(output, `roles=${affected.join(' ')}\npublish=${!!publish}\ncommit=${publish ?? sha}\ncold=${eventName === 'schedule' && !!publish}\ncache-run=${cacheRun}\n`);
    console.log(`Selected image roles: ${affected.join(', ') || 'none'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
