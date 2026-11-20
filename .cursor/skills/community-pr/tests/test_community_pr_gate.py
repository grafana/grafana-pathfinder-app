#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "scripts" / "community_pr_gate.py"
SPEC = importlib.util.spec_from_file_location("community_pr_gate", SCRIPT)
assert SPEC and SPEC.loader
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)

def binding() -> dict:
    return {
        "schema_version": 1,
        "repository": "grafana/grafana-pathfinder-app",
        "internal_author_policy": "repository_write_access",
        "ci_config_prefix": ".github/",
        "cla": {
            "context": "license/cla",
            "signed_description": "signed",
            "not_signed_description": "not signed",
        },
        "scanner": {"minimum_blocking_severity": "High"},
        "review_skill": ".cursor/skills/review-lite/SKILL.md",
        "review_policy": "docs/design/PR_REVIEW.md",
        "contributor_guide": "https://github.com/grafana/grafana-pathfinder-app/blob/main/CONTRIBUTING.md",
        "blocker_priority": ["cla", "signing"],
    }


class BindingTests(unittest.TestCase):
    def test_valid_binding(self) -> None:
        self.assertEqual(
            gate.validate_binding(binding(), "grafana/grafana-pathfinder-app")["schema_version"],
            1,
        )

    def test_binding_for_another_repository_is_rejected(self) -> None:
        with self.assertRaises(gate.GateError):
            gate.validate_binding(binding(), "grafana/another-repository")

    def test_invalid_internal_handle_is_rejected(self) -> None:
        value = binding()
        value["internal_handles"] = ["@not-a-handle"]
        with self.assertRaises(gate.GateError):
            gate.validate_binding(value, value["repository"])

    def test_github_app_bot_login_is_valid_but_not_implicitly_internal(self) -> None:
        self.assertIsNotNone(gate.HANDLE_RE.fullmatch("renovate-sh-app[bot]"))
        self.assertEqual(gate.classify_write_access({"user": {"login": "renovate-sh-app[bot]"}, "permission": "read"}, "renovate-sh-app[bot]"), "denied")

    def test_contributor_guide_is_pinned_to_binding_sha(self) -> None:
        value = binding()
        value["contributor_guide"] = (
            "https://github.com/grafana/grafana-pathfinder-app/blob/main/CONTRIBUTING.md"
        )
        with mock.patch.object(gate, "tree_has_path", side_effect=lambda _repo, _sha, path: path == "CONTRIBUTING.md"):
            result = gate.binding_for_output(
                Path("."),
                value,
                "grafana/grafana-pathfinder-app",
                "a" * 40,
            )
        self.assertEqual(
            result["contributor_guide"],
            f"https://github.com/grafana/grafana-pathfinder-app/blob/{'a' * 40}/CONTRIBUTING.md",
        )

    def test_repository_relative_nested_contributor_guide_is_pinned_to_binding_sha(self) -> None:
        value = binding()
        value["contributor_guide"] = "docs/CONTRIBUTING.md"
        with mock.patch.object(
            gate,
            "tree_has_path",
            side_effect=lambda _repo, _sha, path: path == "docs/CONTRIBUTING.md",
        ):
            result = gate.binding_for_output(
                Path("."), value, "grafana/grafana-pathfinder-app", "a" * 40
            )
        self.assertEqual(
            result["contributor_guide"],
            f"https://github.com/grafana/grafana-pathfinder-app/blob/{'a' * 40}/docs/CONTRIBUTING.md",
        )

    def test_ambiguous_contributor_guide_url_is_rejected(self) -> None:
        value = binding()
        value["contributor_guide"] = (
            "https://github.com/grafana/grafana-pathfinder-app/blob/release/1.x/docs/CONTRIBUTING.md"
        )
        with self.assertRaises(gate.GateError):
            gate.validate_binding(value, value["repository"])

    def test_external_contributor_guide_is_rejected(self) -> None:
        value = binding()
        value["contributor_guide"] = "https://example.invalid/CONTRIBUTING.md"
        with self.assertRaises(gate.GateError):
            gate.validate_binding(value, value["repository"])

    def test_binding_comes_from_current_trusted_base_branch_tip(self) -> None:
        pr = {
            "base": {
                "ref": "main",
                "repo": {"full_name": "grafana/grafana-pathfinder-app"},
            }
        }
        with mock.patch.object(gate, "gh_json", return_value={"commit": {"sha": "c" * 40}}) as api:
            result = gate.resolve_binding_sha(Path("."), "grafana/grafana-pathfinder-app", pr)
        self.assertEqual(result, "c" * 40)
        api.assert_called_once_with(Path("."), "repos/grafana/grafana-pathfinder-app/branches/main")

    def test_binding_rejects_a_different_base_repository(self) -> None:
        pr = {"base": {"ref": "main", "repo": {"full_name": "attacker/fork"}}}
        with self.assertRaises(gate.GateError):
            gate.resolve_binding_sha(Path("."), "grafana/grafana-pathfinder-app", pr)

    def test_blocker_priority_may_explicitly_add_merge_conflicts(self) -> None:
        value = binding()
        value["blocker_priority"] = ["merge_conflicts", "cla", "signing"]
        self.assertEqual(
            gate.validate_binding(value, value["repository"])["blocker_priority"],
            ["merge_conflicts", "cla", "signing"],
        )

    def test_blocker_priority_rejects_an_unknown_blocker_name(self) -> None:
        value = binding()
        value["blocker_priority"] = ["cla", "signing", "does_not_exist"]
        with self.assertRaises(gate.GateError):
            gate.validate_binding(value, value["repository"])

    def test_blocker_priority_rejects_a_duplicate_blocker_name(self) -> None:
        value = binding()
        value["blocker_priority"] = ["cla", "cla", "signing"]
        with self.assertRaises(gate.GateError):
            gate.validate_binding(value, value["repository"])

    def test_blocker_priority_still_requires_cla_and_signing(self) -> None:
        value = binding()
        value["blocker_priority"] = ["merge_conflicts", "cla"]
        with self.assertRaises(gate.GateError):
            gate.validate_binding(value, value["repository"])


