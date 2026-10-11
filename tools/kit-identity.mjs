// The kit's name and repository, read from manifest.json: its `name` (the display name) and its `homepage` (the
// GitHub repository, https://github.com/<owner>/<repo>). The tools that print or check either read them here, so a
// rename is manifest.json, the repository's own rename, then `node tools/name-check.mjs` for the markdown that
// keeps literal URLs (see tools/name-check.mjs).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * @param {{ name?: unknown, homepage?: unknown }} manifest the parsed manifest.json
 * @returns {{ name: string, homepage: string, owner: string, repo: string, slug: string, pages: string, raw: (ref: string) => string }}
 */
export function kitIdentity(manifest) {
    const name = typeof manifest.name === 'string' ? manifest.name : '';
    const homepage = typeof manifest.homepage === 'string' ? manifest.homepage : '';
    const match = homepage.match(/^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
    if (!name || !match) {
        throw new Error(`manifest.json needs a "name" and a "homepage" of the form https://github.com/<owner>/<repo> (homepage: "${homepage}").`);
    }
    const [, owner, repo] = match;

    return {
        name,
        homepage,
        owner,
        repo,
        slug: `${owner}/${repo}`,
        // GitHub Pages serves a project site at https://<owner>.github.io/<repo>/ (the owner lowercased)
        pages: `https://${owner.toLowerCase()}.github.io/${repo}/`,
        raw: (ref) => `https://raw.githubusercontent.com/${owner}/${repo}/${ref}`,
    };
}

export function readKitIdentity(root = repoRoot) {
    return kitIdentity(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')));
}
