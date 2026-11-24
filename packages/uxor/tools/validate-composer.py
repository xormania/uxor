#!/usr/bin/env python3
"""Strictly validate UXor's manifest and lock, allowing its two native provider version pins."""

import json
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[3]
NATIVE_PROVIDERS = ("carthage-software/mago", "byte-kitsune/mago-symfony-wiring")


def main() -> int:
    result = subprocess.run(
        ["composer", "validate", "--strict", "--check-lock", "--no-ansi"],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    sys.stdout.write(result.stdout)
    # Composer uses 1 for warnings and 2 or higher for errors (including a stale lock).
    if result.returncode != 1:
        return result.returncode

    requirements = json.loads((ROOT / "composer.json").read_text())["require"]
    allowed = {
        f"- require.{name} : exact version constraints ({requirements[name]}) should be avoided "
        "if the package follows semantic versioning"
        for name in NATIVE_PROVIDERS
    }
    # Accept only Composer's general-warning section. An additional diagnostic must fail the check.
    _, marker, details = result.stdout.partition("\n# General warnings\n")
    warnings = set(details.strip().splitlines())
    if marker and warnings and warnings <= allowed:
        print("Validated the release-matched Mago SDK and Symfony wiring pins.")
        return 0
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
