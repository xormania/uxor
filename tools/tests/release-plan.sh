#!/usr/bin/env bash
#
# tools/release-plan.sh: each case builds a scratch repository whose main merges release pull requests from dev (a
# release commit adds the `## [X.Y.Z]` heading, main's merge commit brings it), tags it as the case says, and checks
# what release.yml would do: the commit of each version, the state of its tag, the notes, and the refusals.

set -euo pipefail
cd "$(dirname "$0")/../.."
plan="$PWD/tools/release-plan.sh"

failures=0
case=
fail() {
    echo "FAIL: $case: $*"
    failures=$((failures + 1))
}
g() { git -c user.name=t -c user.email=t@t -c tag.gpgSign=false -c commit.gpgSign=false "$@"; }

# CHANGELOG.md edits, as a release pull request makes them
entry() { # an entry under Unreleased
    awk -v e="$1" '{ print } /^## \[Unreleased\]/ { print ""; print "### Added"; print ""; print "- " e }' CHANGELOG.md > c.tmp
    mv c.tmp CHANGELOG.md
}
heading() { # the Unreleased entries become the version's
    awk -v v="$1" '{ print } /^## \[Unreleased\]/ { print ""; print "## [" v "] - 2026-10-06" }' CHANGELOG.md > c.tmp
    mv c.tmp CHANGELOG.md
}

# A fresh scratch repository on main with 0.1.0 and 0.2.0 released (newest first in CHANGELOG.md), no tag. Sets
# $repo, $start (main's first commit), $rel1_dev and $rel2_dev (the release commits on dev) and $rel1 and $rel2
# (main's merge commits: the expected ones).
setup() {
    case="$1"
    repo=$(mktemp -d)
    cd "$repo"
    g init -q -b main
    printf '# Changelog\n\n## [Unreleased]\n' > CHANGELOG.md
    entry first
    g add -A && g commit -qm start
    start=$(git rev-parse HEAD)
    g checkout -qb dev
    heading 0.1.0 && g commit -qam 'chore: release 0.1.0'
    rel1_dev=$(git rev-parse HEAD)
    g checkout -q main && g merge -q --no-ff dev -m 'Merge pull request #1: release 0.1.0'
    rel1=$(git rev-parse HEAD)
    g checkout -q dev && g merge -q main
    entry second && g commit -qam 'feat: second'
    heading 0.2.0 && g commit -qam 'chore: release 0.2.0'
    rel2_dev=$(git rev-parse HEAD)
    g checkout -q main && g merge -q --no-ff dev -m 'Merge pull request #2: release 0.2.0'
    rel2=$(git rev-parse HEAD)
}
teardown() {
    cd "$OLDPWD"
    rm -rf "$repo"
}

# run <expected status> <args...>: the plan's stdout in $out, its stderr in $err
run() {
    local expected="$1" status=0
    shift
    out=$("$plan" "$@" 2> "$repo.err") || status=$?
    err=$(cat "$repo.err") && rm -f "$repo.err"
    [ "$status" = "$expected" ] || fail "exit $status, expected $expected (stdout: $out; stderr: $err)"
}
expect_out() { [ "$out" = "$1" ] || fail "printed '$out', expected '$1'"; }

setup 'no tag yet: each version on the merge commit that adds its heading, not the release commit on dev'
run 0
expect_out "0.2.0 $rel2 untagged
0.1.0 $rel1 untagged"
teardown

setup 'a lightweight tag on the expected commit'
g tag 0.1.0 "$rel1"
run 0
expect_out "0.2.0 $rel2 untagged
0.1.0 $rel1 tagged"
teardown

setup 'an annotated tag on the expected commit (peeled)'
g tag -a 0.1.0 "$rel1" -m 'UXor 0.1.0'
run 0 0.1.0
expect_out "0.1.0 $rel1 tagged"
teardown

setup 'an annotated tag on the release commit on dev: refused'
g tag -a 0.1.0 "$rel1_dev" -m 'UXor 0.1.0'
run 1 0.1.0
expect_out "0.1.0 $rel1 refused"
case "$err" in *"0.1.0"*"$rel1_dev"*) ;; *) fail "the refusal does not name the tag's commit: $err" ;; esac
teardown

setup 'a lightweight tag on another commit: refused, and every version is still reported'
g tag 0.1.0 "$start"
g tag 0.2.0 "$rel2"
run 1
expect_out "0.2.0 $rel2 tagged
0.1.0 $rel1 refused"
teardown

setup 'a partial re-run: 0.1.0 released, 0.2.0 tagged by the run that failed before publishing'
g tag -a 0.1.0 "$rel1" -m 'UXor 0.1.0'
g tag -a 0.2.0 "$rel2" -m 'UXor 0.2.0'
run 0 0.2.0
expect_out "0.2.0 $rel2 tagged"
teardown

setup 'a later edit to an old section: the notes are the section at the expected commit'
sed 's/^- first$/- first, edited later/' CHANGELOG.md > c.tmp && mv c.tmp CHANGELOG.md
g commit -qam 'docs: edit the 0.1.0 notes'
run 0 --notes-dir "$repo/notes"
expect_out "0.2.0 $rel2 untagged
0.1.0 $rel1 untagged"
grep -qx -- '- first' "$repo/notes/0.1.0.md" || fail "0.1.0's notes miss '- first': $(cat "$repo/notes/0.1.0.md")"
if grep -q 'edited later\|second\|## \[' "$repo/notes/0.1.0.md"; then fail "0.1.0's notes: $(cat "$repo/notes/0.1.0.md")"; fi
grep -qx -- '- second' "$repo/notes/0.2.0.md" || fail "0.2.0's notes miss '- second': $(cat "$repo/notes/0.2.0.md")"
if grep -q 'first' "$repo/notes/0.2.0.md"; then fail "0.2.0's notes hold 0.1.0's: $(cat "$repo/notes/0.2.0.md")"; fi
teardown

setup 'the dry run: every field, the notes at the expected commit, the refusal, and no tag made'
g tag 0.1.0 "$rel1_dev"
sed 's/^- first$/- first, edited later/' CHANGELOG.md > c.tmp && mv c.tmp CHANGELOG.md
g commit -qam 'docs: edit the 0.1.0 notes'
run 1 --dry-run
for want in "tag:            0.1.0" "commit:         $rel1" "tag exists:     yes, lightweight, at $rel1_dev" \
    "decision:       refused" "tag:            0.2.0" "commit:         $rel2" "tag exists:     no" "- first" "- second"; do
    case "$out" in *"$want"*) ;; *) fail "the dry run does not print '$want': $out" ;; esac
done
case "$out" in *'edited later'*) fail "the dry run prints the notes of the checked-out CHANGELOG.md" ;; esac
[ "$(git tag)" = 0.1.0 ] || fail "the dry run changed the tags: $(git tag | paste -sd ' ' -)"
teardown

setup 'another history (--ref): the version is planned on that history'
g checkout -q dev
run 0 --ref main 0.2.0
expect_out "0.2.0 $rel2 untagged"
run 0 0.2.0
expect_out "0.2.0 $rel2_dev untagged"
teardown

if [ "$failures" -gt 0 ]; then
    exit 1
fi
echo 'release-plan: every case plans the expected tags, commits and notes'
