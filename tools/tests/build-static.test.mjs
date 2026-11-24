// Exercise the real publication script and fence verifier with a one-recipe tagged repository.
// Each producer records the PHP entry points invoked and renders its side of the public URL contract.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const tools = fileURLToPath(new URL('..', import.meta.url));

test('the website and runtime build independently and publish matching URLs together at the release tag', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'uxor-build-static-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const put = (path, contents) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), contents);
    };
    const read = (path) => readFileSync(join(root, path), 'utf8');
    const run = (file, args) => spawnSync(file, args, {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, FIXTURE: root, PHP: join(root, 'php'), COMPOSER_BIN: join(root, 'composer') },
    });
    const success = (result) => assert.equal(result.status, 0, result.stdout + result.stderr);
    const build = (out, ...flags) => run('bash', ['tools/build-static.sh', out, '--base-path=/project', '--release-from-tags', '--branch=main', ...flags]);

    mkdirSync(join(root, 'tools'));
    for (const name of ['build-static.sh', 'fence-coverage.mjs']) copyFileSync(join(tools, name), join(root, 'tools', name));
    put('button/README.md', '# Button\n\n```twig {"preview":true}\n<button>OK</button>\n```\n');
    put('button/manifest.json', '{}');
    put('composer', `#!/bin/sh
set -eu
echo "$*" >> "$FIXTURE/composer-calls"
case "$*" in *--working-dir=*) test -d "$FIXTURE/website";; *) test "$PWD" = "$FIXTURE/demo";; esac
`);
    put('php', `#!/usr/bin/env bash
set -eu
echo "$*" >> "$FIXTURE/php-calls"
case "$1" in
    */website/bin/build) exec bash "$@" ;;
    */tools/sync-demo) test -d "$FIXTURE/demo" ;;
    bin/console) exec bash "$@" ;;
    *) exit 1 ;;
esac
`);
    for (const bin of ['php', 'composer']) chmodSync(join(root, bin), 0o755);
    put('website/bin/build', `set -eu
dir=$1
mkdir -p "$dir/r/button" "$dir/website-assets"
echo '<link rel="stylesheet" href="/project/website-assets/site.css"><a href="/project/r/button/">Button</a><a href="demo/signup/?from=docs#form">Sign up</a>' > "$dir/index.html"
base=/project
if [ -f "$FIXTURE/bad-frame" ]; then base=; fi
for theme in light dark; do
    echo "<iframe src=\\"$base/preview/button/default/$theme/\\"></iframe>"
done > "$dir/r/button/index.html"
echo '# Button' > "$dir/r/button.md"
cat > "$dir/sitemap.xml" <<'XML'
<urlset>
<url><loc>https://example.com/project/</loc></url>
<url><loc>https://example.com/project/r/button/</loc></url>
</urlset>
XML
echo '[Button](https://example.com/project/r/button.md)' > "$dir/llms.txt"
echo 'website CSS' > "$dir/website-assets/site.css"
if [ -f "$FIXTURE/retired-guide" ]; then mkdir "$dir/retired"; echo guide > "$dir/retired/index.html"; echo '# Retired' > "$dir/retired.md"; fi
if [ -f "$FIXTURE/leak" ]; then mkdir "$dir/assets"; fi
`);
    success(run('git', ['init', '-q', '--initial-branch=main']));
    success(run('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'release']));
    success(run('git', ['tag', '1.2.3']));

    put('retired-guide', '');
    put('out/notes.txt', 'unrelated output');
    success(build('out', '--website-only'));
    assert.doesNotMatch(read('php-calls') + read('composer-calls'), /sync-demo|bin\/console|tailwind/);
    assert.match(read('php-calls'), /--release=1\.2\.3 .*--latest-release=1\.2\.3/);
    assert.equal(existsSync(join(root, 'out/retired/index.html')), true);
    assert.equal(existsSync(join(root, 'out/preview')), false);

    put('bad-frame', '');
    const invalid = build('out', '--website-only');
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /missing preview iframe/);
    assert.match(read('out/r/button/index.html'), /\/project\/preview\//);
    rmSync(join(root, 'bad-frame'));

    put('leak', '');
    const collision = build('out', '--website-only');
    assert.notEqual(collision.status, 0);
    assert.match(collision.stderr, /website wrote into a runtime export path/);
    rmSync(join(root, 'leak'));
    rmSync(join(root, 'retired-guide'));

    put('demo/config/packages/symfonycasts_tailwind.yaml', '    binary_version: v4.3.5\n');
    put('demo/bin/console', `set -eu
if [ "$1" != app:export-static ]; then exit 0; fi
dir=$2
mkdir -p "$dir/assets" "$dir/demo/not-found"
echo '{}' > "$dir/assets/manifest.json"
echo '<a href="/project/">Back to the gallery</a><a href="/project/demo/signup/">Sign up</a>' > "$dir/demo/index.html"
cp "$dir/demo/index.html" "$dir/demo/not-found/index.html"
if [ ! -f "$FIXTURE/missing-signup" ]; then mkdir "$dir/demo/signup"; echo form > "$dir/demo/signup/index.html"; fi
for theme in light dark; do
    mkdir -p "$dir/preview/button/default/$theme"
    echo "$theme button" > "$dir/preview/button/default/$theme/index.html"
    if [ "$theme" = light ]; then echo '<meta name="robots" content="noindex">' >> "$dir/preview/button/default/$theme/index.html"; fi
done
`);
    put('missing-signup', '');
    const missingDemo = build('out');
    assert.notEqual(missingDemo.status, 0);
    assert.match(missingDemo.stderr, /site\/index\.html: demo link "demo\/signup\//);
    assert.match(missingDemo.stderr, /site\/demo\/index\.html: demo link "\/project\/demo\/signup\//);
    rmSync(join(root, 'missing-signup'));
    success(build('out'));
    assert.equal(read('out/notes.txt'), 'unrelated output');
    assert.equal(existsSync(join(root, 'out/retired.md')), false);
    assert.equal(existsSync(join(root, 'out/retired')), false);
    assert.equal(read('out/website-assets/site.css'), 'website CSS\n');
    assert.match(read('out/demo/index.html'), /Back to the gallery/);
    assert.equal(read('out/preview/button/default/dark/index.html'), 'dark button\n');

    // A checkout with an older _site has no inventories. Preserve possible local additions
    // when replacing recognizable old output, while keeping unrelated files at their paths.
    for (const owner of ['website', 'runtime']) rmSync(join(root, 'out', `.uxor-output-${owner}`));
    put('out/r/button/local-notes.txt', 'mine');
    put('out/assets/custom.css', 'mine');
    success(build('out'));
    const backup = readdirSync(join(root, 'out')).find((name) => name.startsWith('.uxor-before-inventory.'));
    assert.ok(backup);
    assert.equal(read(`out/${backup}/r/button/local-notes.txt`), 'mine');
    assert.equal(read(`out/${backup}/assets/custom.css`), 'mine');
    assert.equal(read('out/notes.txt'), 'unrelated output');

    renameSync(join(root, 'website'), join(root, 'website-unavailable'));
    put('php-calls', '');
    success(build('out', '--runtime-only'));
    assert.doesNotMatch(read('php-calls'), /website\/bin\/build/);
    assert.equal(read('out/website-assets/site.css'), 'website CSS\n');

    put('unowned/assets/private.txt', 'keep');
    const occupied = build('unowned', '--runtime-only');
    assert.notEqual(occupied.status, 0);
    assert.match(occupied.stderr, /existing path is not owned/);
    assert.equal(read('unowned/assets/private.txt'), 'keep');
});
