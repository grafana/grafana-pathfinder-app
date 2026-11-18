import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('isolation', Path(__file__).with_name('isolated-review.py'))
isolation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(isolation)


def fixture_repo(root, files):
    repo = root / 'repo'; repo.mkdir()
    def git(*args, **kwargs):
        return subprocess.check_output(['git', '-c', 'core.precomposeunicode=false', '-C', str(repo), *args], text=True, **kwargs).strip()
    git('init', '-q')
    for name, body in files:
        oid = git('hash-object', '-w', '--stdin', input=body)
        git('update-index', '--add', '--cacheinfo', f'100644,{oid},{name}')
    tree = git('write-tree')
    return repo, tree


def install_layout(root):
    node = root / 'tools/node/bin/node'
    node.parent.mkdir(parents=True); node.write_text('')
    (root / 'tools/node/include/node').mkdir(parents=True)
    runtime = root / 'tools/srt/node_modules/@anthropic-ai/sandbox-runtime'
    runtime.mkdir(parents=True)
    return runtime, node


class SourceTests(unittest.TestCase):
    def assert_collision_rejected(self, files):
        with tempfile.TemporaryDirectory() as directory:
            repo, tree = fixture_repo(Path(directory), files)
            output = Path(directory) / 'output'
            with self.assertRaisesRegex(ValueError, 'collide'):
                isolation.export_source(repo, tree, output)
            self.assertFalse(output.exists())

    def test_export_rejects_file_names_differing_only_by_case(self):
        self.assert_collision_rejected([('src/Evil.ts', 'harmful'), ('src/evil.ts', 'harmless')])

    def test_export_rejects_parent_directories_differing_only_by_case(self):
        self.assert_collision_rejected([('SRC/a.ts', 'one'), ('src/b.ts', 'two')])

    def test_export_rejects_unicode_normalization_aliases(self):
        self.assert_collision_rejected([('caf\u00e9.ts', 'composed'), ('cafe\u0301.ts', 'decomposed')])

    def test_export_keeps_distinct_names_in_one_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            repo, tree = fixture_repo(Path(directory), [('src/a.ts', 'one'), ('src/b.ts', 'two')])
            output = Path(directory) / 'output'
            self.assertEqual(isolation.export_source(repo, tree, output), [])
            self.assertEqual((output / 'src/a.ts').read_text(), 'one')
            self.assertEqual((output / 'src/b.ts').read_text(), 'two')

    def test_export_is_pinned_ignores_archive_attributes_and_never_follows_links(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo = root / 'repo'; repo.mkdir()
            def git(*args):
                return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()
            git('init', '-q'); git('config', 'user.email', 'test@example.com')
            git('config', 'user.name', 'Test'); git('config', 'commit.gpgsign', 'false')
            (repo / 'payload.py').write_text('raise RuntimeError("CANARY_34ab90")\n')
            (repo / '.gitattributes').write_text('payload.py export-ignore\n')
            protected = root / 'protected'; protected.write_text('synthetic secret')
            (repo / 'link').symlink_to(protected)
            git('add', '.'); git('commit', '-qm', 'fixture')
            revision = git('rev-parse', 'HEAD')
            (repo / 'payload.py').write_text('different working tree')
            output = root / 'output'
            omitted = isolation.export_source(repo, revision, output)
            self.assertEqual((output / 'payload.py').read_text(), 'raise RuntimeError("CANARY_34ab90")\n')
            self.assertEqual(omitted, ['link'])
            self.assertFalse((output / 'link').exists())
            self.assertEqual(protected.read_text(), 'synthetic secret')

    def test_export_rejects_mutable_revision_before_git(self):
        with self.assertRaisesRegex(ValueError, 'immutable'):
            isolation.export_source(Path('/absent'), 'main', Path('/absent'))

    def test_actual_launch_arguments_remove_execution_and_external_tools(self):
        args = isolation.agent_arguments(Path('/claude'), Path('/input'))
        self.assertEqual(args[args.index('--tools') + 1], 'Read')
        self.assertEqual(args[args.index('--allowedTools') + 1], 'Read')
        self.assertEqual(json.loads(args[args.index('--mcp-config') + 1]), {'mcpServers': {}})
        self.assertIn('--bare', args)
        self.assertIn('--strict-mcp-config', args)
        self.assertIn('--disable-slash-commands', args)

    def test_profile_grants_only_model_network_and_scratch_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime, node = install_layout(Path(directory))
            p = isolation.profile(Path('/input'), Path('/scratch'), runtime, node, Path('/claude'))
        self.assertIn(str(Path(directory) / 'tools/node'), p['filesystem']['allowRead'])
        self.assertIn(str(Path(directory) / 'tools/srt/node_modules'), p['filesystem']['allowRead'])
        self.assertEqual(p['network']['allowedDomains'], ['api.anthropic.com'])
        self.assertFalse(p['network']['allowLocalBinding'])
        self.assertEqual(p['network']['allowUnixSockets'], [])
        self.assertEqual(p['filesystem']['denyRead'], ['/'])
        self.assertEqual(p['filesystem']['allowWrite'], ['/scratch'])
        self.assertEqual(p['filesystem']['denyWrite'], ['/input'])


class ReadRootTests(unittest.TestCase):
    def profile_with_home(self, home, runtime, node, claude=Path('/claude')):
        with mock.patch.dict(os.environ, {'HOME': str(home)}):
            return isolation.profile(Path('/input'), Path('/scratch'), runtime, node, claude)

    def test_node_outside_an_install_prefix_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            runtime, _ = install_layout(home)
            for placed in ('bin/node', '.config/gh/node', '.asdf/shims/node'):
                node = home / placed
                node.parent.mkdir(parents=True, exist_ok=True); node.write_text('')
                with self.subTest(placed), self.assertRaisesRegex(ValueError, '--node'):
                    self.profile_with_home(home, runtime, node)

    def test_install_prefix_at_home_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            runtime, _ = install_layout(home)
            (home / 'bin').mkdir(); (home / 'bin/node').write_text('')
            (home / 'include/node').mkdir(parents=True)
            with self.assertRaisesRegex(ValueError, 'host credentials'):
                self.profile_with_home(home, runtime, home / 'bin/node')

    def test_srt_outside_a_dedicated_install_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            _, node = install_layout(home)
            loose = home / 'sandbox-runtime'; loose.mkdir()
            with self.assertRaisesRegex(ValueError, '--srt'):
                self.profile_with_home(home, loose, node)

    def test_claude_root_containing_home_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve() / 'home'
            runtime, node = install_layout(Path(directory).resolve())
            with self.assertRaisesRegex(ValueError, 'host credentials'):
                self.profile_with_home(home, runtime, node, claude=home.parent)


if __name__ == '__main__':
    unittest.main()
