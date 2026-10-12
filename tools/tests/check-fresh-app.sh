#!/usr/bin/env bash
# Checks the app that fresh-install.sh and docker-install.sh build from tools/tests/fixtures/fresh-app: `/` renders
# the dashboard through the layouts, `/register` renders the signup form through the form theme (no
# `twig.form_themes` setting: the block applies the theme itself), `/orders` renders a DataTable whose PHP classes
# ux:install copied into src/, `/live-orders` a DataTableLive that answers a Live action, `/pick` autocomplete fields and
# the Autocomplete component, `/dates` a DateType opted into the date picker, `/charts` two charts, `/upload`
# DropzoneType fields that take a posted file, `/post` an EditorType that sanitizes what it stores, and all answer 200.
#
#   tools/tests/check-fresh-app.sh <base URL> [curl option…]
set -euo pipefail

base="$1"
shift
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch() { # fetch <path> [curl option…]: prints the page on one line, fails unless it answers 200
    local path="$1" status
    shift
    status="$(curl -s "$@" -o "$work/page.html" -w '%{http_code}' "$base$path")"
    if [ "$status" != 200 ]; then
        if [ -f "$work/page.html" ]; then grep -o '<title>[^<]*' "$work/page.html" >&2 || true; fi
        echo "FAIL: $path answered $status" >&2
        exit 1
    fi
    tr '\n' ' ' < "$work/page.html"
}

page="$(fetch / "$@")"
for expected in '<h1[^>]*>[[:space:]]*Dashboard[[:space:]]*</h1>' 'Recent orders' '<aside[^>]*id="sidebar"[^>]*data-turbo-permanent' 'id="toasts"'; do
    grep -qE -- "$expected" <<< "$page" || { echo "FAIL: the dashboard page lacks $expected" >&2; exit 1; }
done
echo "ok: the dashboard renders (HTTP 200)"

