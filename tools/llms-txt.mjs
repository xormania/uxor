#!/usr/bin/env node
// Writes the agent-facing lists of recipes from docs/RECIPES.md's tables (the row a person reads is the line an agent
// reads), checked against the directories holding a manifest.json, so a recipe cannot be left out or listed twice:
//
// - llms.txt (https://llmstxt.org/): the kit's pages for agents, one line each, linked as raw markdown. The links
//   point at the tree this file describes: the version of CHANGELOG.md's latest `## [X.Y.Z]` heading, which is the
//   tag release.yml puts on the commit that adds the heading, or `dev` while `## [Unreleased]` has entries. Never
//   `main`, which moves away from an installed tag.
// - FOR-AGENTS.md, *Which recipe*: the table between the `recipes:start` and `recipes:end` comments.
//
// It also checks that FOR-AGENTS.md and docs/PROJECT-AGENTS-SNIPPET.md name only recipes that exist
// (`ux:install <name>`, `<name>/README.md` links), and the plans' status (docs/PLAN-*.md front matter and the
// docs/ROADMAP.md table, see CONTRIBUTING.md *Plans*): an `open` plan whose recipes all ship, or a `shipped` one
// whose recipe is missing, fails.
//
//   node tools/llms-txt.mjs           # writes llms.txt and the FOR-AGENTS.md table
//   node tools/llms-txt.mjs --check   # fails when either is not what this script writes, or a check fails (CI)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kitIdentity } from './kit-identity.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
// table text as plain markdown: links keep their text, the ✦ marker goes
const plain = (text) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s*✦\s*/g, ' ').trim();
const errors = [];

// The ref the links name: CHANGELOG.md's first section is `## [Unreleased]` (with or without entries), then the
// versions, newest first
const changelog = read('CHANGELOG.md');
const unreleased = changelog.match(/^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[)/m);
const version = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];
const ref = unreleased && /^\s*- /m.test(unreleased[1]) ? 'dev' : version;
if (!ref) {
    console.error('CHANGELOG.md has no unreleased entry and no `## [X.Y.Z]` heading: no ref for the links.');
    process.exit(1);
}
const manifest = JSON.parse(read('manifest.json'));
// the kit's name and repository: manifest.json's name and homepage (tools/kit-identity.mjs)
const kit = kitIdentity(manifest);
const raw = kit.raw(ref);
const recipes = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'manifest.json')))
    .map((entry) => entry.name)
    .sort();

