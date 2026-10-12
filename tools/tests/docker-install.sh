#!/usr/bin/env bash
# On a fresh Symfony Docker project (dunglas/symfony-docker: FrankenPHP in worker mode, its PHP image, the latest
# Symfony by default), README.md's install steps with the kit downloaded from GitHub, the archive users get
# (`--kit=https://github.com/xormania/uxor:<ref>`), give the same pages as fresh-install.sh.
#
#   KIT_REF=<tag or full commit SHA> tools/tests/docker-install.sh
#   (SYMFONY_VERSION=… default 8.1.*, KIT_REPOSITORY=… default the owner/name of manifest.json's
#   homepage; needs Docker and git)
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
ref="${KIT_REF:?set KIT_REF to a tag or a full commit SHA of the kit}"
# the repository manifest.json's homepage names (https://github.com/<owner>/<name>)
repository="${KIT_REPOSITORY:-$(sed -n 's#^ *"homepage": *"https://github\.com/\([^/"]*/[^/"]*\)".*#\1#p' "$root/manifest.json")}"
[ -n "$repository" ] || { echo "manifest.json has no https://github.com/<owner>/<name> homepage: set KIT_REPOSITORY" >&2; exit 1; }
export SYMFONY_VERSION="${SYMFONY_VERSION:-8.1.*}"
# the template commit docs/NOTES.md records for the demo
template_commit=422756611d61e0108600ed7ec1370ec677d0e8d0
work="$(mktemp -d)"
app="$work/app"
cleanup() {
    if [ -f "$app/compose.yaml" ]; then
        (
            cd "$app"
            docker compose down -v --remove-orphans > /dev/null 2>&1
            # the container created most project files as root: delete them from a container too
            docker compose run --rm --no-deps -T --entrypoint find php /app -mindepth 1 -delete > /dev/null 2>&1
        ) || true
    fi
    rm -rf "$work" || true
}
trap cleanup EXIT

git clone --quiet https://github.com/dunglas/symfony-docker "$app"
git -C "$app" checkout --quiet "$template_commit"
cd "$app"
# FrankenPHP 1.13 (Mercure 1.0) refuses the template's Mercure configuration: the demo's Caddyfile and no
# `demo` directive, as in docs/NOTES.md's Symfony Docker section
cp "$root/demo/frankenphp/Caddyfile" frankenphp/Caddyfile
sed -i '/MERCURE_EXTRA_DIRECTIVES/d' compose.override.yaml
# the demo's compose.yaml: the template's, with its ports published on loopback only
cp "$root/demo/compose.yaml" compose.yaml

docker compose build --pull
# the first start creates the Symfony project (the template's entrypoint)
docker compose up --wait --wait-timeout 600 || { docker compose logs php; exit 1; }

x() { docker compose exec -T php "$@"; }

# the shared steps (install-scenario.sh), run in the container
app() { x "$@"; }
app_console() { x bin/console "$@"; }
app_composer=composer
app_dir=/app
# shellcheck source=tools/tests/install-scenario.sh
. "$root/tools/tests/install-scenario.sh"
require_kit_packages
install_kit_recipes "https://github.com/$repository:$ref" "$work"
add_fresh_app "$root"

# fresh workers for the new code
docker compose restart php
docker compose up --wait --wait-timeout 300

"$root/tools/tests/check-fresh-app.sh" https://localhost --insecure || {
    echo "--- routes"; x bin/console debug:router --no-interaction 2>&1 | head -30 || true
    echo "--- logs"; docker compose logs --tail 50 php || true
    exit 1
}
echo "ok: $(x bin/console --version --no-ansi | head -1), kit $repository:$ref from GitHub, in Symfony Docker"
