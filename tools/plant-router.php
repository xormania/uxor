<?php

// Serve public files directly and send Symfony routes (including AssetMapper's versioned URLs) to the demo.
$public = $_SERVER['DOCUMENT_ROOT'];
$path = realpath($public.rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH)));
if (false !== $path && str_starts_with($path, $public.'/') && is_file($path)) {
    return false;
}

$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = $public.'/index.php';
require $_SERVER['SCRIPT_FILENAME'];
