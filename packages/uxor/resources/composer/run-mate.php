<?php

declare(strict_types=1);

use Symfony\Component\Console\Input\ArgvInput;
use Xormania\UXor\Console\Application;

// Composer supplies the actual project autoloader. No project bin-dir proxy is executed by this hook.
require $argv[1];
exit((new Application())->run(new ArgvInput(['uxor', 'mate', ...array_slice($argv, 2)])));
