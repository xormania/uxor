#!/usr/bin/env bash
set -euo pipefail

work=$(realpath -m -- "$1")
read -r -a roles <<< "$IMAGE_ROLES"
receipt=$work/previous/receipt.json
# Bake's filesystem boundary covers these staged contexts and OCI outputs.
bake() (
    cd "$work"
    docker buildx bake --file bake.json --progress=plain "$@"
)
start=$SECONDS
if [[ "$IMAGE_COLD" == true ]]; then
    node tools/ci/images/bake.mjs "$work" "$IMAGE_ROLES"
    bake --set '*.no-cache=true' 2>&1 | tee "$work/build.log"
else
    inputs=()
    if [[ -f "$receipt" ]]; then
        inputs+=("$receipt")
    fi
    node tools/ci/images/bake.mjs "$work" "$IMAGE_ROLES" "${inputs[@]}"
    bake 2>&1 | tee "$work/build.log"
fi
build_seconds=$((SECONDS - start))
hits=$(grep -cE '^#[0-9]+ CACHED$' "$work/build.log" || true)
jq -nc --arg commit "$IMAGE_COMMIT" --argjson seconds "$build_seconds" --argjson cached_steps "$hits" \
    --argjson cold "$IMAGE_COLD" '{commit: $commit, build_seconds: $seconds, cached_steps: $cached_steps, cold: $cold}' > "$work/timings.ndjson"

failed=0
for role in "${roles[@]}"; do
    dir=$work/$role
    archive=oci-archive:$dir/image.tar
    tag=uxor-ci-$role:tested
    start=$SECONDS
    skopeo inspect --raw "$archive" > "$dir/manifest.json"
    manifest=$(skopeo manifest-digest "$dir/manifest.json")
    config=$(jq -er '.config.digest | select(test("^sha256:[a-f0-9]{64}$"))' "$dir/manifest.json")
    skopeo copy "$archive" "docker-daemon:$tag"
    # OCI and Docker manifest media types can differ on daemon import. The config
    # digest binds the executable configuration and uncompressed rootfs layers.
    test "$(docker image inspect --format '{{.Id}}' "$tag")" = "$config"
    rm -f -- "$dir/tested.sha256"
    test_status=0
    docker run --rm --mount "type=bind,src=$dir/test,dst=/workspace" \
        --mount "type=bind,src=$dir/test.sh,dst=/uxor-test.sh,readonly" \
        --workdir /workspace --entrypoint bash "$config" /uxor-test.sh || test_status=$?
    if (( test_status == 0 )); then
        sha256sum "$dir/image.tar" > "$dir/tested.sha256"
    else
        failed=1
    fi
    elapsed=$((SECONDS - start))
    jq -nc --arg role "$role" --arg manifest "$manifest" --arg config "$config" \
        --argjson seconds "$elapsed" --argjson test_exit_code "$test_status" \
        '{role: $role, manifest_digest: $manifest, config_digest: $config, test_seconds: $seconds, test_exit_code: $test_exit_code}' >> "$work/timings.ndjson"
done

{
    printf 'Image build took %s seconds with %s cached BuildKit steps.\n\n' "$build_seconds" "$hits"
    printf '| Role | Load and test seconds | Test result | OCI manifest |\n| --- | ---: | --- | --- |\n'
    jq -r 'select(.role) | (if .test_exit_code == 0 then "Passed" else "Failed (exit \(.test_exit_code))" end) as $result
        | "| \(.role) | \(.test_seconds) | \($result) | \(.manifest_digest) |"' "$work/timings.ndjson"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

exit "$failed"
