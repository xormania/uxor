#!/usr/bin/env node
// Each recipe's README states the dependencies its manifest.json declares by rendering them: a `::: installation`
// line of its own, outside code blocks, from which the toolkit writes the install steps with the manifest's packages
// and constraints. The versions match by construction, so a README writes none of its own: a table with a Version
// column outside code blocks fails, whether it matches the manifest or not.
//
// A README without the line fails, and so does a version table. There is no waiver: fix the README (the manifest is
// what ux:install reads). The root manifest.json is the kit's, not a recipe's, and is not read here.
//
//   node tools/readme-versions.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The README's lines outside fenced code blocks (``` or ~~~), with their line numbers: what renders as the README */
export function unfenced(readme) {
    const kept = [];
    let fence = null;
    readme.split('\n').forEach((text, i) => {
        const marker = text.match(/^\s*(`{3,}|~{3,})/);
        if (marker) {
            if (fence === null) {
                fence = marker[1];
            } else if (text.trim().startsWith(fence)) {
                fence = null;
            }
            return;
        }
        if (fence === null) {
            kept.push({ line: i + 1, text });
        }
    });
    return kept;
}

const cells = (text) => text.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim().toLowerCase());

/** What is wrong with a recipe's README: a list of messages, empty when it renders its manifest and writes no version. */
export function checkReadme(recipe, readme) {
    const lines = unfenced(readme);
    const where = `${recipe}/README.md`;
    const problems = [];
    if (!lines.some(({ text }) => /^::: installation[ \t]*$/.test(text))) {
        problems.push(`${where}: no "::: installation" line: add one, so the toolkit renders ${recipe}/manifest.json's dependencies.`);
    }
    lines.forEach(({ line, text }, i) => {
        // a table's header row: a Version cell, with the delimiter row (|---|) under it
        const next = lines[i + 1];
        if (text.trim().startsWith('|') && cells(text).includes('version') && next?.line === line + 1 && /^\s*\|?\s*:?-+/.test(next.text)) {
            problems.push(`${where}:${line}: a table with a Version column: versions come from ${recipe}/manifest.json through "::: installation", remove it.`);
        }
    });
    return problems;
}

function main() {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const recipes = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'manifest.json')))
        .map((entry) => entry.name)
        .sort();
    const problems = [];
    for (const recipe of recipes) {
        const readmePath = join(root, recipe, 'README.md');
        if (!existsSync(readmePath)) {
            problems.push(`${recipe}/README.md: missing.`);
            continue;
        }
        problems.push(...checkReadme(recipe, readFileSync(readmePath, 'utf8')));
    }
    if (problems.length > 0) {
        console.error(problems.join('\n'));
        console.error(`\n${problems.length} README version problem(s): the manifests are the truth, render them with "::: installation".`);
        process.exit(1);
    }
    console.log(`README versions come from the manifests: ${recipes.length} recipes render "::: installation" and write no version table.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
