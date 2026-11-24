#!/usr/bin/env bash
# Build and qualify the two GitHub Pages producers. The default publishes the documentation,
# runtime previews and visual demo together. Each can be built into its own directory for CI:
#   tools/build-static.sh _site --website-only --base-path=/uxor
#   tools/build-static.sh _runtime --runtime-only --base-path=/uxor
# PHP and COMPOSER_BIN override the executable paths. Runtime builds compile demo/public/assets.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
php="${PHP:-php}"
composer="${COMPOSER_BIN:-composer}"
usage() { echo "usage: $0 <dir> [--base-path=/path] [--release-from-tags] [--branch=name] [--site-url=URL] [--website-only|--runtime-only]" >&2; exit 2; }

[ $# -ge 1 ] && [ -n "$1" ] && [ "${1#-}" = "$1" ] || usage
dir="$1"; shift
base_path='' release='' latest_release='' branch='' site_url='' scope=all
for arg in "$@"; do
    case "$arg" in
        --base-path=*) base_path="${arg#--base-path=}" ;;
        --website-only | --runtime-only)
            [ "$scope" = all ] || usage
            scope="${arg#--}"
            ;;
        --site-url=*) site_url="${arg#--site-url=}" ;;
        --branch=*) branch="${arg#--branch=}" ;;
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
dir="$(cd "$dir" && pwd -P)"
if [[ "$dir" == / || "$root" == "$dir" || "$root" == "$dir/"* ]] || { [[ "$dir" == "$root/"* ]] && [[ -n "$(git -C "$root" ls-files -- "${dir#"$root"/}")" ]]; }; then
    echo "Choose a build output directory outside the source files." >&2
    exit 2
fi
base_path="${base_path%/}"
# Stage only the selected producers. A failed build leaves the last output available.
work=$(mktemp -d "$dir/.uxor-staging.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
stage="$work/site"
mkdir "$stage"
producers=()
commit=$(git -C "$root" rev-parse --short HEAD)
branch="${branch:-$(git -C "$root" symbolic-ref --short -q HEAD || echo main)}"
echo "Static site ($scope): $dir, base path '${base_path}', release '${release}', latest release '${latest_release}', commit $commit on '$branch'"

if [ "$scope" != runtime-only ]; then
    "$composer" install --working-dir="$root/website" --no-interaction --no-progress
    args=(--base-path="$base_path" --branch="$branch" --commit="$commit" --release="$release" --latest-release="$latest_release")
    if [ -n "$site_url" ]; then args+=(--site-url="$site_url"); fi
    "$php" "$root/website/bin/build" "$stage" "${args[@]}"
    for reserved in assets demo preview; do
        if [ -e "$stage/$reserved" ]; then
            echo "::error::the website wrote into a runtime export path: $reserved" >&2
            exit 1
        fi
    done
    producers+=(website)
    for entry in "$stage"/*; do basename "$entry"; done > "$work/website"
fi

if [ "$scope" != website-only ]; then
    # Disable debug before Composer's cache:clear and all asset compilation.
    export APP_DEBUG=0
    "$php" "$root/tools/sync-demo"
    (
        cd "$root/demo"
        "$composer" install --no-interaction --no-progress
        # the compiler is downloaded by tailwind:build itself, so the version it will fetch is the configured one
        # the first binary_version line, its value quoted with ' or " or not, then optionally a comment; a commented-out key is no key
        tailwind_version=$(sed -nE "/^ *binary_version:/{s/^ *binary_version: *['\"]?(v?[0-9][0-9.]*)['\"]? *(#.*)?\$/\1/p;q}" config/packages/symfonycasts_tailwind.yaml)
        if [ -z "$tailwind_version" ]; then
            echo "::error::config/packages/symfonycasts_tailwind.yaml has no readable binary_version: the build cannot name the Tailwind compiler it uses" >&2
            exit 1
        fi
        echo "Tailwind compiler: ${tailwind_version} (symfonycasts_tailwind binary_version)"
        "$php" bin/console tailwind:build --minify
        "$php" bin/console asset-map:compile
        "$php" bin/console app:export-static "$work/runtime-export" --base-path="$base_path"
    )
    producers+=(runtime)
    for entry in "$work/runtime-export"/*; do
        name=${entry##*/}
        case "$name" in
            assets|demo|preview) mv -- "$entry" "$stage/" ;;
            *) echo "::error::the runtime wrote outside its export paths: $name" >&2; exit 1 ;;
        esac
        echo "$name"
    done > "$work/runtime"
    for file in assets/manifest.json demo/index.html demo/not-found/index.html; do
        [ -s "$stage/$file" ] || { echo "::error::the runtime export is missing $file"; exit 1; }
    done

    # the previews' own links and forms reach saved pages
    if grep -rlE '/preview/[a-z0-9-]+/[a-z0-9-]+/(light|dark)/&' "$stage/preview"; then
        echo "::error::a preview link lost its '?' when the export moved the theme into the path"
        exit 1
    fi
    if grep -rlE 'action="[^"]*/preview/[a-z0-9-]+/[a-z0-9-]+"' "$stage/preview"; then
        echo "::error::a preview form submits to a path without the theme: no file answers it"
        exit 1
    fi
fi

# the sources against the saved pages: a recipe or a README example without its page fails
coverage=(--site "$stage" --base-path="$base_path")
if [ "$scope" != all ]; then coverage+=("--$scope"); fi
node "$root/tools/fence-coverage.mjs" "${coverage[@]}"

if [ "$scope" != runtime-only ]; then
    # the discovery files (docs/PLAN-docs-automation.md, Stage 3): the sitemap lists every recipe page under the base path
    # and never the export's own origin, and each Markdown file llms.txt links on the site is one the copy holds
    for file in sitemap.xml llms.txt; do
        [ -s "$stage/$file" ] || { echo "::error::no $file in the site"; exit 1; }
    done
    if grep -lE '//(localhost|127\.0\.0\.1)[:/]' "$stage/sitemap.xml" "$stage/llms.txt"; then
        echo "::error::the sitemap or llms.txt names the export's own origin instead of the site's"
        exit 1
    fi
    for page in "$stage"/r/*/index.html; do
        recipe=$(basename "$(dirname "$page")")
        grep -qF "${base_path}/r/${recipe}/</loc>" "$stage/sitemap.xml" || { echo "::error::sitemap.xml does not list the ${recipe} page"; exit 1; }
    done
    # the site's URL is the sitemap's first entry, the index
    site_url=$(grep -oE '<loc>[^<]+</loc>' "$stage/sitemap.xml" | sed -nE '1s#^<loc>(.*)/</loc>$#\1#p')
    grep -oF "($site_url/" "$stage/llms.txt" >/dev/null || { echo "::error::llms.txt links no Markdown of the site ($site_url)"; exit 1; }
    missing=$(grep -oE '\([^)]+\.md\)' "$stage/llms.txt" | sed -E 's#^\((.*)\)$#\1#' | while read -r url; do
        case "$url" in
            "$site_url"/*) [ -f "$stage/${url#"$site_url"/}" ] || echo "$url" ;;
        esac
    done)
    if [ -n "$missing" ]; then
        echo "::error::llms.txt links Markdown the site does not hold: $missing"
        exit 1
    fi
fi

# Recognize a site from before the producers kept inventories. A migration retains the
# old trees in a private backup, since readers may have added their own files inside them.
legacy_entries() {
    local producer=$1 name file
    if [ "$producer" = runtime ]; then
        [ -f "$dir/assets/manifest.json" ] && grep -qF 'Back to the gallery' "$dir/demo/index.html" 2>/dev/null \
            && grep -qF 'content="noindex"' "$dir/preview/button/default/light/index.html" 2>/dev/null || return 0
        echo assets; echo demo; echo preview
    else
        [ -f "$dir/index.html" ] && [ -f "$dir/r/button/index.html" ] && [ -f "$dir/r/button.md" ] \
            && grep -qF '/r/button/</loc>' "$dir/sitemap.xml" 2>/dev/null \
            && grep -qF '/r/button.md)' "$dir/llms.txt" 2>/dev/null || return 0
        for name in index.html 404.html llms.txt sitemap.xml r; do
            if [ -e "$dir/$name" ]; then echo "$name"; fi
        done
        if [ -d "$dir/website-assets" ] && grep -qF '/website-assets/' "$dir/index.html"; then echo website-assets; fi
        for file in "$dir"/*.md; do
            name=${file##*/}; name=${name%.md}
            if [[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]] && [ -f "$dir/$name/index.html" ] && grep -qF "/$name/</loc>" "$dir/sitemap.xml"; then
                echo "$name"; echo "$name.md"
            fi
        done
    fi
}

