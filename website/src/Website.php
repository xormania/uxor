<?php

declare(strict_types=1);

namespace UXor\Website;

use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\Filesystem\Path;
use Symfony\Component\Routing\Generator\UrlGenerator;
use Symfony\Component\Routing\RequestContext;
use Symfony\Component\Routing\Route;
use Symfony\Component\Routing\RouteCollection;
use Symfony\UX\Toolkit\Dependency\ImportmapPackageDependency;
use Symfony\UX\Toolkit\Dependency\PhpPackageDependency;
use Symfony\UX\Toolkit\Dependency\RecipeDependency;
use Symfony\UX\Toolkit\Recipe\Recipe;
use Twig\Environment;
use Twig\Loader\FilesystemLoader;
use Twig\TwigFunction;
use Twig\TwigTest;
use UXor\Kit\KitReader;

final class Website
{
    private const SERVER_ONLY = [
        'oauth' => 'provider sign-in, callbacks and account connections require Symfony and configured provider applications; the static examples show the presentation only',
        'social-login' => 'provider sign-in requires the application server; the static examples show the login and registration cards',
        'connected-accounts' => 'connecting and disconnecting accounts requires authenticated server requests; the static examples use disabled actions',
        'data-table' => 'the search, the sort links and the pages ask the server for the rows, so they do not change them',
        'data-table-live' => 'the table is a Live Component: its search, sorting, pages and selection run on the server, so they do nothing',
        'markdown-editor' => 'the Preview tab is rendered on the server by a Live Component, so it stays empty; the Write tab and its toolbar work',
    ];

    private readonly KitReader $kit;
    private readonly RecipeDocs $docs;
    private readonly GuideDocs $guides;
    private readonly Environment $twig;
    private readonly string $ref;

    public function __construct(
        private readonly string $sourceRoot,
        string $basePath,
        private readonly string $siteUrl,
        ?string $release = null,
        string $branch = 'main',
        ?string $commit = null,
        ?string $latestRelease = null,
    ) {
        if ('' !== $basePath && !preg_match('#^(?:/[a-zA-Z0-9_-][a-zA-Z0-9._-]*)+$#D', $basePath)) {
            throw new \InvalidArgumentException('Use a base path such as /uxor, or omit it for the root.');
        }
        if (!filter_var($siteUrl, FILTER_VALIDATE_URL) || !in_array(parse_url($siteUrl, PHP_URL_SCHEME), ['http', 'https'], true)
            || null !== parse_url($siteUrl, PHP_URL_QUERY) || null !== parse_url($siteUrl, PHP_URL_FRAGMENT)) {
            throw new \InvalidArgumentException('The public site URL must be an absolute HTTP(S) URL without a query or fragment.');
        }
        $this->kit = new KitReader($sourceRoot);
        $routes = new RouteCollection();
        foreach ([
            'app_index' => '/', 'app_recipe' => '/r/{recipe}/', 'app_recipe_markdown' => '/r/{recipe}.md',
            'app_guide' => '/{name}/', 'app_guide_markdown' => '/{name}.md', 'app_preview' => '/preview/{recipe}/{example}',
            'app_demo' => '/demo/', 'app_demo_login' => '/demo/login/', 'app_demo_signup' => '/demo/signup/',
            'app_demo_forgot_password' => '/demo/forgot-password/', 'app_demo_settings_profile' => '/demo/settings/profile/',
            'app_demo_blank' => '/demo/blank/',
        ] as $name => $pattern) {
            $routes->add($name, new Route($pattern));
        }
        $urls = new UrlGenerator($routes, new RequestContext($basePath));
        $loader = new FilesystemLoader(__DIR__.'/../templates/pages');
        $loader->addPath(__DIR__.'/../templates/toolkit', 'UXToolkit');
        $this->twig = new Environment($loader, ['strict_variables' => true, 'autoescape' => 'name']);
        $this->twig->addExtension(new InlineMarkdownExtension());
        $this->twig->addFunction(new TwigFunction('path', $urls->generate(...)));
        $this->twig->addTest(new TwigTest('utf8', static fn (string $value): bool => mb_check_encoding($value, 'UTF-8')));
        $this->docs = new RecipeDocs($this->kit, $this->twig, $urls);
        $this->guides = new GuideDocs($sourceRoot, $this->docs, $urls);
        $this->ref = $release ?? $branch;
        $this->twig->addGlobal('kit', $this->kit->getKit());
        $this->twig->addGlobal('repository', $this->kit->getManifest()->homepage);
        $this->twig->addGlobal('guides', $this->guides->all());
        $this->twig->addGlobal('guide_sections', $this->guides->sections());
        $this->twig->addGlobal('ref', $this->ref);
        $this->twig->addGlobal('release', $release);
        $this->twig->addGlobal('latest_release', $latestRelease);
        $this->twig->addGlobal('branch', $branch);
        $this->twig->addGlobal('commit', $commit);
        $this->twig->addGlobal('base_path', $basePath);
    }

