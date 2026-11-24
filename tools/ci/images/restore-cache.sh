#!/usr/bin/env bash
set -euo pipefail

previous=$1/previous
[[ "${GITHUB_REPOSITORY,,}" == xormania/uxor && "$CACHE_RUN" =~ ^[1-9][0-9]*$ ]]
if ! gh run download "$CACHE_RUN" --repo "$GITHUB_REPOSITORY" --name uxor-image-cache-receipt --dir "$previous" ||
    ! test -s "$previous/receipt.json" ||
    ! printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin; then
    rm -f "$previous/receipt.json"
    echo "::warning::The prior image cache is unavailable. Building without it."
fi
