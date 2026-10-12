/*
 * Every committed screenshot belongs to a test. A README example that the demo stops finding takes its screenshot
 * and accessibility tests with it, without a failure; its screenshots stay behind and fail this test.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoPages, examples, recipes, root, viewports } from '../inventory';
import { expect, test, themes } from './fixtures';

/** The files of `<top>/<dir>` (e.g. 'alert/tests'), none when it does not exist. */
const files = (top: string, dir: string): string[] => (existsSync(join(root, top, dir)) ? readdirSync(join(root, top, dir)) : []);

// about the Chromium baselines, so with the screenshot tests: tagged like them, it runs in Chromium only
test('every screenshot in <recipe>/tests/screenshots has a test', { tag: '@screenshot' }, () => {
    const expected = new Set([
        // examples.spec.ts
        ...examples.flatMap(({ recipe, id }) => themes.map((theme) => `${recipe}/${id}-${theme}.png`)),
        // pages.spec.ts
        ...Object.keys(demoPages).flatMap((name) => Object.keys(viewports).map((viewport) => `layouts/${name}-${viewport}.png`)),
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