    public static function pagesUrl(string $repository, string $basePath): string
    {
        if (!preg_match('#^https://github\.com/([a-zA-Z0-9-]+)/#', $repository, $owner)) {
            throw new \InvalidArgumentException('Pass --site-url for a kit hosted outside GitHub.');
        }

        return 'https://'.strtolower($owner[1]).'.github.io'.$basePath;
    }

    public function build(string $output): void
    {
        $files = new Filesystem();
        $pages = [];
        $savePage = function (string $path, string $template, array $data) use ($output, $files, &$pages): void {
            $canonical = rtrim($this->siteUrl, '/').$path;
            $files->dumpFile($output.$path.'index.html', $this->twig->render($template, $data + ['canonical' => $canonical]));
            $pages[] = $canonical;
        };
        $recipes = $this->kit->getRecipes();
        $categories = RecipeCategories::fromSource($this->sourceRoot, $recipes);
        $counts = array_map(fn (Recipe $recipe): int => count($this->kit->getPreviewExamples($recipe)), $recipes);
        $savePage('/', 'index.html.twig', ['recipe_categories' => $categories, 'recipes' => $recipes, 'example_counts' => $counts]);
        foreach ($this->guides->all() as $slug => $guide) {
            $savePage('/'.$slug.'/', 'guide.html.twig', ['name' => $slug] + $this->guides->render($slug, $this->ref) + $guide);
            $files->dumpFile($output.'/'.$slug.'.md', $this->guides->markdown($slug, $this->ref));
        }
        foreach ($recipes as $recipe) {
            $savePage('/r/'.$recipe->name.'/', 'recipe.html.twig', [
                'recipe' => $recipe, 'doc' => $this->docs->page($recipe, $this->ref), 'recipe_categories' => $categories,
                'dependencies' => $this->dependencies($recipe), 'server_notice' => self::SERVER_ONLY[$recipe->name] ?? null,
            ]);
            $files->dumpFile($output.'/r/'.$recipe->name.'.md', $this->docs->markdown($recipe, $this->ref));
        }
        $xml = '<?xml version="1.0" encoding="UTF-8"?>'."\n".'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'."\n";
        foreach ($pages as $canonical) {
            $xml .= '  <url><loc>'.htmlspecialchars($canonical, \ENT_XML1).'</loc></url>'."\n";
        }
        $files->dumpFile($output.'/sitemap.xml', $xml."</urlset>\n");
        $files->dumpFile($output.'/llms.txt', $this->llms(rtrim($this->siteUrl, '/')));
        $files->dumpFile($output.'/404.html', $this->twig->render('404.html.twig', ['canonical' => null]));
        $files->mirror(__DIR__.'/../assets', $output.'/website-assets', options: ['override' => true]);
    }

    /** @return array{recipes: list<RecipeDependency>, composer: list<PhpPackageDependency>, importmap: list<ImportmapPackageDependency>} */
    private function dependencies(Recipe $recipe): array
    {
        $dependencies = ['recipes' => [], 'composer' => [], 'importmap' => []];
        foreach ($recipe->manifest->dependencies as $dependency) {
            $group = match (true) {
                $dependency instanceof RecipeDependency => 'recipes',
                $dependency instanceof PhpPackageDependency => 'composer',
                $dependency instanceof ImportmapPackageDependency => 'importmap',
                default => null,
            };
            if (null !== $group) {
                $dependencies[$group][] = $dependency;
            }
        }

        return $dependencies;
    }

    private function llms(string $site): string
    {
        $text = (string) preg_replace_callback(
            '#\]\('.preg_quote(str_replace('https://github.com/', 'https://raw.githubusercontent.com/', $this->kit->getManifest()->homepage), '#').'/[^/)]+/([^)\s]+)\)#',
            function (array $match) use ($site): string {
                if (null !== $recipe = $this->docs->readmeRecipe($match[1])) {
                    return ']('.$site.'/r/'.$recipe.'.md)';
                }

                $slug = $this->guides->slugForFile($match[1]);
                return null !== $slug ? ']('.$site.'/'.$slug.'.md)' : $match[0];
            },
            (new Filesystem())->readFile(Path::join($this->sourceRoot, 'llms.txt')),
        );

        // A branch can build against the last release's frozen index while its gallery already serves new guides.
        $additional = [];
        foreach ($this->guides->all() as $slug => $guide) {
            $target = '('.$site.'/'.$slug.'.md)';
            if (!str_contains($text, ']'.$target)) {
                $additional[] = '- ['.$guide['title'].']'.$target.': '.$guide['description'];
            }
        }
        if ([] !== $additional) {
            $text = rtrim($text)."\n\n## More guides in this gallery\n\n".implode("\n", $additional)."\n";
        }

        return $text;
    }
}
