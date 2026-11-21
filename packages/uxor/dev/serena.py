#!/usr/bin/env python3
"""Build or launch the development consumer's offline Serena editor."""
import argparse
import csv
import hashlib
import io
import os
from pathlib import Path
import subprocess
import sys

DEV = Path(__file__).resolve().parent
ROOT = DEV.parents[2]
CONTEXT = DEV / "images/serena"


def image_tag():
    digest = hashlib.sha256()
    for name in ("Dockerfile", "start.py", "package.json", "package-lock.json"):
        digest.update(name.encode() + b"\0" + (CONTEXT / name).read_bytes() + b"\0")
    return "uxor-dev-serena:" + digest.hexdigest()[:20]


def image_id(tag):
    result = subprocess.run(["docker", "image", "inspect", "--format", "{{.Id}}", tag],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"Could not inspect {tag}. Run 'run.py serena --prepare'.\n{result.stderr.strip()}")
    return result.stdout.strip()


def prepare():
    tag = image_tag()
    subprocess.run(["docker", "build", "--tag", tag, str(CONTEXT)], stdout=sys.stderr, check=True)
    return image_id(tag)


def bind(path, target, readonly=False):
    # Docker --mount parses CSV. A quoted source field preserves commas in worktree names.
    output = io.StringIO()
    csv.writer(output, lineterminator="\n").writerow(
        ["type=bind", f"source={path}", f"target={target}", *(["readonly"] if readonly else [])])
    return output.getvalue().rstrip("\n")


def command(image, cache, write):
    args = ["docker", "run", "--rm", "--interactive", "--init", "--pull=never", "--network=none",
            "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
            "--user", f"{os.getuid()}:{os.getgid()}", "--tmpfs", "/tmp:rw,nosuid,nodev,mode=1777",
            "--mount", bind(ROOT, "/workspace", readonly=not write),
            "--mount", f"type=volume,source={cache},target=/cache", image]
    if write:
        args.append("--write")
    return args


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true", help="Build the editor image and exit")
    parser.add_argument("--write", action="store_true", help="Grant the editor write access to the checkout")
    args = parser.parse_args()
    if args.prepare:
        print(prepare(), file=sys.stderr)
        return
    tag = image_tag()
    image = image_id(tag)
    scope = f"{ROOT}\0{os.getuid()}:{os.getgid()}\0{image}".encode()
    cache = "uxor-dev-serena-" + hashlib.sha256(scope).hexdigest()[:24]
    os.execvp("docker", command(image, cache, args.write))


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
