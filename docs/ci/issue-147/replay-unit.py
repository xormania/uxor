#!/usr/bin/env python3
"""Replay issue147's unchanged four unit cases against old/fixed modules, without installs/network/browser."""
from pathlib import Path
import hashlib,json,re,shutil,subprocess,tempfile
base=Path(__file__).resolve().parent
evidence=base/'evidence'
expected=json.loads((evidence/'unit-red-green.json').read_text())
cases=(evidence/'unit-cases.mjs').read_bytes()
assert hashlib.sha256(cases).hexdigest()==expected['test_sha256']
node=shutil.which('node')
if not node:raise SystemExit('Node is required; no installation is performed.')
out=Path(tempfile.mkdtemp(prefix='uxor-issue147-unit-'))
receipts=[]
for label,filename,code,passes,fails in [('red','old-module.mjs',1,3,1),('green','fixed-module.mjs',0,4,0)]:
    module=(evidence/filename).read_bytes()
    assert hashlib.sha256(module).hexdigest()==expected[label]['helper_sha256']
    tree=out/label
    (tree/'tools/tests').mkdir(parents=True)
    (tree/'tests/e2e').mkdir(parents=True)
    (tree/'tools/tests/leak-detector.test.mjs').write_bytes(cases)
    (tree/'tests/e2e/leak-detector.mjs').write_bytes(module)
    command=[node,'--test','--test-reporter=tap','tools/tests/leak-detector.test.mjs']
    result=subprocess.run(command,cwd=tree,capture_output=True,text=True,timeout=10)
    output=result.stdout+result.stderr
    (out/f'{label}.stdout.log').write_text(result.stdout)
    (out/f'{label}.stderr.log').write_text(result.stderr)
    assert result.returncode==code,output
    assert re.search(rf'^# pass {passes}$',output,re.M),output
    assert re.search(rf'^# fail {fails}$',output,re.M),output
    assert not any(s in output for s in ['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND','SyntaxError']),output
    if label=='red':
        assert 'the known crashing renderer must not be started' in output,output
        assert re.search(r'not ok .*known crashing Chromium build',output),output
    receipts.append({'variant':label,'command':command,'cwd':str(tree),'exit':result.returncode,'passed':passes,'failed':fails,'stdout_sha256':hashlib.sha256(result.stdout.encode()).hexdigest(),'stderr_sha256':hashlib.sha256(result.stderr.encode()).hexdigest()})
(out/'receipt.json').write_text(json.dumps({'runtime':subprocess.check_output([node,'--version'],text=True).strip(),'tests_unchanged':True,'receipts':receipts},indent=2)+'\n')
print('Expected red3pass/1fail and green4pass/0fail verified. Evidence:',out)
