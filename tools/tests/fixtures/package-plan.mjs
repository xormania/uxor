import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));

export function fileNames(directory, prefix = '') {
    return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        return entry.isDirectory() ? fileNames(directory, path) : [path];
    }).sort();
}

export function sha256(contents) {
    return createHash('sha256').update(contents).digest('hex');
}

// This is a controlled builder input, not a second implementation of Toolkit's resolver. The PHP adapter
// tests exercise real Toolkit discovery; these cases check what the builder does with that boundary's output.
export function plannedFixture(t) {
    const work = mkdtempSync(join(tmpdir(), 'uxor-planned-package-'));
    t.after(() => rmSync(work, { recursive: true, force: true }));
    const source = join(work, 'source');
    const names = ['data-table', 'table', 'pagination', 'input', 'select', 'button', 'empty-state', 'turbo', 'theme'].sort();
    for (const path of [...names, 'packages/uxor-pilot', 'manifest.json', 'LICENSE', 'NOTICE']) {
        cpSync(join(root, path), join(source, path), { recursive: true });
    }
    const icons = join(source, 'demo/assets/icons/flowbite');
    mkdirSync(icons, { recursive: true });
    for (const name of ['arrow-up-outline', 'arrow-down-outline', 'chevron-left-outline', 'chevron-right-outline', 'inbox-outline']) {
        cpSync(join(root, 'demo/assets/icons/flowbite', `${name}.svg`), join(icons, `${name}.svg`));
    }
    const manifest = (path) => ({ path, sha256: sha256(readFileSync(join(source, path))) });
    const kit = { name: 'UXor', manifest: manifest('manifest.json') };
    const recipes = names.map((name) => ({ name, type: 'component', manifest: manifest(`${name}/manifest.json`), inventory: fileNames(join(source, name)) }));
    const files = recipes.flatMap(({ name }) => fileNames(join(source, name))
        .filter((path) => ['assets/', 'src/', 'templates/components/'].some((prefix) => path.startsWith(prefix)))
        .map((path) => ({ recipe: name, source: `${name}/${path}`, destination: path, sha256: sha256(readFileSync(join(source, name, path))) })));
    files.sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
    const requirements = [];
    for (const [owner, path] of [['kit', 'manifest.json'], ...names.map((name) => [`recipe:${name}`, `${name}/manifest.json`])]) {
        const metadata = JSON.parse(readFileSync(join(source, path)));
        for (const [type, declarations] of Object.entries(metadata.dependencies ?? {})) {
            for (const requirement of declarations) requirements.push({ owner, type, requirement });
        }
    }
    const plan = {
        format: 1,
        toolkit: { package: 'symfony/ux-toolkit', version: 'v3.5.1', reference: '0'.repeat(40) },
        source: { sha256: '' }, kit, roots: ['data-table', 'theme'], recipes, files, requirements,
    };
    updatePlanIdentity(plan);
    return { work, source, plan, manifest };
}

export function updatePlanIdentity(plan) {
    plan.source.sha256 = sha256(JSON.stringify({ kit: plan.kit, roots: plan.roots, recipes: plan.recipes, files: plan.files }));
}
