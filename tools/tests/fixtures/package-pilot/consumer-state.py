#!/usr/bin/env python3
"""Fingerprint app-owned source, including its manifest/importmap; generated assets and selected locks are separate."""
import hashlib
import json
from pathlib import Path

paths = [Path(name) for name in ('composer.json', 'importmap.php')]
for directory in ('src', 'templates', 'styles', 'bin', 'public', 'assets'):
    paths.extend(path for path in Path(directory).rglob('*') if path.is_file() and not any(
        path.is_relative_to(Path(generated)) for generated in ('public/assets', 'assets/vendor', 'assets/styles')
    ))
print(json.dumps({str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}, sort_keys=True))
