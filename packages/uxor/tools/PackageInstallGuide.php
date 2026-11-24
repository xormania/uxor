<?php

declare(strict_types=1);

namespace Xormania\UXor\Tools;

/** Render the application install command from the same release metadata Composer resolves. */
final class PackageInstallGuide
{
    public static function render(string $markdown, array $package, array $lock, string $release): string
    {
        $start = '<!-- package-install:start -->';
        $end = '<!-- package-install:end -->';
        if (1 !== substr_count($markdown, $start) || 1 !== substr_count($markdown, $end) || strpos($markdown, $end) < strpos($markdown, $start)) {
            throw new \RuntimeException('The package README needs one ordered pair of package-install markers.');
        }

        $settings = [];
        if ('stable' !== ($package['minimum-stability'] ?? 'stable')) {
            $settings[] = 'composer config minimum-stability '.escapeshellarg($package['minimum-stability']);
        }
        if (true === ($package['prefer-stable'] ?? false)) {
            $settings[] = 'composer config prefer-stable true';
        }
        if ('composer-plugin' === ($package['type'] ?? null)) {
            $settings[] = 'composer config '.escapeshellarg('allow-plugins.'.$package['name']).' true';
        }
        foreach ($lock['packages'] as $dependency) {
            $name = $dependency['name'];
            if ('composer-plugin' === ($dependency['type'] ?? null) && true === ($package['config']['allow-plugins'][$name] ?? false)) {
                $settings[] = 'composer config '.escapeshellarg('allow-plugins.'.$name).' true';
            }
        }

        $requirements = 'Requires PHP `'.$package['require']['php'].'`';
        if (isset($package['require']['composer'])) {
            $requirements .= ' and Composer `'.$package['require']['composer'].'`';
        }
        $block = "\n\n".$requirements.".\n\n";
        if ([] !== $settings) {
            $block .= "For a fresh application or a noninteractive install, apply these project settings first.\n\n```sh\n"
                .implode("\n", $settings)."\n```\n\n";
        }
        $block .= "Install the development package.\n\n```sh\ncomposer require --dev ".escapeshellarg($package['name'].':^'.$release)."\n```\n\n";

        return substr($markdown, 0, strpos($markdown, $start) + strlen($start)).$block.substr($markdown, strpos($markdown, $end));
    }
}