class ClassificationTests(unittest.TestCase):
    def test_write_access_classification(self) -> None:
        def payload(permission: object, login: str = "Someone") -> dict:
            return {"permission": permission, "user": {"login": login}}

        self.assertEqual(gate.classify_write_access(payload("admin"), "someone"), "granted")
        self.assertEqual(gate.classify_write_access(payload("write"), "someone"), "granted")
        self.assertEqual(gate.classify_write_access(payload("read"), "someone"), "denied")
        self.assertEqual(gate.classify_write_access(payload("none"), "someone"), "denied")
        self.assertEqual(gate.classify_write_access(payload("write", "other"), "someone"), "unavailable")
        self.assertEqual(gate.classify_write_access(payload(None), "someone"), "unavailable")
        self.assertEqual(gate.classify_write_access([], "someone"), "unavailable")

    def test_write_access_lookup_failure_fails_closed(self) -> None:
        with mock.patch.object(gate, "gh_json", side_effect=gate.GateError("boom")):
            self.assertEqual(gate.write_access_state(Path("."), "o/r", "someone"), "unavailable")

    def snapshot_for(self, author: str, flag: object, access: str) -> dict:
        value = binding()
        pr = {"head": {"sha": "a" * 40}, "base": {"sha": "b" * 40}, "user": {"login": author}, "title": "t"}
        args = SimpleNamespace(repo_dir=".", remote="origin", number="7", scanner="zizmor")
        failure = gate.GateError("stop here")
        with (
            mock.patch.object(gate, "resolve_repository", return_value="grafana/grafana-pathfinder-app"),
            mock.patch.object(gate, "gh_json", return_value=pr),
            mock.patch.object(gate, "resolve_binding_sha", return_value="b" * 40),
            mock.patch.object(gate, "fetch_pr_objects"),
            mock.patch.object(gate, "load_binding", return_value=value),
            mock.patch.object(gate, "tree_has_path", return_value=True),
            mock.patch.object(gate, "scanner_snapshot", return_value={"status": "passed"}),
            mock.patch.object(gate, "write_access_state", return_value=access) as lookup,
            mock.patch.object(gate, "classify_cla", side_effect=failure),
        ):
            try:
                result, _ = gate.build_snapshot(args)
            except gate.GateError:
                result = {"status": "reached_community_gates"}
        result["lookup_called"] = lookup.called
        return result

    def test_write_access_author_is_internal_when_enabled(self) -> None:
        result = self.snapshot_for("writer", True, "granted")
        self.assertEqual(result["status"], "internal")
        self.assertEqual(result["internal_basis"], "write_access")

    def test_nonwriters_and_unknown_permissions_always_reach_community_gates(self) -> None:
        for author in ("CORE", "org-member", "stranger"):
            for access in ("denied", "unavailable"):
                result = self.snapshot_for(author, None, access)
                self.assertEqual(result["status"], "reached_community_gates")
                self.assertTrue(result["lookup_called"])

    def test_writer_classification_is_not_optional(self) -> None:
        result = self.snapshot_for("writer", None, "granted")
        self.assertEqual(result["status"], "internal")
        self.assertTrue(result["lookup_called"])

    def test_absent_cla_is_awaiting(self) -> None:
        self.assertEqual(gate.classify_cla([], binding())["state"], "awaiting")

    def test_not_signed_cla_fails(self) -> None:
        statuses = [{"context": "license/cla", "state": "pending", "description": "not signed"}]
        self.assertEqual(gate.classify_cla(statuses, binding())["state"], "failed")

    def test_unfamiliar_successful_cla_is_indeterminate(self) -> None:
        statuses = [{"context": "license/cla", "state": "success", "description": "surprise"}]
        self.assertEqual(gate.classify_cla(statuses, binding())["state"], "indeterminate")

    def test_latest_cla_status_wins(self) -> None:
        statuses = [
            {
                "context": "license/cla",
                "state": "success",
                "description": "signed",
                "updated_at": "2026-01-02T00:00:00Z",
            },
            {
                "context": "license/cla",
                "state": "pending",
                "description": "not signed",
                "updated_at": "2026-01-01T00:00:00Z",
            },
        ]
        self.assertEqual(gate.classify_cla(statuses, binding())["state"], "passed")

    def test_mixed_signatures_fail_per_commit(self) -> None:
        commits = [
            {"sha": "a" * 40, "commit": {"verification": {"verified": True, "reason": "valid"}}},
            {"sha": "b" * 40, "commit": {"verification": {"verified": False, "reason": "unknown_key"}}},
        ]
        result = gate.classify_signatures(commits, 2)
        self.assertEqual(result["state"], "failed")
        self.assertEqual(result["commits"][1]["reason"], "unknown_key")

    def test_more_than_250_commits_is_indeterminate(self) -> None:
        self.assertEqual(gate.classify_signatures([], 251)["state"], "indeterminate")

    def test_binding_controls_dual_blocker_priority(self) -> None:
        self.assertEqual(gate.choose_primary_blocker(["signing", "cla"], ["cla", "signing"]), "cla")

    def test_dirty_merge_state_fails(self) -> None:
        pr = {"mergeable": False, "mergeable_state": "dirty"}
        self.assertEqual(gate.classify_mergeable(pr)["state"], "failed")

    def test_clean_merge_state_passes(self) -> None:
        pr = {"mergeable": True, "mergeable_state": "clean"}
        self.assertEqual(gate.classify_mergeable(pr)["state"], "passed")

    def test_unresolved_merge_state_is_indeterminate(self) -> None:
        self.assertEqual(gate.classify_mergeable({"mergeable": None, "mergeable_state": None})["state"], "indeterminate")
        self.assertEqual(
            gate.classify_mergeable({"mergeable": True, "mergeable_state": "unknown"})["state"],
            "indeterminate",
        )

    def test_blocked_by_branch_protection_is_not_a_merge_conflict(self) -> None:
        pr = {"mergeable": False, "mergeable_state": "blocked"}
        self.assertEqual(gate.classify_mergeable(pr)["state"], "passed")

    def test_undeclared_merge_conflicts_default_to_lowest_priority(self) -> None:
        self.assertEqual(
            gate.effective_blocker_priority(binding()),
            ["cla", "signing", "merge_conflicts"],
        )
        self.assertEqual(
            gate.choose_primary_blocker(["merge_conflicts"], gate.effective_blocker_priority(binding())),
            "merge_conflicts",
        )

    def test_workflow_authorization_states(self) -> None:
        held = [{"id": 1, "name": "CI", "event": "pull_request", "conclusion": "action_required"}]
        ran = [{"id": 2, "name": "CI", "event": "pull_request", "conclusion": "success"}]
        self.assertEqual(gate.classify_workflows(held)["state"], "awaiting_authorization")
        completed = gate.classify_workflows(ran)
        self.assertEqual(completed["state"], "already_authorized")
        self.assertEqual(completed["authorization_provenance"], "inferred_from_executed_pull_request_runs")
        self.assertEqual(completed["observed_pull_request_runs"][0]["id"], 2)
        self.assertEqual(gate.classify_workflows([])["state"], "no_runs")

    def test_non_pull_request_run_is_never_presented_for_authorization(self) -> None:
        run = [{"id": 1, "name": "CI", "event": "push", "conclusion": "action_required"}]
        result = gate.classify_workflows(run)
        self.assertEqual(result["held_runs"], [])
        self.assertEqual(result["state"], "no_runs")

    def test_perform_adds_stable_failure_stage(self) -> None:
        with self.assertRaises(gate.GateError) as raised:
            gate.perform("resolve_pr", "pr_metadata_unavailable", lambda: (_ for _ in ()).throw(gate.GateError("offline")))
        self.assertEqual(raised.exception.details["stage"], "resolve_pr")
        self.assertEqual(raised.exception.details["error_code"], "pr_metadata_unavailable")


