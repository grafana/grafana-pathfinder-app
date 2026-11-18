import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('isolation', Path(__file__).with_name('isolated-review.py'))
isolation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(isolation)


class SourceTests(unittest.TestCase):
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
        p = isolation.profile(*map(Path, ['/input', '/scratch', '/runtime', '/node/bin/node', '/claude']))
        self.assertEqual(p['network']['allowedDomains'], ['api.anthropic.com'])
        self.assertFalse(p['network']['allowLocalBinding'])
        self.assertEqual(p['network']['allowUnixSockets'], [])
        self.assertEqual(p['filesystem']['denyRead'], ['/'])
        self.assertEqual(p['filesystem']['allowWrite'], ['/scratch'])
        self.assertEqual(p['filesystem']['denyWrite'], ['/input'])


if __name__ == '__main__':
    unittest.main()
