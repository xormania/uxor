#!/usr/bin/env node
/*
 * The Docker image the browser runs in: upstream's Playwright image (mcr.microsoft.com/playwright), in which the
 * screenshot baselines were taken. tools/playwright-image.json pins it by digest, `<image>:v<version>-noble@sha256:…`,
 * so the browser cannot change under the tests when Microsoft republishes the tag. Its tag must name the
 * @playwright/test version package-lock.json locks: the client and the browser server speak the same protocol, and a
 * Playwright bump moves the browser only with a new pin, never on its own.
 *
 * Read by playwright.config.ts (the `docker run` of the browser server) and by the workflows (`docker pull`).
 *
 *   node tools/playwright-image.mjs            print the pinned image; fails when its tag is not the locked version
 *   node tools/playwright-image.mjs --refresh  pin the locked version's tag at the digest the registry gives now
 *                                              (docker buildx imagetools inspect: reads the registry, pulls nothing)
 *
 * A @playwright/test bump (by hand: Dependabot leaves it alone, docs/NOTES.md) fails Tool tests and the browser jobs
 * until `--refresh` is run and the new pin committed with the baselines the new browser changes.
 * Test: node --test tools/tests/playwright-image.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
export const IMAGE = 'mcr.microsoft.com/playwright';
const PIN_FILE = 'tools/playwright-image.json';
const REFRESH = 'node tools/playwright-image.mjs --refresh';

/** The tag the image has for a Playwright version. */
export const tagFor = (version) => `${IMAGE}:v${version}-noble`;

/** The pinned image reference in tools/playwright-image.json, or undefined when there is none. */
export function readPin(root = repository) {
    try {
        return JSON.parse(readFileSync(join(root, PIN_FILE), 'utf8')).image;
    } catch (error) {
        if ('ENOENT' === error.code) {
            return undefined;
        }
        throw error;
    }
}

/** The @playwright/test version package-lock.json locks. */
export function lockedVersion(root = repository) {
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    return lock.packages?.['node_modules/@playwright/test']?.version;
}

/** What is wrong with a pin for a Playwright version: [] when it is that version's tag at a digest. */
export function checkPin(image, version) {
    if (!image) {
        return [`${PIN_FILE}: no pinned image. Run \`${REFRESH}\`.`];
    }
    const match = /^(.+):v([^:@]+)-noble@sha256:[0-9a-f]{64}$/.exec(image);
    if (!match || IMAGE !== match[1]) {
        return [`${PIN_FILE}: "${image}" is not ${IMAGE}:v<version>-noble@sha256:<digest>. Run \`${REFRESH}\`.`];
    }
    if (match[2] !== version) {
        return [
            `${PIN_FILE}: the browser image is pinned at v${match[2]}-noble, but @playwright/test is ${version}. ` +
                `Run \`${REFRESH}\` and commit the new pin (with the baselines the new browser changes).`,
        ];
    }
    return [];
}

/** The pinned image for a Playwright version; throws when the pin is missing or for another version. */
export function playwrightImage(version, image = readPin()) {
    const problems = checkPin(image, version);
    if (problems.length > 0) {
        throw new Error(image ? problems.join('\n') : `no pinned image: ${problems.join('\n')}`);
    }
    return image;
}

/** The digest the registry gives now for a tag (the multi-platform index), read without pulling the image. */
function registryDigest(tag) {
    const manifest = JSON.parse(execFileSync('docker', ['buildx', 'imagetools', 'inspect', tag, '--format', '{{json .Manifest}}'], { encoding: 'utf8' }));
    if (!/^sha256:[0-9a-f]{64}$/.test(manifest.digest ?? '')) {
        throw new Error(`no digest for ${tag} in: ${JSON.stringify(manifest).slice(0, 200)}`);
    }
    return manifest.digest;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const version = lockedVersion();
    if (!version) {
        console.error('package-lock.json locks no @playwright/test');
        process.exit(1);
    }
    if (process.argv.includes('--refresh')) {
        const tag = tagFor(version);
        const image = `${tag}@${registryDigest(tag)}`;
        writeFileSync(join(repository, PIN_FILE), `${JSON.stringify({ image }, null, 4)}\n`);
        console.log(`${PIN_FILE}: ${image}`);
    } else {
        try {
            console.log(playwrightImage(version));
        } catch (error) {
            console.error(error.message);
            process.exit(1);
        }
    }
}
