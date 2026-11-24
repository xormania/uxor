<?php

namespace UXor\Website\Tests;

use PHPUnit\Framework\TestCase;
use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\Finder\Finder;
use UXor\Kit\KitReader;
use UXor\Website\Website;

require_once dirname(__DIR__).'/vendor/autoload.php';

abstract class WebsiteTestCase extends TestCase
{
    protected const SITE = 'https://xormania.github.io/uxor';
    protected const RELEASE = '0.4.0';
    private static ?string $work = null;

    /** Exercise publishing with the real recipes and independently authored guide content. */
    protected static function source(): string
    {
        if (null !== self::$work) {
            return self::$work.'/source';
        }
        $repository = dirname(__DIR__, 2);
        $fs = new Filesystem();
        self::$work = sys_get_temp_dir().'/uxor-website-'.bin2hex(random_bytes(8));
        $temporary = self::$work;
        register_shutdown_function(static fn () => $fs->remove($temporary));
        $root = $temporary.'/source';
        $fs->mkdir($root);
        foreach (['manifest.json', 'INSTALL.md', 'docs/GUIDE.md'] as $file) {
            $fs->copy($repository.'/'.$file, $root.'/'.$file);
        }
        foreach (glob($repository.'/*/manifest.json') as $manifest) {
            $recipe = dirname($manifest);
            $fs->mirror($recipe, $root.'/'.basename($recipe), (new Finder())->in($recipe)->exclude('tests'));
        }
        $fs->dumpFile($root.'/duplicate-snippets/manifest.json', '{"type":"component","name":"Duplicate snippets"}');
        $fs->copy(__DIR__.'/fixtures/duplicate-snippets.md', $root.'/duplicate-snippets/README.md');
        $guides = [
            'composer' => ['file' => 'handbook/nested/start.md', 'title' => 'First steps', 'description' => 'Get started in an application.'],
            'advanced' => ['file' => 'handbook/nested/detail.md', 'title' => 'Further reading & FAQs', 'description' => 'Compare "debug" output for <draft> & release builds.'],
            'install' => ['file' => 'INSTALL.md', 'title' => 'Getting started', 'description' => 'Set up a kit.'],
            'guide' => ['file' => 'docs/GUIDE.md', 'title' => 'Guide', 'description' => 'Install and update recipes.'],
        ];
        $fs->dumpFile($root.'/packages/uxor/resources/guides.json', json_encode($guides, JSON_THROW_ON_ERROR));
        $fs->dumpFile($root.'/handbook/nested/start.md', "# First steps\n\nRead [Details](detail.md#local-tools) and [Install](../../INSTALL.md).\n\n[Offline install guide](../../packages/uxor/resources/uxor/docs/INSTALL.md).\n");
        $fs->dumpFile($root.'/handbook/nested/detail.md', "# Further reading\n\n## Local tools\n\nSee [First steps](start.md).\n");
        // A frozen release index predates the two nested guides. The current site's index must still include them.
        $raw = 'https://raw.githubusercontent.com/xormania/uxor/0.3.0/';
        $llms = "# UXor\n\n[Installation](".$raw."INSTALL.md)\n[Guide](".$raw."docs/GUIDE.md)\n";
        foreach (glob($root.'/*/manifest.json') as $file) {
            $name = basename(dirname($file));
            $llms .= '['.$name.']('.$raw.$name."/README.md)\n";
        }
        $fs->dumpFile($root.'/llms.txt', $llms);

        // Exercise a Windows checkout through the actual Markdown renderer and the runtime's preview catalog.
        $readme = $root.'/duplicate-snippets/README.md';
        $fs->dumpFile($readme, preg_replace('/\r?\n/', "\r\n", $fs->readFile($readme)));

        return $root;
    }

    protected static function kit(): KitReader
    {
        static $kit;

        return $kit ??= new KitReader(self::source());
    }

    protected static function page(string $file, ?string $release = self::RELEASE, string $branch = 'main'): string
    {
        static $built = [];
        $source = self::source();
        $key = ($release ?? 'branch').'-'.$branch;
        $output = self::$work.'/'.$key;
        if (!isset($built[$key])) {
            (new Website($source, '/uxor', self::SITE, $release, $branch, 'abc1234def', '0.3.0'))->build($output);
            $built[$key] = true;
        }
        self::assertFileExists($output.'/'.$file);
        $content = file_get_contents($output.'/'.$file);
        self::assertIsString($content);

        return $content;
    }

    protected static function recipeHtml(string $name): string
    {
        return self::page('r/'.$name.'/index.html');
    }
}
