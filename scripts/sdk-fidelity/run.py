#!/usr/bin/env python3
"""Compare frozen legacy and current SDK handlers without modifying either checkout."""
import difflib
import argparse
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

BASELINE = 'f106a8904174594c456b00edb1f67b6905f0cd8e'
ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def compare(left, right):
    return list(difflib.unified_diff(
        json.dumps(left, indent=2, sort_keys=True).splitlines(),
        json.dumps(right, indent=2, sort_keys=True).splitlines(),
        fromfile='frozen baseline', tofile='SDK', lineterm=''))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--record-baseline', action='store_true')
    args = parser.parse_args()
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip())
    print(f'Legacy {BASELINE}; SDK {head}; workspace changes={dirty}', flush=True)
    with tempfile.TemporaryDirectory(prefix='pathfinder-fidelity-') as temp:
        transcripts = []
        for mode, package in [('legacy', 'plugin'), ('sdk', 'provider')]:
            target = Path(temp) / mode
            target.mkdir()
            archive = subprocess.check_output(['git', 'archive', BASELINE if mode == 'legacy' else 'HEAD'], cwd=ROOT)
            with tarfile.open(fileobj=io.BytesIO(archive)) as source:
                source.extractall(target, filter='data')
            if mode == 'sdk':
                shutil.copytree(ROOT / 'pkg', target / 'pkg', dirs_exist_ok=True)
                for file in ['go.mod', 'go.sum']:
                    shutil.copy2(ROOT / file, target / file)
            dest = target / 'pkg' / package
            (dest / 'frozen_shared_test.go').write_text((HERE / 'shared.go.txt').read_text().replace('package PACKAGE', 'package ' + package))
            (dest / 'frozen_history_test.go').write_text((HERE / 'history.go.txt').read_text().replace('package PACKAGE', 'package ' + package))
            (dest / 'frozen_http_reads_test.go').write_text((HERE / 'http_reads.go.txt').read_text().replace('package PACKAGE', 'package ' + package))
            (dest / 'frozen_cache_test.go').write_text((HERE / 'cache.go.txt').read_text().replace('package PACKAGE', 'package ' + package))
            (dest / 'frozen_adapter_test.go').write_text((HERE / (mode + '.go.txt')).read_text())
            output = Path(temp) / (mode + '.json')
            env = dict(os.environ, FIDELITY_CORPUS=str(HERE / 'scenarios.json'), FIDELITY_OUTPUT=str(output), FIDELITY_HISTORY=str(HERE / 'history.json'))
            subprocess.run(['go', 'test', './pkg/' + package, '-run', '^TestFrozenFidelity', '-count=1'], cwd=target, env=env, check=True)
            transcripts.append(json.loads(output.read_text()))
            transcripts[-1]["history"] = json.loads(Path(str(output) + ".reads").read_text())
            transcripts[-1]["cache"] = json.loads(Path(str(output) + ".cache").read_text())
            transcripts[-1]["httpReads"] = json.loads(Path(str(output) + ".httpreads").read_text())
        expected = HERE / 'baseline-writes.json'
        if args.record_baseline:
            expected.write_text(json.dumps(transcripts[0], indent=2, sort_keys=True) + '\n')
        if compare(json.loads(expected.read_text()), transcripts[0]):
            raise RuntimeError('frozen baseline transcript drifted')
        # Explicit permitted difference: SDK POST responses add Cache-Control: no-store.
        # Assert both exact values before comparison; never discard arbitrary headers.
        for name in transcripts[0]:
            if name in ("history", "cache", "httpReads"):
                continue
            for old, new in zip(transcripts[0][name], transcripts[1][name], strict=True):
                if old['cacheControl'] != '' or new['cacheControl'] != 'no-store':
                    raise RuntimeError('unexpected cache-control difference')
                old['cacheControl'] = 'no-store'
        diff = compare(*transcripts)
        # Mutate only the temporary SDK copy: the harness must catch a broken
        # monotonic-progress comparison in production code, not just a JSON edit.
        attempt = target / 'pkg/services/completion_attempt.go'
        original = attempt.read_text()
        needle = 'stored.Spec.CompletionPercent >= incoming.CompletionPercent'
        if original.count(needle) != 1:
            raise RuntimeError('monotonic mutation target changed; review the control')
        attempt.write_text(original.replace(needle, 'stored.Spec.CompletionPercent <= incoming.CompletionPercent'))
        mutation = subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityWrites$', '-count=1'], cwd=target, env=env, capture_output=True, text=True)
        if mutation.returncode == 0:
            mutated_output = json.loads(output.read_text())
            clean_writes = {key: value for key, value in transcripts[1].items() if key not in ('history', 'cache', 'httpReads')}
            if not compare(clean_writes, mutated_output):
                raise RuntimeError('production monotonicity mutation was not detected')
        else:
            raise RuntimeError('mutation did not produce a comparable transcript: ' + mutation.stdout + mutation.stderr)
        attempt.write_text(original)
        write_route = target / 'pkg/provider/completion_write.go'
        write_source = write_route.read_text()
        schema_needle = 'cause.Field != "spec.completedAt" || cause.Type != "FieldValueRequired"'
        if write_source.count(schema_needle) != 1:
            raise RuntimeError('schema mutation target changed; review the control')
        write_route.write_text(write_source.replace(schema_needle, 'cause.Field == "__never__"'))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityWrites$', '-count=1'], cwd=target, env=env, check=True)
        if not compare(clean_writes, json.loads(output.read_text())):
            raise RuntimeError('production schema validation mutation was not detected')
        write_route.write_text(write_source)
        transport_needle = 'status := diagnostic.UpstreamStatus'
        if write_source.count(transport_needle) != 1:
            raise RuntimeError('write transport diagnostic mutation target changed')
        write_route.write_text(write_source.replace(transport_needle, transport_needle + '\n if status == 0 { diagnostic.Reason = "http-error"; diagnostic.UpstreamStatus = 503 }'))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityWrites$', '-count=1'], cwd=target, env=env, check=True)
        if not compare(clean_writes, json.loads(output.read_text())):
            raise RuntimeError('production write transport diagnostic mutation was not detected')
        write_route.write_text(write_source)
        cache = target / 'pkg/services/completion_cache.go'
        cache_source = cache.read_text()
        cache_needle = 'const completionCacheTTL = 5 * time.Minute'
        if cache_source.count(cache_needle) != 1:
            raise RuntimeError('cache mutation target changed; review the control')
        cache.write_text(cache_source.replace(cache_needle, 'const completionCacheTTL = 10 * time.Minute'))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityCache$', '-count=1'], cwd=target, env=env, check=True)
        if not compare(transcripts[1]['cache'], json.loads(Path(str(output) + '.cache').read_text())):
            raise RuntimeError('production cache TTL mutation was not detected')
        completion_client = target / 'pkg/resourceaccess/completions.go'
        client_source = completion_client.read_text()
        pagination_needle = 'Continue: page.Continue'
        if client_source.count(pagination_needle) != 1:
            raise RuntimeError('pagination mutation target changed; review the control')
        completion_client.write_text(client_source.replace(pagination_needle, 'Continue: ""'))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityHTTPReads$', '-count=1'], cwd=target, env=env, check=True)
        if not compare(transcripts[1]['httpReads'], json.loads(Path(str(output) + '.httpreads').read_text())):
            raise RuntimeError('production pagination mutation was not detected')
        completion_client.write_text(client_source)

        diagnostic = target / 'pkg/provider/diagnostics.go'
        diagnostic_source = diagnostic.read_text()
        diagnostic_needle = 'result.Reason = "invalid-json"'
        if diagnostic_source.count(diagnostic_needle) != 1:
            raise RuntimeError('diagnostic mutation target changed; review the control')
        diagnostic.write_text(diagnostic_source.replace(diagnostic_needle, 'result.Reason = "unexpected-error"'))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityHTTPReads$', '-count=1'], cwd=target, env=env, check=True)
        if not compare(transcripts[1]['httpReads'], json.loads(Path(str(output) + '.httpreads').read_text())):
            raise RuntimeError('production diagnostic mutation was not detected')
        diagnostic.write_text(diagnostic_source)
        bounded_transport = target / 'pkg/resourceaccess/transport.go'
        bounded_source = bounded_transport.read_text()
        bounded_needle = 'Reason: "response-too-large", Status: b.status'
        if bounded_source.count(bounded_needle) != 1:
            raise RuntimeError('response bound mutation target changed')
        bounded_transport.write_text(bounded_source.replace(bounded_needle, 'Reason: "http-error", Status: 503'))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityHTTPReads$', '-count=1'], cwd=target, env=env, check=True)
        mutated_settings = json.loads(Path(str(output) + '.httpreads').read_text())['settings/-2']
        if not compare(transcripts[1]['httpReads']['settings/-2'], mutated_settings):
            raise RuntimeError('production oversized settings mutation was not detected')
        bounded_transport.write_text(bounded_source)
        absence_needle = 'return settingsErrorTransport{next: next}'
        if bounded_source.count(absence_needle) != 1:
            raise RuntimeError('settings absence mutation target changed')
        bounded_transport.write_text(bounded_source.replace(absence_needle, 'return next'))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityHTTPReads$', '-count=1'], cwd=target, env=env, check=True)
        mutated_absence = json.loads(Path(str(output) + '.httpreads').read_text())['settings-absence/forbidden']
        if not compare(transcripts[1]['httpReads']['settings-absence/forbidden'], mutated_absence):
            raise RuntimeError('production settings absence mutation was not detected')
        bounded_transport.write_text(bounded_source)
        # Negative control: a status regression must be visible to the comparator.
        mutated = json.loads(json.dumps(transcripts[0]))
        mutated['progress-retry-out-of-order-complete'][0]['status'] = 599
        if not compare(transcripts[0], mutated):
            raise RuntimeError('negative control failed')
        if diff:
            print('\n'.join(diff))
            raise SystemExit(1)
        print('Frozen writes, history, cache, and HTTP reads match; status, monotonicity, cache TTL, pagination, schema validation, write transport, response bounds, settings absence, and diagnostic controls detected.')


if __name__ == '__main__':
    main()
