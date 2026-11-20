"""Verify the provider installation and record runtime provenance and notices."""
import hashlib
from importlib.metadata import distribution, distributions
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tomllib

import serena
import serena_mago.server


ROOT = Path("/opt/mago-serena-provider")
LICENSES = ROOT / "licenses"
PATCHES = ROOT / "patches"
sys.path.insert(0, str(PATCHES))
from apply_serena import apply


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def command(*arguments):
    return subprocess.check_output(arguments, text=True).strip()


def collect_licenses(php_version):
    php_license = LICENSES / "php" / "LICENSE"
    php_license.parent.mkdir()
    with tarfile.open("/usr/src/php.tar.xz") as source:
        with source.extractfile(f"php-{php_version}/LICENSE") as f:
            php_license.write_bytes(f.read())
    python_license = LICENSES / "python-runtime"
    python_license.mkdir()
    shutil.copy2(Path(sys.base_prefix, "lib", f"python{sys.version_info.major}.{sys.version_info.minor}", "LICENSE.txt"), python_license)
    for package in distributions():
        for file in package.files or []:
            if "licenses" not in file.parts or ".." in file.parts or file.is_absolute():
                continue
            source = package.locate_file(file)
            if source.is_file():
                target = LICENSES / "python" / package.metadata["Name"] / file.name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
    serena_licenses = LICENSES / "python" / "serena-agent"
    for filename in ("LICENSE", "GPL-3.0-or-later.txt", "MIT.txt"):
        if not (serena_licenses / filename).is_file():
            raise RuntimeError(f"Serena notice is missing: {filename}")


def main(php_image, python_image, uv_image, composer_image, rust_image, uv_version):
    lock = Path("uv.lock")
    serena_pin = next(package for package in tomllib.loads(lock.read_text())["package"]
                      if package["name"] == "serena-agent")
    serena_dist = distribution("serena-agent")
    serena_source = json.loads(serena_dist.read_text("direct_url.json"))["vcs_info"]["commit_id"]
    if serena_source != serena_pin["source"]["git"].rsplit("#", 1)[1]:
        raise RuntimeError("Installed Serena source revision differs from the provider lock")
    facade = apply(Path(serena.__file__).resolve().parent.parent)
    php_version = command("php", "-r", "echo PHP_VERSION;")
    collect_licenses(php_version)
    packages = ROOT / "os-packages.txt"
    packages.write_text(command("dpkg-query", "-W") + "\n")
    binary = Path("/usr/local/bin/mago")
    identity = {
        "base_image": php_image,
        "build_images": {"python": python_image, "uv": uv_image, "composer": composer_image, "rust": rust_image},
        "debian_snapshot": Path("/opt/debian-snapshot.txt").read_text().strip(),
        "os_packages_sha256": digest(packages),
        "php": php_version,
        "php_extensions": sorted(command("php", "-r", "echo implode(PHP_EOL, get_loaded_extensions());").splitlines()),
        "composer": command("composer", "--no-ansi", "--version").splitlines()[0],
        "python": sys.version.split()[0],
        "uv": uv_version,
        "uv_lock_sha256": digest(lock),
        "serena": serena_dist.version,
        "serena_source_sha": serena_source,
        "serena_facade_sha256": digest(facade),
        "serena_patch_sha256": digest(PATCHES / "serena-symbol-references.patch"),
        "adapter_source_sha": (ROOT / "poc-source.sha").read_text().strip(),
        "adapter_sha256": digest(Path(serena_mago.server.__file__)),
        "mago": command(binary, "--version"),
        "mago_binary_sha256": digest(binary),
        "mago_source_sha": (ROOT / "mago-source.sha").read_text().strip(),
        "mago_lsp_source_sha": (ROOT / "mago-lsp-source.sha").read_text().strip(),
        "mago_lsp_base_sha": (ROOT / "mago-lsp-base.sha").read_text().strip(),
        "mago_rust_version": (ROOT / "rust-version.txt").read_text().strip(),
        "mago_cargo_lock_sha256": digest(LICENSES / "mago/Cargo.lock"),
        "mago_patch_sha256": {patch.name: digest(patch) for patch in sorted(PATCHES.glob("mago-*.patch"))},
    }
    (ROOT / "identity.json").write_text(json.dumps(identity, indent=2) + "\n")


if __name__ == "__main__":
    main(*sys.argv[1:])
