#!/bin/sh
set -eu

context=$(CDPATH='' cd -P -- "$(dirname -- "$0")" && pwd -P)
preparation=$(CDPATH='' cd -P -- "$context/../../../src/Preparation" && pwd -P)
exec docker buildx build "$@" --build-context "preparation=$preparation" "$context"
