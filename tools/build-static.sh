#!/usr/bin/env bash
# The gallery as a static site: the index, every recipe page and every README example in both themes, and the /demo
# application's pages, rendered by `bin/console app:export-static` into <dir> (emptied first), then checked: the
# previews' own links and forms reach saved pages, and every recipe and README example has its pages
# (tools/fence-coverage.mjs). CI's *Static site* job and pages.yml both build with it; Pages then uploads <dir>.
#
#   tools/build-static.sh <dir> [--base-path=/<repository name>] [--release-from-tags]
#
# --base-path: the URL path the site is served under (none: the root). --release-from-tags: the install commands name
# the release (X.Y.Z tag) HEAD is, or else the latest release before it; without it, or without tags, they name none.
# PHP=… COMPOSER_BIN=… to use other binaries. It installs the demo (tools/sync-demo, composer install) and compiles its
# assets into demo/public/assets/: run `rm -rf demo/public/assets` after it, or the local demo serves those copies.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
php="${PHP:-php}"
composer="${COMPOSER_BIN:-composer}"
usage() { echo "usage: $0 <dir> [--base-path=/path] [--release-from-tags]" >&2; exit 2; }

[ $# -ge 1 ] && [ -n "$1" ] && [ "${1#-}" = "$1" ] || usage
dir="$1"; shift
base_path='' release='' latest_release=''
for arg in "$@"; do
    case "$arg" in
        --base-path=*) base_path="${arg#--base-path=}" ;;
        --release-from-tags)
            # release tags only (X.Y.Z)
            match='[0-9]*.[0-9]*.[0-9]*'
            release=$(git -C "$root" describe --tags --exact-match --match "$match" 2>/dev/null || true)
            latest_release=$(git -C "$root" describe --tags --abbrev=0 --match "$match" 2>/dev/null || true)
            ;;
        *) usage ;;
    esac
done
mkdir -p "$dir"
dir="$(cd "$dir" && pwd)"
commit=$(git -C "$root" rev-parse --short HEAD)
echo "Static site: $dir, base path '${base_path}', release '${release}', latest release '${latest_release}', commit $commit"

# every console command without debug, from composer's cache:clear on, so the assets compile with Stimulus's debug
# logging off (a compiled asset is cached whatever the debug mode)
export APP_DEBUG=0
cd "$root"
"$php" tools/sync-demo
(
    cd demo
    "$composer" install --no-interaction --no-progress
    "$php" bin/console tailwind:build --minify
    "$php" bin/console asset-map:compile
    # app:export-static fails on any page that does not answer 200
    "$php" bin/console app:export-static "$dir" --base-path="$base_path" --release="$release" \
        --latest-release="$latest_release" --commit="$commit"
)

# the previews' own links and forms reach saved pages
if grep -rlE '/preview/[a-z0-9-]+/[a-z0-9-]+/(light|dark)/&' "$dir"; then
    echo "::error::a preview link lost its '?' when the export moved the theme into the path"
    exit 1
fi
if grep -rlE 'action="[^"]*/preview/[a-z0-9-]+/[a-z0-9-]+"' "$dir"; then
    echo "::error::a preview form submits to a path without the theme: no file answers it"
    exit 1
fi

# the sources against the saved pages: a recipe or a README example without its page fails
node tools/fence-coverage.mjs --site "$dir"
