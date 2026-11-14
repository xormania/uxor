#!/usr/bin/env bash
#
# The demo's production image (demo/Dockerfile, target frankenphp_prod) built and run, as evidence that the stage works,
# not only that its text reads right (demo/tests/Security/ProductionConfigurationTest.php). Three parts, reported apart:
#
#   static   the Dockerfile's base images are pinned by digest and the stage exists; ProductionConfigurationTest when
#            demo/vendor/ is installed (otherwise SKIP, never counted as a pass)
#   build    docker build --target frankenphp_prod --platform linux/amd64 of demo/ (the context compose.override.yaml
#            gives the development image); the base image digests and the image built are printed
#   runtime  the image refuses to boot without the production opt-in; with it and a random APP_SECRET, it turns healthy
#            (its HEALTHCHECK), PID 1 runs as www-data, PHP has the extensions the image installs and the demo requires,
#            no Xdebug and no require-dev package is in it, the opt-in and the secret are not baked into it, and / answers
#            200 over HTTP
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

# ---------------------------------------------------------------------------------------------------- build
echo "== build: target frankenphp_prod, platform $platform"
if [ -n "$given_image" ]; then
    result build SKIP "image given: $given_image"
else
    build_log="$(mktemp)"
    if docker buildx build --platform "$platform" --target frankenphp_prod --load --progress plain -t "$image" "$root/demo" >"$build_log" 2>&1; then
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
        port="$(docker port "$container" 80/tcp | head -n 1 | sed 's/.*://')"
        code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "http://127.0.0.1:$port/" || echo 000)"
        check runtime "GET / answers 200 (got $code)" test "$code" = 200
    else
        result runtime FAIL 'the container is not running: no further runtime checks'
    fi
fi

echo
echo "== summary ($platform)"
printf '%s\n' "${report[@]}"
echo "Base images: ${bases[*]}"
[ "$failures" -eq 0 ] || { echo "$failures check(s) failed"; exit 1; }
