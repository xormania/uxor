<?php

namespace App\Command;

use Symfony\Component\AssetMapper\AssetMapper;
use Symfony\Component\AssetMapper\ImportMap\ImportMapGenerator;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\Filesystem\Path;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\HttpKernel\TerminableInterface;
use Symfony\Contracts\Service\ResetInterface;
use UXor\Kit\KitReader;

/**
 * Renders the kit previews and visual example application with Symfony. The documentation
 * website links to these runtime exports and builds its own pages and assets separately.
 */
#[AsCommand('app:export-static', description: 'Export recipe previews, the visual demo and their compiled assets')]
final class ExportStaticCommand
{
    public function __construct(
        private readonly KitReader $kit,
        #[Autowire(service: 'asset_mapper.importmap.generator')]
        private readonly ImportMapGenerator $importMap,
        #[Autowire(service: 'http_kernel')]
        private readonly HttpKernelInterface $httpKernel,
        #[Autowire(service: 'services_resetter')]
        private readonly ResetInterface $servicesResetter,
        #[Autowire('%kernel.project_dir%')]
        private readonly string $projectDir,
    ) {
    }

    public function __invoke(
        SymfonyStyle $io,
        #[Argument(description: 'Output directory for preview/, demo/ and assets/')]
        string $dir,
        #[Option(description: 'The path the site is served under, e.g. /uxor')]
        string $basePath = '',
    ): int {
        $basePath = rtrim($basePath, '/');
        if ('' !== $basePath && !preg_match('#^(/[A-Za-z0-9._-]+)+$#', $basePath)) {
            $io->error(\sprintf('The base path "%s" is not a URL path like "/uxor".', $basePath));

            return Command::INVALID;
        }

        $assets = $this->projectDir.'/public/assets';
        if (!is_file($assets.'/manifest.json')) {
            $io->error('No compiled assets: run "bin/console tailwind:build" and "bin/console asset-map:compile" first.');

            return Command::FAILURE;
        }

        $filesystem = new Filesystem();
        $dir = Path::makeAbsolute($dir, getcwd());
        if (Path::isBasePath($dir, $this->projectDir)) {
            $io->error('Choose a dedicated directory for the runtime export.');

            return Command::INVALID;
        }
        // The build wrapper stages these three trees before replacing an earlier export.
        foreach (['assets', 'demo', 'preview'] as $name) {
            if (file_exists($dir.'/'.$name) || is_link($dir.'/'.$name)) {
                $io->error(\sprintf('The runtime export path %s already exists. Choose an empty staging directory.', $dir.'/'.$name));

                return Command::INVALID;
            }
        }
        // AssetMapper retains old fingerprinted assets on a warm build. Publish only the files
        // named by this compile, so removed styles and scripts cannot reappear in a release.
        $manifest = json_decode($filesystem->readFile($assets.'/'.AssetMapper::MANIFEST_FILE_NAME), true, flags: \JSON_THROW_ON_ERROR);
        foreach ($manifest as $path) {
            if (!str_starts_with($path, '/assets/') || !Path::isBasePath('/assets', $path)) {
                throw new \UnexpectedValueException(\sprintf('Compiled asset lies outside /assets/: %s.', $path));
            }
            $filesystem->copy($this->projectDir.'/public'.$path, $dir.$path);
        }
        $metadata = [AssetMapper::MANIFEST_FILE_NAME, ImportMapGenerator::IMPORT_MAP_CACHE_FILENAME];
        foreach ($this->importMap->getEntrypointNames() as $entrypoint) {
            $metadata[] = \sprintf(ImportMapGenerator::ENTRYPOINT_CACHE_FILENAME_PATTERN, $entrypoint);
        }
        foreach ($metadata as $file) {
            $filesystem->copy($assets.'/'.$file, $dir.'/assets/'.$file);
        }

        $pages = 0;
        foreach ($this->getPaths() as $path => $file) {
            $html = $this->render($basePath, $path);
            $filesystem->dumpFile($dir.'/'.$file, $html);
            ++$pages;
        }
        $io->success(\sprintf('%d pages and the compiled assets written to %s.', $pages, $dir));

        return Command::SUCCESS;
    }

    /**
     * @return iterable<string, string> each path to request, and the file to save it as
     */
    private function getPaths(): iterable
    {
        foreach ($this->kit->getRecipes() as $recipe) {
            foreach ($this->kit->getExamples($recipe) as $example) {
                foreach (['light', 'dark'] as $theme) {
                    $preview = \sprintf('preview/%s/%s', $recipe->name, $example['id']);
                    yield '/'.$preview.'?theme='.$theme => $preview.'/'.$theme.'/index.html';
                }
            }
        }
        foreach (['', '/login', '/signup', '/forgot-password', '/settings/profile', '/settings/notifications', '/settings/billing', '/blank', '/not-found'] as $page) {
            yield '/demo'.$page => 'demo'.$page.'/index.html';
        }
    }

