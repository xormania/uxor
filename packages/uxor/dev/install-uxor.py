#!/usr/bin/env python3
"""Install the workflow's components from this checkout's kit through Symfony UX Toolkit, then build assets.

The kit is the candidate commit (HEAD) of this repository, as GitHub's archive gives it (`git archive` applies the
export rules), installed as a local Toolkit kit: the same route as tools/tests/fresh-install.sh. Uncommitted changes
are not installed. The consumer and the Composer package therefore check the same commit.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[3]
APP = Path(__file__).resolve().parent / 'app'
KIT_NAME = 'uxor-candidate'
KITS = APP / 'vendor/symfony/ux-toolkit/kits'
RECIPES = ('theme', 'data-table', 'modal', 'toast', 'form-theme')
MARKER = APP / 'var/workflow-uxor.json'


def console(*arguments: str) -> None:
    subprocess.run([os.environ.get('PHP_BIN', 'php'), 'bin/console', *arguments, '--no-interaction'], cwd=APP, check=True)


def candidate_revision() -> str:
    return subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, check=True, text=True,
                          stdout=subprocess.PIPE).stdout.strip()


def export_kit(revision: str) -> None:
    """Write the candidate's archive as the local kit the Toolkit reads from its own kits directory."""
    if not KITS.is_dir():
        raise SystemExit('symfony/ux-toolkit is not installed in the consumer; run "run.py --native prepare" first.')
    kit = KITS / KIT_NAME
    shutil.rmtree(kit, ignore_errors=True)
    archive = subprocess.run(['git', 'archive', '--format=tar', revision], cwd=ROOT, check=True,
                             stdout=subprocess.PIPE).stdout
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:') as exported:
        exported.extractall(kit, filter='data')
    if not (kit / 'manifest.json').is_file():
        raise SystemExit('The candidate archive has no kit manifest.json.')


def installed_files() -> dict[str, str]:
    paths = [*APP.glob('src/UXor/**/*'), *APP.glob('templates/components/**/*'),
             *APP.glob('templates/form/**/*'), *APP.glob('assets/lib/**/*'),
             *APP.glob('assets/controllers/*'), APP / 'assets/styles/uxor.css']
    return {str(path.relative_to(APP)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(paths) if path.is_file() and path.name not in {'counter_controller.js', 'customer_saved_controller.js'}}


def main() -> None:
    revision = candidate_revision()
    expected = {'repository': 'https://github.com/xormania/uxor', 'revision': revision, 'recipes': list(RECIPES)}
    if MARKER.exists():
        recorded = json.loads(MARKER.read_text())
        if any(recorded.get(key) != value for key, value in expected.items()):
            raise SystemExit('The workflow components were installed from another commit or recipe list. Inspect the '
                             'application-owned files; to reinstall from this commit, remove them and '
                             + str(MARKER.relative_to(APP)) + '. No files changed.')
        if recorded.get('files') != installed_files():
            raise SystemExit('Installed fixture components are missing or customized. Inspect the changes before reinstalling.')
        print('Existing workflow installation from this commit verified; no component files overwritten.')
    else:
        if installed_files():
            raise SystemExit('Existing component files have no workflow receipt. Inspect them before installing; no files changed.')
        export_kit(revision)
        # No force: an existing application's files must never be silently replaced.
        for recipe in RECIPES:
            console('ux:install', recipe, '--kit=' + KIT_NAME)
        MARKER.parent.mkdir(parents=True, exist_ok=True)
        MARKER.write_text(json.dumps(expected | {'files': installed_files()}, indent=2) + '\n')
    console('cache:clear')
    console('importmap:install')
    console('ux:icons:lock')
    console('tailwind:build', '--minify')
    console('cache:clear')
    print(json.dumps({'status': 'ready', 'components': expected, 'application': str(APP)}))


if __name__ == '__main__':
    main()
