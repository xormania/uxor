#!/usr/bin/env bash
# Run a real Mate beta installation against the locked development consumer.
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

beta=1.0.0-BETA1
composer --working-dir="$trial" require --no-update \
    "symfony/ai-mate:$beta" "symfony/ai-symfony-mate-extension:$beta"
cd "$app"
composer require --dev --no-update "symfony/ai-mate:$beta" \
    "symfony/ai-symfony-mate-extension:$beta" "symfony/ai-mate-composer-plugin:$beta"
composer update --minimal-changes --no-interaction --no-progress \
    xormania/uxor symfony/ai-mate symfony/ai-symfony-mate-extension symfony/ai-mate-composer-plugin

vendor/bin/mate init --no-interaction
composer dump-autoload --no-interaction
vendor/bin/mate discover --no-interaction
vendor/bin/mate tools:list --format=json > "$trial/tools.json"
jq -e '
    [.tools | to_entries[] | select(.value.extension == "xormania/uxor") | .key] | sort ==
    ["uxor_catalog","uxor_component","uxor_doctor","uxor_project","uxor_reference","uxor_tools","uxor_workflow"]
' "$trial/tools.json"
for tool in $(jq -r '.tools | keys[] | select(startswith("uxor_"))' "$trial/tools.json"); do
    vendor/bin/mate tools:inspect "$tool" --format=json |
        jq -e --arg tool "$tool" '.name == $tool and (.input_schema | type == "object")'
done
vendor/bin/mate tools:call uxor_component --name=button --format=json |
    jq -e '.status == "completed" and .data.reference_uri == "uxor://reference/button/README.md"'
vendor/bin/mate tools:call uxor_workflow --name=customer-management --limit=64 --format=json |
    jq -e '.status == "completed" and .data.truncated and .data.next_offset == 64'
vendor/bin/mate tools:call uxor_tools --format=json |
    jq -e '.untrusted_data.status == "incomplete" and .untrusted_data.operation == "tools"'
vendor/bin/mate skills:list --format=json | jq -e '
    [.skills[] | select(.package == "xormania/uxor" and .enabled and .status == "ok") | .original_name]
    | sort == ["build","setup","verify"]
'
for skill in build setup verify; do
    vendor/bin/mate skills:validate "$skill" --format=json |
        jq -e '.skills | length == 1 and .[0].status == "ok"'
done
echo 'Seven tool schemas, two reads, the trust check and three installed skills passed.'
