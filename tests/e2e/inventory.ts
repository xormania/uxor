/*
 * What the specs cover, in one place: the kit's recipes, every README example, and the /demo pages screenshotted at
 * each viewport. examples/baselines.spec.ts checks that every committed screenshot belongs to one of them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../..', import.meta.url));

// The kit's display name, the index's heading: manifest.json's name
export const kitName: string = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).name;

// Recipes as the UX Toolkit discovers them: "<dir>/manifest.json" at depth 1 of the kit root.
export const recipes = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, 'manifest.json')))
    .map((entry) => entry.name)
    .sort();

// The README examples as the demo renders them. PHP_BINARY lets a machine without PHP 8.4 on its PATH point at
// another binary or wrapper.
export const examples: { recipe: string; id: string }[] = JSON.parse(
    execFileSync(process.env.PHP_BINARY ?? 'php', ['bin/console', 'app:examples'], { cwd: join(root, 'demo'), encoding: 'utf8' }),
);

// The layouts and blocks as pages of the /demo application (examples/pages.spec.ts)
export const demoPages = {
    dashboard: '/demo',
    login: '/demo/login',
    signup: '/demo/signup',
    'forgot-password': '/demo/forgot-password',
    'settings-profile': '/demo/settings/profile',
    'settings-notifications': '/demo/settings/notifications',
    'settings-billing': '/demo/settings/billing',
    'not-found': '/demo/not-found',
    blank: '/demo/blank',
};
export const viewports = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };
