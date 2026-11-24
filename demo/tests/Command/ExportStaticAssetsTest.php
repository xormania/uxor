<?php

namespace App\Tests\Command;

use App\Command\ExportStaticCommand;
use PHPUnit\Framework\TestCase;
use Symfony\Component\AssetMapper\ImportMap\ImportMapGenerator;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\ArrayInput;
use Symfony\Component\Console\Output\NullOutput;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\Filesystem\Filesystem;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Contracts\Service\ResetInterface;
use UXor\Kit\KitReader;

final class ExportStaticAssetsTest extends TestCase
{
    public function testAWarmBuildPublishesOnlyTheAssetsAndEntrypointsOfTheCurrentCompile(): void
    {
        $files = new Filesystem();
        $root = sys_get_temp_dir().'/uxor-export-'.bin2hex(random_bytes(8));
        $assets = $root.'/app/public/assets';
        $output = $root.'/output';
        try {
            $source = \dirname(__DIR__, 3);
            $files->copy($source.'/manifest.json', $root.'/kit/manifest.json');
            $files->copy($source.'/button/manifest.json', $root.'/kit/button/manifest.json');
            $files->dumpFile($assets.'/manifest.json', '{"styles/app.css":"/assets/styles/app-current.css"}');
            foreach (['styles/app-current.css', 'styles/retired-website.css', 'entrypoint.app.json', 'entrypoint.retired.json', 'importmap.json'] as $file) {
                $files->dumpFile($assets.'/'.$file, 'fixture');
            }
            $files->dumpFile($output.'/website-assets/site.css', 'website');
            $imports = self::createStub(ImportMapGenerator::class);
            $imports->method('getEntrypointNames')->willReturn(['app']);
            $kernel = self::createStub(HttpKernelInterface::class);
            $kernel->method('handle')->willReturn(new Response('<html><body></body></html>'));
            $export = new ExportStaticCommand(new KitReader($root.'/kit'), $imports, $kernel, self::createStub(ResetInterface::class), $root.'/app');

            self::assertSame(Command::SUCCESS, $export(new SymfonyStyle(new ArrayInput([]), new NullOutput()), $output));
            foreach (['styles/app-current.css', 'manifest.json', 'entrypoint.app.json', 'importmap.json'] as $file) {
                self::assertFileExists($output.'/assets/'.$file);
            }
            self::assertFileDoesNotExist($output.'/assets/styles/retired-website.css');
            self::assertFileDoesNotExist($output.'/assets/entrypoint.retired.json');
            self::assertSame('website', $files->readFile($output.'/website-assets/site.css'));
        } finally {
            $files->remove($root);
        }
    }
}