# The page's import map serves every local module it names, the kit's controllers among them: what a browser loads to
# start Stimulus in this freshly installed app (a missing or failed asset here leaves every widget inert)
modules="$(grep -oE '<script type="importmap"[^>]*>.*</script>' <<< "$page" | grep -oE ':[[:space:]]*"/assets/[^"]+\.js"' | grep -oE '/assets/[^"]+' | sort -u)"
grep -q '^/assets/controllers/' <<< "$modules" || { echo "FAIL: the dashboard's import map names no controller of the kit" >&2; exit 1; }
while IFS= read -r module; do
    status="$(curl -s "$@" -o /dev/null -w '%{http_code} %{content_type}' "$base$module")"
    [[ "$status" == "200 "*javascript* ]] || { echo "FAIL: $module (in the import map) answered $status" >&2; exit 1; }
done <<< "$modules"
echo "ok: the import map's $(wc -l <<< "$modules") local modules answer as JavaScript, the kit's controllers included"

# Symfony's default layout would print a bare <input id="form_email"> and <label for="form_email" class="required">;
# the theme prints the kit's components
page="$(fetch /register "$@")"
grep -oE '<input[^>]*>' <<< "$page" | grep 'id="form_email"' | grep -q 'rounded-base' \
    || { echo "FAIL: the signup email field is not the Input component" >&2; exit 1; }
grep -oE '<label[^>]*>' <<< "$page" | grep 'for="form_email"' | grep -q 'text-heading' \
    || { echo "FAIL: the signup email label is not FormField's" >&2; exit 1; }
grep -qE '<p id="form_plainPassword_help"[^>]*>[[:space:]]*At least 12 characters' <<< "$page" \
    || { echo "FAIL: the signup password help is not FormField's" >&2; exit 1; }
echo "ok: the signup form renders through the form theme (HTTP 200)"

# the data-table recipe's PHP (src/UXor/DataTable/) works in the app: the table reads its page, sort and filter
# from the URL, and its links keep them
page="$(fetch '/orders?page=2&sort=number&dir=desc&f%5Bstatus%5D=paid' "$@")"
grep -qE 'Showing <span[^>]*>11–12</span> of <span[^>]*>12</span>' <<< "$page" \
    || { echo "FAIL: the orders table does not show its second page of paid orders" >&2; exit 1; }
grep -qE '<turbo-frame[^>]*id="orders"[^>]*data-turbo-action="advance"' <<< "$page" \
    || { echo "FAIL: the orders table is not in its Turbo Frame" >&2; exit 1; }
grep -qE 'id="orders-row-2"' <<< "$page" \
    || { echo "FAIL: the orders table rows have no stable ids" >&2; exit 1; }
grep -qE 'href="/orders\?sort=number&amp;dir=desc&amp;f%5Bstatus%5D=paid"' <<< "$page" \
    || { echo "FAIL: the orders table page links lose the sort or the filter" >&2; exit 1; }
echo "ok: the orders DataTable renders from the recipe's PHP (HTTP 200)"

# the data-table-live recipe's PHP works as a Live Component: the page renders it, and its `goTo` action, sent as the
# live controller sends it (tools/tests/live-action.php), answers with the requested page
page="$(fetch /live-orders "$@")"
grep -qE 'data-live-name-value="LiveOrders"' <<< "$page" \
    || { echo "FAIL: the live orders table is not a Live Component" >&2; exit 1; }
body="$("${PHP:-php}" "$(dirname "$0")/live-action.php" "$work/page.html" '{"page":"2"}')"
status="$(curl -s "$@" -o "$work/action.html" -w '%{http_code}' -X POST "$base/_components/LiveOrders/goTo" \
    -H 'Accept: application/vnd.live-component+html' -H 'X-Requested-With: XMLHttpRequest' --data-urlencode "data=$body")"
[ "$status" = 200 ] || { echo "FAIL: the live orders table's goTo action answered $status" >&2; exit 1; }
grep -qE 'Showing <span[^>]*>11–20</span> of <span[^>]*>25</span>' "$work/action.html" \
    || { echo "FAIL: the live orders table's goTo action did not render page 2" >&2; exit 1; }
echo "ok: the live orders DataTableLive renders and answers a Live action (HTTP 200)"

# the autocomplete recipe: a form field with `'autocomplete' => true` renders through the form theme with UX
# Autocomplete's controller, the recipe's autocomplete-sync and the label reference for Tom Select, the Autocomplete
# component renders a Select with both controllers, and the remote field's search URL answers with its JSON results
page="$(fetch /pick "$@")"
# the select's controllers: UX Autocomplete's, and the recipe's autocomplete-sync beside it (one list, any order)
controllers() { grep -oE 'data-controller="[^"]*"' <<< "$1" | cut -d'"' -f2 | tr ' ' '\n'; }
select="$(grep -oE '<select[^>]*id="form_country"[^>]*>' <<< "$page")"
for expected in symfony--ux-autocomplete--autocomplete autocomplete-sync; do
    controllers "$select" | grep -qx -- "$expected" || { echo "FAIL: the autocomplete form field lacks the $expected controller" >&2; exit 1; }
done
for expected in 'aria-labelledby="form_country-ts-label"' 'rounded-base'; do
    grep -q -- "$expected" <<< "$select" || { echo "FAIL: the autocomplete form field lacks $expected" >&2; exit 1; }
done
select="$(grep -oE '<select[^>]*id="fruit"[^>]*>' <<< "$page")"
for expected in symfony--ux-autocomplete--autocomplete autocomplete-sync; do
    controllers "$select" | grep -qx -- "$expected" || { echo "FAIL: the Autocomplete component lacks the $expected controller" >&2; exit 1; }
done
for expected in 'aria-labelledby="fruit-ts-label"' 'tom-select-options-value="{&quot;create&quot;:true}"' 'rounded-base'; do
    grep -q -- "$expected" <<< "$select" || { echo "FAIL: the Autocomplete component lacks $expected" >&2; exit 1; }
done
url="$(grep -oE '<select[^>]*id="form_customer"[^>]*>' <<< "$page" | grep -oE 'autocomplete-url-value="[^"]*"' | cut -d'"' -f2)"
[ -n "$url" ] || { echo "FAIL: the remote autocomplete field has no search URL" >&2; exit 1; }
fetch "$url?query=bon" "$@" | grep -q '"text":"Bonnie Green"' \
    || { echo "FAIL: the remote autocomplete field's search URL does not find Bonnie Green" >&2; exit 1; }
echo "ok: the autocomplete fields and component render, and the remote search answers (HTTP 200)"

# the date-picker recipe through the form theme's opt-in: the typed field takes the field's id, the hidden input its
# name and value, and the calendar its bounds
page="$(fetch /dates "$@")"
grep -oE '<input[^>]*>' <<< "$page" | grep 'id="form_startsOn"' | grep -q 'data-date-picker-target="input"' \
    || { echo "FAIL: the opted-in date field is not the date picker's text field" >&2; exit 1; }
grep -oE '<input[^>]*>' <<< "$page" | grep 'name="form\[startsOn\]"' | grep 'type="hidden"' | grep -q 'value="2026-03-12"' \
    || { echo "FAIL: the date picker's hidden input lacks the field's name or value" >&2; exit 1; }
grep -qE 'data-calendar-min-date-value="2026-01-01"' <<< "$page" \
    || { echo "FAIL: the date picker's calendar lacks the field's min" >&2; exit 1; }
echo "ok: the date picker renders an opted-in DateType (HTTP 200)"

# the chart recipe: a Chart from arrays and one from ChartBuilderInterface, each with its canvas for UX Chart.js, its
# theme controller and its data table; Flex put chart.js in the import map (StimulusBundle loads UX Chart.js's
# controller from controllers.json, without an import map entry)
page="$(fetch /charts "$@")"
for expected in 'data-controller="chart"' 'data-controller="symfony--ux-chartjs--chart"' 'role="img"' '<table id="revenue-table"' 'bg-chart-1' '"chart.js"'; do
    grep -qF -- "$expected" <<< "$page" || { echo "FAIL: the charts page lacks $expected" >&2; exit 1; }
done
grep -oE 'data-symfony--ux-chartjs--chart-view-value="[^"]*' <<< "$page" | grep -q 'Mon' \
    || { echo "FAIL: the ChartBuilderInterface chart lost its labels" >&2; exit 1; }
echo "ok: the chart recipe renders charts from arrays and from ChartBuilderInterface (HTTP 200)"

# the dropzone recipe through the form theme, for every DropzoneType: the kit's markup (never the package's theme), the
# help wired to the file input, several files under one name; Flex registered the bundle without a recipe, and a
# posted file reaches the form
page="$(fetch /upload "$@" -c "$work/cookies")"
grep -oE '<form[^>]*>' <<< "$page" | grep -q 'enctype="multipart/form-data"' \
    || { echo "FAIL: the upload form is not multipart" >&2; exit 1; }
grep -q 'data-controller="symfony--ux-dropzone--dropzone dropzone-assist"' <<< "$page" \
    || { echo "FAIL: the upload page lacks the Dropzone component" >&2; exit 1; }
grep -oE '<input[^>]*>' <<< "$page" | grep 'id="form_photo"' | grep 'type="file"' | grep -q 'aria-describedby="form_photo_help"' \
    || { echo "FAIL: the photo file input lacks its help" >&2; exit 1; }
grep -oE '<input[^>]*>' <<< "$page" | grep 'name="form\[files\]\[\]"' | grep -q ' multiple' \
    || { echo "FAIL: the several-files input lacks its name or multiple" >&2; exit 1; }
for unexpected in 'dropzone-container' 'style="'; do
    if grep -qF -- "$unexpected" <<< "$page"; then echo "FAIL: the upload page has $unexpected" >&2; exit 1; fi
done
# a 1×1 PNG, posted as the browser would: with the form's CSRF token when it has one, its cookies and its origin
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' | base64 -d > "$work/tiny.png"
token="$(grep -oE '<input[^>]*name="form\[_token\]"[^>]*>' <<< "$page" | grep -oE 'value="[^"]*"' | sed 's/^value="//; s/"$//' || true)"
location="$(curl -s "$@" -o /dev/null -w '%{http_code} %{redirect_url}' -b "$work/cookies" -H "Origin: $base" \
    -F "form[photo]=@$work/tiny.png;type=image/png" ${token:+-F "form[_token]=$token"} "$base/upload")"
case "$location" in
    "303 "*"uploaded=tiny.png") ;;
    *) echo "FAIL: posting a PNG to /upload answered $location" >&2; exit 1 ;;
esac
echo "ok: a DropzoneType renders through the dropzone recipe and takes a posted file (HTTP 200, 303)"

# the editor recipe through the form theme: an EditorType renders the Editor (a textbox named by the label, the hidden
# textarea under the field's name), and a posted body is stored sanitized
page="$(fetch /post "$@" -c "$work/cookies")"
for expected in 'data-controller="editor"' 'role="textbox"' 'aria-labelledby="form_body_label"' 'id="form_body_label"' 'name="form[body]"' 'role="toolbar"'; do
    grep -qF -- "$expected" <<< "$page" || { echo "FAIL: the post page lacks $expected" >&2; exit 1; }
done
if grep -q ' style="' <<< "$page"; then echo "FAIL: the post page has a style attribute" >&2; exit 1; fi
token="$(grep -oE '<input[^>]*name="form\[_token\]"[^>]*>' <<< "$page" | grep -oE 'value="[^"]*"' | sed 's/^value="//; s/"$//' || true)"
location="$(curl -s "$@" -o /dev/null -w '%{http_code} %{redirect_url}' -b "$work/cookies" -H "Origin: $base" \
    --data-urlencode 'form[body]=<p onclick="x()">Hi <script>x()</script></p>' ${token:+--data-urlencode "form[_token]=$token"} "$base/post")"
case "$location" in
    "303 "*"stored=%3Cp%3EHi%3C/p%3E") ;;
    *) echo "FAIL: posting a body to /post answered $location" >&2; exit 1 ;;
esac
echo "ok: an EditorType renders the Editor and stores sanitized HTML (HTTP 200, 303)"

# the markdown-editor recipe through the form theme: a MarkdownType renders the MarkdownEditor Live Component (the
# textarea under the field's id and name, the Write and Preview tabs), its `preview` action renders the typed Markdown
# on the server, and a posted body is stored as Markdown and printed without its raw HTML
page="$(fetch /note "$@" -c "$work/cookies")"
for expected in 'data-live-name-value="MarkdownEditor"' 'data-controller="markdown-editor"' 'role="tablist"' 'id="form_body"' 'name="form[body]"' 'role="toolbar"'; do
    grep -qF -- "$expected" <<< "$page" || { echo "FAIL: the note page lacks $expected" >&2; exit 1; }
done
if grep -q ' style="' <<< "$page"; then echo "FAIL: the note page has a style attribute" >&2; exit 1; fi
body="$("${PHP:-php}" "$(dirname "$0")/live-action.php" "$work/page.html" '{}' '{"value":"**Hi** [bad](javascript:x)"}')"
status="$(curl -s "$@" -o "$work/action.html" -w '%{http_code}' -X POST "$base/_components/MarkdownEditor/preview" \
    -H 'Accept: application/vnd.live-component+html' -H 'X-Requested-With: XMLHttpRequest' --data-urlencode "data=$body")"
[ "$status" = 200 ] || { echo "FAIL: the markdown editor's preview action answered $status" >&2; exit 1; }
grep -qF '<strong>Hi</strong>' "$work/action.html" && ! grep -qF 'href="javascript' "$work/action.html" \
    || { echo "FAIL: the markdown editor's preview did not render the Markdown safely" >&2; exit 1; }
token="$(grep -oE '<input[^>]*name="form\[_token\]"[^>]*>' <<< "$page" | grep -oE 'value="[^"]*"' | sed 's/^value="//; s/"$//' || true)"
location="$(curl -s "$@" -o /dev/null -w '%{http_code} %{redirect_url}' -b "$work/cookies" -H "Origin: $base" \
    --data-urlencode 'form[body]=**Hi** <script>x()</script>' ${token:+--data-urlencode "form[_token]=$token"} "$base/note")"
case "$location" in
    "303 "*"stored=**Hi**%20%3Cscript%3Ex%28%29%3C/script%3E") ;;
    *) echo "FAIL: posting a body to /note answered $location" >&2; exit 1 ;;
esac
page="$(fetch "/note?${location#*\?}" "$@")"
grep -qF '<div id="stored"><p><strong>Hi</strong>' <<< "$page" && ! grep -qF '<script>x()' <<< "$page" \
    || { echo "FAIL: the stored Markdown is not printed as safe HTML" >&2; exit 1; }
echo "ok: a MarkdownType renders the MarkdownEditor, previews on the server and prints stored Markdown safely (HTTP 200, 303)"
