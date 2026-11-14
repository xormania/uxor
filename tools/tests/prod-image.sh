#!/usr/bin/env bash
#
# The demo's production image (demo/Dockerfile, target frankenphp_prod) built and run, as evidence that the stage works,
# not only that its text reads right (demo/tests/Security/ProductionConfigurationTest.php). Three parts, reported apart:
#
#   static   the Dockerfile's base images are pinned by digest and the stage exists; ProductionConfigurationTest when
#            demo/vendor/ is installed (otherwise SKIP, never counted as a pass)
#   build    docker build --target frankenphp_prod --platform linux/amd64 -f demo/Dockerfile from the repository root (the
#            context the image needs: the kit's files beside the demo, chosen by demo/Dockerfile.dockerignore); the base
#            image digests and the image built are printed
#   runtime  the image refuses to boot without the production opt-in; with it and a random APP_SECRET, it turns healthy
#            (its HEALTHCHECK), PID 1 runs as www-data, PHP has the extensions the image installs and the demo requires,
#            the production kernel registers no UXToolkitBundle and its console has no ux:install or ux:toolkit:* command
#            (the gallery uses the Toolkit's library in prod), no Xdebug and no require-dev package (read from
#            demo/composer.json at run time) is in it, the opt-in and the secret are not baked into it; the app is
#            at /app/demo beside the kit's files, as on disk; the dashboard, a recipe page, the install guide and
#            /llms.txt answer 200 with their content, and every recipe the image holds (/app/*/manifest.json) has a
#            recipe page answering 200, as does each page's first preview, each page rendered through the demo's own
#            templates (its Toolkit overrides show every example in a light and a dark preview frame), not a fallback (the files the image needs are in it); no node_modules, tests,
#            .git, packages/, .github, docs but GUIDE.md, or tools/ are (the files it must not hold are not)
#
#   context  what the build context sends (demo/Dockerfile's ignore file applied): a throwaway stage copies the
#            whole context and the copy is listed; nothing under .git, .github, node_modules, packages/ or any tests
#            directory, nothing in tools/ but tools/sync-demo, and no secret or machine-local file a developer's
#            checkout may hold (Symfony's secrets decryption key, .env.local files, phpunit.xml, .agents, .idea, .vscode),
#            which only a run in such a checkout can catch; demo/ holding only the entries the build needs (an
#            explicit list here: a new one fails until it is added to the allow-list and to this list); and nothing
#            demo/.gitignore ignores outside the copies tools/sync-demo writes (read from the file at run time).
#            A clone holds none of a developer's local files, so CI cannot show those leaks: run
#            `tools/tests/prod-image.sh no-such-image` in your own checkout (it skips the build and the run, and
#            checks the context alone), or plant a file such as demo/config/secrets/prod/prod.decrypt.private.php in
#            a scratch clone and see the context part name it. It runs with a given image too: it needs the
#            checkout and buildx, not the image. A git worktree's .git is a file, a clone's a directory: a check of what
#            .git leaks only means something in a clone, as CI has (the harness prints which one it runs in)
#
# Usage: tools/tests/prod-image.sh [<image>]
#   <image>: an image already built from the stage, to run without building (the build part then reports SKIP)
# PROD_IMAGE_KEEP=1 keeps the image built. Needs docker (with buildx), curl and openssl. Exits non-zero on any FAIL.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
dockerfile="$root/demo/Dockerfile"
platform='linux/amd64'
health_timeout="${PROD_IMAGE_HEALTH_TIMEOUT:-180}"
given_image="${1:-}"
image="${given_image:-uxor-demo-prod:check-$$}"
container="uxor-demo-prod-check-$$"
failures=0
declare -a report

