#!/usr/bin/env bash
# Check the locked Mate beta in a disposable copy of the development consumer.
set -euo pipefail

root=$(cd "$(dirname "$0")/../../.." && pwd)
trial=$(mktemp -d)
trap 'rm -rf "$trial"' EXIT
app="$trial/packages/uxor/dev/app"
package="$trial/packages/uxor"
mkdir -p "$app/mate"
cp "$root/composer.json" "$trial/"
for part in bin config resources skills src INSTRUCTIONS.md; do
    cp -R "$root/packages/uxor/$part" "$package/"
done
cp "$root/packages/uxor/dev/app/"{composer.json,composer.lock} "$app/"
cp "$root/packages/uxor/dev/app/mate/config.php" "$app/mate/"

cd "$app"
composer install --prefer-dist --no-interaction --no-progress

jq -e --arg version 'v1.0.0-BETA1' '
    INDEX(.packages[]; .name)
    | .["symfony/ai-mate"].version == $version
      and .["symfony/ai-mate-composer-plugin"].version == $version
      and .["symfony/ai-symfony-mate-extension"].version == $version
' vendor/composer/installed.json
vendor/bin/mate init --no-interaction
composer dump-autoload --no-interaction
vendor/bin/mate discover --no-interaction
tools_json=$(vendor/bin/mate tools:list --format=json)
jq -e '
    [.tools | to_entries[] | select(.value.extension == "xormania/uxor") | .key] | sort ==
    ["uxor_browser_diagnostics","uxor_catalog","uxor_component","uxor_doctor","uxor_environment","uxor_prepare","uxor_project","uxor_reference","uxor_setup","uxor_tools","uxor_workflow"]
' <<< "$tools_json"
for tool in $(jq -r '.tools | keys[] | select(startswith("uxor_"))' <<< "$tools_json"); do
    vendor/bin/mate tools:inspect "$tool" --format=json |
        jq -e --arg tool "$tool" '.name == $tool and (.input_schema | type == "object")'
done
vendor/bin/mate tools:call uxor_component --name=button --format=json |
    jq -e '.status == "completed" and .data.reference_uri == "uxor://reference/button/README.md"'
vendor/bin/mate tools:call uxor_workflow --name=customer-management --limit=64 --format=json |
    jq -e '.status == "completed" and .data.truncated and .data.next_offset == 64'
vendor/bin/mate tools:call uxor_tools --format=json |
    jq -e '.untrusted_data | .status == "incomplete" and .operation == "tools" and .data.project_code_executed == false'
skill_names=()
for directory in "$package"/skills/*/; do
    [[ -d "$directory" ]] || continue
    directory=${directory%/}
    skill_names+=("${directory##*/}")
done
if [[ ${#skill_names[@]} -ne 3 ]]; then
    printf 'Expected three UXor skill source directories, found %s.\n' "${#skill_names[@]}" >&2
    exit 1
fi
vendor/bin/mate skills:list --format=json | jq -e --args '
    [.skills[] | select(.package == "xormania/uxor")] as $owned
    | ($owned | map(.original_name) | sort) == ($ARGS.positional | sort)
      and all($owned[]; .enabled == true and .status == "ok" and .installed_name == ("mate-" + .original_name))
' "${skill_names[@]}"
for skill in "${skill_names[@]}"; do
    vendor/bin/mate skills:validate "$skill" --format=json |
        jq -e --arg installed "mate-$skill" '.skills | length == 1 and .[0].name == $installed and .[0].status == "ok"'
done
echo 'Eleven tool schemas, two reads, the trust check and three installed skills passed.'
