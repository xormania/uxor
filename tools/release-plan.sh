#!/usr/bin/env bash
#
# What .github/workflows/release.yml tags and publishes for each version of CHANGELOG.md. Version X.Y.Z (its
# `## [X.Y.Z]` heading) is tagged `X.Y.Z` on the first commit of <ref>'s first-parent history that adds the heading:
# on main, the release pull request's merge commit. Its notes are its section of CHANGELOG.md at that commit, so a
# later edit to an old section changes no published notes. An existing tag, lightweight or annotated, must point at
# that commit: a tag that points elsewhere is refused, and so is a version no commit adds. release.yml checks the
# install of an untagged version before it tags it; a tagged one only gets its Release ("Latest" only for the newest).
#
# Usage: tools/release-plan.sh [--dry-run] [--ref <rev>] [--notes-dir <dir>] [<version>...]
#   <version>...       the versions to plan; default: every version heading of CHANGELOG.md at <ref>
#   --ref <rev>        the history to read; default: HEAD (release.yml: the commit of main CI passed on)
#   --notes-dir <dir>  write each version's notes to <dir>/<version>.md
#   --dry-run          print, for each version, the tag, the commit, the tag's state, the decision and the notes
# Prints one line per version, `<version> <commit> untagged|tagged|refused` (unless --dry-run), and exits 1 when a
# version is refused, after reporting every version. It never creates, moves or pushes a tag.
# Test: tools/tests/release-plan.sh

set -euo pipefail

dry_run=false ref=HEAD notes_dir=
versions=()
while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) dry_run=true ;;
        --ref) ref="$2"; shift ;;
        --notes-dir) notes_dir="$2"; shift ;;
        -*) echo "usage: $0 [--dry-run] [--ref <rev>] [--notes-dir <dir>] [<version>...]" >&2; exit 2 ;;
        *) versions+=("$1") ;;
    esac
    shift
done

error() {
    if [ "${GITHUB_ACTIONS:-}" = true ]; then echo "::error::$1" >&2; else echo "error: $1" >&2; fi
}

ref=$(git rev-parse --verify -q "$ref^{commit}") || { error "no commit $ref"; exit 2; }
if [ ${#versions[@]} -eq 0 ]; then
    mapfile -t versions < <(git show "$ref:CHANGELOG.md" | sed -nE 's/^## \[([0-9]+\.[0-9]+\.[0-9]+)\].*/\1/p')
fi
[ -z "$notes_dir" ] || mkdir -p "$notes_dir"

# the version's section of CHANGELOG.md at a commit, without its heading, up to the next heading or the links
notes() {
    git show "$2:CHANGELOG.md" \
        | awk -v h="## [$1]" 'index($0, h) == 1 { on = 1; next } on && (/^## \[/ || /^\[[^]]+\]: /) { exit } on'
}

refused=0
for version in "${versions[@]}"; do
    # sed, not head: the whole list is read, so git log never writes to a closed pipe
    commit=$(git log "$ref" --first-parent --diff-merges=first-parent --no-patch --reverse --format=%H \
        -S"## [$version]" -- CHANGELOG.md | sed -n 1p)

    tag_state='no' tagged=
    if git rev-parse -q --verify "refs/tags/$version" > /dev/null; then
        kind=$(git cat-file -t "refs/tags/$version")
        if [ "$kind" = tag ]; then kind=annotated; else kind=lightweight; fi
        tagged=$(git rev-parse -q --verify "refs/tags/$version^{commit}" || echo 'no commit')
        tag_state="yes, $kind, at $tagged"
    fi

    if [ -z "$commit" ]; then
        state=refused
        decision="refused: no commit of $ref's first-parent history adds the heading of $version"
    elif [ -z "$tagged" ]; then
        state=untagged
        decision="check the install of $commit, tag it $version, publish the release"
    elif [ "$tagged" = "$commit" ]; then
        state=tagged
        decision="the tag is right: publish the release (no install check: only an untagged version gets one)"
    else
        state=refused
        decision="refused: tag $version points at $tagged, not at $commit, the commit that adds its heading"
    fi
    if [ "$state" = refused ]; then
        error "$version: ${decision#refused: }"
        refused=1
    fi

    if $dry_run; then
        echo "tag:            $version"
        if [ -n "$commit" ]; then
            echo "commit:         $commit $(git log -1 --format=%s "$commit")"
        else
            echo "commit:         none"
        fi
        echo "tag exists:     $tag_state"
        echo "decision:       $decision"
        if [ -n "$commit" ]; then
            echo "notes (CHANGELOG.md at ${commit:0:12}):"
            notes "$version" "$commit" | sed 's/^/    /'
        fi
        echo
    else
        echo "$version ${commit:-none} $state"
    fi
    if [ -n "$notes_dir" ] && [ -n "$commit" ]; then
        notes "$version" "$commit" > "$notes_dir/$version.md"
    fi
done
exit "$refused"