class ScannerTests(unittest.TestCase):
    def test_paths_are_normalized_before_comparison(self) -> None:
        raw = {
            "ident": "unpinned-uses",
            "determinations": {"severity": "High"},
            "locations": [
                {
                    "symbolic": {
                        "kind": "Primary",
                        "key": {"Local": {"verbatim_path": "PLACEHOLDER/.github/workflows/ci.yml"}},
                        "route": {"route": [{"Key": "jobs"}, {"Key": "test"}]},
                    },
                    "concrete": {"location": {"start_point": {"row": 12}}},
                }
            ],
        }
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            raw["locations"][0]["symbolic"]["key"]["Local"]["verbatim_path"] = str(
                root / ".github/workflows/ci.yml"
            )
            normalized = gate.normalize_finding(raw, root)
        self.assertEqual(normalized["path"], ".github/workflows/ci.yml")

    def test_scanner_fields_are_control_cleaned_and_bounded(self) -> None:
        value = "unsafe\x00" + ("x" * 400)
        result = gate.bounded_scanner_text(value)
        self.assertNotIn("\x00", result)
        self.assertEqual(len(result), gate.MAX_SCANNER_FIELD_LENGTH)

    def test_bounded_display_fields_do_not_collapse_fingerprints(self) -> None:
        prefix = ".github/workflows/" + ("x" * 260)
        first = gate.synthetic_finding("x", prefix + "a.yml", "route")
        second = gate.synthetic_finding("x", prefix + "b.yml", "route")
        self.assertEqual(first["path"], second["path"])
        self.assertNotEqual(gate.finding_fingerprint(first), gate.finding_fingerprint(second))
        self.assertEqual(gate.new_findings([second], [first]), [second])

    def test_route_keeps_same_file_findings_distinct(self) -> None:
        first = {"audit_id": "x", "severity": "High", "path": "ci.yml", "route": "one", "line": 1}
        second = {"audit_id": "x", "severity": "High", "path": "ci.yml", "route": "two", "line": 2}
        self.assertEqual(gate.new_findings([first, second], [first]), [second])

    def test_duplicate_fingerprints_use_multiset_comparison(self) -> None:
        finding = {"audit_id": "x", "severity": "High", "path": "ci.yml", "route": "one", "line": 1}
        self.assertEqual(gate.new_findings([finding, finding], [finding]), [finding])

    def test_scanner_snapshot_distinguishes_baseline_findings_from_new_findings(self) -> None:
        existing = gate.synthetic_finding("existing", ".github/workflows/ci.yml", "jobs.test")
        with (
            tempfile.TemporaryDirectory() as temp,
            mock.patch.object(gate, "archive_github", return_value=(True, [])),
            mock.patch.object(gate, "run_zizmor", side_effect=[([existing], 0), ([existing], 0)]),
        ):
            result = gate.scanner_snapshot(
                Path(temp),
                "a" * 40,
                "b" * 40,
                binding(),
                "zizmor",
            )
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["baseline_status"], "findings_present")
        self.assertEqual(result["comparison_policy"], "new_findings_only")
        self.assertEqual(result["carried_forward_count"], 1)
        self.assertEqual(result["new_serious_count"], 0)
        self.assertEqual(result["scanner_execution"]["head"], "completed")

    def test_nonzero_zizmor_with_partial_findings_is_indeterminate(self) -> None:
        result = SimpleNamespace(stdout='[{"ident": "partial"}]', returncode=2)
        with mock.patch.object(gate, "run", return_value=result):
            with self.assertRaises(gate.GateError):
                gate.run_zizmor("zizmor", Path("."), True)

    def test_scanner_block_snapshot_exposes_no_contributor_content(self) -> None:
        args = SimpleNamespace(repo_dir=".", remote="origin", number="7", scanner="zizmor")
        pr = {
            "head": {"sha": "a" * 40},
            "base": {"sha": "b" * 40},
            "user": {"login": "untrusted-author"},
            "title": "untrusted title",
            "body": "untrusted body",
        }
        scan = {
            "status": "blocked",
            "blocking_findings": [
                {"audit_id": "template-injection", "severity": "High", "path": ".github/workflows/ci.yml"}
            ],
        }
        with (
            mock.patch.object(gate, "resolve_repository", return_value="grafana/grafana-pathfinder-app"),
            mock.patch.object(gate, "gh_json", return_value=pr),
            mock.patch.object(gate, "resolve_binding_sha", return_value="b" * 40),
            mock.patch.object(gate, "fetch_pr_objects"),
            mock.patch.object(gate, "load_binding", return_value=binding()),
            mock.patch.object(gate, "tree_has_path", return_value=True),
            mock.patch.object(gate, "scanner_snapshot", return_value=scan),
        ):
            result, exit_code = gate.build_snapshot(args)
        self.assertEqual(exit_code, 20)
        self.assertEqual(result["status"], "scanner_blocked")
        self.assertNotIn("author", result)
        self.assertNotIn("title", result)
        self.assertNotIn("body", result)

    @unittest.skipUnless(shutil.which("zizmor"), "zizmor is not installed")
    def test_real_zizmor_marks_unpinned_action_as_serious(self) -> None:
        fixture = Path(__file__).parent / "fixtures" / "unsafe-workflow.yml"
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            workflows = root / ".github" / "workflows"
            workflows.mkdir(parents=True)
            shutil.copyfile(fixture, workflows / "unsafe-workflow.yml")
            findings, _ = gate.run_zizmor("zizmor", root, True)
        serious = [item for item in findings if gate.SEVERITY_RANK.get(item["severity"], 99) >= gate.SEVERITY_RANK["High"]]
        self.assertTrue(serious)
        self.assertIn("unpinned-uses", {item["audit_id"] for item in serious})


