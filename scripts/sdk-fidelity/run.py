#!/usr/bin/env python3
"""Compare frozen legacy and current SDK handlers without modifying either checkout."""
import difflib
import argparse
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

BASELINE = 'f106a8904174594c456b00edb1f67b6905f0cd8e'
ACHIEVEMENT_BASELINE = '3e24d681eb626498d99b1b7ead31277b78a3f7f9'
CATALOGUE_BASELINE = '5a7cd9a4b61b5be68f4ab952da5f44412b57b238'
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
    changes = subprocess.check_output(
        ['git', 'status', '--porcelain', '--untracked-files=all', '--', 'scripts/sdk-fidelity'],
        cwd=ROOT, text=True)
    if changes:
        raise RuntimeError('Commit fidelity harness changes before comparing committed revisions.')
    print(f'Legacy {BASELINE}; SDK {head}', flush=True)
    with tempfile.TemporaryDirectory(prefix='pathfinder-fidelity-') as temp:
        transcripts = []
        goldens = []
        for mode, package in [('legacy', 'plugin'), ('sdk', 'provider')]:
            target = Path(temp) / mode
            target.mkdir()
            archive = subprocess.check_output(['git', 'archive', BASELINE if mode == 'legacy' else head], cwd=ROOT)
            with tarfile.open(fileobj=io.BytesIO(archive)) as source:
                source.extractall(target, filter='data')
            dest = target / 'pkg' / package
            (dest / 'frozen_shared_test.go').write_text((HERE / 'shared.go.txt').read_text().replace('package PACKAGE', 'package ' + package))
            (dest / 'frozen_history_test.go').write_text((HERE / 'history.go.txt').read_text().replace('package PACKAGE', 'package ' + package))
            (dest / 'frozen_http_reads_test.go').write_text((HERE / 'http_reads.go.txt').read_text().replace('package PACKAGE', 'package ' + package))
            (dest / 'frozen_assignment_history_test.go').write_text((HERE / 'assignment_history.go.txt').read_text().replace('package PACKAGE', 'package ' + package))
            (dest / 'frozen_resources_test.go').write_text((HERE / 'resource_writes.go.txt').read_text().replace('package PACKAGE', 'package ' + package))
            (dest / 'frozen_concurrent_test.go').write_text((HERE / 'concurrent.go.txt').read_text().replace('package PACKAGE', 'package ' + package))
            (dest / 'frozen_cache_test.go').write_text((HERE / 'cache.go.txt').read_text().replace('package PACKAGE', 'package ' + package))
            (dest / 'frozen_adapter_test.go').write_text((HERE / (mode + '.go.txt')).read_text())
            output = Path(temp) / (mode + '.json')
            env = dict(os.environ, FIDELITY_CORPUS=str(HERE / 'scenarios.json'), FIDELITY_OUTPUT=str(output), FIDELITY_HISTORY=str(HERE / 'history.json'))
            subprocess.run(['go', 'test', './pkg/' + package, '-run', '^TestContractValueGoldens$', '-count=1'], cwd=target, env=env, check=True)
            goldens.append({file.name: json.loads(file.read_text()) for file in (dest / 'testdata/contract').glob('*.json') if file.name != 'struct-tags.json'})
            subprocess.run(['go', 'test', './pkg/' + package, '-run', '^TestFrozenFidelity', '-count=1'], cwd=target, env=env, check=True)
            subprocess.run(['go', 'test', '-race', './pkg/' + package, '-run', '^TestFrozenFidelityConcurrent$', '-count=10'], cwd=target, env=env, check=True)
            transcripts.append(json.loads(output.read_text()))
            transcripts[-1]["assignmentHistory"] = json.loads(Path(str(output) + ".assignmenthistory").read_text())
            transcripts[-1]["resources"] = json.loads(Path(str(output) + ".resources").read_text())
            transcripts[-1]["concurrent"] = json.loads(Path(str(output) + ".concurrent").read_text())
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
        achievement_target = Path(temp) / 'achievement-baseline'
        achievement_target.mkdir()
        archive = subprocess.check_output(['git', 'archive', ACHIEVEMENT_BASELINE], cwd=ROOT)
        with tarfile.open(fileobj=io.BytesIO(archive)) as source:
            source.extractall(achievement_target, filter='data')
        subprocess.run(['go', 'test', './pkg/plugin', '-run', '^(TestContractValueGoldens|TestAchievementStore|TestAchievementNameReader|TestCustomGuideHTTPClient_LargeGuidesDrainAcrossSmallerPages)', '-count=1'], cwd=achievement_target, check=True)
        achievement_goldens = {file.name: json.loads(file.read_text()) for file in (achievement_target / 'pkg/plugin/testdata/contract').glob('achievements-*.json')}
        sdk_achievements = {name: goldens[1].pop(name) for name in achievement_goldens}
        # Explicit permitted difference: per-tier criteria (#2463) change six achievement
        # contracts. Each must still differ from the frozen baseline and match its reviewed copy exactly.
        per_tier = json.loads((HERE / 'achievement-per-tier.json').read_text())
        if len(per_tier) != 6 or not set(per_tier) <= set(achievement_goldens):
            raise RuntimeError('the per-tier achievement difference must name six frozen contracts')
        for name, reviewed in per_tier.items():
            if not compare(achievement_goldens[name], reviewed):
                raise RuntimeError(name + ' no longer differs from the frozen baseline; remove it from achievement-per-tier.json')
            if compare(reviewed, sdk_achievements[name]):
                raise RuntimeError(name + ' differs from its reviewed per-tier copy: ' + '\n'.join(compare(reviewed, sdk_achievements[name])))
            achievement_goldens[name] = reviewed
        if len(achievement_goldens) != 9 or compare(achievement_goldens, sdk_achievements):
            raise RuntimeError('achievement baseline contracts differ: ' + '\n'.join(compare(achievement_goldens, sdk_achievements)))
        print('Three achievement contracts match their separate frozen main baseline; six match their reviewed per-tier copies', flush=True)
        unavailable = goldens[0].pop('learning-insights.unavailable.json')
        if unavailable['capability'] != {'available': False, 'reason': 'identity-unavailable'}:
            raise RuntimeError('legacy unavailable-identity contract changed')
        # The editor catalogue gained metadata on main after the original baseline.
        for name in ('custom-guide-repository.default.json', 'custom-guide-repository.wire-widened-manifest.json'):
            fixture = f'{CATALOGUE_BASELINE}:pkg/plugin/testdata/contract/{name}'
            goldens[0][name] = json.loads(subprocess.check_output(['git', 'show', fixture], cwd=ROOT))
        raw_guides = transcripts[0]['httpReads']['guide-list/200/catalogue=false']['body']['items']
        catalogue = transcripts[0]['httpReads']['guide-list/200/catalogue=true']['body']['guides']
        for entry, resource in zip(catalogue, raw_guides, strict=True):
            entry['name'] = resource['metadata']['name']
        # Main retired the full guide list. Keep its frozen captures as baseline evidence.
        for name in ('custom-guides.default.json', 'custom-guides.empty.json'):
            del goldens[0][name]
        for key in list(transcripts[0]['httpReads']):
            if key.startswith('guide-list/') and key.endswith('/catalogue=false'):
                del transcripts[0]['httpReads'][key]
        for variant in ('default', 'empty', 'untargeted'):
            name = f'package-recommendations.{variant}.json'
            for captures in goldens:
                del captures[name]
        print('Three synthetic recommendation schema fixtures excluded from historical comparisons.', flush=True)
        if len(goldens[0]) != 13 or compare(goldens[0], goldens[1]):
            raise RuntimeError('historical value goldens differ: ' + '\n'.join(compare(goldens[0], goldens[1])))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestInsightsWithoutIdentityRejectsBeforeResourceReads$', '-count=1'], cwd=target, env=env, check=True)
        for name in transcripts[0]:
            if name in ("history", "cache", "httpReads", "concurrent", "resources", "assignmentHistory"):
                continue
            for old, new in zip(transcripts[0][name], transcripts[1][name], strict=True):
                if old['cacheControl'] != '' or new['cacheControl'] != 'no-store':
                    raise RuntimeError('unexpected cache-control difference')
                old['cacheControl'] = 'no-store'
        for name, old in transcripts[0]['httpReads'].items():
            if name.startswith('assignments/'):
                new = transcripts[1]['httpReads'][name]
                if old['cacheControl'] != '' or new['cacheControl'] != 'no-store':
                    raise RuntimeError('unexpected assignment cache-control difference')
                old['cacheControl'] = 'no-store'
        for kind, rows in transcripts[0]['resources'].items():
            for old, new in zip(rows, transcripts[1]['resources'][kind], strict=True):
                if old['cacheControl'] != '' or new['cacheControl'] != 'no-store':
                    raise RuntimeError('unexpected resource-write cache-control difference')
                old['cacheControl'] = 'no-store'
                if old['status'] >= 400 and 'metadata' not in old['body']:
                    if new['body'].get('metadata') != {}:
                        raise RuntimeError('unexpected resource-write error metadata')
                    old['body']['metadata'] = {}
        for name, old in transcripts[0]['assignmentHistory'].items():
            if name.endswith('insights=false'):
                new = transcripts[1]['assignmentHistory'][name]
                if old['cacheControl'] != '' or new['cacheControl'] != 'no-store':
                    raise RuntimeError('unexpected populated assignment cache-control difference')
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
            clean_writes = {key: value for key, value in transcripts[1].items() if key not in ('history', 'cache', 'httpReads', 'concurrent', 'resources', 'assignmentHistory')}
            if not compare(clean_writes, mutated_output):
                raise RuntimeError('production monotonicity mutation was not detected')
        else:
            raise RuntimeError('mutation did not produce a comparable transcript: ' + mutation.stdout + mutation.stderr)
        concurrent_mutation = subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityConcurrent$', '-count=1'], cwd=target, env=env, capture_output=True, text=True)
        if concurrent_mutation.returncode == 0 or 'progress regressed' not in concurrent_mutation.stdout:
            raise RuntimeError('concurrent monotonicity mutation did not trigger the invariant: ' + concurrent_mutation.stdout + concurrent_mutation.stderr)
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
        cache.write_text(cache_source)
        completion_client = target / 'pkg/resourceaccess/completions.go'
        client_source = completion_client.read_text()
        pagination_needle = 'Continue: page.Continue'
        if client_source.count(pagination_needle) != 1:
            raise RuntimeError('pagination mutation target changed; review the control')
        completion_client.write_text(client_source.replace(pagination_needle, 'Continue: ""'))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityHTTPReads$', '-count=1'], cwd=target, env=env, check=True)
        if not compare(transcripts[1]['httpReads'], json.loads(Path(str(output) + '.httpreads').read_text())):
            raise RuntimeError('production pagination mutation was not detected')
        paged_insights = 'insights-paged/503/completions=true'
        mutated_pagination = json.loads(Path(str(output) + '.httpreads').read_text())
        if not compare(transcripts[1]['httpReads'][paged_insights], mutated_pagination[paged_insights]):
            raise RuntimeError('production pagination mutation did not change partial insights')
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
        absence_needle = 'return settingsErrorTransport{next: settingsTransport{next: next, maxBytes: maxBytes}}'
        if bounded_source.count(absence_needle) != 1:
            raise RuntimeError('settings absence mutation target changed')
        bounded_transport.write_text(bounded_source.replace(absence_needle, 'return settingsTransport{next: next, maxBytes: maxBytes}'))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityHTTPReads$', '-count=1'], cwd=target, env=env, check=True)
        mutated_absence = json.loads(Path(str(output) + '.httpreads').read_text())['settings-absence/forbidden']
        if not compare(transcripts[1]['httpReads']['settings-absence/forbidden'], mutated_absence):
            raise RuntimeError('production settings absence mutation was not detected')
        bounded_transport.write_text(bounded_source)
        assignment_route = target / 'pkg/provider/assignments.go'
        assignment_source = assignment_route.read_text()
        assignment_needle = ' && status != 429'
        if assignment_source.count(assignment_needle) != 1:
            raise RuntimeError('assignment retry classification mutation target changed')
        assignment_route.write_text(assignment_source.replace(assignment_needle, ''))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityHTTPReads$', '-count=1'], cwd=target, env=env, check=True)
        mutated_assignment = json.loads(Path(str(output) + '.httpreads').read_text())['assignments/429/completions=false']
        if not compare(transcripts[1]['httpReads']['assignments/429/completions=false'], mutated_assignment):
            raise RuntimeError('production assignment retry classification mutation was not detected')
        assignment_route.write_text(assignment_source)
        insights_route = target / 'pkg/provider/insights.go'
        insights_source = insights_route.read_text()
        insights_needle = 'response.Partial("completions-" + warning)'
        if insights_source.count(insights_needle) != 1:
            raise RuntimeError('insights partial-history mutation target changed')
        insights_route.write_text(insights_source.replace(insights_needle, '_ = warning'))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityHTTPReads$', '-count=1'], cwd=target, env=env, check=True)
        mutated_insights = json.loads(Path(str(output) + '.httpreads').read_text())['insights/503/completions=true']
        if not compare(transcripts[1]['httpReads']['insights/503/completions=true'], mutated_insights):
            raise RuntimeError('production insights partial-history mutation was not detected')
        insights_route.write_text(insights_source)
        guide_client = target / 'pkg/resourceaccess/guides.go'
        guide_source = guide_client.read_text()
        guide_needle = 'return nil, &ResponseValidationError{Reason: "invalid-json", Status: 200}'
        if guide_source.count(guide_needle) != 1:
            raise RuntimeError('guide malformed-response mutation target changed')
        guide_client.write_text(guide_source.replace(guide_needle, 'return nil, err'))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityHTTPReads$', '-count=1'], cwd=target, env=env, check=True)
        mutated_guide = json.loads(Path(str(output) + '.httpreads').read_text())['guide/-1']
        if not compare(transcripts[1]['httpReads']['guide/-1'], mutated_guide):
            raise RuntimeError('production guide diagnostic mutation was not detected')
        guide_client.write_text(guide_source)
        repair_needle = 'if persisted.CompletedAt != "" {'
        if write_source.count(repair_needle) != 1:
            raise RuntimeError('assignment repair mutation target changed')
        write_route.write_text(write_source.replace(repair_needle, 'if persisted.CompletedAt != "" && status == http.StatusCreated {'))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityWrites$', '-count=1'], cwd=target, env=env, check=True)
        mutated_repair = json.loads(output.read_text())['lost-acknowledgement'][-1]['assignment']
        if not compare(transcripts[1]['lost-acknowledgement'][-1]['assignment'], mutated_repair):
            raise RuntimeError('production completed-retry repair mutation was not detected')
        write_route.write_text(write_source)
        guide_pagination_needle = 'Continue: page.GetContinue()'
        if guide_source.count(guide_pagination_needle) != 1:
            raise RuntimeError('guide pagination mutation target changed')
        guide_client.write_text(guide_source.replace(guide_pagination_needle, 'Continue: ""'))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityHTTPReads$', '-count=1'], cwd=target, env=env, check=True)
        mutated_guides = json.loads(Path(str(output) + '.httpreads').read_text())
        key = 'guide-list/200/catalogue=true'
        if not compare(transcripts[1]['httpReads'][key], mutated_guides[key]):
            raise RuntimeError('production catalogue pagination mutation was not detected')
        guide_client.write_text(guide_source)
        resource_client = target / 'pkg/resourceaccess/resource_writes.go'
        resource_source = resource_client.read_text()
        resource_needle = 'for key, value := range map[string]string'
        if resource_source.count(resource_needle) != 1:
            raise RuntimeError('resource metadata mutation target changed')
        resource_client.write_text(resource_source.replace(resource_needle, 'delete(metadata, "annotations")\n ' + resource_needle))
        subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityResourceWrites$', '-count=1'], cwd=target, env=env, check=True)
        mutated_resources = json.loads(Path(str(output) + '.resources').read_text())
        if not compare(transcripts[1]['resources'], mutated_resources):
            raise RuntimeError('production resource metadata loss was not detected')
        resource_client.write_text(resource_source)
        assignment_client = target / 'pkg/resourceaccess/assignments.go'
        assignment_client_source = assignment_client.read_text()
        assignment_page_needle = 'Continue: page.Continue'
        if assignment_client_source.count(assignment_page_needle) != 1:
            raise RuntimeError('assignment pagination mutation target changed')
        assignment_client.write_text(assignment_client_source.replace(assignment_page_needle, 'Continue: ""'))
        mutation = subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestFrozenFidelityAssignmentHistory$', '-count=1'], cwd=target, env=env, capture_output=True, text=True)
        if mutation.returncode == 0 or 'lost or leaked assignments' not in mutation.stdout:
            raise RuntimeError('assignment last-page invariant did not detect mutation: ' + mutation.stdout + mutation.stderr)
        assignment_client.write_text(assignment_client_source)
        completion_route = target / 'pkg/provider/completions.go'
        completion_source = completion_route.read_text()
        cooldown_needle = 'if errors.Is(err, context.Canceled) {'
        if completion_source.count(cooldown_needle) != 1:
            raise RuntimeError('cancellation cooldown mutation target changed')
        completion_route.write_text(completion_source.replace(cooldown_needle, 'if false {'))
        mutation = subprocess.run(['go', 'test', './pkg/provider', '-run', '^TestCompletionFailureCooldownPreservesCauseAndCallerIsolation$', '-count=1'], cwd=target, env=env, capture_output=True, text=True)
        if mutation.returncode == 0 or 'same caller upstream calls=1, want 2' not in mutation.stdout:
            raise RuntimeError('cancellation cooldown regression not detected: ' + mutation.stdout + mutation.stderr)
        completion_route.write_text(completion_source)
        # Negative control: a status regression must be visible to the comparator.
        mutated = json.loads(json.dumps(transcripts[0]))
        mutated['progress-retry-out-of-order-complete'][0]['status'] = 599
        if not compare(transcripts[0], mutated):
            raise RuntimeError('negative control failed')
        if diff:
            print('\n'.join(diff))
            raise SystemExit(1)
        print('Frozen writes, concurrent updates, history, cache, and HTTP reads match; status, monotonicity, cache TTL, pagination, schema validation, write transport, response bounds, settings absence, assignment retries, insights completeness, guide responses, assignment repair, and diagnostic controls detected.')


if __name__ == '__main__':
    main()
