#!/usr/bin/env python3
"""Build a local acceptance binary with a known catalogue, without editing sources."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='Local test binary; never publish this build')
    parser.add_argument('--goos', default='linux')
    parser.add_argument('--goarch', default='arm64')
    args = parser.parse_args()
    source_path = ROOT / 'pkg/publiccontent/achievements_definitions.go'
    source = source_path.read_text()
    marker = 'func AchievementDefinitions() definitionsProvider {'
    if source.count(marker) != 1:
        raise RuntimeError('definitions constructor changed; review the acceptance overlay')
    bundle = (ROOT / 'pkg/achievements/testdata/bundle.json').read_text()
    replacement = '''func AchievementDefinitions() definitionsProvider {
 snapshot,err:=achievements.LoadBundle([]byte(BUNDLE))
 if err!=nil {panic(err)}
 return localAcceptanceDefinitions{snapshot:snapshot}
}
type localAcceptanceDefinitions struct {snapshot *achievements.Snapshot}
func(d localAcceptanceDefinitions)Snapshot(context.Context)(*achievements.Snapshot,time.Duration){return d.snapshot,0}
'''.replace('BUNDLE', json.dumps(bundle))
    with tempfile.TemporaryDirectory(prefix='sdk-achievement-fixture-') as temporary:
        directory = Path(temporary)
        fixture = directory / 'definitions.go'
        fixture.write_text(source[:source.index(marker)] + replacement)
        overlay = directory / 'overlay.json'
        overlay.write_text(json.dumps({'Replace': {str(source_path): str(fixture)}}))
        subprocess.run(['go', 'build', '-overlay=' + str(overlay), '-o', str(args.output.resolve()), './pkg'],
                       cwd=ROOT, env=dict(os.environ, GOOS=args.goos, GOARCH=args.goarch), check=True)
    print(f'Acceptance fixture binary: {args.output.resolve()} (restore the normal build after testing)')


if __name__ == '__main__':
    main()
