#!/usr/bin/env bash
set -euo pipefail

work=$(realpath -m -- "$1")
repository=${GITHUB_REPOSITORY,,}
[[ "$GITHUB_REF" == refs/heads/main && "$GITHUB_REF_PROTECTED" == true && "$IMAGE_COMMIT" == "$GITHUB_SHA" ]]
[[ "$GITHUB_EVENT_NAME" == workflow_run || "$GITHUB_EVENT_NAME" == schedule ]]
[[ "$repository" == xormania/uxor ]]
read -r -a roles <<< "$IMAGE_ROLES"

current() {
    test "$(gh api "repos/$repository/git/ref/heads/main" --jq .object.sha)" = "$IMAGE_COMMIT"
}
current
[[ "$(git rev-parse HEAD)" == "$IMAGE_COMMIT" ]]
for role in "${roles[@]}"; do
    [[ "$role" =~ ^(demo|toolkit|package|docs)$ ]]
    sha256sum -c "$work/$role/tested.sha256"
done

docker_auth="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
trap 'docker logout ghcr.io' EXIT
printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin

for role in "${roles[@]}"; do
    current
    dir=$work/$role
    ref=ghcr.io/$repository-ci-$role
    expected=$(skopeo manifest-digest "$dir/manifest.json")
    version="$ref:$IMAGE_COMMIT-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
    source="oci-archive:$dir/image.tar"
    for target in "$version" "$ref:main"; do
        current
        skopeo copy --authfile "$docker_auth" --preserve-digests "$source" "docker://$target"
        skopeo inspect --authfile "$docker_auth" --raw "docker://$target" > "$dir/published-manifest.json"
        test "$(skopeo manifest-digest "$dir/published-manifest.json")" = "$expected"
    done
    jq -nc --arg role "$role" --arg image "$ref@$expected" --arg version "$version" \
        '{role: $role, published_image: $image, version: $version}' >> "$work/timings.ndjson"
done

# A cache export uses the same BuildKit builder and source contexts after the
# smoke checks. A later run imports only digests in a trusted run's receipt.
cache='{}'
while IFS= read -r scope; do
    current
    ref=ghcr.io/$repository-image-cache:$scope
    (
        cd "$work"
        docker buildx bake --file bake.json --progress=plain "$scope" \
            --set "$scope.output=type=cacheonly" \
            --set "$scope.cache-to=type=registry,ref=$ref,mode=max,image-manifest=true,oci-mediatypes=true"
    ) 2>&1 | tee "$work/cache-$scope.log"
    # BuildKit includes "image" in this message with image-manifest=true.
    # Use the digest emitted by the exporter to verify the exact registry object.
    digest=$(sed -nE 's/^#[0-9]+ writing cache( image)? manifest (sha256:[a-f0-9]{64})( .*)?$/\2/p' "$work/cache-$scope.log" | sort -u)
    if ! [[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]]; then
        printf 'Expected one cache manifest digest for %s in %s\n' "$scope" "$work/cache-$scope.log" >&2
        exit 1
    fi
    skopeo inspect --authfile "$docker_auth" --raw "docker://ghcr.io/$repository-image-cache@$digest" > "$work/cache-provider.json"
    test "$(skopeo manifest-digest "$work/cache-provider.json")" = "$digest"
    cache=$(jq -c --arg scope "$scope" --arg digest "$digest" '. + {($scope): $digest}' <<< "$cache")
done < <(jq -r '.target | keys[]' "$work/bake.json")

current
jq -n --arg repository "$repository" --arg commit "$IMAGE_COMMIT" --argjson cache "$cache" \
    '{repository: $repository, commit: $commit, cache: $cache}' > "$work/receipt.json"
