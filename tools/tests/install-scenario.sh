# shellcheck shell=bash disable=SC2154 # app_composer and app_dir: set by the script that sources this file
# What a fresh install of the kit does, the same on a Symfony skeleton (fresh-install.sh) and in a Symfony Docker
# project (docker-install.sh): README.md's install steps, the recipes it installs, and the app a user writes. Sourced by
# both from the app's directory; each one says how a command runs in its app, and keeps what differs: where the app
# and its PHP run, where the kit comes from, how the app is served and checked.
#
#   app <command> [args...]   runs a command in the app (on the host, or in its container)
#   app_console [args...]     runs the app's bin/console
#   app_composer              the Composer command there (word-split: `php composer.phar` is two words)
#   app_dir                   the app's directory there

# the recipes installed, in this order: a page block and its layouts, a form block, then each recipe with a PHP part or
# Composer packages of its own
install_recipes=(dashboard-home signup data-table data-table-live autocomplete date-picker chart dropzone editor markdown-editor)
toolkit_version="${UX_TOOLKIT_VERSION:-3.5.1}"

# README.md's install steps, command for command:
# - contrib recipes: tales-from-a-dev/twig-tailwind-extra (the `tailwind_classes` filter of every recipe) registers
#   its bundle through one
# - symfony/ux-twig-component as a regular dependency, with TwigBundle (its bundle needs it): required only through
#   `--dev symfony/ux-toolkit`, its symfony/property-access is dev-only, so FrameworkBundle leaves property_access
#   off while Flex enables TwigComponentBundle in every environment, and cache:clear fails ("non-existent service
#   property_accessor")
# - symfony/http-client with the toolkit, which downloads kits from GitHub with it
# - AssetMapper (the layouts' importmap entrypoint) and StimulusBundle (it loads the recipes' controllers)
require_kit_packages() {
    # shellcheck disable=SC2086 # app_composer may be several words
    {
        app $app_composer config extra.symfony.allow-contrib true
        app $app_composer require --no-interaction --no-progress symfony/twig-bundle "symfony/ux-twig-component:^3.5"
        app $app_composer require --no-interaction --no-progress --dev "symfony/ux-toolkit:$toolkit_version" symfony/http-client
        app $app_composer require --no-interaction --no-progress symfony/asset-mapper symfony/stimulus-bundle
    }
}

# `ux:install` of each recipe from <kit> (a kit name or a GitHub URL), its log in <logs>/install-<recipe>.log. The
# installer prints the Composer packages a recipe needs: each printed command runs through a shell, as a user pasting
# it would (a constraint such as `^7.4|^8.0` would pipe the line into another command), before the next recipe (a
# recipe's PHP in src/ can need its packages to boot the app, e.g. data-table-live's Live Component).
install_kit_recipes() {
    local kit="$1" logs="$2" recipe arguments
    for recipe in "${install_recipes[@]}"; do
        app_console ux:install "$recipe" --kit="$kit" --no-interaction > "$logs/install-$recipe.log" 2>&1 \
            || { cat "$logs/install-$recipe.log"; echo "FAIL: ux:install $recipe"; exit 1; }
        grep -h '^ *\$ composer require ' "$logs/install-$recipe.log" | sed 's/^ *\$ composer //' | while IFS= read -r arguments; do
            echo "ux:install $recipe suggested: composer $arguments"
            app sh -c "$app_composer $arguments --no-interaction --no-progress" < /dev/null
        done
    done
}

# The app a user writes: a dashboard page and a registration page (tools/tests/fixtures/fresh-app), then a cache built
# from scratch: cache:clear keeps the cached routes when its own boot rebuilt the container in the same second as their
# build (the route cache checks the container file's mtime, one-second resolution), and the controllers copied here
# would answer 404 (docs/NOTES.md)
add_fresh_app() {
    local root="$1"
    tar -C "$root/tools/tests/fixtures/fresh-app" -c . | app tar -x -C "$app_dir"
    app rm -rf var/cache
    app_console cache:warmup --no-interaction > /dev/null
}
