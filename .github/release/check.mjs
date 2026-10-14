// Offline release smoke: checks the release contract, not the semantic-release libraries.
//
// The tag is the version. `gh release create --generate-notes` publishes, so there is no
// version-planning or note-rendering code left on this path to test - what is worth checking is
// that release.yml still says what it is supposed to say, that every shell step parses, and that
// version.py moves every manifest together. Never invokes Apple services or publishes anything.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { load } from 'js-yaml';

const workflow = load(readFileSync('.github/workflows/release.yml', 'utf8'));

// The tag is the version, and a release is always for a tag. A manual dispatch may
// rebuild and republish a tag that already exists, but it may not invent a version:
// the dispatch input names an existing tag, and prepare still refuses a tag that
// disagrees with the workspace version.
assert.deepEqual(Object.keys(workflow.on).sort(), ['push', 'workflow_dispatch']);
assert.deepEqual(workflow.on.push.tags, ['v[0-9]+.[0-9]+.[0-9]+']);
assert(workflow.on.workflow_dispatch.inputs.tag.required === true);

// Windows x64 and arm64 are both still built.
const platforms = workflow.jobs.build.strategy.matrix.os;
assert(platforms.includes('windows-latest'));
assert(platforms.includes('windows-11-arm'));
// macOS is absent on purpose, so assert that rather than letting it creep back in unnoticed: it
// cannot be signed without a paid Apple Developer account.
assert(!platforms.some(os => String(os).includes('macos')));
// A release must not be published from Windows artifacts alone.
assert(workflow.jobs.publish.needs.includes('linux'));
// prepare gates everything, and it is the job that compares the tag to the manifest version.
assert(workflow.jobs.build.needs === 'prepare');
assert(workflow.jobs.linux.needs === 'prepare');

// Every inline shell step has to parse. A typo here surfaces as an opaque failure halfway through a
// release build, which is the most expensive place to find out.
for (const job of Object.values(workflow.jobs)) {
  for (const step of job.steps ?? []) {
    if (step.run && step.shell !== 'pwsh') execFileSync('bash', ['-n'], { input: step.run });
  }
}
execFileSync('bash', ['-n', 'packaging/macos/sign-release.sh']);
execFileSync('bash', ['packaging/macos/test_sign_release.sh'], { stdio: 'inherit' });

// version.py is what keeps Cargo.toml, both lockfiles and the Mac plist on one version. If it ever
// rewrites a dependency section or misses a local package, a release ships with manifests that
// disagree, so assert the exact package set is preserved.
execFileSync(process.env.PYTHON || 'python3', ['-c', `
import glob, os, pathlib, shutil, subprocess, tempfile, tomllib
root = pathlib.Path.cwd()
manifest = tomllib.loads((root / 'Cargo.toml').read_text())
with tempfile.TemporaryDirectory() as directory:
    fixture = pathlib.Path(directory)
    paths = ['Cargo.toml', 'Cargo.lock', 'fuzz/Cargo.lock', 'packaging/macos/Info.plist']
    for member in manifest['workspace']['members']:
        paths.extend(glob.glob(member + '/Cargo.toml'))
    for path in paths:
        (fixture / path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / path, fixture / path)
    os.chdir(fixture)
    for version in ['1.2.3-nightly.20260913.9', '1.2.3']:
        subprocess.run([os.sys.executable, str(root / '.github/release/version.py'), version], check=True)
        assert tomllib.loads(pathlib.Path('Cargo.toml').read_text())['workspace']['package']['version'] == version
        for lock in ['Cargo.lock', 'fuzz/Cargo.lock']:
            packages = tomllib.loads(pathlib.Path(lock).read_text())['package']
            original = tomllib.loads((root / lock).read_text())['package']
            assert [p for p in packages if 'source' in p] == [p for p in original if 'source' in p]
            assert next(p['version'] for p in packages if p['name'] == 'model' and 'source' not in p) == version
    import plistlib
    assert plistlib.loads(pathlib.Path('packaging/macos/Info.plist').read_bytes())['CFBundleShortVersionString'] == '1.2.3'
`], { stdio: 'inherit' });

console.log('Release smoke passed: tag trigger, platform matrix, job gating, shell syntax, manifest/lock versions.');
