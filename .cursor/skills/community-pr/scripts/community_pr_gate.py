#!/usr/bin/env python3
"""Build an immutable, zizmor-first snapshot for a community pull request."""

from __future__ import annotations

import argparse
import collections
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote, urlparse


BINDING_PATH = ".github/community-pr-gate.json"
HANDLE_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SEVERITY_RANK = {"Informational": 0, "Low": 1, "Medium": 2, "High": 3, "Critical": 4}
KNOWN_BLOCKERS = ("cla", "signing", "merge_conflicts")
FAILED_CHECK_CONCLUSIONS = {"action_required", "cancelled", "failure", "startup_failure", "timed_out"}
INFRASTRUCTURE_SIGNATURES = (
    {
        "id": "fork-report-comment-permission",
        "description": "A fork-safe report job could not write its PR comment.",
        "check_name": re.compile(r"^publish-report$", re.IGNORECASE),
        "message": re.compile(r"Resource not accessible by integration", re.IGNORECASE),
    },
    {
        "id": "pathfinder-fork-bundle-comment-permission",
        "description": "Pathfinder Bundle Stats could not write its PR comment for a fork.",
        "repositories": {"grafana/grafana-pathfinder-app"},
        "check_name": re.compile(r"^compare$", re.IGNORECASE),
        "message": re.compile(r"Resource not accessible by integration", re.IGNORECASE),
    },
)
MAX_ANNOTATIONS_PER_CHECK = 20
MAX_ANNOTATION_LENGTH = 500
MAX_SCANNER_FIELD_LENGTH = 240
DEPENDENCY_NAMES = {
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "go.mod",
    "go.sum",
    "cargo.toml",
    "cargo.lock",
    "requirements.txt",
    "poetry.lock",
    "gemfile",
    "gemfile.lock",
}


class GateError(Exception):
    def __init__(self, message: str, *, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.details = details or {}


def perform(stage: str, error_code: str, operation: Any) -> Any:
    try:
        return operation()
    except GateError as error:
        raise GateError(
            str(error),
            details={"stage": stage, "error_code": error_code, **error.details},
        ) from error
    except subprocess.TimeoutExpired as error:
        raise GateError(
            f"operation timed out: {error.cmd[0]}",
            details={"stage": stage, "error_code": f"{error_code}_timeout"},
        ) from error


def run(
    argv: list[str],
    *,
    cwd: Path,
    text: bool = True,
    timeout: int = 60,
    check: bool = True,
) -> subprocess.CompletedProcess[Any]:
    try:
        result = subprocess.run(
            argv,
            cwd=cwd,
            capture_output=True,
            text=text,
            timeout=timeout,
            check=False,
        )
    except OSError as error:
        raise GateError(f"could not execute {argv[0]}: {error}") from error
    if check and result.returncode != 0:
        stderr = result.stderr.strip() if text else ""
        raise GateError(f"command failed ({result.returncode}): {argv[0]} {stderr}".strip())
    return result


def git_text(repo_dir: Path, *args: str) -> str:
    return run(["git", *args], cwd=repo_dir).stdout.strip()


def resolve_repository(repo_dir: Path, remote: str) -> str:
    url = git_text(repo_dir, "remote", "get-url", remote)
    patterns = (
        r"^https://github\.com/([^/]+/[^/]+?)(?:\.git)?$",
        r"^git@github\.com:([^/]+/[^/]+?)(?:\.git)?$",
        r"^ssh://git@github\.com/([^/]+/[^/]+?)(?:\.git)?$",
    )
    for pattern in patterns:
        match = re.match(pattern, url)
        if match:
            return match.group(1)
    raise GateError(f"remote {remote!r} is not a recognized GitHub repository URL")


def gh_json(repo_dir: Path, endpoint: str) -> Any:
    result = run(["gh", "api", endpoint], cwd=repo_dir, timeout=90)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise GateError(f"GitHub API returned invalid JSON for {endpoint}") from error


def gh_post(repo_dir: Path, endpoint: str) -> Any:
    result = run(["gh", "api", "--method", "POST", endpoint], cwd=repo_dir, timeout=90)
    try:
        return json.loads(result.stdout or "{}")
    except json.JSONDecodeError as error:
        raise GateError(f"GitHub API returned invalid JSON for POST {endpoint}") from error


def gh_pages(repo_dir: Path, endpoint: str, *, maximum: int | None = None) -> list[Any]:
    items: list[Any] = []
    page = 1
    while True:
        separator = "&" if "?" in endpoint else "?"
        payload = gh_json(repo_dir, f"{endpoint}{separator}per_page=100&page={page}")
        if not isinstance(payload, list):
            raise GateError(f"expected a list from GitHub API endpoint {endpoint}")
        items.extend(payload)
        if maximum is not None and len(items) >= maximum:
            return items[:maximum]
        if len(payload) < 100:
            return items
        page += 1


def fetch_pr_objects(
    repo_dir: Path,
    remote: str,
    number: str,
    head_sha: str,
    base_sha: str,
    binding_sha: str,
) -> None:
    run(["git", "fetch", "--no-tags", remote, f"refs/pull/{number}/head"], cwd=repo_dir, timeout=120)
    fetched_head = git_text(repo_dir, "rev-parse", "FETCH_HEAD")
    if fetched_head != head_sha:
        raise GateError("fetched PR head does not match the GitHub API head SHA")
    run(["git", "fetch", "--no-tags", remote, base_sha], cwd=repo_dir, timeout=120)
    if binding_sha != base_sha:
        run(["git", "fetch", "--no-tags", remote, binding_sha], cwd=repo_dir, timeout=120)


def resolve_binding_sha(repo_dir: Path, repository: str, pr: dict[str, Any]) -> str:
    base = pr.get("base") if isinstance(pr, dict) else None
    base_repository = base.get("repo", {}).get("full_name") if isinstance(base, dict) else None
    base_ref = base.get("ref") if isinstance(base, dict) else None
    if base_repository != repository:
        raise GateError("PR base repository does not match the current repository")
    if not isinstance(base_ref, str) or not base_ref:
        raise GateError("GitHub PR response omitted the base branch name")
    branch = gh_json(repo_dir, f"repos/{repository}/branches/{quote(base_ref, safe='')}")
    binding_sha = branch.get("commit", {}).get("sha") if isinstance(branch, dict) else None
    if not isinstance(binding_sha, str) or not SHA_RE.fullmatch(binding_sha):
        raise GateError("GitHub base branch response omitted a valid commit SHA")
    return binding_sha


def git_object(repo_dir: Path, sha: str, path: str) -> str:
    if not SHA_RE.fullmatch(sha):
        raise GateError("invalid commit SHA from GitHub API")
    result = run(["git", "show", f"{sha}:{path}"], cwd=repo_dir, check=False)
    if result.returncode != 0:
        raise GateError(f"required trusted-base file is missing: {path}")
    return result.stdout


def validate_binding(data: Any, repository: str) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise GateError("community PR binding must be a JSON object")
    required_strings = (
        "repository",
        "internal_author_policy",
        "ci_config_prefix",
        "review_skill",
        "review_policy",
        "contributor_guide",
    )
    if data.get("schema_version") != 1:
        raise GateError("community PR binding schema_version must be 1")
    for key in required_strings:
        if not isinstance(data.get(key), str) or not data[key]:
            raise GateError(f"community PR binding field {key!r} must be a non-empty string")
    guide = data["contributor_guide"]
    if "://" in guide and not guide.startswith("https://"):
        raise GateError("community PR binding contributor_guide URL must use HTTPS")
    if guide.startswith("https://"):
        parsed = urlparse(guide)
        prefix = f"/{repository}/blob/"
        if (
            parsed.scheme != "https"
            or parsed.netloc != "github.com"
            or parsed.query
            or parsed.fragment
            or not parsed.path.startswith(prefix)
            or len(parsed.path[len(prefix):].split("/")) != 2
        ):
            raise GateError(
                "community PR binding contributor_guide URL must be a same-repository root file with a single-segment ref; use a repository-relative path otherwise"
            )
    else:
        validate_relative_path(guide, "community PR binding contributor_guide")
    if data["repository"] != repository:
        raise GateError(
            f"community PR binding names {data['repository']!r}, not current repository {repository!r}"
        )
    if data["internal_author_policy"] != "repository_write_access":
        raise GateError("community PR binding internal_author_policy must be 'repository_write_access'")
    cla = data.get("cla")
    if not isinstance(cla, dict):
        raise GateError("community PR binding field 'cla' must be an object")
    for key in ("context", "signed_description", "not_signed_description"):
        if not isinstance(cla.get(key), str) or not cla[key]:
            raise GateError(f"community PR binding CLA field {key!r} must be a non-empty string")
    scanner = data.get("scanner")
    if not isinstance(scanner, dict) or scanner.get("minimum_blocking_severity") not in SEVERITY_RANK:
        raise GateError("community PR binding scanner severity is invalid")
    if "internal_handles" in data or "write_access_is_internal" in data:
        raise GateError("handle exemptions and optional write-access classification are no longer supported")
    priority = data.get("blocker_priority")
    if not isinstance(priority, list) or any(not isinstance(item, str) for item in priority):
        raise GateError("community PR binding blocker_priority must be a list of blocker names")
    if len(set(priority)) != len(priority):
        raise GateError("community PR binding blocker_priority must not repeat a blocker name")
    if set(priority) - set(KNOWN_BLOCKERS):
        raise GateError(f"community PR binding blocker_priority must only name {KNOWN_BLOCKERS}")
    if not {"cla", "signing"} <= set(priority):
        raise GateError("community PR binding blocker_priority must order 'cla' and 'signing'")
    return data


def effective_blocker_priority(binding: dict[str, Any]) -> list[str]:
    declared = binding["blocker_priority"]
    return [*declared, *(item for item in KNOWN_BLOCKERS if item not in declared)]


def load_binding(repo_dir: Path, binding_sha: str, repository: str) -> dict[str, Any]:
    raw = git_object(repo_dir, binding_sha, BINDING_PATH)
    try:
        return validate_binding(json.loads(raw), repository)
    except json.JSONDecodeError as error:
        raise GateError(f"trusted-base binding is not valid JSON: {BINDING_PATH}") from error


def contributor_guide_path(
    repo_dir: Path,
    binding_sha: str,
    repository: str,
    guide: str,
) -> str:
    if not guide.startswith("https://"):
        guide_path = guide
    else:
        prefix = f"https://github.com/{repository}/blob/"
        remainder = guide[len(prefix):]
        segments = remainder.split("/")
        guide_path = segments[1]
    if not tree_has_path(repo_dir, binding_sha, guide_path):
        raise GateError("contributor guide does not resolve in the trusted binding commit")
    return guide_path


def binding_for_output(
    repo_dir: Path,
    binding: dict[str, Any],
    repository: str,
    binding_sha: str,
) -> dict[str, Any]:
    result = json.loads(json.dumps(binding))
    guide_path = contributor_guide_path(repo_dir, binding_sha, repository, result["contributor_guide"])
    result["contributor_guide"] = f"https://github.com/{repository}/blob/{binding_sha}/{guide_path}"
    return result


def tree_has_path(repo_dir: Path, sha: str, path: str) -> bool:
    result = run(["git", "cat-file", "-e", f"{sha}:{path}"], cwd=repo_dir, check=False)
    return result.returncode == 0


def archive_github(repo_dir: Path, sha: str, destination: Path) -> tuple[bool, list[str]]:
    destination.mkdir(parents=True, exist_ok=True)
    if not tree_has_path(repo_dir, sha, ".github"):
        return False, []
    archive = run(["git", "archive", sha, ".github"], cwd=repo_dir, text=False, timeout=90)
    unsupported: list[str] = []
    root = destination.resolve()
    with tarfile.open(fileobj=io.BytesIO(archive.stdout), mode="r:") as bundle:
        for member in bundle.getmembers():
            target = (destination / member.name).resolve()
            try:
                target.relative_to(root)
            except ValueError:
                raise GateError("git archive contained a path outside the extraction root")
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                source = bundle.extractfile(member)
                if source is None:
                    raise GateError(f"could not read archived file {member.name}")
                target.write_bytes(source.read())
            else:
                unsupported.append(member.name)
    return True, unsupported


def primary_location(finding: dict[str, Any]) -> dict[str, Any]:
    locations = finding.get("locations") if isinstance(finding.get("locations"), list) else []
    for location in locations:
        if location.get("symbolic", {}).get("kind") == "Primary":
            return location
    return locations[0] if locations else {}


def bounded_scanner_text(value: Any) -> str:
    if not isinstance(value, str):
        return "unknown"
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "�", value)
    return cleaned[:MAX_SCANNER_FIELD_LENGTH]


