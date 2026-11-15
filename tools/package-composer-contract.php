#!/usr/bin/env php
<?php

/**
 * Validate the direct Composer contract of a generated package without solving or modifying it.
 *
 * Toolkit declarations use "name:constraint", or a bare name for "*". Only Composer declarations
 * participate; importmap/npm constraints have different semantics. No provide/replace, transitive
 * dependency, repository availability, platform installation or minimum-stability solving occurs.
 * Plain development branches use Composer's opaque branch sets; package branch aliases are not inferred.
 * Inline aliases, stability flags and commit references are rejected because VersionParser discards
 * policy/identity from those forms. Accepting their interval alone would claim a stronger proof than this
 * tool performs. A future adapter can support them with explicit semantics and tests.
 *
 * Usage: php tools/package-composer-contract.php AUTOLOAD < contract-input.json
 */

use Composer\InstalledVersions;
use Composer\Semver\Constraint\ConstraintInterface;
use Composer\Semver\Constraint\MultiConstraint;
use Composer\Semver\Intervals;
use Composer\Semver\VersionParser;

/** @return array<string, mixed> Deterministic evidence, or a diagnostic identifying the offending owners. */
function validatePackageComposerRequirements(array $requirements, array $package): array
{
    if (!class_exists(InstalledVersions::class) || !InstalledVersions::isInstalled('composer/semver')
        || !class_exists(VersionParser::class) || !class_exists(Intervals::class)) {
        throw new RuntimeException('The supplied autoloader must provide composer/semver.');
    }
    $version = InstalledVersions::getPrettyVersion('composer/semver');
    $reference = InstalledVersions::getReference('composer/semver');
    if ('3.5.1.0' !== InstalledVersions::getVersion('composer/semver')) {
        throw new RuntimeException(sprintf('Unsupported composer/semver version "%s"; this contract is tested with 3.5.1 only.', $version ?? 'unknown'));
    }
    if (null === $version || null === $reference || '' === $reference) {
        throw new RuntimeException('composer/semver must identify its exact version and source reference.');
    }

    $quote = static fn (string $value): string => json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    $validName = static function (string $name): bool {
        // Composer package names, plus its platform package families. Virtual vendor/package names are
        // syntactically valid, but still require a direct declaration: provider resolution belongs to Composer.
        return 1 === preg_match('{\A[a-z0-9]([_.-]?[a-z0-9]+)*/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*\z}', $name)
            || in_array($name, ['php', 'php-64bit', 'php-ipv6', 'php-zts', 'php-debug', 'hhvm', 'composer', 'composer-plugin-api', 'composer-runtime-api'], true)
            || 1 === preg_match('{\A(?:ext|lib)-[a-z0-9](?:[a-z0-9_.-]*[a-z0-9])?\z}', $name);
    };
    $parser = new VersionParser();
    $parse = static function (mixed $value, string $context) use ($parser, $quote): ConstraintInterface {
        if (!is_string($value) || '' === trim($value) || preg_match('/[\x00-\x1f\x7f]/', $value)) {
            throw new RuntimeException($context.' must contain a nonempty Composer constraint without control characters.');
        }
        if (strpbrk($value, '@#') || preg_match('/\s+as\s+/i', $value)) {
            throw new RuntimeException($context.' uses unsupported inline aliases, stability flags or references: '.$quote($value).'.');
        }
        try {
            return $parser->parseConstraints($value);
        } catch (UnexpectedValueException $error) {
            throw new RuntimeException($context.' has an invalid Composer constraint '.$quote($value).'.', 0, $error);
        }
    };
    $nonempty = static function (ConstraintInterface $constraint): bool {
        // haveIntersections($constraint, MatchAllConstraint) has an unconditional wildcard shortcut.
        // Inspect the complete set so an impossible emitted range cannot pass subset validation vacuously.
        $intervals = Intervals::get($constraint);

        return [] !== $intervals['numeric'] || $intervals['branches']['exclude'] || [] !== $intervals['branches']['names'];
    };

    if (!array_is_list($requirements)) {
        throw new RuntimeException('Requirements must be a list of owner/type/requirement records.');
    }
    foreach ($requirements as $entry) {
        if (!is_array($entry) || 3 !== count($entry)) {
            throw new RuntimeException('Every requirement must contain exactly owner, type and requirement strings.');
        }
        foreach (['owner', 'type', 'requirement'] as $key) {
            if (!isset($entry[$key]) || !is_string($entry[$key]) || '' === trim($entry[$key])
                || preg_match('/[\x00-\x1f\x7f]/', $entry[$key])) {
                throw new RuntimeException('Every requirement must contain nonempty owner, type and requirement strings without control characters.');
            }
        }
        if (trim($entry['owner']) !== $entry['owner'] || trim($entry['type']) !== $entry['type']) {
            throw new RuntimeException('Requirement owners and types must not contain surrounding whitespace.');
        }
    }
    usort($requirements, static fn (array $a, array $b): int => [$a['owner'], $a['type'], $a['requirement']] <=> [$b['owner'], $b['type'], $b['requirement']]);
    $groups = [];
    foreach ($requirements as $entry) {
        if ('composer' !== $entry['type']) {
            continue;
        }
        [$name, $constraint] = array_pad(explode(':', $entry['requirement'], 2), 2, '*');
        $context = 'Composer requirement from '.$quote($entry['owner']).' for '.$quote($name);
        if (!$validName($name)) {
            throw new RuntimeException($context.' has an invalid package name.');
        }
        $groups[$name][] = [
            'owner' => $entry['owner'], 'requirement' => $entry['requirement'], 'constraint' => $constraint,
            'parsed' => $parse($constraint, $context),
        ];
    }
    ksort($groups, SORT_STRING);

    if ([] !== $package && array_is_list($package)) {
        throw new RuntimeException('Generated composer.json must be an object.');
    }
    $declared = array_key_exists('require', $package) ? $package['require'] : [];
    if (!is_array($declared)) {
        throw new RuntimeException('Generated composer.json require must be an object mapping package names to constraints.');
    }
    ksort($declared, SORT_STRING);
    $parsedDeclarations = [];
    foreach ($declared as $name => $constraint) {
        if (!is_string($name) || !$validName($name)) {
            throw new RuntimeException('Generated composer.json require contains an invalid package name.');
        }
        $owners = isset($groups[$name]) ? ' (required by '.implode(', ', array_map(static fn (array $entry): string => $quote($entry['owner']), $groups[$name])).')' : '';
        $parsedDeclarations[$name] = $parse($constraint, 'Generated composer.json require '.$quote($name).$owners);
        if (!$nonempty($parsedDeclarations[$name])) {
            throw new RuntimeException('Generated composer.json require '.$quote($name).$owners.' permits no versions: '.$quote($constraint).'.');
        }
    }

    $dependencies = [];
    foreach ($groups as $name => $entries) {
        $origins = implode('; ', array_map(static fn (array $entry): string => $quote($entry['owner']).' requires '.$quote($entry['constraint']), $entries));
        $intersection = Intervals::compactConstraint(MultiConstraint::create(array_column($entries, 'parsed'), true));
        if (!$nonempty($intersection)) {
            throw new RuntimeException('Contradictory Composer requirements for '.$quote($name).': '.$origins.'.');
        }
        if (!array_key_exists($name, $parsedDeclarations)) {
            throw new RuntimeException('Generated composer.json is missing direct require '.$quote($name).': '.$origins.'. provide, replace and require-dev do not satisfy this direct contract.');
        }
        if (!Intervals::isSubsetOf($parsedDeclarations[$name], $intersection)) {
            throw new RuntimeException('Generated composer.json require '.$quote($name).' constraint '.$quote($declared[$name]).' is not a subset of every recipe requirement: '.$origins.'.');
        }
        $dependencies[] = [
            'name' => $name,
            'package_constraint' => $declared[$name],
            'required_intersection' => (string) $intersection,
            'requirements' => array_map(static fn (array $entry): array => [
                'owner' => $entry['owner'], 'requirement' => $entry['requirement'], 'constraint' => $entry['constraint'],
            ], $entries),
        ];
    }

    return [
        'format' => 1,
        'semver' => ['package' => 'composer/semver', 'version' => $version, 'reference' => $reference],
        'dependencies' => $dependencies,
    ];
}

// Requiring this file exposes the function without reading stdin or executing the command.
if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    try {
        if (2 !== $argc || !is_file($argv[1])) {
            throw new RuntimeException('Usage: php tools/package-composer-contract.php AUTOLOAD < contract-input.json');
        }
        require $argv[1];
        $json = stream_get_contents(STDIN);
        $shape = json_decode($json, flags: JSON_THROW_ON_ERROR);
        if (!$shape instanceof stdClass || !isset($shape->requirements, $shape->package)
            || !is_array($shape->requirements) || !$shape->package instanceof stdClass
            || (property_exists($shape->package, 'require') && !$shape->package->require instanceof stdClass)) {
            throw new RuntimeException('Input must contain a requirements list and a package object with an optional require object.');
        }
        $input = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        $report = validatePackageComposerRequirements($input['requirements'], $input['package']);
        fwrite(STDOUT, json_encode($report, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n");
    } catch (Throwable $error) {
        fwrite(STDERR, 'package-composer-contract: '.$error->getMessage()."\n");
        exit(1);
    }
}
