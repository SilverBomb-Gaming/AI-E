"""Manifest-driven scope validation for capability execution requests."""
from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

from .capability_models import CapabilityManifest
from .execution_models import CapabilityExecutionRequest
from .scope_models import ScopeValidationResult


class ScopeValidator:
    """Validate request scope against capability manifest constraints."""

    def validate(self, request: CapabilityExecutionRequest, manifest: CapabilityManifest) -> ScopeValidationResult:
        scope = request.scope
        scope_summary = self._scope_summary(scope, manifest=manifest)

        if scope.scope_type != manifest.scope_type:
            return ScopeValidationResult(
                allowed=False,
                reason_code="scope_type_not_allowed",
                message="This capability is not allowed in the current execution scope.",
                scope_summary=scope_summary,
            )
        if scope.access_mode != manifest.access_mode:
            return ScopeValidationResult(
                allowed=False,
                reason_code="scope_access_not_allowed",
                message="This capability is not allowed to use that access mode.",
                scope_summary=scope_summary,
            )

        if scope.scope_type == "internal":
            return ScopeValidationResult(True, "scope_allowed", "Internal scope allowed.", scope_summary)

        if scope.scope_type == "filesystem":
            return self._validate_filesystem_scope(request, manifest, scope_summary)

        if scope.scope_type == "repository":
            return self._validate_repository_scope(request, manifest, scope_summary)

        if scope.scope_type == "network":
            return self._validate_network_scope(request, manifest, scope_summary)

        return ScopeValidationResult(
            allowed=False,
            reason_code="scope_type_unknown",
            message="This capability could not validate the requested scope.",
            scope_summary=scope_summary,
        )

    def _validate_filesystem_scope(
        self,
        request: CapabilityExecutionRequest,
        manifest: CapabilityManifest,
        scope_summary: str,
    ) -> ScopeValidationResult:
        scope = request.scope
        if not scope.target_path:
            return ScopeValidationResult(
                allowed=False,
                reason_code="scope_target_missing",
                message="This capability needs a target path before it can run.",
                scope_summary=scope_summary,
            )
        target = Path(scope.target_path).resolve()
        allowed_roots = manifest.scope_allowed_paths or scope.allowed_paths
        for root in allowed_roots:
            try:
                target.relative_to(Path(root).resolve())
                return ScopeValidationResult(True, "scope_allowed", "Filesystem scope allowed.", scope_summary)
            except ValueError:
                continue
        return ScopeValidationResult(
            allowed=False,
            reason_code="target_path_not_allowed",
            message="This capability is not allowed to access that path.",
            scope_summary=scope_summary,
        )

    def _validate_repository_scope(
        self,
        request: CapabilityExecutionRequest,
        manifest: CapabilityManifest,
        scope_summary: str,
    ) -> ScopeValidationResult:
        scope = request.scope
        repo_root = manifest.scope_repo_root or scope.repo_root
        if not repo_root:
            return ScopeValidationResult(
                allowed=False,
                reason_code="repo_root_missing",
                message="This capability is missing a repository root.",
                scope_summary=scope_summary,
            )
        repo_root_path = Path(repo_root)
        if not repo_root_path.is_absolute():
            return ScopeValidationResult(
                allowed=False,
                reason_code="repo_root_not_absolute",
                message="Repository scope requires an absolute repo root.",
                scope_summary=scope_summary,
            )
        repo_root_path = repo_root_path.resolve()
        target_candidate = scope.target_path or scope.repo_root
        if not target_candidate:
            return ScopeValidationResult(
                allowed=False,
                reason_code="scope_target_missing",
                message="This capability needs a repository target before it can run.",
                scope_summary=scope_summary,
            )
        target = Path(target_candidate).resolve()
        try:
            target.relative_to(repo_root_path)
        except ValueError:
            return ScopeValidationResult(
                allowed=False,
                reason_code="target_path_not_allowed",
                message="This capability is not allowed to access that repository target.",
                scope_summary=scope_summary,
            )
        return ScopeValidationResult(True, "scope_allowed", "Repository scope allowed.", scope_summary)

    def _validate_network_scope(
        self,
        request: CapabilityExecutionRequest,
        manifest: CapabilityManifest,
        scope_summary: str,
    ) -> ScopeValidationResult:
        scope = request.scope
        target_domain = self._normalize_domain(scope.target_domain)
        allowlist = tuple(
            self._normalize_domain(domain)
            for domain in (manifest.scope_domain_allowlist or scope.domain_allowlist)
        )
        if target_domain and allowlist and target_domain not in allowlist:
            return ScopeValidationResult(
                allowed=False,
                reason_code="target_domain_not_allowed",
                message="This capability is not allowed to contact that network target.",
                scope_summary=scope_summary,
            )
        return ScopeValidationResult(True, "scope_allowed", "Network scope allowed.", scope_summary)

    @staticmethod
    def _normalize_domain(value: str) -> str:
        candidate = value.strip()
        if not candidate:
            return ""
        if "://" in candidate:
            parsed = urlparse(candidate)
            return (parsed.hostname or "").lower()
        if "/" in candidate:
            parsed = urlparse(f"https://{candidate}")
            return (parsed.hostname or "").lower()
        return candidate.lower()

    @staticmethod
    def _repo_name(value: str) -> str:
        candidate = value.strip()
        if not candidate:
            return "configured"
        path = Path(candidate)
        name = path.name or candidate
        return name

    @classmethod
    def _scope_summary(cls, scope, *, manifest: CapabilityManifest) -> str:
        parts = [f"{scope.scope_type}/{scope.access_mode}"]
        if scope.scope_type == "network" and scope.target_domain:
            parts.append(f"target={cls._normalize_domain(scope.target_domain) or 'configured'}")
        elif scope.scope_type == "filesystem" and scope.target_path:
            parts.append("target=path")
        elif scope.scope_type == "repository":
            repo_root = manifest.scope_repo_root or scope.repo_root
            parts.append(f"repo={cls._repo_name(repo_root)}")
            if scope.target_path:
                parts.append("target=path")
        return " ".join(parts)