class FileTriageTests(unittest.TestCase):
    def test_file_categories_are_structured(self) -> None:
        files = [
            {"filename": ".github/workflows/ci.yml"},
            {"filename": "package-lock.json"},
            {"filename": "scripts/release-build.sh"},
        ]
        result = gate.classify_files(files, binding())
        self.assertEqual(result["ci_paths"], [".github/workflows/ci.yml"])
        self.assertEqual(result["dependency_paths"], ["package-lock.json"])
        self.assertEqual(result["build_release_paths"], ["scripts/release-build.sh"])


class HeadVerificationTests(unittest.TestCase):
    def test_verify_head_reports_unchanged_without_contributor_content(self) -> None:
        args = SimpleNamespace(repo_dir=".", remote="origin", number="9", expected_sha="a" * 40)
        with (
            mock.patch.object(gate, "resolve_repository", return_value="grafana/grafana-pathfinder-app"),
            mock.patch.object(gate, "gh_json", return_value={"head": {"sha": "a" * 40}, "title": "ignored"}),
        ):
            result, exit_code = gate.verify_head(args)
        self.assertEqual(exit_code, 0)
        self.assertEqual(result["status"], "unchanged")
        self.assertNotIn("title", result)

    def test_verify_head_reports_moved(self) -> None:
        args = SimpleNamespace(repo_dir=".", remote="origin", number="9", expected_sha="a" * 40)
        with (
            mock.patch.object(gate, "resolve_repository", return_value="grafana/grafana-pathfinder-app"),
            mock.patch.object(gate, "gh_json", return_value={"head": {"sha": "b" * 40}}),
        ):
            result, _ = gate.verify_head(args)
        self.assertEqual(result["status"], "moved")
        self.assertEqual(result["next_action"], "discard_state_and_rerun_snapshot")


