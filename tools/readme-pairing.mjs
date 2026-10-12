#!/usr/bin/env node
// A change to a recipe's code changes its README too. A recipe is a top-level directory holding a manifest.json; its
// code is every file under it except README.md and tests/. Over the branch's changes since its base (the commit CI's
// Changes job compares with: where the branch left dev), each recipe whose code changed must
// have its README.md changed, or be waived by a trailer in the last paragraph of a commit message in the range:
//
//   Docs-waiver: <recipe> <reason>
//
// The reason must not be empty and the recipe must exist. Every accepted waiver is printed, and listed in
// $GITHUB_STEP_SUMMARY when it is set. The changes are `git diff <base> HEAD`, as the Changes job reads them, so a
// merge that only brings the base in adds nothing; the waivers are read from `git log <base>..HEAD`. With no base
// (a push to main or dev, a run by hand, or --base ''), nothing is compared.
//
//   node tools/readme-pairing.mjs                # since where HEAD left origin/dev (none on main or dev), as CI computes it
//   node tools/readme-pairing.mjs --base <ref>   # since <ref>
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const KEY = /^docs-waiver[ \t]*:(.*)$/i;
const HOW = 'Update the README, or add "Docs-waiver: <recipe> <reason>" to the last paragraph of a commit message in the range.';

/** The waivers of one commit message: the `Docs-waiver:` lines of its last paragraph (its trailers). */
export function waiverLines(message) {
    const paragraphs = message.replace(/\s+$/, '').split(/\n[ \t]*\n/);
    return paragraphs.at(-1).split('\n').map((line) => line.match(KEY)).filter(Boolean).map((match) => match[1].trim());
}

/** The waivers of the range: { waivers: [{ sha, recipe, reason }], problems: [message] }. */
export function parseWaivers(commits, recipes) {
    const waivers = [];
    const problems = [];
    for (const { sha, message } of commits) {
        for (const value of waiverLines(message)) {
            const [, recipe = '', reason = ''] = value.match(/^(\S*)\s*(.*)$/);
            const where = `Docs-waiver in ${sha.slice(0, 7)}`;
            if (recipe === '') {
                problems.push(`${where}: no recipe and no reason; write "Docs-waiver: <recipe> <reason>".`);
            } else if (!recipes.has(recipe)) {
                problems.push(`${where}: "${recipe}" is not a recipe (a top-level directory with a manifest.json).`);
            } else if (reason.trim() === '') {
                problems.push(`${where}: ${recipe} has no reason; write "Docs-waiver: ${recipe} <why its README needs no change>".`);
            } else {
                waivers.push({ sha, recipe, reason: reason.trim() });
            }
        }
    }
    return { waivers, problems };
}

/** The recipe a path belongs to as code, or null: README.md and tests/ are not code. */
export function recipeCode(path, recipes) {
    const [top, ...rest] = path.split('/');
    if (rest.length === 0 || !recipes.has(top)) {
        return null;
    }
    const inside = rest.join('/');
    return inside === 'README.md' || inside.startsWith('tests/') ? null : top;
}

/**
 * The pairing of the changed paths: { changed: Map recipe => code paths, paired: [recipe], waived: [{ recipe, sha,
 * reason }], unused: [waiver], problems: [message] }.
 */
export function pairing(paths, recipes, commits) {
    const changed = new Map();
    for (const path of paths) {
        const recipe = recipeCode(path, recipes);
        if (recipe !== null) {
            changed.set(recipe, [...(changed.get(recipe) ?? []), path]);
        }
    }
    const { waivers, problems } = parseWaivers(commits, recipes);
    const paired = [];
    const waived = [];
    for (const [recipe, code] of [...changed].sort(([a], [b]) => a.localeCompare(b))) {
        if (paths.includes(`${recipe}/README.md`)) {
            paired.push(recipe);
            continue;
        }
        const own = waivers.filter((waiver) => waiver.recipe === recipe);
        if (own.length > 0) {
            waived.push(...own);
            continue;
        }
        const list = code.length > 3 ? `${code.slice(0, 3).join(', ')} and ${code.length - 3} more` : code.join(', ');
        problems.push(`${recipe}: ${list} changed, ${recipe}/README.md did not.`);
    }
    const unused = waivers.filter((waiver) => !waived.includes(waiver));
    return { changed, paired, waived, unused, problems };
}

/** The Markdown for $GITHUB_STEP_SUMMARY. */
export function summary(base, result) {
    const lines = [`### README pairing since \`${base.slice(0, 7)}\``, ''];
    lines.push(`${result.changed.size} recipe(s) with code changes: ${result.paired.length} with their README, ${result.waived.length} waiver(s) accepted.`);
    if (result.waived.length > 0) {
        lines.push('', '| Recipe | Commit | Reason |', '|---|---|---|');
        for (const { recipe, sha, reason } of result.waived) {
            lines.push(`| \`${recipe}\` | ${sha.slice(0, 7)} | ${reason.replaceAll('|', '\\|')} |`);
        }
    }
    if (result.problems.length > 0) {
        lines.push('', ...result.problems.map((problem) => `- ${problem}`));
    }
    return `${lines.join('\n')}\n`;
}

function main() {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const index = process.argv.indexOf('--base');
    let base;
    if (index !== -1) {
        base = process.argv[index + 1] ?? '';
    } else {
        // the rule CI's Changes job applies, which computes the base in the workflow itself, out of the branch's reach
        let branch = '';
        try {
            branch = git('symbolic-ref', '-q', 'HEAD').trim();
        } catch {}
        base = '';
        if (branch !== 'refs/heads/main' && branch !== 'refs/heads/dev') {
            try {
                base = git('merge-base', 'HEAD', 'origin/dev').trim();
            } catch {}
        }
    }
    if (base === '') {
        console.log('README pairing: no base (a push to main or dev, a run by hand, or no history shared with origin/dev): nothing to compare.');
        return;
    }
    try {
        base = git('rev-parse', '--verify', '--quiet', `${base}^{commit}`).trim();
    } catch {
        console.error(`README pairing: the base "${base}" is not a commit here (a shallow clone? fetch the history).`);
        process.exit(1);
    }
    const recipesAt = (rev) => git('ls-tree', '-r', '--name-only', rev).split('\n')
        .map((path) => path.match(/^([^/]+)\/manifest\.json$/)?.[1]).filter(Boolean);
    const recipes = new Set([...recipesAt(base), ...recipesAt('HEAD')]);
    const paths = git('diff', '--name-only', '--no-renames', base, 'HEAD').split('\n').filter(Boolean);
    const commits = git('log', '--format=%H%x00%B%x1e', `${base}..HEAD`).split('\x1e')
        .map((record) => record.replace(/^\n/, '')).filter(Boolean)
        .map((record) => {
            const [sha, message = ''] = record.split('\x00');
            return { sha, message };
        });

    const result = pairing(paths, recipes, commits);
    console.log(`README pairing since ${base.slice(0, 7)} (${commits.length} commit(s)): ${result.changed.size} recipe(s) with code changes, ${result.paired.length} with their README, ${result.waived.length} waiver(s) accepted.`);
    for (const { recipe, sha, reason } of result.waived) {
        console.log(`Waived: ${recipe} (${sha.slice(0, 7)}): ${reason}`);
    }
    for (const { recipe, sha } of result.unused) {
        console.log(`Not needed: the waiver for ${recipe} in ${sha.slice(0, 7)} (its README changed, or its code did not).`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(base, result));
    }
    if (result.problems.length > 0) {
        console.error(result.problems.join('\n'));
        console.error(HOW);
        process.exit(1);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