def normalize_finding(finding: dict[str, Any], root: Path) -> dict[str, Any]:
    location = primary_location(finding)
    symbolic = location.get("symbolic", {})
    local_path = symbolic.get("key", {}).get("Local", {}).get("verbatim_path")
    relative_path = "unknown"
    if isinstance(local_path, str):
        try:
            relative_path = str(Path(local_path).resolve().relative_to(root.resolve()))
        except ValueError:
            relative_path = "outside-scan-root"
    route_value = symbolic.get("route", {}).get("route", [])
    route = json.dumps(route_value, sort_keys=True, separators=(",", ":"))
    line = location.get("concrete", {}).get("location", {}).get("start_point", {}).get("row")
    severity = finding.get("determinations", {}).get("severity", "Unknown")
    audit_id = str(finding.get("ident", "unknown"))
    fingerprint = hashlib.sha256(
        json.dumps([audit_id, severity, relative_path, route], separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "audit_id": bounded_scanner_text(audit_id),
        "severity": bounded_scanner_text(severity),
        "path": bounded_scanner_text(relative_path),
        "route": bounded_scanner_text(route),
        "line": line if isinstance(line, int) else None,
        "_fingerprint": fingerprint,
    }


def finding_fingerprint(finding: dict[str, Any]) -> tuple[str, ...]:
    if isinstance(finding.get("_fingerprint"), str):
        return ("sha256", finding["_fingerprint"])
    return (
        str(finding.get("audit_id")),
        str(finding.get("severity")),
        str(finding.get("path")),
        str(finding.get("route")),
    )


def new_findings(head: list[dict[str, Any]], base: list[dict[str, Any]]) -> list[dict[str, Any]]:
    remaining = collections.Counter(finding_fingerprint(item) for item in base)
    result: list[dict[str, Any]] = []
    for finding in head:
        fingerprint = finding_fingerprint(finding)
        if remaining[fingerprint] > 0:
            remaining[fingerprint] -= 1
        else:
            result.append(finding)
    return result


def synthetic_finding(audit_id: str, path: str, route: str) -> dict[str, Any]:
    fingerprint = hashlib.sha256(
        json.dumps([audit_id, "High", path, route], separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "audit_id": bounded_scanner_text(audit_id),
        "severity": "High",
        "path": bounded_scanner_text(path),
        "route": bounded_scanner_text(route),
        "line": None,
        "_fingerprint": fingerprint,
    }


def public_finding(finding: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in finding.items() if not key.startswith("_")}


def run_zizmor(scanner: str, tree_root: Path, has_github: bool) -> tuple[list[dict[str, Any]], int]:
    if not has_github:
        return [], 0
    result = run(
        [
            scanner,
            "--offline",
            "--format",
            "json",
            "--no-progress",
            "--no-exit-codes",
            str(tree_root / ".github"),
        ],
        cwd=tree_root,
        timeout=120,
        check=False,
    )
    if result.returncode != 0:
        raise GateError(f"zizmor failed with exit code {result.returncode}")
    try:
        payload = json.loads(result.stdout or "[]")
    except json.JSONDecodeError as error:
        raise GateError(f"zizmor returned invalid JSON with exit code {result.returncode}") from error
    if not isinstance(payload, list):
        raise GateError("zizmor JSON output must be an array")
    return [normalize_finding(item, tree_root) for item in payload], result.returncode


def scanner_snapshot(
    repo_dir: Path,
    head_sha: str,
    base_sha: str,
    binding: dict[str, Any],
    scanner: str,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="community-pr-") as temp:
        root = Path(temp)
        head_root = root / "head"
        base_root = root / "base"
        head_exists, head_unsupported = archive_github(repo_dir, head_sha, head_root)
        base_exists, base_unsupported = archive_github(repo_dir, base_sha, base_root)
        head, head_exit = run_zizmor(scanner, head_root, head_exists)
        base, base_exit = run_zizmor(scanner, base_root, base_exists)
        head.extend(synthetic_finding("unsupported-git-entry", path, "archive") for path in head_unsupported)
        base.extend(synthetic_finding("unsupported-git-entry", path, "archive") for path in base_unsupported)
        if base_exists and not head_exists:
            head.append(synthetic_finding("workflow-directory-removed", ".github", "tree"))
        delta = new_findings(head, base)
        minimum = binding["scanner"]["minimum_blocking_severity"]
        blocking = [item for item in delta if SEVERITY_RANK.get(item["severity"], 99) >= SEVERITY_RANK[minimum]]
        base_serious = [item for item in base if SEVERITY_RANK.get(item["severity"], 99) >= SEVERITY_RANK[minimum]]
        head_serious = [item for item in head if SEVERITY_RANK.get(item["severity"], 99) >= SEVERITY_RANK[minimum]]
        return {
            "status": "blocked" if blocking else "passed",
            "baseline_status": "findings_present" if base else "clean",
            "comparison_policy": "new_findings_only",
            "minimum_blocking_severity": minimum,
            "head_has_github": head_exists,
            "base_has_github": base_exists,
            "head_raw_count": len(head),
            "head_unique_count": len({finding_fingerprint(item) for item in head}),
            "base_raw_count": len(base),
            "base_unique_count": len({finding_fingerprint(item) for item in base}),
            "base_serious_count": len(base_serious),
            "head_serious_count": len(head_serious),
            "carried_forward_count": len(head) - len(delta),
            "new_count": len(delta),
            "new_serious_count": len(blocking),
            "new_findings": [public_finding(item) for item in delta],
            "blocking_findings": [public_finding(item) for item in blocking],
            "zizmor_exit_codes": {"head": head_exit, "base": base_exit},
            "scanner_execution": {"head": "completed", "base": "completed"},
        }


def classify_write_access(payload: Any, author: str) -> str:
    """Return granted, denied, or unavailable from a collaborator-permission response."""
    if not isinstance(payload, dict):
        return "unavailable"
    user = payload.get("user")
    login = user.get("login") if isinstance(user, dict) else None
    if not isinstance(login, str) or login.casefold() != author.casefold():
        return "unavailable"
    permission = payload.get("permission")
    if permission in ("admin", "write"):
        return "granted"
    if isinstance(permission, str):
        return "denied"
    return "unavailable"


def write_access_state(repo_dir: Path, repository: str, author: str) -> str:
    try:
        payload = gh_json(repo_dir, f"repos/{repository}/collaborators/{author}/permission")
    except (GateError, subprocess.TimeoutExpired):
        return "unavailable"
    return classify_write_access(payload, author)


def classify_cla(statuses: Any, binding: dict[str, Any]) -> dict[str, str]:
    if not isinstance(statuses, list):
        return {"state": "indeterminate", "reason": "statuses_not_list"}
    cla = binding["cla"]
    matching = [item for item in statuses if isinstance(item, dict) and item.get("context") == cla["context"]]
    if not matching:
        return {"state": "awaiting", "reason": "context_absent"}
    latest = max(matching, key=lambda item: str(item.get("updated_at", "")))
    state = latest.get("state")
    description = latest.get("description")
    if state == "success" and description == cla["signed_description"]:
        return {"state": "passed", "reason": "signed"}
    if state == "pending" and description == cla["not_signed_description"]:
        return {"state": "failed", "reason": "not_signed"}
    if state == "pending":
        return {"state": "awaiting", "reason": "pending_unfamiliar_description"}
    return {"state": "indeterminate", "reason": "unfamiliar_status"}


def classify_signatures(commits: list[dict[str, Any]], reported_count: int) -> dict[str, Any]:
    if reported_count > 250:
        return {"state": "indeterminate", "reason": "commit_limit", "reported_count": reported_count}
    if len(commits) != reported_count or not commits:
        return {
            "state": "indeterminate",
            "reason": "commit_count_mismatch",
            "reported_count": reported_count,
            "enumerated_count": len(commits),
        }
    details = []
    for commit in commits:
        verification = commit.get("commit", {}).get("verification", {})
        details.append(
            {
                "sha": str(commit.get("sha", ""))[:12],
                "verified": verification.get("verified") is True,
                "reason": verification.get("reason", "unknown"),
            }
        )
    failures = [item for item in details if not item["verified"]]
    return {
        "state": "failed" if failures else "passed",
        "reason": "unverified_commits" if failures else "all_verified",
        "reported_count": reported_count,
        "enumerated_count": len(details),
        "commits": details,
    }


def classify_mergeable(pr: dict[str, Any]) -> dict[str, Any]:
    mergeable = pr.get("mergeable")
    state = pr.get("mergeable_state")
    if mergeable is None or state in (None, "unknown"):
        return {"state": "indeterminate", "reason": "mergeable_state_unresolved", "mergeable_state": state}
    if state == "dirty":
        return {"state": "failed", "reason": "merge_conflict", "mergeable_state": state}
    return {"state": "passed", "reason": "no_conflict", "mergeable_state": state}


def classify_workflows(runs: list[dict[str, Any]]) -> dict[str, Any]:
    held = [
        {"id": item.get("id"), "name": item.get("name") or "unnamed workflow"}
        for item in runs
        if item.get("event") == "pull_request" and item.get("conclusion") == "action_required"
    ]
    pull_runs = [item for item in runs if item.get("event") == "pull_request"]
    if held:
        state = "awaiting_authorization"
        provenance = "held_by_github"
    elif pull_runs:
        state = "already_authorized"
        provenance = "inferred_from_executed_pull_request_runs"
    else:
        state = "no_runs"
        provenance = "none"
    observed = [
        {
            "id": item.get("id"),
            "name": item.get("name") or "unnamed workflow",
            "conclusion": item.get("conclusion"),
        }
        for item in pull_runs
    ]
    return {
        "state": state,
        "authorization_provenance": provenance,
        "held_runs": held,
        "observed_pull_request_runs": observed,
        "run_count": len(runs),
    }


def classify_files(files: list[dict[str, Any]], binding: dict[str, Any]) -> dict[str, Any]:
    names = [item.get("filename") for item in files if isinstance(item.get("filename"), str)]
    ci_prefix = binding["ci_config_prefix"]
    ci_paths = [name for name in names if name.startswith(ci_prefix)]
    dependencies = [name for name in names if Path(name).name.lower() in DEPENDENCY_NAMES]
    build_release = [
        name
        for name in names
        if re.search(r"(^|/)(build|release|publish)([-_.]|/|$)", name, flags=re.IGNORECASE)
    ]
    return {
        "ci_paths": ci_paths,
        "dependency_paths": dependencies,
        "build_release_paths": build_release,
        "requires_manual_diff_triage": True,
    }


def prior_merge_count(repo_dir: Path, repository: str, author: str) -> int:
    if not HANDLE_RE.fullmatch(author):
        raise GateError("GitHub API returned an invalid author handle")
    query = quote(f"repo:{repository} is:pr is:merged author:{author}", safe=":")
    payload = gh_json(repo_dir, f"search/issues?q={query}&per_page=1")
    count = payload.get("total_count") if isinstance(payload, dict) else None
    if not isinstance(count, int):
        raise GateError("GitHub search response omitted total_count")
    return count


def choose_primary_blocker(failures: Iterable[str], priority: list[str]) -> str | None:
    failed = set(failures)
    return next((item for item in priority if item in failed), None)


def collect_runs(repo_dir: Path, repository: str, head_sha: str) -> list[dict[str, Any]]:
    runs: list[dict[str, Any]] = []
    page = 1
    while True:
        payload = gh_json(
            repo_dir,
            f"repos/{repository}/actions/runs?head_sha={head_sha}&per_page=100&page={page}",
        )
        batch = payload.get("workflow_runs") if isinstance(payload, dict) else None
        if not isinstance(batch, list):
            raise GateError("GitHub Actions response omitted workflow_runs")
        runs.extend(batch)
        if len(batch) < 100:
            return runs
        page += 1


def current_head(repo_dir: Path, repository: str, number: str) -> str:
    pr = gh_json(repo_dir, f"repos/{repository}/pulls/{number}")
    head_sha = pr.get("head", {}).get("sha") if isinstance(pr, dict) else None
    if not isinstance(head_sha, str) or not SHA_RE.fullmatch(head_sha):
        raise GateError("GitHub PR response omitted a valid head SHA")
    return head_sha


def bounded_annotation_message(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "�", value)
    return cleaned[:MAX_ANNOTATION_LENGTH]


def collect_check_runs(repo_dir: Path, repository: str, head_sha: str) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    page = 1
    while True:
        payload = gh_json(
            repo_dir,
            f"repos/{repository}/commits/{head_sha}/check-runs?per_page=100&page={page}",
        )
        batch = payload.get("check_runs") if isinstance(payload, dict) else None
        if not isinstance(batch, list):
            raise GateError("GitHub check-runs response omitted check_runs")
        checks.extend(batch)
        if len(batch) < 100:
            return checks
        page += 1


def infrastructure_signature(check_name: str, message: str, repository: str | None = None) -> dict[str, str] | None:
    for signature in INFRASTRUCTURE_SIGNATURES:
        repositories = signature.get("repositories")
        if repositories is not None and repository not in repositories:
            continue
        name_pattern = signature["check_name"]
        if name_pattern is not None and not name_pattern.search(check_name):
            continue
        if signature["message"].search(message):
            return {"id": signature["id"], "description": signature["description"]}
    return None


def classify_ci_checks(
    checks: list[dict[str, Any]],
    annotations_by_check: dict[int, list[dict[str, Any]]],
    *,
    ci_config_changed: bool = False,
    repository: str | None = None,
) -> dict[str, Any]:
    if not checks:
        return {
            "state": "no_checks",
            "total": 0,
            "failed": [],
            "pending_count": 0,
            "ci_config_changed": ci_config_changed,
            "automatic_contributor_attribution": False,
        }
    pending = [item for item in checks if item.get("status") != "completed"]
    failed: list[dict[str, Any]] = []
    for check in checks:
        conclusion = check.get("conclusion")
        if conclusion not in FAILED_CHECK_CONCLUSIONS:
            continue
        check_id = check.get("id")
        name = check.get("name") if isinstance(check.get("name"), str) else "unnamed check"
        raw_annotations = annotations_by_check.get(check_id, []) if isinstance(check_id, int) else []
        reported_annotation_count = check.get("output", {}).get("annotations_count")
        annotations_truncated = len(raw_annotations) > MAX_ANNOTATIONS_PER_CHECK or (
            isinstance(reported_annotation_count, int) and reported_annotation_count > len(raw_annotations)
        )
        raw_annotations = raw_annotations[:MAX_ANNOTATIONS_PER_CHECK]
        annotations = [
            {
                "level": item.get("annotation_level") if item.get("annotation_level") in {"notice", "warning", "failure"} else "unknown",
                "message": bounded_annotation_message(item.get("message")),
            }
            for item in raw_annotations
        ]
        annotations = [item for item in annotations if item["message"]]
        failure_messages = [item["message"] for item in annotations if item["level"] == "failure"]
        signatures = [infrastructure_signature(name, message, repository) for message in failure_messages]
        infrastructure_signatures = []
        if (
            not ci_config_changed
            and not annotations_truncated
            and failure_messages
            and all(signature is not None for signature in signatures)
        ):
            infrastructure_signatures = list(
                {
                    signature["id"]: signature
                    for signature in signatures
                    if signature is not None
                }.values()
            )
        failed.append(
            {
                "id": check_id,
                "name": name,
                "conclusion": conclusion,
                "annotations": annotations,
                "annotations_truncated": annotations_truncated,
                "infrastructure_signatures": infrastructure_signatures,
            }
        )
    if pending:
        state = "pending"
    elif not failed:
        state = "passed"
    elif all(item["infrastructure_signatures"] for item in failed):
        state = "infrastructure"
    else:
        state = "unclear"
    return {
        "state": state,
        "total": len(checks),
        "failed": failed,
        "pending_count": len(pending),
        "ci_config_changed": ci_config_changed,
        "automatic_contributor_attribution": False,
    }


def exact_changed_paths(repo_dir: Path, base_sha: str, head_sha: str) -> list[str]:
    if not SHA_RE.fullmatch(base_sha) or not SHA_RE.fullmatch(head_sha):
        raise GateError("exact changed-path comparison requires valid base and head SHAs")
    result = run(
        ["git", "diff", "--name-only", "-z", f"{base_sha}...{head_sha}", "--"],
        cwd=repo_dir,
        text=False,
    )
    try:
        return [item.decode("utf-8") for item in result.stdout.split(b"\x00") if item]
    except UnicodeDecodeError as error:
        raise GateError("changed paths are not valid UTF-8") from error


def ci_status(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    repo_dir = Path(args.repo_dir).resolve()
    repository = perform(
        "resolve_repository",
        "repository_identity_unavailable",
        lambda: resolve_repository(repo_dir, args.remote),
    )
    observed_head = perform(
        "verify_head",
        "pr_metadata_unavailable",
        lambda: current_head(repo_dir, repository, args.number),
    )
    if observed_head != args.expected_sha:
        return {
            "schema_version": 1,
            "repository": repository,
            "pr_number": int(args.number),
            "expected_head_sha": args.expected_sha,
            "current_head_sha": observed_head,
            "status": "moved",
            "next_action": "discard_state_and_rerun_snapshot",
        }, 22
    binding = perform(
        "load_binding",
        "binding_unavailable",
        lambda: load_binding(repo_dir, args.binding_sha, repository),
    )
    paths = perform(
        "collect_ci_config_paths",
        "changed_files_unavailable",
        lambda: exact_changed_paths(repo_dir, args.base_sha, args.expected_sha),
    )
    ci_config_prefix = binding["ci_config_prefix"]
    ci_config_changed = any(path.startswith(ci_config_prefix) for path in paths)
    checks = perform(
        "collect_ci_checks",
        "check_runs_unavailable",
        lambda: collect_check_runs(repo_dir, repository, args.expected_sha),
    )
    failed_ids = [
        item.get("id")
        for item in checks
        if item.get("conclusion") in FAILED_CHECK_CONCLUSIONS and isinstance(item.get("id"), int)
    ]
    annotations: dict[int, list[dict[str, Any]]] = {}
    for check_id in failed_ids:
        annotations[check_id] = perform(
            "collect_ci_annotations",
            "check_annotations_unavailable",
            lambda check_id=check_id: gh_pages(
                repo_dir,
                f"repos/{repository}/check-runs/{check_id}/annotations",
                maximum=MAX_ANNOTATIONS_PER_CHECK + 1,
            ),
        )
    final_head = perform(
        "verify_head_after_ci_collection",
        "pr_metadata_unavailable",
        lambda: current_head(repo_dir, repository, args.number),
    )
    if final_head != args.expected_sha:
        return {
            "schema_version": 1,
            "repository": repository,
            "pr_number": int(args.number),
            "expected_head_sha": args.expected_sha,
            "current_head_sha": final_head,
            "status": "moved",
            "next_action": "discard_state_and_rerun_snapshot",
        }, 22
    classification = classify_ci_checks(
        checks,
        annotations,
        ci_config_changed=ci_config_changed,
        repository=repository,
    )
    return {
        "schema_version": 1,
        "repository": repository,
        "pr_number": int(args.number),
        "base_sha": args.base_sha,
        "binding_sha": args.binding_sha,
        "head_sha": args.expected_sha,
        "status": "ci_status",
        "ci": classification,
        "next_action": {
            "passed": "continue_coordinated_review",
            "infrastructure": "continue_review_without_blaming_contributor",
            "pending": "wait_and_rerun_ci_status",
            "no_checks": "report_absent_ci_and_escalate_if_it_persists",
            "unclear": "escalate_without_posting_a_contributor_failure",
        }[classification["state"]],
    }, 0


def authorize_held(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    if not args.approved_by_human:
        raise GateError("authorize-held requires explicit human approval")
    run_ids = args.run_ids
    if not run_ids or len(set(run_ids)) != len(run_ids) or any(item <= 0 for item in run_ids):
        raise GateError("authorize-held requires unique positive run IDs")
    repo_dir = Path(args.repo_dir).resolve()
    repository = perform(
        "resolve_repository",
        "repository_identity_unavailable",
        lambda: resolve_repository(repo_dir, args.remote),
    )
    observed_head = perform(
        "verify_head_before_authorization",
        "pr_metadata_unavailable",
        lambda: current_head(repo_dir, repository, args.number),
    )
    if observed_head != args.expected_sha:
        return {
            "schema_version": 1,
            "repository": repository,
            "pr_number": int(args.number),
            "expected_head_sha": args.expected_sha,
            "current_head_sha": observed_head,
            "status": "moved",
            "approved_run_ids": [],
            "next_action": "discard_state_and_rerun_snapshot",
        }, 22
    runs = perform(
        "collect_held_runs",
        "workflow_runs_unavailable",
        lambda: collect_runs(repo_dir, repository, args.expected_sha),
    )
    runs_by_id = {item.get("id"): item for item in runs if isinstance(item.get("id"), int)}
    invalid = [
        run_id
        for run_id in run_ids
        if run_id not in runs_by_id
        or runs_by_id[run_id].get("event") != "pull_request"
        or runs_by_id[run_id].get("head_sha") != args.expected_sha
    ]
    if invalid:
        return {
            "schema_version": 1,
            "repository": repository,
            "pr_number": int(args.number),
            "head_sha": args.expected_sha,
            "status": "authorization_set_invalid",
            "invalid_run_ids": invalid,
            "approved_run_ids": [],
            "next_action": "stop_and_rerun_snapshot",
        }, 21
    current_held = {
        item["id"]
        for item in runs
        if isinstance(item.get("id"), int)
        and item.get("event") == "pull_request"
        and item.get("conclusion") == "action_required"
    }
    unexpected_held = sorted(current_held - set(run_ids))
    if unexpected_held:
        return {
            "schema_version": 1,
            "repository": repository,
            "pr_number": int(args.number),
            "head_sha": args.expected_sha,
            "status": "authorization_set_changed",
            "unexpected_held_run_ids": unexpected_held,
            "approved_run_ids": [],
            "next_action": "show_a_new_authorization_prompt",
        }, 21
    approved: list[int] = []
    already_released = [run_id for run_id in run_ids if run_id not in current_held]
    for run_id in run_ids:
        if run_id not in current_held:
            continue
        current = perform(
            "verify_head_during_authorization",
            "pr_metadata_unavailable",
            lambda: current_head(repo_dir, repository, args.number),
        )
        if current != args.expected_sha:
            return {
                "schema_version": 1,
                "repository": repository,
                "pr_number": int(args.number),
                "expected_head_sha": args.expected_sha,
                "current_head_sha": current,
                "status": "head_moved_during_authorization",
                "approved_run_ids": approved,
                "remaining_run_ids": [item for item in run_ids if item not in approved and item not in already_released],
                "next_action": "stop_and_rerun_snapshot",
            }, 23
        try:
            gh_post(repo_dir, f"repos/{repository}/actions/runs/{run_id}/approve")
        except GateError as error:
            return {
                "schema_version": 1,
                "repository": repository,
                "pr_number": int(args.number),
                "head_sha": args.expected_sha,
                "status": "partial_authorization",
                "approved_run_ids": approved,
                "failed_run_id": run_id,
                "error": str(error),
                "next_action": "inspect_readback_before_retrying",
            }, 23
        approved.append(run_id)
    readback = perform(
        "readback_authorized_runs",
        "workflow_runs_unavailable",
        lambda: collect_runs(repo_dir, repository, args.expected_sha),
    )
    readback_by_id = {item.get("id"): item for item in readback if isinstance(item.get("id"), int)}
    missing_readback = [run_id for run_id in run_ids if run_id not in readback_by_id]
    wrong_readback = [
        run_id
        for run_id in run_ids
        if run_id in readback_by_id
        and (
            readback_by_id[run_id].get("event") != "pull_request"
            or readback_by_id[run_id].get("head_sha") != args.expected_sha
        )
    ]
    still_held = [
        run_id
        for run_id in run_ids
        if readback_by_id.get(run_id, {}).get("conclusion") == "action_required"
    ]
    unexpected_held_readback = sorted(
        item["id"]
        for item in readback
        if isinstance(item.get("id"), int)
        and item.get("event") == "pull_request"
        and item.get("head_sha") == args.expected_sha
        and item.get("conclusion") == "action_required"
        and item["id"] not in set(run_ids)
    )
    final_head = perform(
        "verify_head_after_authorization",
        "pr_metadata_unavailable",
        lambda: current_head(repo_dir, repository, args.number),
    )
    if final_head != args.expected_sha or missing_readback or wrong_readback or still_held or unexpected_held_readback:
        return {
            "schema_version": 1,
            "repository": repository,
            "pr_number": int(args.number),
            "expected_head_sha": args.expected_sha,
            "current_head_sha": final_head,
            "status": "partial_authorization",
            "approved_run_ids": approved,
            "already_released_run_ids": already_released,
            "missing_readback_run_ids": missing_readback,
            "wrong_readback_run_ids": wrong_readback,
            "still_held_run_ids": still_held,
            "unexpected_held_run_ids": unexpected_held_readback,
            "next_action": (
                "stop_and_rerun_snapshot"
                if final_head != args.expected_sha or missing_readback or wrong_readback
                else "show_a_new_authorization_prompt"
                if unexpected_held_readback
                else "inspect_readback_before_retrying"
            ),
        }, 23
    return {
        "schema_version": 1,
        "repository": repository,
        "pr_number": int(args.number),
        "head_sha": args.expected_sha,
        "status": "authorized",
        "authorization_provenance": "approved_by_human",
        "approved_run_ids": approved,
        "already_released_run_ids": already_released,
        "verified_run_ids": run_ids,
        "next_action": "start_coordinated_ci_and_review",
    }, 0


def validate_relative_path(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise GateError(f"{field} must be a non-empty repository-relative path")
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise GateError(f"{field} must be a repository-relative path without '..'")
    return value


def validate_string_list(value: Any, field: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise GateError(f"{field} must be a list of strings")
    return value


def validate_inline_comments(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise GateError("inline_comments must be a list")
    for comment in value:
        if not isinstance(comment, dict):
            raise GateError("each inline comment must be an object")
        validate_relative_path(comment.get("path"), "inline comment path")
        if not isinstance(comment.get("line"), int) or comment["line"] <= 0:
            raise GateError("inline comment line must be a positive integer")
        if comment.get("side") not in {"LEFT", "RIGHT"}:
            raise GateError("inline comment side must be LEFT or RIGHT")
        if not isinstance(comment.get("body"), str):
            raise GateError("inline comment body must be a string")
    return value


def validate_review_handoff(data: Any, expected_head_sha: str) -> str:
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise GateError("ReviewHandoff must be a schema-version 1 object")
    if data.get("head_sha") != expected_head_sha:
        raise GateError("ReviewHandoff head_sha does not match the expected head")
    for field in ("base_sha", "binding_sha", "head_sha"):
        if not isinstance(data.get(field), str) or not SHA_RE.fullmatch(data[field]):
            raise GateError(f"ReviewHandoff {field} must be a 40-character lowercase SHA")
    if not REPOSITORY_RE.fullmatch(str(data.get("repository", ""))):
        raise GateError("ReviewHandoff repository must use owner/name syntax")
    if not isinstance(data.get("pr_number"), int) or data["pr_number"] <= 0:
        raise GateError("ReviewHandoff pr_number must be a positive integer")
    validate_relative_path(data.get("review_skill"), "ReviewHandoff review_skill")
    validate_relative_path(data.get("review_policy"), "ReviewHandoff review_policy")
    if data.get("untrusted_input") is not True:
        raise GateError("ReviewHandoff untrusted_input must be true")
    allowed = set(validate_string_list(data.get("allowed_operations"), "ReviewHandoff allowed_operations"))
    required_allowed = {"fetch_objects", "read_blobs", "inspect_diffs"}
    if allowed != required_allowed:
        raise GateError("ReviewHandoff allowed_operations must contain only the approved read operations")
    forbidden = set(validate_string_list(data.get("forbidden_operations"), "ReviewHandoff forbidden_operations"))
    required_forbidden = {"checkout", "execute", "install_dependencies", "follow_contributor_links"}
    if not required_forbidden.issubset(forbidden):
        raise GateError("ReviewHandoff omits a required forbidden operation")
    triage = data.get("triage")
    if not isinstance(triage, dict):
        raise GateError("ReviewHandoff triage must be an object")
    for field in (
        "ci_paths",
        "dependency_paths",
        "build_release_paths",
        "new_hosts",
        "secret_token_environment_reads",
        "instruction_shaped_text",
    ):
        validate_string_list(triage.get(field), f"ReviewHandoff triage.{field}")
    return expected_head_sha


def validate_review_result(data: Any, expected_head_sha: str) -> str:
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise GateError("ReviewResult must be a schema-version 1 object")
    if data.get("reviewed_head_sha") != expected_head_sha:
        raise GateError("ReviewResult reviewed_head_sha does not match the expected head")
    if not isinstance(data.get("disposition"), str) or not data["disposition"]:
        raise GateError("ReviewResult disposition must be a non-empty string")
    if not isinstance(data.get("body"), str):
        raise GateError("ReviewResult body must be a string")
    validate_inline_comments(data.get("inline_comments"))
    if not isinstance(data.get("verification"), list) or any(not isinstance(item, dict) for item in data["verification"]):
        raise GateError("ReviewResult verification must be a list of objects")
    return expected_head_sha


def validate_publication_preview(data: Any, expected_head_sha: str) -> str:
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise GateError("PublicationPreview must be a schema-version 1 object")
    if data.get("reviewed_head_sha") != expected_head_sha:
        raise GateError("PublicationPreview reviewed_head_sha does not match the expected head")
    if not isinstance(data.get("pr_number"), int) or data["pr_number"] <= 0:
        raise GateError("PublicationPreview pr_number must be a positive integer")
    if data.get("event") not in {"approve", "request_changes", "comment"}:
        raise GateError("PublicationPreview event is invalid")
    if not isinstance(data.get("body"), str):
        raise GateError("PublicationPreview body must be a string")
    validate_inline_comments(data.get("inline_comments"))
    return expected_head_sha


def validate_interface(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    try:
        raw = sys.stdin.read() if args.path == "-" else Path(args.path).read_text()
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError) as error:
        raise GateError(f"could not read interface JSON: {error}") from error
    validators = {
        "review-handoff": validate_review_handoff,
        "review-result": validate_review_result,
        "publication-preview": validate_publication_preview,
    }
    head_sha = validators[args.kind](data, args.expected_sha)
    return {
        "schema_version": 1,
        "status": "valid",
        "kind": args.kind,
        "head_sha": head_sha,
    }, 0


def validate_trace_outcome(args: argparse.Namespace) -> None:
    allowed = {
        "internal": {
            "gate_state": {"internal"},
            "authorization_state": {"not_applicable"},
            "review_handoff": {"in_progress"},
            "ci_attribution": {"not_checked"},
            "head_verification": {"unchanged"},
        },
        "scanner_blocked": {
            "gate_state": {"scanner_blocked"},
            "authorization_state": {"not_applicable"},
            "review_handoff": {"not_started"},
            "ci_attribution": {"not_checked"},
            "head_verification": {"not_checked"},
        },
        "contributor_blocked": {
            "gate_state": {"contributor_blocked"},
            "authorization_state": {"not_applicable"},
            "review_handoff": {"not_started"},
            "ci_attribution": {"not_checked"},
            "head_verification": {"unchanged"},
        },
        "awaiting_authorization": {
            "gate_state": {"ready_for_triage"},
            "authorization_state": {"awaiting_authorization"},
            "review_handoff": {"not_started"},
            "ci_attribution": {"not_checked"},
            "head_verification": {"unchanged"},
        },
        "authorization_declined": {
            "gate_state": {"ready_for_triage"},
            "authorization_state": {"declined"},
            "review_handoff": {"not_started"},
            "ci_attribution": {"not_checked"},
            "head_verification": {"unchanged"},
        },
        "review_in_progress": {
            "gate_state": {"ready_for_triage"},
            "authorization_state": {"authorized", "already_authorized"},
            "review_handoff": {"in_progress", "completed"},
            "ci_attribution": {"pending", "passed", "infrastructure", "unclear", "no_runs"},
            "head_verification": {"unchanged"},
        },
        "ci_blocked": {
            "gate_state": {"ready_for_triage"},
            "authorization_state": {"authorized", "already_authorized"},
            "review_handoff": {"partial", "discarded"},
            "ci_attribution": {"contributor"},
            "head_verification": {"unchanged"},
        },
        "complete": {
            "gate_state": {"ready_for_triage"},
            "authorization_state": {"authorized", "already_authorized"},
            "review_handoff": {"completed"},
            "ci_attribution": {"passed", "infrastructure"},
            "head_verification": {"unchanged"},
        },
    }
    if args.terminal_outcome in allowed:
        for field, values in allowed[args.terminal_outcome].items():
            if getattr(args, field) not in values:
                raise GateError(f"emit-trace {args.terminal_outcome} fields disagree")
    elif args.terminal_outcome == "dry_run_complete":
        if args.review_handoff != "not_started" or args.head_verification not in {"not_checked", "unchanged"}:
            raise GateError("emit-trace dry-run fields disagree")
    elif args.terminal_outcome == "indeterminate":
        if args.gate_state not in {"awaiting_cla", "ready_for_triage", "indeterminate"}:
            raise GateError("emit-trace indeterminate fields disagree")
    if args.terminal_outcome == "scanner_blocked" and args.scanner_new_serious_count == 0:
        raise GateError("emit-trace scanner-blocked trace requires a new serious finding")


def emit_trace(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    counts = (
        args.scanner_raw_count,
        args.scanner_unique_count,
        args.scanner_new_count,
        args.scanner_new_serious_count,
    )
    if not REPOSITORY_RE.fullmatch(args.repository):
        raise GateError("emit-trace repository must use owner/name syntax")
    if args.gate_state not in {
        "internal",
        "scanner_blocked",
        "awaiting_cla",
        "contributor_blocked",
        "ready_for_triage",
        "indeterminate",
    }:
        raise GateError("emit-trace gate state is invalid")
    if any(value < 0 for value in counts):
        raise GateError("emit-trace scanner counts must be non-negative")
    if args.scanner_unique_count > args.scanner_raw_count:
        raise GateError("emit-trace unique scanner count cannot exceed raw count")
    if args.scanner_new_count > args.scanner_raw_count:
        raise GateError("emit-trace new scanner count cannot exceed raw count")
    if args.scanner_new_serious_count > args.scanner_new_count:
        raise GateError("emit-trace new serious scanner count cannot exceed new count")
    if len(set(args.run_ids)) != len(args.run_ids) or any(item <= 0 for item in args.run_ids):
        raise GateError("emit-trace run IDs must be unique positive integers")
    if args.terminal_outcome == "dry_run_complete" and not args.would_be_next_state:
        raise GateError("dry-run traces require --would-be-next-state")
    if args.terminal_outcome != "dry_run_complete" and args.would_be_next_state:
        raise GateError("--would-be-next-state is only valid for dry-run traces")
    expected_provenance = {
        "not_applicable": "not_applicable",
        "awaiting_authorization": "held_by_github",
        "authorized": "approved_by_human",
        "already_authorized": "inferred_from_executed_pull_request_runs",
        "no_runs": "none",
        "declined": "human_declined",
    }
    if args.authorization_state in expected_provenance and args.authorization_provenance != expected_provenance[args.authorization_state]:
        raise GateError("emit-trace authorization state and provenance disagree")
    validate_trace_outcome(args)
    return {
        "schema_version": 1,
        "repository": args.repository,
        "pr_number": int(args.number),
        "head_sha": args.head_sha,
        "scanner": {
            "raw_count": args.scanner_raw_count,
            "unique_count": args.scanner_unique_count,
            "new_count": args.scanner_new_count,
            "new_serious_count": args.scanner_new_serious_count,
        },
        "gate_state": args.gate_state,
        "authorization": {
            "state": args.authorization_state,
            "provenance": args.authorization_provenance,
            "run_ids": args.run_ids,
        },
        "review_handoff": args.review_handoff,
        "ci_attribution": args.ci_attribution,
        "head_verification": args.head_verification,
        "terminal_outcome": args.terminal_outcome,
        "would_be_next_state": args.would_be_next_state,
    }, 0


def next_action(status: str) -> str:
    return {
        "internal": "hand_off_to_binding_sha_review_skill",
        "awaiting_cla": "wait_30_seconds_and_rerun_complete_snapshot",
        "contributor_blocked": "draft_one_blocker_message_and_request_publication_approval",
        "ready_for_triage": "inspect_diff_as_untrusted_data_then_apply_authorization_branch",
        "indeterminate": "stop_and_escalate_to_maintainer",
    }[status]


def build_snapshot(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    repo_dir = Path(args.repo_dir).resolve()
    repository = perform(
        "resolve_repository",
        "repository_identity_unavailable",
        lambda: resolve_repository(repo_dir, args.remote),
    )
    pr = perform(
        "resolve_pr",
        "pr_metadata_unavailable",
        lambda: gh_json(repo_dir, f"repos/{repository}/pulls/{args.number}"),
    )
    head_sha = pr.get("head", {}).get("sha") if isinstance(pr, dict) else None
    base_sha = pr.get("base", {}).get("sha") if isinstance(pr, dict) else None
    if not isinstance(head_sha, str) or not SHA_RE.fullmatch(head_sha):
        raise GateError("GitHub PR response omitted a valid head SHA")
    if not isinstance(base_sha, str) or not SHA_RE.fullmatch(base_sha):
        raise GateError("GitHub PR response omitted a valid base SHA")
    binding_sha = perform(
        "resolve_binding_source",
        "binding_source_unavailable",
        lambda: resolve_binding_sha(repo_dir, repository, pr),
    )
    perform(
        "fetch_objects",
        "git_objects_unavailable",
        lambda: fetch_pr_objects(repo_dir, args.remote, args.number, head_sha, base_sha, binding_sha),
    )
    binding = perform(
        "load_binding",
        "binding_unavailable",
        lambda: load_binding(repo_dir, binding_sha, repository),
    )
    output_binding = binding_for_output(repo_dir, binding, repository, binding_sha)
    scan = perform(
        "scan_workflows",
        "zizmor_unavailable",
        lambda: scanner_snapshot(repo_dir, head_sha, base_sha, binding, args.scanner),
    )
    common = {
        "schema_version": 1,
        "repository": repository,
        "pr_number": int(args.number),
        "head_sha": head_sha,
        "base_sha": base_sha,
        "binding_sha": binding_sha,
        "scanner": scan,
    }
    if scan["status"] == "blocked":
        return {
            **common,
            "status": "scanner_blocked",
            "next_action": "stop_before_exposing_contributor_content_and_escalate_to_maintainer",
        }, 20

    author = pr.get("user", {}).get("login")
    if not isinstance(author, str) or not HANDLE_RE.fullmatch(author):
        raise GateError("GitHub PR response omitted a valid author handle")
    write_access = write_access_state(repo_dir, repository, author)
    internal = write_access == "granted"
    internal_basis = "write_access" if internal else None
    if internal:
        return {
            **common,
            "status": "internal",
            "internal_basis": internal_basis,
            "author": author,
            "title": pr.get("title", ""),
            "binding": output_binding,
            "next_action": next_action("internal"),
        }, 0

    status_payload = perform(
        "check_cla",
        "cla_status_unavailable",
        lambda: gh_json(repo_dir, f"repos/{repository}/commits/{head_sha}/status"),
    )
    cla = classify_cla(status_payload.get("statuses") if isinstance(status_payload, dict) else None, binding)
    reported_commits = pr.get("commits")
    if not isinstance(reported_commits, int):
        raise GateError("GitHub PR response omitted commit count")
    commits = [] if reported_commits > 250 else perform(
        "check_signatures",
        "commit_verification_unavailable",
        lambda: gh_pages(
            repo_dir,
            f"repos/{repository}/pulls/{args.number}/commits",
            maximum=reported_commits,
        ),
    )
    signing = classify_signatures(commits, reported_commits)
    mergeable = classify_mergeable(pr)
    reported_files = pr.get("changed_files")
    if not isinstance(reported_files, int):
        raise GateError("GitHub PR response omitted changed_files")
    files = perform(
        "classify_files",
        "changed_files_unavailable",
        lambda: gh_pages(
            repo_dir,
            f"repos/{repository}/pulls/{args.number}/files",
            maximum=reported_files,
        ),
    )
    files_complete = len(files) == reported_files
    workflows = perform(
        "classify_workflows",
        "workflow_runs_unavailable",
        lambda: classify_workflows(collect_runs(repo_dir, repository, head_sha)),
    )
    merged_count = perform(
        "count_prior_merges",
        "contribution_history_unavailable",
        lambda: prior_merge_count(repo_dir, repository, author),
    )
    failures = [
        name
        for name, value in (("cla", cla), ("signing", signing), ("merge_conflicts", mergeable))
        if value["state"] == "failed"
    ]
    if cla["state"] == "awaiting":
        status = "awaiting_cla"
    elif (
        cla["state"] == "indeterminate"
        or signing["state"] == "indeterminate"
        or mergeable["state"] == "indeterminate"
        or not files_complete
    ):
        status = "indeterminate"
    elif failures:
        status = "contributor_blocked"
    else:
        status = "ready_for_triage"
    return {
        **common,
        "status": status,
        "author": author,
        "write_access_lookup": write_access,
        "title": pr.get("title", ""),
        "draft": pr.get("draft") is True,
        "size": {
            "changed_files": reported_files,
            "enumerated_files": len(files),
            "additions": pr.get("additions"),
            "deletions": pr.get("deletions"),
        },
        "binding": output_binding,
        "gates": {"cla": cla, "signing": signing, "merge_conflicts": mergeable},
        "primary_blocker": choose_primary_blocker(failures, effective_blocker_priority(binding)),
        "other_blockers": [
            item
            for item in failures
            if item != choose_primary_blocker(failures, effective_blocker_priority(binding))
        ],
        "files": classify_files(files, binding),
        "prior_merged_prs": merged_count,
        "workflow_authorization": workflows,
        "next_action": next_action(status),
    }, 0 if status != "indeterminate" else 21


def verify_head(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    repo_dir = Path(args.repo_dir).resolve()
    repository = perform(
        "resolve_repository",
        "repository_identity_unavailable",
        lambda: resolve_repository(repo_dir, args.remote),
    )
    current = perform(
        "verify_head",
        "pr_metadata_unavailable",
        lambda: current_head(repo_dir, repository, args.number),
    )
    unchanged = current == args.expected_sha
    return {
        "schema_version": 1,
        "repository": repository,
        "pr_number": int(args.number),
        "expected_head_sha": args.expected_sha,
        "current_head_sha": current,
        "status": "unchanged" if unchanged else "moved",
        "next_action": "continue_current_generation" if unchanged else "discard_state_and_rerun_snapshot",
    }, 0


def validate_binding_file(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    path = Path(args.path)
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise GateError(f"could not read binding file: {error}") from error
    repository = data.get("repository") if isinstance(data, dict) else ""
    binding = validate_binding(data, repository)
    return {"status": "valid", "path": str(path.resolve()), "binding": binding}, 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    subparsers = root.add_subparsers(dest="command", required=True)
    snapshot = subparsers.add_parser("snapshot", help="build a zizmor-first immutable PR snapshot")
    snapshot.add_argument("number", help="pull request number, digits only")
    snapshot.add_argument("--repo-dir", default=os.getcwd())
    snapshot.add_argument("--remote", default="origin")
    snapshot.add_argument("--scanner", default="zizmor")
    binding = subparsers.add_parser("validate-binding", help="validate a repository binding file")
    binding.add_argument("path")
    verify = subparsers.add_parser("verify-head", help="compare a snapshot generation token with the current PR head")
    verify.add_argument("number", help="pull request number, digits only")
    verify.add_argument("expected_sha", help="40-character expected head SHA")
    verify.add_argument("--repo-dir", default=os.getcwd())
    verify.add_argument("--remote", default="origin")
    ci = subparsers.add_parser("ci-status", help="classify CI for one immutable PR head")
    ci.add_argument("number", help="pull request number, digits only")
    ci.add_argument("expected_sha", help="40-character expected head SHA")
    ci.add_argument("base_sha", help="40-character historical base SHA from the snapshot")
    ci.add_argument("binding_sha", help="40-character trusted binding SHA from the snapshot")
    ci.add_argument("--repo-dir", default=os.getcwd())
    ci.add_argument("--remote", default="origin")
    authorize = subparsers.add_parser("authorize-held", help="approve an exact validated set of held runs")
    authorize.add_argument("number", help="pull request number, digits only")
    authorize.add_argument("expected_sha", help="40-character expected head SHA")
    authorize.add_argument("--run-id", dest="run_ids", action="append", type=int, required=True)
    authorize.add_argument("--approved-by-human", action="store_true", required=True)
    authorize.add_argument("--repo-dir", default=os.getcwd())
    authorize.add_argument("--remote", default="origin")
    trace = subparsers.add_parser("emit-trace", help="emit a validated JSON run trace")
    trace.add_argument("repository")
    trace.add_argument("number", help="pull request number, digits only")
    trace.add_argument("head_sha", help="40-character reviewed head SHA")
    trace.add_argument("--scanner-raw-count", type=int, required=True)
    trace.add_argument("--scanner-unique-count", type=int, required=True)
    trace.add_argument("--scanner-new-count", type=int, required=True)
    trace.add_argument("--scanner-new-serious-count", type=int, required=True)
    trace.add_argument(
        "--gate-state",
        choices=("internal", "scanner_blocked", "awaiting_cla", "contributor_blocked", "ready_for_triage", "indeterminate"),
        required=True,
    )
    trace.add_argument(
        "--authorization-state",
        choices=("not_applicable", "awaiting_authorization", "authorized", "already_authorized", "no_runs", "declined"),
        required=True,
    )
    trace.add_argument(
        "--authorization-provenance",
        choices=("not_applicable", "held_by_github", "approved_by_human", "inferred_from_executed_pull_request_runs", "human_declined", "none"),
        required=True,
    )
    trace.add_argument("--run-id", dest="run_ids", action="append", type=int, default=[])
    trace.add_argument("--review-handoff", choices=("not_started", "in_progress", "completed", "partial", "discarded"), required=True)
    trace.add_argument(
        "--ci-attribution",
        choices=("not_checked", "pending", "passed", "infrastructure", "contributor", "unclear", "no_runs"),
        required=True,
    )
    trace.add_argument("--head-verification", choices=("not_checked", "unchanged", "moved"), required=True)
    trace.add_argument(
        "--terminal-outcome",
        choices=("internal", "scanner_blocked", "contributor_blocked", "awaiting_authorization", "authorization_declined", "review_in_progress", "ci_blocked", "complete", "dry_run_complete", "indeterminate"),
        required=True,
    )
    trace.add_argument("--would-be-next-state")
    interface = subparsers.add_parser("validate-interface", help="validate a typed orchestration interface")
    interface.add_argument("kind", choices=("review-handoff", "review-result", "publication-preview"))
    interface.add_argument("path", help="JSON file path, or - for stdin")
    interface.add_argument("--expected-head-sha", dest="expected_sha", required=True)
    return root


def main() -> int:
    args = parser().parse_args()
    if args.command in {"snapshot", "verify-head", "ci-status", "authorize-held", "emit-trace"} and not args.number.isdigit():
        print(json.dumps({"status": "indeterminate", "error": "PR number must contain digits only"}, indent=2))
        return 21
    sha = args.head_sha if args.command == "emit-trace" else getattr(args, "expected_sha", None)
    if args.command in {"verify-head", "ci-status", "authorize-held", "emit-trace", "validate-interface"} and not SHA_RE.fullmatch(sha or ""):
        print(json.dumps({"status": "indeterminate", "error": "expected SHA must contain 40 lowercase hex characters"}, indent=2))
        return 21
    try:
        if args.command == "snapshot":
            result, exit_code = build_snapshot(args)
        elif args.command == "verify-head":
            result, exit_code = verify_head(args)
        elif args.command == "ci-status":
            result, exit_code = ci_status(args)
        elif args.command == "authorize-held":
            result, exit_code = authorize_held(args)
        elif args.command == "emit-trace":
            result, exit_code = emit_trace(args)
        elif args.command == "validate-interface":
            result, exit_code = validate_interface(args)
        else:
            result, exit_code = validate_binding_file(args)
    except (GateError, subprocess.TimeoutExpired) as error:
        details = error.details if isinstance(error, GateError) else {}
        print(json.dumps({"status": "indeterminate", "error": str(error), **details}, indent=2))
        return 21
    print(json.dumps(result, indent=2, sort_keys=True))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