class CIStatusTests(unittest.TestCase):
    def args(self) -> SimpleNamespace:
        return SimpleNamespace(
            repo_dir=".", remote="origin", number="9",
            expected_sha="a" * 40, base_sha="b" * 40, binding_sha="c" * 40,
        )

    def test_report_comment_permission_failure_is_infrastructure(self) -> None:
        checks = [
            {"id": 7, "name": "publish-report", "status": "completed", "conclusion": "failure"},
            {"id": 8, "name": "Test", "status": "completed", "conclusion": "success"},
        ]
        annotations = {
            7: [
                {"annotation_level": "warning", "message": "Node.js is deprecated"},
                {
                    "annotation_level": "failure",
                    "message": "Resource not accessible by integration - create an issue comment",
                },
            ]
        }
        result = gate.classify_ci_checks(checks, annotations)
        self.assertEqual(result["state"], "infrastructure")
        self.assertEqual(
            result["failed"][0]["infrastructure_signatures"][0]["id"],
            "fork-report-comment-permission",
        )

    def test_pathfinder_bundle_compare_permission_failure_is_infrastructure(self) -> None:
        checks = [{"id": 7, "name": "compare", "status": "completed", "conclusion": "failure"}]
        annotations = {
            7: [{"annotation_level": "failure", "message": "Resource not accessible by integration"}]
        }
        result = gate.classify_ci_checks(
            checks,
            annotations,
            repository="grafana/grafana-pathfinder-app",
        )
        self.assertEqual(result["state"], "infrastructure")
        self.assertEqual(
            result["failed"][0]["infrastructure_signatures"][0]["id"],
            "pathfinder-fork-bundle-comment-permission",
        )
        self.assertEqual(
            gate.classify_ci_checks(checks, annotations, repository="another/repository")["state"],
            "unclear",
        )

    def test_unknown_failure_is_never_automatically_attributed_to_contributor(self) -> None:
        checks = [{"id": 7, "name": "Test", "status": "completed", "conclusion": "failure"}]
        result = gate.classify_ci_checks(
            checks,
            {7: [{"annotation_level": "failure", "message": "Assertion failed"}]},
        )
        self.assertEqual(result["state"], "unclear")
        self.assertFalse(result["automatic_contributor_attribution"])

    def test_allowlisted_failure_with_a_second_unknown_failure_is_unclear(self) -> None:
        checks = [{"id": 7, "name": "publish-report", "status": "completed", "conclusion": "failure"}]
        annotations = {
            7: [
                {"annotation_level": "failure", "message": "Resource not accessible by integration"},
                {"annotation_level": "failure", "message": "Assertion failed"},
            ]
        }
        self.assertEqual(gate.classify_ci_checks(checks, annotations)["state"], "unclear")

    def test_truncated_annotations_can_never_be_automatically_infrastructure(self) -> None:
        checks = [
            {
                "id": 7,
                "name": "publish-report",
                "status": "completed",
                "conclusion": "failure",
                "output": {"annotations_count": gate.MAX_ANNOTATIONS_PER_CHECK + 1},
            }
        ]
        annotations = {
            7: [
                {"annotation_level": "failure", "message": "Resource not accessible by integration"}
                for _ in range(gate.MAX_ANNOTATIONS_PER_CHECK)
            ]
        }
        result = gate.classify_ci_checks(checks, annotations)
        self.assertEqual(result["state"], "unclear")
        self.assertTrue(result["failed"][0]["annotations_truncated"])

    def test_changed_ci_config_disables_automatic_infrastructure_attribution(self) -> None:
        checks = [{"id": 7, "name": "publish-report", "status": "completed", "conclusion": "failure"}]
        annotations = {
            7: [{"annotation_level": "failure", "message": "Resource not accessible by integration"}]
        }
        result = gate.classify_ci_checks(checks, annotations, ci_config_changed=True)
        self.assertEqual(result["state"], "unclear")
        self.assertTrue(result["ci_config_changed"])

    def test_pending_check_keeps_ci_pending(self) -> None:
        checks = [{"id": 7, "name": "Test", "status": "in_progress", "conclusion": None}]
        self.assertEqual(gate.classify_ci_checks(checks, {})["state"], "pending")

    def test_ci_status_rejects_a_head_move_after_collection(self) -> None:
        checks = [{"id": 7, "name": "publish-report", "status": "completed", "conclusion": "failure"}]
        annotations = [{"annotation_level": "failure", "message": "Resource not accessible by integration"}]
        with (
            mock.patch.object(gate, "resolve_repository", return_value="grafana/grafana-pathfinder-app"),
            mock.patch.object(gate, "current_head", side_effect=["a" * 40, "d" * 40]) as head,
            mock.patch.object(gate, "load_binding", return_value={"ci_config_prefix": ".github/"}),
            mock.patch.object(gate, "exact_changed_paths", return_value=[]),
            mock.patch.object(gate, "collect_check_runs", return_value=checks),
            mock.patch.object(gate, "gh_pages", return_value=annotations),
        ):
            result, exit_code = gate.ci_status(self.args())
        self.assertEqual(exit_code, 22)
        self.assertEqual(result["status"], "moved")
        self.assertNotIn("ci", result)
        self.assertEqual(head.call_count, 2)

    def test_ci_status_uses_binding_prefix_and_exact_snapshot_paths(self) -> None:
        checks = [{"id": 7, "name": "publish-report", "status": "completed", "conclusion": "failure"}]
        annotations = [{"annotation_level": "failure", "message": "Resource not accessible by integration"}]
        with (
            mock.patch.object(gate, "resolve_repository", return_value="grafana/grafana-pathfinder-app"),
            mock.patch.object(gate, "current_head", return_value="a" * 40),
            mock.patch.object(gate, "load_binding", return_value={"ci_config_prefix": "ci/"}),
            mock.patch.object(gate, "exact_changed_paths", return_value=["ci/pipeline.yml"]) as paths,
            mock.patch.object(gate, "collect_check_runs", return_value=checks),
            mock.patch.object(gate, "gh_pages", return_value=annotations),
        ):
            result, exit_code = gate.ci_status(self.args())
        self.assertEqual(exit_code, 0)
        self.assertEqual(result["ci"]["state"], "unclear")
        self.assertTrue(result["ci"]["ci_config_changed"])
        paths.assert_called_once_with(Path(".").resolve(), "b" * 40, "a" * 40)


