#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPackage } from './build-package-pilot.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const releasePlan = JSON.parse(readFileSync(join(root, 'tools/tests/fixtures/package-pilot/releases.json')));

/** Read only the canonical inputs from an existing commit; export-ignore must not hide package metadata. */
export function exportPilotSources(ref, output, repository = root) {
    if (existsSync(output)) throw new Error('Baseline source output must not exist.');
    const sha = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: repository, encoding: 'utf8' }).trim();
    const paths = ['LICENSE', 'NOTICE', 'packages/uxor-pilot'];
    for (const recipe of ['data-table', 'table', 'pagination', 'input', 'select', 'button', 'empty-state', 'turbo', 'theme']) {
        for (const path of ['manifest.json', 'src', 'assets', 'templates']) paths.push(`${recipe}/${path}`);
    }
    for (const icon of ['arrow-up-outline', 'arrow-down-outline', 'chevron-left-outline', 'chevron-right-outline', 'inbox-outline']) {
        paths.push(`demo/assets/icons/flowbite/${icon}.svg`);
    }
    const entries = execFileSync('git', ['ls-tree', '-r', '-z', sha, '--', ...paths], { cwd: repository, encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const entry of entries) {
        const match = /^(100644|100755) blob ([a-f0-9]+)\t(.+)$/.exec(entry);
        if (!match || match[3].split('/').includes('..')) throw new Error('Unsupported baseline source entry.');
        const [, mode, object, path] = match;
        const target = join(output, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, execFileSync('git', ['cat-file', 'blob', object], { cwd: repository }), { mode: mode === '100755' ? 0o755 : 0o644 });
    }
    return sha;
}

export function buildPilotReleases(output, baselineRef = releasePlan.baseline_ref, repository = root) {
    if (existsSync(output)) throw new Error('Release output must not exist.');
    const source = join(output, 'baseline-source');
    const sha = exportPilotSources(baselineRef, source, repository);
    buildPackage(join(output, releasePlan.baseline_version), source);
    buildPackage(join(output, releasePlan.upgrade_version), repository);
    writeFileSync(join(output, 'releases.json'), `${JSON.stringify({ ...releasePlan, baseline_ref: sha }, null, 4)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    if (process.argv.length !== 3) {
        console.error('Usage: node tools/package-pilot-releases.mjs NEW_OUTPUT_DIRECTORY');
        process.exitCode = 2;
    } else {
        try { buildPilotReleases(resolve(process.argv[2]), process.env.PILOT_BASE_REF); }
        catch (error) { console.error(error.message); process.exitCode = 1; }
    }
}
