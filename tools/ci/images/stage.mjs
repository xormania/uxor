import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const roles = Object.freeze(['demo', 'toolkit', 'package', 'docs']);
const recipeSelectors = new Set(['@recipes', '@recipe-docs', '@recipe-payload']);
const recipePayloadDirectories = new Set(['templates', 'assets', 'src', 'config']);
const areaRoots = Object.freeze({
    demo: ['website', 'packages/uxor'],
    toolkit: ['demo', 'website', 'packages/uxor'],
    package: ['demo', 'website'],
    docs: ['demo', 'packages/uxor/dev'],
});

function ownPath(path) {
    return typeof path === 'string'
        && /^(?:[\w.][\w./-]*)$/.test(path)
        && path.replace(/\/$/, '').split('/').every((part) => part && !['.', '..', '.git'].includes(part));
}

function trackedFiles(root) {
    const entries = execFileSync('git', ['ls-files', '--stage', '-z'], { cwd: root, encoding: 'utf8' });
    return new Map(entries.split('\0').filter(Boolean).map((line) => {
        const tab = line.indexOf('\t');
        const [mode, , stage] = line.slice(0, tab).split(' ');
        if (stage !== '0') throw new Error('refusing an unresolved checkout');
        return [line.slice(tab + 1), mode];
    }));
}

function selectedFiles(files, selector, recipes) {
    if (recipeSelectors.has(selector)) {
        return [...files.keys()].filter((path) => {
            const [recipe, entry, more] = path.split('/');
            if (!recipes.has(recipe)) return false;
            if (selector === '@recipes') return true;
            if (!more) return ['README.md', 'manifest.json'].includes(entry);
            return selector === '@recipe-payload' && recipePayloadDirectories.has(entry);
        });
    }
    if (!ownPath(selector)) throw new Error(`invalid path selector ${JSON.stringify(selector)}`);
    if (selector.endsWith('/')) return [...files.keys()].filter((path) => path.startsWith(selector));
    return files.has(selector) ? [selector] : [];
}

function checkRegular(root, path, mode) {
    if (!ownPath(path) || !['100644', '100755'].includes(mode)) {
        throw new Error(`refusing nonregular tracked input or unsafe path ${path}`);
    }
    // A worktree can replace a tracked parent directory or file with a symlink.
    let parent = root;
    for (const part of path.split('/').slice(0, -1)) {
        parent = join(parent, part);
        if (!lstatSync(parent).isDirectory()) throw new Error(`refusing non-directory input parent ${parent}`);
    }
    if (!lstatSync(join(root, path)).isFile()) throw new Error(`refusing nonregular worktree input ${path}`);
}

export function stage(root, role, dest) {
    if (!roles.includes(role)) throw new Error(`unknown image role ${role}`);
    const source = `tools/ci/images/${role}`;
    const files = trackedFiles(root);
    for (const name of ['Dockerfile', 'paths.json', 'test.sh', '../base/Dockerfile']) {
        const path = name.startsWith('../') ? 'tools/ci/images/base/Dockerfile' : `${source}/${name}`;
        checkRegular(root, path, files.get(path));
    }

    const manifest = JSON.parse(readFileSync(join(root, source, 'paths.json'), 'utf8'));
    if (!['8.4', '8.5'].includes(manifest.php) || !Array.isArray(manifest.test) || !manifest.test.length
        || Object.keys(manifest).some((key) => !['php', 'test'].includes(key))) {
        throw new Error(`invalid image paths manifest for ${role}`);
    }

    const recipes = new Set([...files.keys()]
        .filter((path) => /^[\w-]+\/manifest\.json$/.test(path))
        .map((path) => path.split('/')[0]));
    const selected = new Set();
    for (const selector of manifest.test) {
        const paths = selectedFiles(files, selector, recipes);
        if (!paths.length) throw new Error(`path selector matched no tracked inputs ${selector}`);
        for (const path of paths) {
            if (areaRoots[role].some((forbidden) => path === forbidden || path.startsWith(`${forbidden}/`))) {
                throw new Error(`${role} test context cannot depend on ${path}`);
            }
            checkRegular(root, path, files.get(path));
            selected.add(path);
        }
    }

    // Start with a new destination so stale inputs can never enter another role.
    mkdirSync(dest);
    mkdirSync(join(dest, 'build'));
    mkdirSync(join(dest, 'base'));
    mkdirSync(join(dest, 'test'));
    copyFileSync(join(root, source, 'Dockerfile'), join(dest, 'build', 'Dockerfile'));
    copyFileSync(join(root, 'tools/ci/images/base/Dockerfile'), join(dest, 'base', 'Dockerfile'));
    copyFileSync(join(root, source, 'test.sh'), join(dest, 'test.sh'));
    for (const path of selected) {
        const target = join(dest, 'test', path);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(join(root, path), target);
    }
    writeFileSync(join(dest, 'php-version'), `${manifest.php}\n`);
    return { php: manifest.php, files: selected.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const [, , role, dest] = process.argv;
    if (!role || !dest || process.argv.length !== 4) {
        throw new Error('usage: stage.mjs ROLE DEST');
    }
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const result = stage(root, role, resolve(dest));
    console.log(`Staged ${result.files} test inputs with PHP ${result.php} for ${role}.`);
}