class AuthorizationTests(unittest.TestCase):
    def test_authorize_held_validates_posts_and_reads_every_run_back(self) -> None:
        args = SimpleNamespace(
            repo_dir=".",
            remote="origin",
            number="9",
            expected_sha="a" * 40,
            run_ids=[11, 12],
            approved_by_human=True,
        )
        held = [
            {"id": 11, "event": "pull_request", "head_sha": "a" * 40, "conclusion": "action_required"},
            {"id": 12, "event": "pull_request", "head_sha": "a" * 40, "conclusion": "action_required"},
        ]
        released = [
            {"id": 11, "event": "pull_request", "head_sha": "a" * 40, "conclusion": None},
            {"id": 12, "event": "pull_request", "head_sha": "a" * 40, "conclusion": "success"},
        ]
        with (
            mock.patch.object(gate, "resolve_repository", return_value="grafana/grafana-pathfinder-app"),
            mock.patch.object(gate, "current_head", return_value="a" * 40),
            mock.patch.object(gate, "collect_runs", side_effect=[held, released]),
            mock.patch.object(gate, "gh_post", return_value={}) as post,
        ):
            result, exit_code = gate.authorize_held(args)
        self.assertEqual(exit_code, 0)
        self.assertEqual(result["status"], "authorized")
        self.assertEqual(result["verified_run_ids"], [11, 12])
        self.assertEqual(post.call_count, 2)

    def test_authorize_held_stops_before_mutation_when_run_set_changed(self) -> None:
        args = SimpleNamespace(
            repo_dir=".",
            remote="origin",
            number="9",
            expected_sha="a" * 40,
            run_ids=[11],
            approved_by_human=True,
        )
        runs = [
            {"id": 11, "event": "pull_request", "head_sha": "a" * 40, "conclusion": "action_required"},
            {"id": 12, "event": "pull_request", "head_sha": "a" * 40, "conclusion": "action_required"},
        ]
        with (
            mock.patch.object(gate, "resolve_repository", return_value="grafana/grafana-pathfinder-app"),
            mock.patch.object(gate, "current_head", return_value="a" * 40),
            mock.patch.object(gate, "collect_runs", return_value=runs),
            mock.patch.object(gate, "gh_post") as post,
        ):
            result, exit_code = gate.authorize_held(args)
        self.assertEqual(exit_code, 21)
        self.assertEqual(result["status"], "authorization_set_changed")
        post.assert_not_called()

    def test_authorize_held_reports_head_move_before_second_mutation(self) -> None:
        args = SimpleNamespace(
            repo_dir=".",
            remote="origin",
            number="9",
            expected_sha="a" * 40,
            run_ids=[11, 12],
            approved_by_human=True,
        )
        held = [
            {"id": 11, "event": "pull_request", "head_sha": "a" * 40, "conclusion": "action_required"},
            {"id": 12, "event": "pull_request", "head_sha": "a" * 40, "conclusion": "action_required"},
        ]
        with (
            mock.patch.object(gate, "resolve_repository", return_value="grafana/grafana-pathfinder-app"),
            mock.patch.object(gate, "current_head", side_effect=["a" * 40, "a" * 40, "b" * 40]),
            mock.patch.object(gate, "collect_runs", return_value=held),
            mock.patch.object(gate, "gh_post", return_value={}) as post,
        ):
            result, exit_code = gate.authorize_held(args)
        self.assertEqual(exit_code, 23)
        self.assertEqual(result["status"], "head_moved_during_authorization")
        self.assertEqual(result["approved_run_ids"], [11])
        self.assertEqual(result["current_head_sha"], "b" * 40)
        self.assertEqual(post.call_count, 1)

    def test_authorize_held_rejects_missing_readback_run(self) -> None:
        args = SimpleNamespace(
            repo_dir=".", remote="origin", number="9", expected_sha="a" * 40,
            run_ids=[11], approved_by_human=True,
        )
        held = [{"id": 11, "event": "pull_request", "head_sha": "a" * 40, "conclusion": "action_required"}]
        with (
            mock.patch.object(gate, "resolve_repository", return_value="grafana/grafana-pathfinder-app"),
            mock.patch.object(gate, "current_head", return_value="a" * 40),
            mock.patch.object(gate, "collect_runs", side_effect=[held, []]),
            mock.patch.object(gate, "gh_post", return_value={}),
        ):
            result, exit_code = gate.authorize_held(args)
        self.assertEqual(exit_code, 23)
        self.assertEqual(result["missing_readback_run_ids"], [11])

    def test_authorize_held_rejects_new_held_run_on_readback(self) -> None:
        args = SimpleNamespace(
            repo_dir=".", remote="origin", number="9", expected_sha="a" * 40,
            run_ids=[11], approved_by_human=True,
        )
        held = [{"id": 11, "event": "pull_request", "head_sha": "a" * 40, "conclusion": "action_required"}]
        readback = [
            {"id": 11, "event": "pull_request", "head_sha": "a" * 40, "conclusion": None},
            {"id": 12, "event": "pull_request", "head_sha": "a" * 40, "conclusion": "action_required"},
        ]
        with (
            mock.patch.object(gate, "resolve_repository", return_value="grafana/grafana-pathfinder-app"),
            mock.patch.object(gate, "current_head", return_value="a" * 40),
            mock.patch.object(gate, "collect_runs", side_effect=[held, readback]),
            mock.patch.object(gate, "gh_post", return_value={}),
        ):
            result, exit_code = gate.authorize_held(args)
        self.assertEqual(exit_code, 23)
        self.assertEqual(result["unexpected_held_run_ids"], [12])
        self.assertEqual(result["next_action"], "show_a_new_authorization_prompt")


