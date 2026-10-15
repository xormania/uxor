#!/usr/bin/env php
<?php

/** Real Toolkit API coverage; fixtures contain selected recipe files only, never vendor or the whole checkout. */

function verify(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

/** @return array{int, string} */
function runPlan(string $script, string $autoload, string $repository, string $output): array
{
    $process = proc_open([PHP_BINARY, $script, $autoload, $repository, $output], [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['redirect', 1]], $pipes);
    verify(is_resource($process), 'Cannot execute the Toolkit adapter');
    fclose($pipes[0]);
    $log = stream_get_contents($pipes[1]);
    fclose($pipes[1]);

    return [proc_close($process), $log];
}

function jsonFile(string $path): array
{
    return json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
}

function putJson(string $path, array $data): void
{
    file_put_contents($path, json_encode($data, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n");
}

function copyFileInto(string $source, string $target): void
{
    if (!is_dir(dirname($target))) {
        mkdir(dirname($target), 0700, true);
    }
    verify(copy($source, $target), 'Could not copy test source: '.$source);
}

$work = sys_get_temp_dir().'/uxor-toolkit-plan-'.bin2hex(random_bytes(8));
mkdir($work, 0700);
try {
    verify(3 === $argc, 'Usage: php tools/tests/package-toolkit-plan.php TOOLKIT_AUTOLOAD REPOSITORY');
    $autoload = realpath($argv[1]);
    $repository = realpath($argv[2]);
    verify(false !== $autoload && false !== $repository, 'Autoloader and repository must exist');
    $script = dirname(__DIR__).'/package-toolkit-plan.php';
    [$status, $log] = runPlan($script, $autoload, $repository, $work.'/baseline.json');
    verify(0 === $status, 'Actual Toolkit could not resolve repository: '.$log);
    $baseline = jsonFile($work.'/baseline.json');
    verify(1 === $baseline['format'] && ['data-table', 'theme'] === $baseline['roots'], 'Package roots or format changed');
    verify('3.5.1' === ltrim($baseline['toolkit']['version'], 'v') && '' !== $baseline['toolkit']['reference'], 'Actual installed Toolkit identity was not recorded');
    $names = array_column($baseline['recipes'], 'name');
    foreach (['data-table', 'table', 'pagination', 'button', 'turbo', 'theme'] as $name) {
        verify(in_array($name, $names, true), 'Toolkit dependency closure omitted '.$name);
    }
    verify(in_array(['owner' => 'kit', 'type' => 'importmap', 'requirement' => 'flowbite/dist/flowbite.min.css@^4.0.2'], $baseline['requirements'], true), 'Kit-global importmap requirement was lost');
    foreach ($baseline['files'] as $file) {
        verify(hash_file('sha256', $repository.'/'.$file['source']) === $file['sha256'], 'Source content identity is incorrect');
    }
    [$status, $log] = runPlan($script, $autoload, $repository, $work.'/repeat.json');
    verify(0 === $status && file_get_contents($work.'/baseline.json') === file_get_contents($work.'/repeat.json'), 'Unchanged sources did not produce an identical plan: '.$log);
    [$status, $log] = runPlan($script, $autoload, $repository, $work.'/baseline.json');
    verify(0 !== $status && str_contains($log, 'never overwrites'), 'Existing output was not protected');

    $fixture = $work.'/kit';
    copyFileInto($repository.'/manifest.json', $fixture.'/manifest.json');
    foreach ($baseline['recipes'] as $recipe) {
        copyFileInto($repository.'/'.$recipe['manifest']['path'], $fixture.'/'.$recipe['manifest']['path']);
    }
    foreach ($baseline['files'] as $file) {
        copyFileInto($repository.'/'.$file['source'], $fixture.'/'.$file['source']);
    }
    $table = jsonFile($fixture.'/data-table/manifest.json');
    $table['dependencies']['recipe'][] = 'fixture-mapped';
    putJson($fixture.'/data-table/manifest.json', $table);
    mkdir($fixture.'/fixture-mapped/resources', 0700, true);
    putJson($fixture.'/fixture-mapped/manifest.json', [
        'type' => 'component', 'name' => 'FixtureMapped',
        'copy-files' => ['resources/' => 'assets/generated/'],
        'dependencies' => ['composer' => ['symfony/ux-twig-component:^99.0']],
    ]);
    file_put_contents($fixture.'/fixture-mapped/resources/helper.js', "export const fixture = true;\n");
    [$status, $log] = runPlan($script, $autoload, $fixture, $work.'/changed.json');
    verify(0 === $status, 'Toolkit rejected a new declared transitive recipe: '.$log);
    $changed = jsonFile($work.'/changed.json');
    verify(in_array('fixture-mapped', array_column($changed['recipes'], 'name'), true), 'New transitive recipe was omitted');
    $mapped = array_values(array_filter($changed['files'], static fn (array $file): bool => 'fixture-mapped' === $file['recipe']));
    verify(1 === count($mapped) && 'fixture-mapped/resources/helper.js' === $mapped[0]['source'] && 'assets/generated/helper.js' === $mapped[0]['destination'], 'Toolkit copy-files destination mapping was ignored');
    verify(in_array(['owner' => 'recipe:fixture-mapped', 'type' => 'composer', 'requirement' => 'symfony/ux-twig-component:^99.0'], $changed['requirements'], true), 'Conflicting new requirement lost its owner');
    verify(in_array(['owner' => 'recipe:data-table', 'type' => 'composer', 'requirement' => 'symfony/ux-twig-component:^3.5'], $changed['requirements'], true), 'Conflict was silently resolved by dropping an existing constraint');
    verify($baseline['source']['sha256'] !== $changed['source']['sha256'], 'Changed declarations/files did not change source identity');
    file_put_contents($fixture.'/fixture-mapped/resources/helper.js', "export const fixture = false;\n");
    [$status, $log] = runPlan($script, $autoload, $fixture, $work.'/content-change.json');
    verify(0 === $status && $changed['source']['sha256'] !== jsonFile($work.'/content-change.json')['source']['sha256'], 'Uncommitted file content was not reflected in identity: '.$log);
    file_put_contents($fixture.'/fixture-mapped/resources/added.js', "export const added = true;\n");
    [$status, $log] = runPlan($script, $autoload, $fixture, $work.'/added-file.json');
    verify(0 === $status, 'Adding a mapped file failed: '.$log);
    $added = jsonFile($work.'/added-file.json');
    $addedRecipe = array_values(array_filter($added['recipes'], static fn (array $recipe): bool => 'fixture-mapped' === $recipe['name']))[0];
    verify(in_array('resources/added.js', $addedRecipe['inventory'], true), 'Recipe inventory omitted a newly added file');
    verify(jsonFile($work.'/content-change.json')['source']['sha256'] !== $added['source']['sha256'], 'New file membership did not change source identity');
    symlink($fixture.'/fixture-mapped/resources/added.js', $fixture.'/fixture-mapped/resources/linked.js');
    [$status, $log] = runPlan($script, $autoload, $fixture, $work.'/symlink.json');
    verify(0 !== $status && str_contains($log, 'must not be symlinks') && !file_exists($work.'/symlink.json'), 'Symlinked recipe file was accepted');
    unlink($fixture.'/fixture-mapped/resources/linked.js');

    $table['dependencies']['recipe'][] = 'missing-fixture';
    putJson($fixture.'/data-table/manifest.json', $table);
    [$status, $log] = runPlan($script, $autoload, $fixture, $work.'/missing.json');
    verify(0 !== $status && str_contains($log, 'unregistered Toolkit recipe "missing-fixture"') && !file_exists($work.'/missing.json'), 'Missing recipe did not stop plan creation');

    // Only the unsupported-version negative case substitutes Composer metadata. The successful cases above
    // load the actual installed Toolkit API and use its real parser, discovery and file mapping.
    file_put_contents($work.'/unsupported-autoload.php', <<<'PHP'
<?php
namespace Composer;
final class InstalledVersions {
    public static function isInstalled(string $package): bool { return true; }
    public static function getPrettyVersion(string $package): string { return 'v9.9.9'; }
    public static function getVersion(string $package): string { return '9.9.9.0'; }
}
PHP);
    [$status, $log] = runPlan($script, $work.'/unsupported-autoload.php', $repository, $work.'/unsupported.json');
    verify(0 !== $status && str_contains($log, 'Unsupported Toolkit version "v9.9.9"') && !file_exists($work.'/unsupported.json'), 'Unsupported Toolkit version was not rejected before using its internal API');
    echo "Toolkit package plan: real API closure, copy mappings, requirement provenance, content identity, determinism and rejection cases passed.\n";
} finally {
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($work, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($files as $file) {
        $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
    }
    rmdir($work);
}
