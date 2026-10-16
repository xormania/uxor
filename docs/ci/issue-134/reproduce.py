#!/usr/bin/env python3
"""Replay pinned issue-134 evidence without browsers, network, or remote writes.

Requires Python 3.9+, Node, Git, Bash, jq, the three pinned Git objects, and their
locked npm dependencies already installed in the repository. No installation is
performed. Output contains complete scratch source trees: keep it outside Git.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

MAIN = '9b2fa7309786cee435503de87cf0cd5f0a9d9782'
DEV = '40d957cd1ea7766ac0dee742816948ce5ae05bc3'
FIX = 'c128aeec88b1c17c753c21bc91d619a1e5027411'
parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--repo', type=Path,
                    help='repository containing the pinned objects and npm dependencies; default: this file\'s checkout')
parser.add_argument('--output', type=Path,
                    help='new or empty owned directory outside the checkout; default: a fresh temporary directory')
args = parser.parse_args()
if args.repo is None:
    script_parents = Path(__file__).resolve().parents
    if len(script_parents) < 4:
        parser.error('cannot infer this file\'s checkout; provide --repo')
    args.repo = script_parents[3]
REPO = args.repo.expanduser().resolve()
if sys.version_info < (3, 9):
    parser.error('Python 3.9 or later is required')
if sys.flags.optimize:
    parser.error('run without -O: the evidence assertions must remain enabled')
for executable in ['git', 'node', 'bash', 'jq']:
    if shutil.which(executable) is None:
        parser.error(f'{executable} is required on PATH')
if not REPO.is_dir():
    parser.error(f'repository directory does not exist: {REPO}')
git_check = subprocess.run(['git', '-C', str(REPO), 'rev-parse', '--show-toplevel'], text=True, capture_output=True)
if git_check.returncode or Path(git_check.stdout.strip()).resolve() != REPO:
    parser.error('--repo must name a Git checkout root')
for revision in [MAIN, DEV, FIX]:
    check = subprocess.run(['git', '-C', str(REPO), 'cat-file', '-e', f'{revision}^{{commit}}'], capture_output=True)
    if check.returncode:
        parser.error(f'missing pinned Git commit {revision}; make it available before this offline replay')

# Validate the installation against the pinned lock, not against a possibly newer working-tree lock.
lock_bytes = subprocess.check_output(['git', '-C', str(REPO), 'show', f'{FIX}:package-lock.json'])
locked = json.loads(lock_bytes)
for location, metadata in locked['packages'].items():
    if not location:
        continue
    package = REPO / location / 'package.json'
    if not package.is_file():
        if metadata.get('optional'):
            continue
        parser.error(f'missing locked npm dependency: {location}; install the pinned lock before replaying')
    if json.loads(package.read_text())['version'] != metadata['version']:
        parser.error(f'npm dependency version differs from the pinned lock: {location}')
node = shutil.which('node')
node_version = subprocess.check_output([node, '--version'], text=True).strip()
if int(node_version.lstrip('v').split('.')[0]) < 22:
    parser.error('Node 22 or later is required to replay these snapshots')

if args.output is None:
    OUT = Path(tempfile.mkdtemp(prefix='uxor-issue134-proof-')).resolve()
else:
    candidate = args.output.expanduser().absolute()
    if candidate.is_symlink():
        parser.error('--output must not be a symlink')
    OUT = candidate.resolve()
if OUT == REPO or OUT.is_relative_to(REPO):
    parser.error('--output must be outside the repository checkout')
if OUT.exists():
    if not OUT.is_dir() or any(OUT.iterdir()):
        parser.error('--output must be new or empty; existing files are never removed')
    if hasattr(os, 'getuid') and OUT.stat().st_uid != os.getuid():
        parser.error('--output must be owned by the current user')
else:
    try:
        OUT.mkdir()
    except OSError as error:
        parser.error(f'cannot create --output directory: {error}')
print(f'Evidence output: {OUT}', flush=True)
ENV = {'PATH': os.environ['PATH'], 'RELEASE_CHECKS': '1', 'DEMO_URL': 'https://localhost'}
receipts = []

def git(*args):
    return subprocess.check_output(['git', '-C', str(REPO), *args])

def export(revision, name):
    dest = OUT / name
    dest.mkdir()
    # Include development files which the consumer archive deliberately excludes.
    entries = [entry.split(b'\t', 1) for entry in git('ls-tree', '-r', '-z', revision).split(b'\0') if entry]
    hashes = [metadata.split()[2] for metadata, path in entries]
    blobs = subprocess.check_output(['git', '-C', str(REPO), 'cat-file', '--batch'], input=b'\n'.join(hashes) + b'\n')
    offset = 0
    for (metadata, path), blob_hash in zip(entries, hashes):
        end = blobs.index(b'\n', offset)
        header = blobs[offset:end].split()
        assert header[0] == blob_hash and header[1] == b'blob', header
        size = int(header[2])
        data = blobs[end + 1:end + 1 + size]
        offset = end + 1 + size + 1
        relative = Path(path.decode())
        assert not relative.is_absolute() and '..' not in relative.parts, path
        target = dest / relative
        mode = metadata.split()[0]
        assert mode in [b'100644', b'100755'], f'unsupported tree entry: {path!r}'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        target.chmod(0o755 if mode == b'100755' else 0o644)
    (dest / 'node_modules').symlink_to(REPO / 'node_modules', target_is_directory=True)
    return dest

def run(name, command, cwd, expected, extra=None, assertion=None):
    started = time.monotonic()
    proc = subprocess.run(command, cwd=cwd, env={**ENV, **(extra or {})}, text=True, capture_output=True)
    stdout = OUT / f'{name}.stdout.log'
    stderr = OUT / f'{name}.stderr.log'
    stdout.write_text(proc.stdout)
    stderr.write_text(proc.stderr)
    receipt = {'id': name, 'command': command, 'cwd': str(cwd), 'exit_status': proc.returncode,
               'expected_exit_status': expected, 'stdout': stdout.name, 'stderr': stderr.name,
               'elapsed_seconds': round(time.monotonic() - started, 3), 'assertion': assertion}
    receipts.append(receipt)
    print(f'{name}: exit {proc.returncode}, expected {expected}', flush=True)
    assert proc.returncode == expected, proc.stdout[-3000:] + proc.stderr[-3000:]
    return proc

dev = export(DEV, 'target-dev')
main = export(MAIN, 'target-main')
fixed = export(FIX, 'fixed')
cli = 'node_modules/@playwright/test/cli.js'
filter_arg = '/release\\.[^/]*\\.spec\\.ts$'

# Actual historical main launch selectors, with --list to avoid launching browsers.
old = run('historical-main-selectors-vs-dev', [node, cli, 'test', '--grep', '@release', '--workers=1',
    '--project=smoke', '--project=smoke-dark@release', '--project=harsh@release', '--list'], dev, 1,
    assertion='Playwright rejects the two obsolete project names before execution.')
assert 'Project(s) "smoke-dark@release", "harsh@release" not found.' in old.stderr
assert 'Cannot find module' not in old.stdout + old.stderr

counts = {}
for label, cwd, projects, grep in [
    ('current', dev, ['release', 'release-dark', 'release-harsh'], []),
    ('legacy', main, ['smoke', 'smoke-dark@release', 'harsh@release'], ['--grep', '@release']),
]:
    listed = run(f'{label}-release-spec-discovery', [node, cli, 'test', filter_arg, '--list', '--reporter=json',
        *[f'--project={name}' for name in projects], *grep], cwd, 0,
        assertion='The real pinned configuration accepts its own complete family; focused listing imports no Symfony inventory.')
    report = json.loads(listed.stdout)
    assert not report.get('errors'), report.get('errors')
    tests = []
    def walk(suite):
        for spec in suite.get('specs', []):
            tests.extend({'file': spec['file'], 'project': test['projectName'], 'title': spec['title']} for test in spec['tests'])
        for child in suite.get('suites', []): walk(child)
    for suite in report['suites']: walk(suite)
    counts[label] = {'tests': len(tests), 'projects_configured': [p['name'] for p in report['config']['projects']],
                     'tests_by_project': {p: sum(t['project'] == p for t in tests) for p in projects},
                     'specs': sorted(set(t['file'] for t in tests))}
    assert len(tests) > 0 and len(counts[label]['specs']) == 3

grep = run('obsolete-grep-vs-current-release-specs', [node, cli, 'test', filter_arg, '--list', '--reporter=json',
    '--project=release', '--project=release-dark', '--project=release-harsh', '--grep', '@release'], dev, 1,
    assertion='Renaming projects alone is insufficient: the obsolete grep selects no tests.')
grep_report = json.loads(grep.stdout)
assert any('No tests found' in e.get('message', '') for e in grep_report.get('errors', [])), grep_report
assert 'Cannot find module' not in grep.stdout + grep.stderr

# Historical implementation receives both event and actual-checkout inputs. Its output exposes the bug.
provenance_env = {'GITHUB_SHA': MAIN, 'GITHUB_REF_NAME': 'main', 'GITHUB_WORKFLOW_SHA': MAIN,
    'GITHUB_WORKFLOW_REF': 'example/project/.github/workflows/release-checks.yml@refs/heads/main',
    'TESTED_SHA': DEV, 'TESTED_REF': 'dev', 'RESOLVED_SHA': DEV, 'RESOLVED_REF': 'dev', 'TESTS_OUTCOME': 'failure'}
for label, source in [('historical', main), ('fixed', fixed)]:
    cwd = OUT / f'provenance-{label}'
    cwd.mkdir()
    result = run(f'{label}-provenance', [node, str(source / 'tools/ci/playwright-summary.mjs'), 'playwright-results/results.json'],
        cwd, 2, provenance_env, assertion='A missing report remains fatal; inspect the tested-commit identity separately.')
    summary = (cwd / 'playwright-results/summary.md').read_text()
    attempts = json.loads((cwd / 'playwright-results/failed-attempts.json').read_text())
    assert attempts['counts'] is None and attempts['status'] == 'missing'
    if label == 'historical':
        assert re.search(r'Tested commit:.*' + MAIN, summary)
        assert not re.search(r'Tested commit:.*' + DEV, summary)
    else:
        assert re.search(r'Tested commit:.*' + DEV, summary)
        assert re.search(r'Workflow definition:.*' + MAIN, summary)
        assert re.search(r'Event commit:.*' + MAIN, summary)

# Execute each historical/fixed scheduler's actual compare shell against the same controlled manual-success API.
# jq applies the workflow's own --jq expressions; canned trusted ids would not exercise its trust decision.
marker_bin = OUT / 'marker-bin'
marker_bin.mkdir()
gh = marker_bin / 'gh'
gh.write_text('''#!/usr/bin/env bash
case "$2" in
    */commits/dev) payload="$API_HEAD" ;;
    */actions/artifacts?*) payload="$API_ARTIFACTS" ;;
    */actions/runs/73) payload="$API_RUN" ;;
    *) echo "Unexpected API route: $2" >&2; exit 2 ;;
esac
printf '%s' "$payload" | jq -r "$4"
''')
gh.chmod(0o755)
for label, source, should_run in [('historical', main, 'false'), ('fixed', fixed, 'true')]:
    workflow = (source / '.github/workflows/release-checks.yml').read_text()
    start = workflow.index('    changed:\n')
    end = workflow.index('\n    checks:\n', start)
    job = workflow[start:end]
    block = job.split('              run: |\n', 1)[1]
    script = '\n'.join(line[18:] if line.strip() else '' for line in block.splitlines())
    output = OUT / f'{label}-manual-marker.output'
    output.write_text('')
    summary = OUT / f'{label}-manual-marker.summary.md'
    summary.write_text('')
    api = {'PATH': f'{marker_bin}:{ENV["PATH"]}', 'EVENT': 'schedule', 'REPO': 'example/project',
        'WORKFLOW_SHA': MAIN, 'GITHUB_OUTPUT': str(output), 'GITHUB_STEP_SUMMARY': str(summary),
        'API_HEAD': json.dumps({'sha': DEV}),
        'API_ARTIFACTS': json.dumps({'artifacts': [{'expired': False, 'workflow_run': {'id': 73, 'repository_id': 10, 'head_repository_id': 10}}]}),
        'API_RUN': json.dumps({'id': 73, 'path': '.github/workflows/release-checks.yml', 'event': 'workflow_dispatch', 'head_sha': MAIN, 'conclusion': 'success'})}
    run(f'{label}-manual-marker', ['bash', '--noprofile', '--norc', '-eo', 'pipefail', '-c', script], source, 0, api,
        assertion=f'A successful manual marker gives run={should_run}; only fixed scheduling refuses this skip.')
    values = dict(line.split('=', 1) for line in output.read_text().splitlines())
    assert values['run'] == should_run, values

# These mutations keep the complete fixed tree and its real dependencies. They calibrate existing assertions;
# they are intentionally distinct from replaying an actual historical revision.
focused = ['tools/tests/release-checks.test.mjs', 'tools/tests/release-checks-workflow.test.mjs']
run('fixed-focused-tests', [node, '--test', *focused], fixed, 0,
    assertion='The unchanged complete fixed tree passes both runner/workflow suites before mutation.')

mutations = [
    ('pipeline-swallow', '.github/workflows/release-checks.yml', '                  set -o pipefail\n',
     '                  set +o pipefail\n', 'a launcher failure retains its exit status', '0 !== 37'),
    ('manual-marker-trust', '.github/workflows/release-checks.yml', '.event == "schedule" and .head_sha',
     '(.event == "schedule" or .event == "workflow_dispatch") and .head_sha', 'the scheduler reuses only', 'manual pass'),
    ('checkout-mismatch-ignored', '.github/workflows/release-checks.yml', 'if [ "$tested" != "$RESOLVED_SHA" ]; then',
     'if false; then', 'checkout provenance must match', '0 !== 1'),
    ('narrowed-contract-accepted', 'tools/ci/release-checks.mjs',
     "Object.keys(expected).some((key) => JSON.stringify(saved[key]) !== JSON.stringify(expected[key]))",
     'false', 'evidence refuses a narrowed', '0 !== 1'),
]
for label, file, before, after, test_name, failure_text in mutations:
    dest = OUT / f'mutation-{label}'
    dest.mkdir()
    for directory in ['tools', '.github']:
        shutil.copytree(fixed / directory, dest / directory)
    target = dest / file
    original = target.read_text()
    assert original.count(before) == 1, (label, original.count(before))
    target.write_text(original.replace(before, after))
    suite = focused[0] if file.endswith('.mjs') else focused[1]
    result = run(f'mutation-{label}', [node, '--test', '--test-name-pattern', test_name, suite], dest, 1,
        assertion=f'Existing assertion rejects the deliberate mutation: {failure_text}.')
    assert failure_text in result.stdout + result.stderr, result.stdout + result.stderr
    assert 'ERR_MODULE_NOT_FOUND' not in result.stdout + result.stderr
    assert 'SyntaxError' not in result.stdout + result.stderr

run('fixed-focused-tests-after-negative-calibration', [node, '--test', *focused], fixed, 0,
    assertion='All 17 unchanged runner/workflow tests are green again after the four independent red mutations.')

source_files = ['.github/workflows/release-checks.yml', 'playwright.config.ts', 'tools/ci/playwright-summary.mjs',
    'tools/ci/release-checks.mjs', *focused]
sources = []
for revision in [MAIN, DEV, FIX]:
    files = {}
    for file in source_files:
        proc = subprocess.run(['git', '-C', str(REPO), 'show', f'{revision}:{file}'], capture_output=True)
        if proc.returncode == 0:
            files[file] = {'git_blob': git('rev-parse', f'{revision}:{file}').decode().strip(),
                           'sha256': hashlib.sha256(proc.stdout).hexdigest()}
    sources.append({'commit': revision, 'tree': git('rev-parse', f'{revision}^{{tree}}').decode().strip(), 'files': files})
manifest = {'schema': 1, 'recorded_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    'invocation': [sys.executable, *sys.argv], 'repository': str(REPO), 'output': str(OUT),
    'replay_script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'pinned_package_lock_sha256': hashlib.sha256(lock_bytes).hexdigest(),
    'python_version': sys.version.split()[0], 'node_version': node_version,
    'jq_version': subprocess.check_output(['jq', '--version'], text=True).strip(),
    'playwright_version': json.loads((REPO / 'node_modules/@playwright/test/package.json').read_text())['version'],
    'sources': sources, 'discovery': counts, 'receipts': receipts,
    'limits': ['Discovery only: no browser/application run.', 'Real configuration and real specs; focused release-file filter excludes non-release specs in dark/harsh projects.',
               'Mutation receipts calibrate existing tests against complete fixed code; they are not historical failures.',
               'No remote API or workflow execution and no scheduled default-branch operational proof.']}
for receipt in receipts:
    receipt['logs_sha256'] = {key: hashlib.sha256((OUT / receipt[key]).read_bytes()).hexdigest() for key in ['stdout', 'stderr']}
(OUT / 'receipts.json').write_text(json.dumps(manifest, indent=2) + '\n')
print('All historical and mutation checks produced the intended outcomes.', flush=True)