class TraceTests(unittest.TestCase):
    def test_emit_trace_returns_capture_ready_json_shape(self) -> None:
        args = SimpleNamespace(
            repository="grafana/grafana-pathfinder-app",
            number="9",
            head_sha="a" * 40,
            scanner_raw_count=10,
            scanner_unique_count=6,
            scanner_new_count=0,
            scanner_new_serious_count=0,
            gate_state="ready_for_triage",
            authorization_state="already_authorized",
            authorization_provenance="inferred_from_executed_pull_request_runs",
            run_ids=[11],
            review_handoff="completed",
            ci_attribution="infrastructure",
            head_verification="unchanged",
            terminal_outcome="complete",
            would_be_next_state=None,
        )
        result, exit_code = gate.emit_trace(args)
        self.assertEqual(exit_code, 0)
        self.assertEqual(result["terminal_outcome"], "complete")
        self.assertEqual(result["authorization"]["run_ids"], [11])

    def test_emit_trace_rejects_cross_field_contradictions(self) -> None:
        args = SimpleNamespace(
            repository="grafana/grafana-pathfinder-app", number="9", head_sha="a" * 40,
            scanner_raw_count=1, scanner_unique_count=2, scanner_new_count=3,
            scanner_new_serious_count=4, gate_state="scanner_blocked",
            authorization_state="authorized", authorization_provenance="none", run_ids=[11],
            review_handoff="completed", ci_attribution="passed", head_verification="moved",
            terminal_outcome="complete", would_be_next_state=None,
        )
        with self.assertRaises(gate.GateError):
            gate.emit_trace(args)

    def test_emit_trace_rejects_internal_outcome_with_external_gate_fields(self) -> None:
        args = SimpleNamespace(
            repository="grafana/grafana-pathfinder-app", number="9", head_sha="a" * 40,
            scanner_raw_count=1, scanner_unique_count=1, scanner_new_count=1,
            scanner_new_serious_count=1, gate_state="scanner_blocked",
            authorization_state="authorized", authorization_provenance="approved_by_human", run_ids=[11],
            review_handoff="completed", ci_attribution="contributor", head_verification="moved",
            terminal_outcome="internal", would_be_next_state=None,
        )
        with self.assertRaises(gate.GateError):
            gate.emit_trace(args)

    def test_emit_trace_represents_contributor_ci_block(self) -> None:
        args = SimpleNamespace(
            repository="grafana/grafana-pathfinder-app", number="9", head_sha="a" * 40,
            scanner_raw_count=1, scanner_unique_count=1, scanner_new_count=0,
            scanner_new_serious_count=0, gate_state="ready_for_triage",
            authorization_state="authorized", authorization_provenance="approved_by_human", run_ids=[11],
            review_handoff="discarded", ci_attribution="contributor", head_verification="unchanged",
            terminal_outcome="ci_blocked", would_be_next_state=None,
        )
        result, exit_code = gate.emit_trace(args)
        self.assertEqual(exit_code, 0)
        self.assertEqual(result["terminal_outcome"], "ci_blocked")

    def test_emit_trace_represents_partial_review_preserved_on_ci_block(self) -> None:
        args = SimpleNamespace(
            repository="grafana/grafana-pathfinder-app", number="9", head_sha="a" * 40,
            scanner_raw_count=1, scanner_unique_count=1, scanner_new_count=0,
            scanner_new_serious_count=0, gate_state="ready_for_triage",
            authorization_state="authorized", authorization_provenance="approved_by_human", run_ids=[11],
            review_handoff="partial", ci_attribution="contributor", head_verification="unchanged",
            terminal_outcome="ci_blocked", would_be_next_state=None,
        )
        result, exit_code = gate.emit_trace(args)
        self.assertEqual(exit_code, 0)
        self.assertEqual(result["terminal_outcome"], "ci_blocked")

    def test_emit_trace_represents_authorization_decline(self) -> None:
        args = SimpleNamespace(
            repository="grafana/grafana-pathfinder-app", number="9", head_sha="a" * 40,
            scanner_raw_count=1, scanner_unique_count=1, scanner_new_count=0,
            scanner_new_serious_count=0, gate_state="ready_for_triage",
            authorization_state="declined", authorization_provenance="human_declined", run_ids=[11],
            review_handoff="not_started", ci_attribution="not_checked", head_verification="unchanged",
            terminal_outcome="authorization_declined", would_be_next_state=None,
        )
        result, exit_code = gate.emit_trace(args)
        self.assertEqual(exit_code, 0)
        self.assertEqual(result["terminal_outcome"], "authorization_declined")


