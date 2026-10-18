<?php

declare(strict_types=1);

namespace Xormania\UXor;

/** Static checks for the documented installation layout, never a runtime health verdict. */
final class ComponentWiring
{
    private const CONTROLLERS = [
        'modal' => 'flowbite_modal_controller.js', 'data-table' => 'data_table_controller.js',
        'editor' => 'editor_controller.js', 'dropzone' => 'dropzone_assist_controller.js',
    ];

    public function findings(array $project, array $component, string $profile): array
    {
        if (!in_array($profile, ['auto', 'assetmapper', 'custom'], true)) {
            throw new \InvalidArgumentException('Asset profile must be auto, assetmapper, or custom.');
        }
        $name = $component['name'];
        $reference = 'uxor://reference/'.$component['documentation'];
        $mapper = $project['packages']['symfony/asset-mapper'];
        $conventional = 'assetmapper' === $profile || ('auto' === $profile
            && (null !== $mapper['declared_in'] || null !== $mapper['installed_version'])
            && is_file($project['root'].'/importmap.php'));
        $result = [];
        $add = static function (string $check, string $subject, ?bool $passes, array $evidence, string $action) use (&$result, $reference): void {
            $result[] = ['check' => $check, 'subject' => $subject,
                'status' => null === $passes ? 'unknown' : ($passes ? 'pass' : 'fail'),
                'evidence' => $evidence + ['reference' => $reference, 'scope' => 'static documented installation layout'],
                'suggested_action' => true === $passes ? null : $action];
        };
        $root = $project['root'];
        $importmap = $conventional ? $this->read($root, 'importmap.php') : null;
        foreach ($component['manifest']['dependencies']['importmap'] ?? [] as $dependency) {
            $add('component_importmap', $dependency, null === $importmap ? null : $this->hasLiteralKey($importmap, $dependency),
                ['file' => 'importmap.php', 'profile' => $profile],
                'Complete the component manifest importmap requirements, or verify the equivalent custom asset pipeline.');
        }
        if (isset(self::CONTROLLERS[$name])) {
            $path = 'assets/controllers/'.self::CONTROLLERS[$name];
            $add('component_controller_file', $path, $conventional ? null !== $this->read($root, $path) : null,
                ['file' => $path, 'profile' => $profile],
                'Check the copied local Stimulus controller and its discovery path; use the custom profile for relocated or replaced application-owned behavior.');
        }
        if (in_array($name, ['editor', 'dropzone'], true)) {
            $filename = 'uxor-'.$name.'.css';
            $path = 'assets/styles/'.$filename;
            $css = $conventional ? $this->read($root, 'assets/styles/app.css') : null;
            $add('component_stylesheet_file', $path, $conventional ? null !== $this->read($root, $path) : null,
                ['file' => $path, 'profile' => $profile], 'Check the stylesheet copied by Toolkit or its customized application equivalent.');
            $css = null === $css ? null : preg_replace('~/\*.*?\*/~s', '', $css);
            $imported = null === $css ? null : 1 === preg_match('~@import\s+(?:url\(\s*)?[\'"](?:\./)?'.preg_quote($filename, '~').'[\'"]~', $css);
            $add('component_stylesheet_import', $filename, $imported, ['file' => 'assets/styles/app.css', 'profile' => $profile],
                'Import the component stylesheet after the kit stylesheet as its README describes, or verify its custom build entry point.');
        }
        if ('dropzone' === $name) {
            $controllers = $conventional ? $this->read($root, 'assets/controllers.json') : null;
            $config = null;
            if (null !== $controllers) {
                try {
                    $decoded = json_decode($controllers, true, 512, JSON_THROW_ON_ERROR);
                    $candidate = is_array($decoded) ? ($decoded['controllers']['@symfony/ux-dropzone']['dropzone'] ?? []) : [];
                    $config = is_array($candidate) ? $candidate : [];
                } catch (\JsonException) {
                    // Invalid configuration is an explicit failing static finding below.
                    $config = [];
                }
            }
            $add('component_controller_enabled', '@symfony/ux-dropzone/dropzone', null === $config ? null : true === ($config['enabled'] ?? null),
                ['file' => 'assets/controllers.json', 'profile' => $profile], 'Enable the native UX Dropzone controller in controllers.json as the README describes.');
            $autoimport = is_array($config['autoimport'] ?? null) ? $config['autoimport'] : [];
            $add('component_default_stylesheet_disabled', '@symfony/ux-dropzone/dist/style.min.css',
                null === $config ? null : array_key_exists('@symfony/ux-dropzone/dist/style.min.css', $autoimport)
                    && false === $autoimport['@symfony/ux-dropzone/dist/style.min.css'],
                ['file' => 'assets/controllers.json', 'profile' => $profile], 'Disable the upstream Dropzone stylesheet autoimport so the UXor replacement is used.');
            $add('component_importmap', '@symfony/ux-dropzone', null === $importmap ? null : $this->hasLiteralKey($importmap, '@symfony/ux-dropzone'),
                ['file' => 'importmap.php', 'profile' => $profile], 'Complete native UX Dropzone package/Flex setup and its importmap entry, or verify the custom pipeline.');
        }
        $add('component_runtime_verification', $name, null, ['application_executed' => false, 'profile' => $profile],
            'Verify actual controller connection, computed CSS and the requested Turbo/Live/browser journey. Static checks do not prove source provenance or runtime behavior.');
        return $result;
    }

    private function read(string $root, string $path): ?string
    {
        $file = realpath($root.'/'.$path);
        if (false === $file || !str_starts_with($file, $root.DIRECTORY_SEPARATOR) || !is_file($file)
            || !is_readable($file) || filesize($file) > 256 * 1024) {
            return null;
        }
        $value = file_get_contents($file);
        return false === $value ? null : $value;
    }

    private function hasLiteralKey(string $php, string $key): bool
    {
        $tokens = array_values(array_filter(token_get_all($php), static fn ($token): bool => !is_array($token)
            || !in_array($token[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)));
        foreach ($tokens as $position => $token) {
            if (is_array($token) && T_CONSTANT_ENCAPSED_STRING === $token[0]
                && trim($token[1], "\"'") === $key && is_array($tokens[$position + 1] ?? null)
                && T_DOUBLE_ARROW === $tokens[$position + 1][0]) {
                return true;
            }
        }
        return false;
    }
}