result() { # <part> <PASS|FAIL|SKIP> <what>
    report+=("$(printf '%-8s %-4s %s' "$1" "$2" "$3")")
    printf '[%s] %s: %s\n' "$1" "$2" "$3"
    if [ "$2" = FAIL ]; then failures=$((failures + 1)); fi
}
check() { # <part> <what> <command…>: PASS when the command succeeds
    local part="$1" what="$2"; shift 2
    if "$@"; then result "$part" PASS "$what"; else result "$part" FAIL "$what"; fi
}
cleanup() {
    docker rm -f "$container" >/dev/null 2>&1 || true
    if [ -z "$given_image" ] && [ "${PROD_IMAGE_KEEP:-}" != 1 ]; then docker image rm -f "$image" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------------------------------- static
echo "== static: $dockerfile"
mapfile -t bases < <(grep -E '^FROM [^ ]+@sha256:[0-9a-f]{64}' "$dockerfile" | awk '{print $2}')
echo "Base images (pinned inputs):"; printf '  %s\n' "${bases[@]}"
unpinned=$(grep -E '^FROM ' "$dockerfile" | awk '{print $2}' | grep -vE '@sha256:[0-9a-f]{64}$' | grep -vE '^frankenphp_' || true)
check static 'every external base image is pinned by digest' test -z "$unpinned"
check static 'the frankenphp_prod stage exists' grep -qE '^FROM .+ AS frankenphp_prod$' "$dockerfile"
if [ -d "$root/demo/vendor" ]; then
    if (cd "$root/demo" && php bin/phpunit tests/Security/ProductionConfigurationTest.php >/dev/null 2>&1); then
        result static PASS 'ProductionConfigurationTest'
    else
        result static FAIL 'ProductionConfigurationTest (run it in demo/ for the details)'
    fi
else
    result static SKIP 'ProductionConfigurationTest: demo/vendor/ is not installed here'
fi

# ---------------------------------------------------------------------------------------------------- context
echo "== context: what $root sends for demo/Dockerfile"
if [ -d "$root/.git" ]; then echo "The checkout's .git is a directory (a clone, as in CI)"
elif [ -f "$root/.git" ]; then echo "The checkout's .git is a file (a git worktree: a leak of .git does not show here; check in a clone)"
else echo "The checkout has no .git"; fi
listed() { # listed <what> <command printing the offending paths, run in the copied context>
    local found
    # a long listing ends head's input early: find's broken pipe is not a failure here
    found="$(cd "$context_out/ctx" && eval "$2" 2>/dev/null | head -n 20)" || true
    if [ -z "$found" ]; then result context PASS "no $1 in the build context"
    else
        result context FAIL "no $1 in the build context, found:"
        while IFS= read -r line; do printf '    %s\n' "$line"; done <<< "$found"
    fi
}
# demo/.gitignore's patterns outside its sync-demo block, matched in the copied context (they are anchored at demo/)
gitignored_in_context() {
    local pattern match
    awk '/^###> UXor: files copied/ { skip = 1; next } /^###< UXor/ { skip = 0; next } skip || /^#/ || /^!/ || NF == 0 { next } { print }' "$root/demo/.gitignore" |
        while IFS= read -r pattern; do
            pattern="${pattern#/}"
            pattern="${pattern%/}"
            for match in demo/$pattern; do
                if [ -e "$match" ] || [ -L "$match" ]; then echo "./$match"; fi
            done
        done
}
# the files of the copied context the repository does not hold: not committed, and not a copy tools/sync-demo writes
# (ignored by a pattern of demo/.gitignore's marked sync block); whatever else a checkout holds (a scratch file, a file
# a global gitignore hides) is refused, so a clone passes and a developer's checkout is held to what the repository has
not_held_in_context() {
    local path first last source line pattern
    local -A held=()
    # NUL-delimited throughout: a file name may hold a newline or a tab
    while IFS= read -r -d '' path; do held["$path"]=1; done < <(git -C "$root" ls-files -z)
    first="$(grep -n '^###> UXor: files copied' "$root/demo/.gitignore" | cut -d: -f1)"
    last="$(grep -n '^###< UXor' "$root/demo/.gitignore" | cut -d: -f1)"
    while IFS= read -r -d '' path; do
        path="${path#./}"
        [ -n "${held[$path]+held}" ] || printf '%s\0' "$path"
    done < <(find . \( -type f -o -type l \) -print0) |
        git -C "$root" check-ignore -z -v -n --no-index --stdin |
        while IFS= read -r -d '' source && IFS= read -r -d '' line && IFS= read -r -d '' pattern && IFS= read -r -d '' path; do
            if [ "$source" = demo/.gitignore ] && [ "$line" -gt "${first:-0}" ] && [ "$line" -lt "${last:-0}" ]; then continue; fi
            # printed quoted, so a name with a newline shows as one entry
            printf './%q\n' "$path"
        done
}
context_dir="$(mktemp -d)"
context_out="$context_dir/out"
ignore="$root/demo/Dockerfile.dockerignore"
[ -f "$ignore" ] || ignore="$root/.dockerignore"
printf 'FROM scratch\nCOPY . /ctx\n' > "$context_dir/context.Dockerfile"
# BuildKit reads <Dockerfile>.dockerignore beside the Dockerfile: the same rules as demo/Dockerfile's
if [ -f "$ignore" ]; then cp "$ignore" "$context_dir/context.Dockerfile.dockerignore"; fi
if docker buildx build -f "$context_dir/context.Dockerfile" --output "type=local,dest=$context_out" "$root" >"$context_dir/build.log" 2>&1 && [ -d "$context_out/ctx" ]; then
    echo "Context: $(find "$context_out/ctx" -type f | wc -l) files, read through ${ignore#"$root"/}"
    listed '.git' "find . \\( -name .git -o -path '*/.git/*' \\) -print"
    listed '.github' "find . -name .github -prune -print"
    listed 'node_modules' "find . -name node_modules -prune -print"
    listed 'packages/' "find . -maxdepth 1 -name packages -print"
    listed 'tests directory' "find . -name tests -type d -prune -print"
    listed 'tools/ but tools/sync-demo' "find ./tools -mindepth 1 ! -path ./tools/sync-demo -print"
    # what a developer's checkout holds and a clone never does (CI cannot see these): Symfony's secrets decryption key,
    # local env files, a local PHPUnit configuration and cache, agent and editor folders
    # demo/ holds only what the build needs: a file that appears in a developer's demo/ fails here and names itself
    listed 'unexpected entry at the top of demo/' "ls -A demo | grep -vxF -e .env -e assets -e bin -e composer.json -e composer.lock -e config -e frankenphp -e importmap.php -e public -e src -e symfony.lock -e templates | sed 's|^|./demo/|'"
    # nothing demo/.gitignore ignores, but the copies tools/sync-demo writes (its marked block), which the build rewrites
    listed 'file demo/.gitignore ignores (outside the copies sync-demo writes)' gitignored_in_context
    # every file is one the repository holds, or a copy sync-demo writes: a developer's scratch file in an admitted
    # directory, or one a global gitignore hides, is refused; a clone has none
    if [ -e "$root/.git" ]; then
        listed 'file the repository does not hold (not committed, not a copy sync-demo writes)' not_held_in_context
    else
        # without the repository's metadata nothing says which files it holds: the check is not run, and says so
        result context SKIP "no file the repository does not hold: $root has no .git, so its tracked files are unknown"
    fi
    listed "secret or machine-local file (a decryption key, .env.local, phpunit.xml, .agents, .idea, .vscode)" \
        "find . \\( -name '*.decrypt.private.php' -o -name .env.local -o -name '.env.*.local' -o -name .env.local.php -o -name phpunit.xml -o -name .phpunit.cache -o -name .agents -o -name .idea -o -name .vscode \\) -print"
else
    tail -n 20 "$context_dir/build.log"
    result context FAIL "the build context could not be copied (last lines above)"
fi
rm -rf "$context_dir"

# ---------------------------------------------------------------------------------------------------- build
echo "== build: target frankenphp_prod, platform $platform"
if [ -n "$given_image" ]; then
    result build SKIP "image given: $given_image"
else
    build_log="$(mktemp)"
    if docker buildx build --platform "$platform" --target frankenphp_prod --load --progress plain -f "$root/demo/Dockerfile" -t "$image" "$root" >"$build_log" 2>&1; then
        result build PASS "built $image"
    else
        tail -n 40 "$build_log"
        result build FAIL "docker build of frankenphp_prod (last lines above; full log $build_log)"
    fi
fi
if ! docker image inspect "$image" >/dev/null 2>&1; then
    result runtime SKIP 'no image to run'
else
    echo "Image: $image $(docker image inspect --format '{{.Id}} {{.Os}}/{{.Architecture}}' "$image")"

    # ------------------------------------------------------------------------------------------------ runtime
    echo "== runtime"
    secret="$(openssl rand -hex 32)"
    jwt="$(openssl rand -hex 32)"
    env_args=(-e SERVER_NAME=':80' -e "MERCURE_PUBLISHER_JWT_KEY=$jwt" -e "MERCURE_SUBSCRIBER_JWT_KEY=$jwt" -e "MERCURE_JWT_SECRET=$jwt"
        -e MERCURE_URL='http://localhost/.well-known/mercure' -e MERCURE_PUBLIC_URL='http://localhost/.well-known/mercure' -e DEFAULT_URI='http://localhost')

    # refused without the opt-in, with a strong secret: the kernel (src/Kernel.php) stops before anything serves
    if docker run --rm "${env_args[@]}" -e "APP_SECRET=$secret" "$image" php bin/console about >/dev/null 2>&1; then
        result runtime FAIL 'the console boots without UXOR_DEMO_ALLOW_PRODUCTION=1'
    else
        result runtime PASS 'the console refuses to boot without UXOR_DEMO_ALLOW_PRODUCTION=1'
    fi

    image_env="$(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$image")"
    check runtime 'the image sets neither the opt-in nor APP_SECRET' bash -c '! grep -qE "^(UXOR_DEMO_ALLOW_PRODUCTION|APP_SECRET)=" <<<"$1"' _ "$image_env"
    baked="$(docker run --rm --entrypoint php "$image" -r '$e = is_file(".env.local.php") ? require ".env.local.php" : []; echo ($e["UXOR_DEMO_ALLOW_PRODUCTION"] ?? ""), "|", ($e["APP_SECRET"] ?? "");' 2>/dev/null || echo 'unreadable')"
    check runtime "the dumped .env.local.php holds no opt-in and no secret (got '$baked')" test "$baked" != unreadable -a "${baked%%|*}" != 1 -a -z "${baked#*|}"

    docker run -d --name "$container" "${env_args[@]}" -e UXOR_DEMO_ALLOW_PRODUCTION=1 -e "APP_SECRET=$secret" -p 127.0.0.1::80 "$image" >/dev/null
    status=starting
    for _ in $(seq "$health_timeout"); do
        status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo gone)"
        case "$status" in healthy | unhealthy | exited | dead | gone) break ;; esac
        sleep 1
    done
    if [ "$status" = healthy ]; then
        result runtime PASS 'the container turns healthy (HEALTHCHECK)'
    else
        docker logs --tail 40 "$container" 2>&1 || true
        result runtime FAIL "the container turns healthy (HEALTHCHECK): $status after up to ${health_timeout}s (logs above)"
    fi

    if [ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null)" = true ]; then
        pid1_user="$(docker exec "$container" stat -c %U /proc/1 2>/dev/null || echo '?')"
        check runtime "PID 1 runs as www-data (got $pid1_user)" test "$pid1_user" = www-data
        check runtime 'APP_ENV is prod' test "$(docker exec "$container" printenv APP_ENV 2>/dev/null)" = prod
        # the Toolkit's library serves the gallery in prod; its bundle and console commands are for dev and test only
        bundles="$(docker exec "$container" php bin/console debug:container --parameter=kernel.bundles --format=json 2>/dev/null || echo FAILED)"
        if [ "$bundles" = FAILED ] || ! grep -q 'FrameworkBundle' <<< "$bundles"; then
            result runtime FAIL "the production kernel's bundles could not be read"
        else
            check runtime 'the production kernel registers no UXToolkitBundle' bash -c '! grep -q UXToolkitBundle <<<"$1"' _ "$bundles"
        fi
        commands="$(docker exec "$container" php bin/console list --format=json 2>/dev/null | jq -r '.commands[].name' 2>/dev/null || true)"
        if ! grep -qx 'cache:clear' <<< "$commands"; then
            result runtime FAIL "the production console's commands could not be listed"
        else
            toolkit_commands="$(grep -E '^ux:(install|toolkit:)' <<< "$commands" | tr '\n' ' ' || true)"
            check runtime "the production console has no Toolkit command (ux:install, ux:toolkit:*)${toolkit_commands:+, got: $toolkit_commands}" test -z "$toolkit_commands"
        fi
        modules="$(docker exec "$container" php -m 2>/dev/null | tr '[:upper:]' '[:lower:]')"
        for ext in apcu intl opcache zip ctype iconv; do
            check runtime "PHP extension $ext" grep -qx "$ext\|zend $ext" <<<"$modules"
        done
        check runtime 'no Xdebug' bash -c '! grep -qx xdebug <<<"$1"' _ "$modules"
        check runtime 'frankenphp runs' docker exec "$container" frankenphp version
        dev_packages="$(php -r 'echo implode(" ", array_keys(json_decode(file_get_contents($argv[1]), true)["require-dev"] ?? []));' "$root/demo/composer.json" 2>/dev/null \
            || jq -r '."require-dev" // {} | keys | join(" ")' "$root/demo/composer.json")"
        for package in $dev_packages; do
            check runtime "no require-dev package $package in vendor/" docker exec "$container" test ! -e "vendor/$package"
        done
        # the layout of the development image: the app in /app/demo, the kit's files beside it
        check runtime "the working directory is /app/demo (got $(docker exec "$container" pwd 2>/dev/null))" test "$(docker exec "$container" pwd 2>/dev/null)" = /app/demo
        check runtime 'SERVER_ROOT is /app/demo/public' test "$(docker exec "$container" printenv SERVER_ROOT 2>/dev/null)" = /app/demo/public

        # the files the image needs are in it: each page answers 200 with its own content
        port="$(docker port "$container" 80/tcp | head -n 1 | sed 's/.*://')"
        page() { # <path> <text the page must hold>
            local body code
            body="$(mktemp)"
            code="$(curl -s -o "$body" -w '%{http_code}' --max-time 30 "http://127.0.0.1:$port$1" || echo 000)"
            if [ "$code" = 200 ] && grep -qF -- "$2" "$body"; then result runtime PASS "GET $1 answers 200 with \"$2\""
            else result runtime FAIL "GET $1 answers 200 with \"$2\" (got $code)"; fi
            rm -f "$body"
        }
        page / 'href="/r/button"'               # the dashboard lists the recipes
        page /r/button 'src="/preview/button/'  # a recipe page: its README's examples, as previews
        page '/preview/button/default?theme=light' '<title>button / default'   # one preview: the recipe's templates render
        page /install 'ux:install'               # the install guide (INSTALL.md)
        page /guide 'How to install, update and use the kit'   # the guide (docs/GUIDE.md)
        page /llms.txt '/r/button'               # llms.txt, from the kit's files

        # every recipe page answers 200: the recipes are read from the image (each /app/<recipe>/manifest.json), so the
        # list cannot drift; a failing page is named, with the container's log lines about it
        recipes="$(docker exec "$container" sh -c 'for m in /app/*/manifest.json; do d="${m%/manifest.json}"; echo "${d##*/}"; done' 2>/dev/null)"
        failed=''
        previews=0
        started="$(date +%s)"
        body="$(mktemp)"
        while IFS= read -r recipe; do
            [ -n "$recipe" ] || continue
            code="$(curl -s -o "$body" -w '%{http_code}' --max-time 30 "http://127.0.0.1:$port/r/$recipe" || echo 000)"
            if [ "$code" != 200 ]; then failed="$failed/r/$recipe $code"$'\n'; continue; fi
            # its first preview: the recipe's templates render in prod
            preview="$(grep -oE 'src="/preview/[^"]*"' "$body" | head -n 1 | sed 's/^src="//; s/"$//; s/&amp;/\&/g' || true)"
            [ -n "$preview" ] || continue
            # the page is the demo's, not a fallback to the Toolkit's own templates: the demo's code_preview override
            # (demo/templates/bundles/UXToolkitBundle) shows each example in both themes, in a preview-frame iframe
            example="${preview%%\?*}"
            if ! grep -qF "src=\"$example?theme=light\"" "$body" || ! grep -qF "src=\"$example?theme=dark\"" "$body" || ! grep -qF 'data-controller="preview-frame"' "$body"; then
                failed="$failed/r/$recipe renders the Toolkit's own templates, not the demo's (no light and dark preview-frame of $example)"$'\n'
            fi
            previews=$((previews + 1))
            code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "http://127.0.0.1:$port$preview" || echo 000)"
            [ "$code" = 200 ] || failed="$failed$preview $code"$'\n'
        done <<< "$recipes"
        rm -f "$body"
        elapsed="$(($(date +%s) - started))"
        count="$(grep -c . <<< "$recipes" || true)"
        if [ "$count" -lt 1 ]; then
            result runtime FAIL 'the image holds no recipe (no /app/*/manifest.json)'
        elif [ -z "$failed" ]; then
            result runtime PASS "every recipe page and its first preview answer 200, each page the demo's own ($count recipes, $previews previews, ${elapsed}s)"
        else
            result runtime FAIL "every recipe page and its first preview answer 200 ($count recipes, $previews previews, ${elapsed}s), failed:"
            while IFS= read -r line; do [ -n "$line" ] && printf '    %s\n' "$line"; done <<< "$failed"
            docker logs "$container" 2>&1 | grep -E 'CRITICAL|critical|Uncaught|Exception' | tail -n 10 | while IFS= read -r line; do printf '    log: %s\n' "${line:0:300}"; done
        fi

        # the files it must not hold are not in it
        absent() { # <what> <command run in the image printing the offending paths>
            local found
            found="$(docker exec "$container" sh -c "$2 2>/dev/null | head -n 20" 2>/dev/null)"
            if [ -z "$found" ]; then result runtime PASS "no $1 in the image"
            else
                result runtime FAIL "no $1 in the image, found:"
                while IFS= read -r line; do printf '    %s\n' "$line"; done <<< "$found"
            fi
        }
        absent 'node_modules' 'find /app -name node_modules -prune -print'
        absent 'tests directory (the root, a recipe or the demo)' 'find /app -maxdepth 2 -name tests -type d -print'
        absent '.git' 'find /app -maxdepth 2 \( -name .git -prune -print \) ; find /app/.git -mindepth 1 -maxdepth 2 -print'
        absent 'packages/' 'find /app -maxdepth 1 -name packages -print'
        absent '.github' 'find /app -maxdepth 1 -name .github -print'
        absent 'tools/ (removed after the build)' 'find /app -maxdepth 1 -name tools -print'
        absent 'docs but docs/GUIDE.md' 'find /app/docs -mindepth 1 ! -path /app/docs/GUIDE.md -print'
    else
        result runtime FAIL 'the container is not running: no further runtime checks'
    fi
fi

echo
echo "== summary ($platform)"
printf '%s\n' "${report[@]}"
echo "Base images: ${bases[*]}"
[ "$failures" -eq 0 ] || { echo "$failures check(s) failed"; exit 1; }
