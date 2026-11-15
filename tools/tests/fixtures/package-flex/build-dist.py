"""Make an actual pilot archive and a synthetic metadata-only upgrade for Flex tests."""

import hashlib
import json
import sys
import zipfile
from pathlib import Path

package, recipe, output = map(Path, sys.argv[1:])
output.mkdir()
files = {
    path.relative_to(package).as_posix(): path.read_bytes()
    for path in sorted(package.rglob("*"))
    if path.is_file()
}
releases = []
for version in ("0.0.1", "0.0.2", "0.0.3"):
    if version == "0.0.2":
        # Test-only release: it proves continuous package metadata synchronization,
        # not a new production controller or a published package version.
        assets = json.loads(files["assets/package.json"])
        assets["symfony"]["controllers"]["fixture-probe"] = {
            "main": "controllers/fixture_probe_controller.js",
            "enabled": True,
            "fetch": "lazy",
        }
        assets["symfony"]["importmap"]["@xormania/uxor-pilot/fixture-helper"] = (
            "path:%PACKAGE%/lib/fixture-helper.js"
        )
        files["assets/package.json"] = json.dumps(assets, indent=4).encode()
        files["assets/controllers/fixture_probe_controller.js"] = (
            b"import { Controller } from '@hotwired/stimulus';\n"
            b"export default class extends Controller {}\n"
        )
        files["assets/lib/fixture-helper.js"] = b"export const fixtureVersion = '0.0.2';\n"
    elif version == "0.0.3":
        # Test-only incompatible peer requirement. Flex still synchronizes package
        # importmap declarations with --no-scripts, so retain the compatible importmap
        # range and avoid a registry lookup before testing the installed-state guard.
        assets = json.loads(files["assets/package.json"])
        assets["peerDependencies"]["@hotwired/stimulus"] = "^4.0.0"
        files["assets/package.json"] = json.dumps(assets, indent=4).encode()

    archive = output / f"uxor-pilot-{version}.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as dist:
        for name, contents in sorted(files.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            dist.writestr(entry, contents)
    metadata = json.loads(files["composer.json"])
    metadata.update(
        version=version,
        dist={
            "type": "zip",
            "url": archive.name,
            "reference": hashlib.sha256(archive.read_bytes()).hexdigest(),
            "shasum": hashlib.sha1(archive.read_bytes()).hexdigest(),
        },
    )
    releases.append(metadata)

(output / "releases.json").write_text(json.dumps(releases, indent=4) + "\n")
(output / "recipe.json").write_text(recipe.read_text())
