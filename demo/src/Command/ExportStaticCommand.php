<?php

namespace App\Command;

use App\Kit\KitReader;
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

/**
 * Saves the showcase as static pages, for GitHub Pages (.github/workflows/pages.yml): the index, every recipe page,
 * every README example in both themes, and the /demo application's pages. Each page goes through the kernel as a GET
 * request under the site's base path, so Symfony prints the links and asset URLs the site needs.
 *
 * Run `tailwind:build` and `asset-map:compile` first: the compiled assets are copied next to the pages. The /lab and
 * /forms pages need the server (Live Components, form submits) and are left out; the pages say so.
 */
#[AsCommand('app:export-static', description: 'Saves the showcase as static pages, for GitHub Pages')]
final class ExportStaticCommand
{
    /**
     * The recipes whose examples need Symfony behind them, with what does not work in the static copy: their recipe
     * page says so. Live Components are switched off on every saved page, so a click does nothing rather than open
     * Live's error dialog with the static host's answer.
     */
    private const SERVER_ONLY = [
        'data-table' => 'the search, the sort links and the pages ask the server for the rows, so they do not change them',
        'data-table-live' => 'the table is a Live Component: its search, sorting, pages and selection run on the server, so they do nothing',
        'markdown-editor' => 'the Preview tab is rendered on the server by a Live Component, so it stays empty; the Write tab and its toolbar work',
    ];

    public function __construct(
        private readonly KitReader $kit,
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
        #[Argument(description: 'The directory to write the site to (emptied first)')]
        string $dir,
        #[Option(description: 'The path the site is served under, e.g. /uxor')]
        string $basePath = '',
        #[Option(description: 'The release the site is built from, if it is one: the install commands then name it')]
        ?string $release = null,
        #[Option(description: 'The latest release, named when the site is built from another commit')]
        ?string $latestRelease = null,
        #[Option(description: 'The commit the site is built from')]
        ?string $commit = null,
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
        $filesystem->remove($dir);
        $filesystem->mirror($assets, $dir.'/assets');

        $context = ['release' => $release ?: null, 'latest_release' => $latestRelease ?: null, 'commit' => $commit ?: null, 'server_only' => self::SERVER_ONLY];
        $pages = 0;
        foreach ($this->getPaths() as $path => $file) {
            $html = $this->render($basePath, $path, $context);
            $filesystem->dumpFile($dir.'/'.$file, $html);
            ++$pages;
        }
        // GitHub Pages answers any missing path with 404.html
        $filesystem->dumpFile($dir.'/404.html', $this->render($basePath, '/demo/not-found', $context));

        $io->success(\sprintf('%d pages and the compiled assets written to %s.', $pages, $dir));

        return Command::SUCCESS;
    }

    /**
     * @return iterable<string, string> each path to request, and the file to save it as
     */
    private function getPaths(): iterable
    {
        yield '/' => 'index.html';
        foreach ($this->kit->getRecipes() as $recipe) {
            yield '/r/'.$recipe->name => 'r/'.$recipe->name.'/index.html';
            foreach ($this->kit->getExamples($recipe) as $example) {
                foreach (['light', 'dark'] as $theme) {
                    $preview = \sprintf('preview/%s/%s', $recipe->name, $example['id']);
                    yield '/'.$preview.'?theme='.$theme => $preview.'/'.$theme.'/index.html';
                }
            }
        }
        foreach (['', '/login', '/signup', '/forgot-password', '/settings/profile', '/settings/notifications', '/settings/billing', '/blank'] as $page) {
            yield '/demo'.$page => ltrim('demo'.$page.'/index.html', '/');
        }
    }

    /**
     * @param array{release: ?string, latest_release: ?string, commit: ?string, server_only: array<string, string>} $context
     */
    private function render(string $basePath, string $path, array $context): string
    {
        $request = Request::create($basePath.$path, 'GET', server: [
            'SCRIPT_NAME' => $basePath.'/index.php',
            'SCRIPT_FILENAME' => $this->projectDir.'/public/index.php',
        ]);
        $request->attributes->set('_static_export', $context);

        $response = $this->httpKernel->handle($request);
        if ($this->httpKernel instanceof TerminableInterface) {
            $this->httpKernel->terminate($request, $response);
        }
        $this->servicesResetter->reset();

        $status = $response->getStatusCode();
        if (200 !== $status && !('/demo/not-found' === $path && 404 === $status)) {
            throw new \RuntimeException(\sprintf('%s answered %d.', $path, $status));
        }

        $html = (string) $response->getContent();
        // A file cannot depend on the query string: the previews are saved per theme, in their own directory. A
        // preview's own links (a table's sort and page links) carry more parameters after the theme: they follow it.
        $html = preg_replace_callback(
            '#(/preview/[a-z0-9-]+/[a-z0-9-]+)\?theme=(light|dark)(?:(?:&amp;|&)([^"\'\s<>]*))?#',
            static fn (array $match): string => $match[1].'/'.$match[2].'/'.(isset($match[3]) && '' !== $match[3] ? '?'.$match[3] : ''),
            $html,
        );

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
        $html = preg_replace_callback(
            '#\bdata-controller="([^"]*)"#',
            static fn (array $match): string => 'data-controller="'.trim(preg_replace('#(?:^|\s)live(?=\s|$)#', ' ', $match[1]) ?? $match[1]).'"',
            $html,
        );

        // AssetMapper prints absolute /assets/ URLs, which no base path changes (the compiled JS and CSS refer to each
        // other relatively or through the importmap): the links, preloads and the importmap need the base path.
        $html = preg_replace('#(["\'])/assets/#', '$1'.$basePath.'/assets/', $html);

        // The /demo pages come from the kit's layouts, which know nothing of this copy: say it there too.
        if (str_starts_with($path, '/demo')) {
            $notice = \sprintf('<div class="border-b border-default bg-neutral-secondary-medium px-4 py-2 text-center text-sm text-body">A static copy of the demo application: its forms do not submit. <a href="%s/" class="underline hover:text-heading">Back to the gallery</a></div>', $basePath);
            $html = preg_replace('#<body\b[^>]*>#', '$0'.$notice, $html, 1);
        }

        return $html;
    }
}