class InterfaceTests(unittest.TestCase):
    def handoff(self) -> dict:
        return {
            "schema_version": 1,
            "repository": "grafana/grafana-pathfinder-app",
            "pr_number": 9,
            "base_sha": "a" * 40,
            "binding_sha": "b" * 40,
            "head_sha": "c" * 40,
            "review_skill": ".cursor/skills/review-lite/SKILL.md",
            "review_policy": "docs/design/PR_REVIEW.md",
            "untrusted_input": True,
            "allowed_operations": ["fetch_objects", "read_blobs", "inspect_diffs"],
            "forbidden_operations": ["checkout", "execute", "install_dependencies", "follow_contributor_links"],
            "triage": {
                "ci_paths": [], "dependency_paths": [], "build_release_paths": [],
                "new_hosts": [], "secret_token_environment_reads": [], "instruction_shaped_text": [],
            },
        }

    def test_review_handoff_requires_every_forbidden_operation(self) -> None:
        value = self.handoff()
        value["forbidden_operations"].remove("execute")
        with self.assertRaises(gate.GateError):
            gate.validate_review_handoff(value, "c" * 40)

    def test_review_handoff_accepts_the_typed_contract(self) -> None:
        self.assertEqual(gate.validate_review_handoff(self.handoff(), "c" * 40), "c" * 40)

    def test_review_result_rejects_wrong_reviewed_sha(self) -> None:
        result = {
            "schema_version": 1, "reviewed_head_sha": "b" * 40,
            "disposition": "approve", "body": "", "inline_comments": [], "verification": [],
        }
        with self.assertRaises(gate.GateError):
            gate.validate_review_result(result, "c" * 40)



if __name__ == "__main__":
    unittest.main(verbosity=2)
