/*
 * Every committed screenshot belongs to a test. When a README example or app page leaves the inventory, its
 * screenshots stay behind and fail the check for that browser project.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoAppScreenshots, demoPages, examples, recipes, root, viewports } from '../inventory';
import { expect, test, themes } from './fixtures';

/** The files of a directory relative to the repository root. */
const files = (...path: string[]): string[] => {
    const dir = join(root, ...path);
    return existsSync(dir) ? readdirSync(dir) : [];
};

// about the Chromium baselines, so with the screenshot tests: tagged like them, it runs in Chromium only
test('every screenshot in <recipe>/tests/screenshots has a test', { tag: '@screenshot' }, () => {
    const expected = new Set([
        // examples.spec.ts
        ...examples.flatMap(({ recipe, id }) => themes.map((theme) => `${recipe}/${id}-${theme}.png`)),
    ]);
    // testState() in the recipe specs: <example>-<state>-<theme>.png
    for (const recipe of recipes) {
        for (const spec of files(recipe, 'tests').filter((file) => file.endsWith('.spec.ts'))) {
            const source = readFileSync(join(root, recipe, 'tests', spec), 'utf8');
            for (const [, example, state] of source.matchAll(/example: '([^']+)',\s*state: '([^']+)'/g)) {
                themes.forEach((theme) => expected.add(`${recipe}/${example}-${state}-${theme}.png`));
            }
        }
    }

    // every top-level <dir>/tests/screenshots, also of a directory that is no longer a recipe
    const committed = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) =>
            files(entry.name, 'tests/screenshots')
                .filter((file) => file.endsWith('.png'))
                .map((file) => `${entry.name}/${file}`),
        );

    expect(committed.filter((name) => !expected.has(name)), 'screenshots no test compares').toEqual([]);
});

test('every example app screenshot has a page test', { tag: ['@screenshot', '@demo-app'] }, () => {
    const expected = new Set(Object.keys(demoPages).flatMap((name) => Object.keys(viewports).map((viewport) => `${name}-${viewport}.png`)));
    const committed = files(...demoAppScreenshots).filter((file) => file.endsWith('.png'));

    expect(committed.filter((name) => !expected.has(name)), 'screenshots no test compares').toEqual([]);
});
