import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stage, roles } from './stage.mjs';

const [directory, selected, receipt] = process.argv.slice(2);
const work = resolve(directory ?? '.');
const targets = selected?.split(' ') ?? [];
if (!targets.length || targets.some((role) => !roles.includes(role)) || new Set(targets).size !== targets.length) {
    throw new Error('usage: bake.mjs WORK "ROLE [...]" [VERIFIED_CACHE_RECEIPT]');
}
const repository = process.env.GITHUB_REPOSITORY?.toLowerCase();
if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('invalid repository identity');
const sha = process.env.IMAGE_COMMIT;
if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('invalid source commit');

let digests = {};
if (receipt) {
    const data = JSON.parse(readFileSync(receipt, 'utf8'));
    if (data.repository !== repository || !/^[0-9a-f]{40}$/.test(data.commit ?? '')
        || !data.cache || typeof data.cache !== 'object' || Array.isArray(data.cache)) {
        throw new Error('invalid verified cache receipt');
    }
    for (const [name, digest] of Object.entries(data.cache)) {
        if (![...roles, 'php84', 'php85'].includes(name) || !/^sha256:[0-9a-f]{64}$/.test(digest)) {
            throw new Error(`invalid verified cache reference for ${name}`);
        }
    }
    digests = data.cache;
}

function cache(name) {
    return digests[name] ? [`type=registry,ref=ghcr.io/${repository}-image-cache@${digests[name]}`] : [];
}

mkdirSync(work, { recursive: true });
const definitions = {};
for (const role of targets) {
    const dir = join(work, role);
    const workspace = stage(process.cwd(), role, dir);
    const base = 'php' + workspace.php.replace('.', '');
    definitions[base] ??= {
        context: join(dir, 'base'), args: { PHP_BASE: base },
        platforms: ['linux/amd64'], 'cache-from': cache(base),
    };
    definitions[role] = {
        context: join(dir, 'build'), contexts: { 'uxor-runtime': `target:${base}` },
        platforms: ['linux/amd64'], output: [`type=oci,dest=${dir}/image.tar`],
        attest: ['type=provenance,disabled=true', 'type=sbom,disabled=true'],
        labels: { 'org.opencontainers.image.source': `https://github.com/${repository}`, 'org.opencontainers.image.revision': sha },
        'cache-from': cache(role),
    };
    console.log(`Prepared ${role} with ${workspace.files} test inputs and PHP ${workspace.php}.`);
}
writeFileSync(join(work, 'bake.json'), JSON.stringify({ group: { default: { targets } }, target: definitions }, null, 2) + '\n');