// docs/RECIPES.md: each "## Group" heading, then rows "| [`name`](../name/README.md) … | description |"
const groups = [];
for (const line of read('docs/RECIPES.md').split('\n')) {
    const heading = line.match(/^## (.+)$/);
    if (heading) {
        groups.push({ title: plain(heading[1]), rows: [] });
        continue;
    }
    const row = line.match(/^\| \[`([a-z0-9-]+)`\]\((?:\.\.\/)?\1\/README\.md\)[^|]*\| (.+) \|$/);
    if (row && groups.length > 0) {
        groups.at(-1).rows.push({ name: row[1], description: row[2].trim() });
    }
}

const listed = groups.flatMap((group) => group.rows.map((row) => row.name));
const missing = recipes.filter((name) => !listed.includes(name));
const unknown = listed.filter((name) => !recipes.includes(name));
const twice = listed.filter((name, index) => listed.indexOf(name) !== index);
if (missing.length || unknown.length || twice.length) {
    console.error('docs/RECIPES.md\'s recipe tables do not match the recipe directories:');
    for (const [label, names] of [['missing', missing], ['not a recipe', unknown], ['listed twice', twice]]) {
        if (names.length) {
            console.error(`  ${label}: ${names.join(', ')}`);
        }
    }
    process.exit(1);
}
// a recipe ships when its directory has a manifest.json and docs/RECIPES.md lists it
const ships = (name) => recipes.includes(name) && listed.includes(name);

// --- llms.txt
const lines = [
    `# ${kit.name}`,
    '',
    `> ${manifest.description}`,
    '',
    `A Symfony UX Toolkit kit: install a recipe with \`php bin/console ux:install <recipe> --kit=${kit.homepage}\`, which copies its files into the project. Each recipe's README gives its props, examples and how it behaves in forms, Live Components and Turbo Frames.`,
    '',
    ref === 'dev'
        ? `The links below point at \`dev\`, the work merged since the last release: install with \`--kit=${kit.homepage}:dev\` to get what they describe.`
        : `The links below point at release \`${ref}\`, the version this file was written for: install it with \`--kit=${kit.homepage}:${ref}\`.`,
    '',
    '## Start here',
    '',
    `- [For agents](${raw}/FOR-AGENTS.md): what the kit gives you, how to set a project up, which recipe to install for what, and the rules to follow`,
    `- [Project agents snippet](${raw}/docs/PROJECT-AGENTS-SNIPPET.md): the block to paste into a project's AGENTS.md or CLAUDE.md`,
    `- [Install](${raw}/INSTALL.md): each setup step explained, AssetMapper or Webpack Encore`,
    `- [README](${raw}/README.md): what the kit is, how to install it, requirements`,
    `- [Recipes](${raw}/docs/RECIPES.md): every recipe, one line each`,
    `- [Guide](${raw}/docs/GUIDE.md): installing and updating recipes, Turbo and Live Components, security, versioning`,
    '',
];
for (const group of groups) {
    lines.push(`## ${group.title}`, '');
    for (const row of group.rows) {
        lines.push(`- [${row.name}](${raw}/${row.name}/README.md): ${plain(row.description)}`);
    }
    lines.push('');
}
lines.push(
    '## Optional',
    '',
    `- [Changelog](${raw}/CHANGELOG.md): what each version changes`,
    `- [Security](${raw}/SECURITY.md): reporting a vulnerability`,
    `- [Testing patterns](${raw}/docs/TESTING.md): how this repository tests Turbo, Live Components, the CSP and request limits, to reuse in an app`,
    `- [Contributing](${raw}/CONTRIBUTING.md): changing the kit itself: layout, conventions, checks`,
    '',
);
const llms = lines.join('\n');

// --- FOR-AGENTS.md, *Which recipe*: one table per group, as docs/RECIPES.md has them (without the ✦)
const start = '<!-- recipes:start: written by tools/llms-txt.mjs from docs/RECIPES.md\'s tables; edit those, then run it -->';
const end = '<!-- recipes:end -->';
const table = [start];
for (const group of groups) {
    table.push('', `**${group.title}**`, '', '| Install | What it is |', '|---|---|');
    for (const row of group.rows) {
        table.push(`| [\`${row.name}\`](${row.name}/README.md) | ${row.description} |`);
    }
}
table.push('', end);
const forAgents = read('FOR-AGENTS.md');
const from = forAgents.indexOf('<!-- recipes:start');
const to = forAgents.indexOf(end);
if (from < 0 || to < from) {
    console.error(`FOR-AGENTS.md has no "<!-- recipes:start" … "${end}" pair: put them where the recipe table goes.`);
    process.exit(1);
}
const forAgentsOutput = forAgents.slice(0, from) + table.join('\n') + forAgents.slice(to + end.length);

// --- the agent pages name only recipes that exist
for (const path of ['FOR-AGENTS.md', 'docs/PROJECT-AGENTS-SNIPPET.md']) {
    const text = read(path);
    const named = [
        ...[...text.matchAll(/ux:install ([a-z0-9][a-z0-9-]*)/g)].map((match) => match[1]),
        ...[...text.matchAll(/\]\(([a-z0-9][a-z0-9-]*)\/README\.md/g)].map((match) => match[1]),
    ];
    for (const name of new Set(named)) {
        if (!ships(name)) {
            errors.push(`${path} names \`${name}\`, which is not a recipe (no ${name}/manifest.json, or not in docs/RECIPES.md's tables).`);
        }
    }
}

// --- plans: docs/PLAN-*.md front matter, docs/ROADMAP.md's *Sequence* table
const statuses = ['open', 'shipped', 'abandoned'];
const checkStatus = (where, status, names) => {
    if (!statuses.includes(status)) {
        errors.push(`${where}: status "${status ?? ''}" is not one of ${statuses.join(', ')}.`);
        return;
    }
    if (status === 'open' && names.length > 0 && names.every(ships)) {
        errors.push(`${where}: status open, but ${names.join(', ')} ${names.length > 1 ? 'ship' : 'ships'} (docs/RECIPES.md's tables): mark it shipped.`);
    }
    if (status === 'shipped') {
        const gone = names.filter((name) => !ships(name));
        if (gone.length) {
            errors.push(`${where}: status shipped, but ${gone.join(', ')} ${gone.length > 1 ? 'are' : 'is'} not a recipe in docs/RECIPES.md's tables.`);
        }
    }
};
const recipeList = (text) => (/^\s*(none|—|-)?\s*$/.test(text) ? [] : text.split(',').map((name) => name.trim().replace(/`/g, '')));
const plans = readdirSync(join(root, 'docs')).filter((file) => /^PLAN-.+\.md$/.test(file)).sort();
const closedPlans = [];
for (const file of plans) {
    const front = read(`docs/${file}`).match(/^---\n([\s\S]*?)\n---\n/);
    if (!front) {
        errors.push(`docs/${file}: no front matter (---, status: open|shipped|abandoned, recipes: …, ---) on its first lines.`);
        continue;
    }
    // "key: value", a trailing "# comment" left out
    const field = (key) => front[1].match(new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*(#.*)?$`, 'm'))?.[1];
    if (field('recipes') === undefined) {
        errors.push(`docs/${file}: no "recipes:" line in the front matter (the recipes it adds, or none).`);
        continue;
    }
    checkStatus(`docs/${file}`, field('status'), recipeList(field('recipes')));
    if (field('status') !== 'open') {
        closedPlans.push(`docs/${file}`);
    }
}
const roadmap = read('docs/ROADMAP.md');
const header = roadmap.match(/^\| # \|.*\| Recipes \| Status \|$/m);
if (!header) {
    errors.push('docs/ROADMAP.md: the *Sequence* table has no "Recipes" and "Status" columns (last two).');
} else {
    for (const line of roadmap.slice(header.index).split('\n').slice(2)) {
        if (!line.startsWith('|')) {
            break;
        }
        const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
        checkStatus(`docs/ROADMAP.md, ${plain(cells[1]).replace(/\*/g, '')}`, cells.at(-1).replace(/\*/g, ''), recipeList(cells.at(-2)));
    }
}
// a plan that is no longer open is a record, not an instruction: llms.txt never offers one
for (const page of closedPlans) {
    if (llms.includes(`/${page}`)) {
        errors.push(`llms.txt links ${page}, which is not an open plan: agents would take it as instructions.`);
    }
}

// --- write or check
const outputs = [['llms.txt', llms], ['FOR-AGENTS.md', forAgentsOutput]];
if (process.argv.includes('--check')) {
    for (const [path, output] of outputs) {
        const current = existsSync(join(root, path)) ? read(path) : '';
        if (current !== output) {
            errors.push(`${path} is stale: run \`node tools/llms-txt.mjs\` and commit the result.`);
        }
    }
    if (errors.length) {
        errors.forEach((error) => console.error(error));
        process.exit(1);
    }
    console.log(`llms.txt and FOR-AGENTS.md are up to date (${listed.length} recipes, links at ${ref}); ${plans.length} plans and the roadmap checked.`);
} else {
    for (const [path, output] of outputs) {
        writeFileSync(join(root, path), output);
    }
    errors.forEach((error) => console.error(error));
    console.log(`Wrote llms.txt and FOR-AGENTS.md (${listed.length} recipes, links at ${ref}).`);
    process.exit(errors.length ? 1 : 0);
}
