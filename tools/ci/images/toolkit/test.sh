#!/usr/bin/env bash
set -euo pipefail

for path in demo website packages; do
    if [ -e "$path" ] || [ -L "$path" ]; then
        printf 'Toolkit test context contains another area: %s\n' "$path" >&2
        exit 1
    fi
done

# The standalone installer exercises the archived kit. Commit the staged Toolkit
# files to a temporary local repository so its existing git archive step applies
# the release's export exclusions without access to the project checkout.
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/kit"
cp -a . "$work/kit"
git -C "$work/kit" init --quiet --template=
git -C "$work/kit" add --force --all
git -C "$work/kit" -c user.name='Toolkit fixture' -c user.email=toolkit-fixture@example.invalid \
    -c commit.gpgSign=false -c core.hooksPath=/dev/null commit --quiet -m 'Staged Toolkit inputs'

COMPOSER_ALLOW_SUPERUSER=1 bash "$work/kit/tools/tests/fresh-install.sh"