# The inventories identify the trees this build may replace on a subsequent run. They are
# local to the output directory (upload-pages-artifact excludes hidden files). Preflight
# every selected producer before modifying anything, including when a guide has been removed.
for producer in "${producers[@]}"; do
    previous="$dir/.uxor-output-$producer"
    if [ ! -e "$previous" ]; then
        previous="$work/legacy-$producer"
        legacy_entries "$producer" > "$previous"
    fi
    while IFS= read -r name; do
        [[ "$name" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || { echo "::error::invalid name in $previous"; exit 1; }
        case "$producer:$name" in
            website:assets|website:demo|website:preview) echo "::error::invalid website inventory"; exit 1 ;;
            runtime:assets|runtime:demo|runtime:preview|website:*) ;;
            *) echo "::error::invalid runtime inventory"; exit 1 ;;
        esac
    done < "$previous"
    while IFS= read -r name; do
        [[ "$name" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || { echo "::error::invalid $producer output name: $name"; exit 1; }
        if { [ -e "$dir/$name" ] || [ -L "$dir/$name" ]; } && ! grep -Fxq -- "$name" "$previous" 2>/dev/null; then
            echo "::error::existing path is not owned by the $producer build: $dir/$name. Choose a fresh output directory." >&2
            exit 1
        fi
    done < "$work/$producer"
done
backup=''
for producer in "${producers[@]}"; do
    previous="$dir/.uxor-output-$producer"
    if [ -f "$previous" ]; then
        while IFS= read -r name; do rm -rf -- "$dir/$name"; done < "$previous"
    elif [ -s "$work/legacy-$producer" ]; then
        if [ -z "$backup" ]; then
            backup=$(mktemp -d "$dir/.uxor-before-inventory.XXXXXX")
            echo "Preserving legacy output in $backup"
        fi
        while IFS= read -r name; do mv -- "$dir/$name" "$backup/"; done < "$work/legacy-$producer"
    fi
    while IFS= read -r name; do mv -- "$stage/$name" "$dir/"; done < "$work/$producer"
    mv -f -- "$work/$producer" "$previous"
done