    private function render(string $basePath, string $path): string
    {
        $request = Request::create($basePath.$path, 'GET', server: [
            'SCRIPT_NAME' => $basePath.'/index.php',
            'SCRIPT_FILENAME' => $this->projectDir.'/public/index.php',
        ]);
        $request->attributes->set('_static_export', true);

        $response = $this->httpKernel->handle($request);
        if ($this->httpKernel instanceof TerminableInterface) {
            $this->httpKernel->terminate($request, $response);
        }
        $this->servicesResetter->reset();

        $status = $response->getStatusCode();
        if (200 !== $status && !('/demo/not-found' === $path && 404 === $status)) {
            throw new \RuntimeException(\sprintf('%s answered %d.', $path, $status));
        }

        return self::rewrite((string) $response->getContent(), $basePath, $path);
    }

    /**
     * A page as the static copy saves it: its preview links per theme, without Live's controller, its asset URLs under
     * the base path, and on a /demo page the notice that its forms do not submit.
     */
    public static function rewrite(string $html, string $basePath, string $path): string
    {
        // A file cannot depend on the query string: the previews are saved per theme, in their own directory. A
        // preview's own links (a table's sort and page links) carry more parameters after the theme: they follow it.
        $html = self::checked(preg_replace_callback(
            '#(/preview/[a-z0-9-]+/[a-z0-9-]+)\?theme=(light|dark)(?:(?:&amp;|&)([^"\'\s<>]*))?#',
            static fn (array $match): string => $match[1].'/'.$match[2].'/'.(isset($match[3]) && '' !== $match[3] ? '?'.$match[3] : ''),
            $html,
        ), 'rewrite the preview links', $path);

        // A preview's own forms (a table's search) point at the preview without its theme, sent as a field instead:
        // on this page, they submit to the page's own directory
        if (1 === preg_match('#^(/preview/[a-z0-9-]+/[a-z0-9-]+)\?theme=(light|dark)$#', $path, $preview)) {
            $html = str_replace(
                'action="'.$basePath.$preview[1].'"',
                'action="'.$basePath.$preview[1].'/'.$preview[2].'/"',
                $html,
            );
        }

        // No server answers Live Components here: without their controller, a click does nothing instead of opening
        // Live's error dialog (the recipe page says what needs the server)
        $html = self::checked(preg_replace_callback(
            '#\bdata-controller="([^"]*)"#',
            static fn (array $match): string => 'data-controller="'.trim(self::checked(preg_replace('#(?:^|\s)live(?=\s|$)#', ' ', $match[1]), "remove Live's controller", $path)).'"',
            $html,
        ), "remove Live's controller", $path);

        // AssetMapper prints absolute /assets/ URLs, which no base path changes (the compiled JS and CSS refer to each
        // other relatively or through the importmap): the links, preloads and the importmap need the base path.
        $html = self::checked(preg_replace('#(["\'])/assets/#', '$1'.$basePath.'/assets/', $html), 'prefix the asset URLs', $path);

        // The /demo pages come from the kit's layouts, which know nothing of this copy: say it there too.
        if (str_starts_with($path, '/demo')) {
            $html = self::addDemoNotice($html, $basePath, $path);
        }

        return $html;
    }

    /**
     * A /demo page of the static copy, with the notice that its forms do not submit: at the top of the page, or with
     * the app layout, at the top of the column beside the sidebar, which sticks as tall as the window (above it, the
     * notice would push the sidebar's bottom out of the window).
     */
    public static function addDemoNotice(string $html, string $basePath, string $path = '/demo'): string
    {
        $notice = \sprintf('<div class="border-b border-default bg-neutral-secondary-medium px-4 py-2 text-center text-sm text-body">A static copy of the demo application: its forms do not submit. <a href="%s/" class="underline hover:text-heading">Back to the gallery</a></div>', $basePath);

        if (str_contains($html, '<main id="main"')) {
            return self::checked(preg_replace('#<main id="main"#', $notice.'$0', $html, 1), 'add the demo notice', $path);
        }

        return self::checked(preg_replace('#<body\b[^>]*>#', '$0'.$notice, $html, 1), 'add the demo notice', $path);
    }

    /**
     * The result of a preg_replace*() call: PCRE gives null on an error (its backtrack limit on a large page, invalid
     * UTF-8), which would save an empty page or one left unrewritten, so the export fails naming the step instead.
     */
    private static function checked(?string $result, string $step, string $path): string
    {
        return $result ?? throw new \RuntimeException(\sprintf('The static export could not %s on %s: %s.', $step, $path, preg_last_error_msg()));
    }
}
