#!/usr/bin/env python3
"""Validate MC Plan contract structure without generating artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

import yaml
from jsonschema.validators import validator_for


ROOT = Path(__file__).resolve().parents[1]
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def walk_refs(value: Any) -> Iterable[str]:
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "$ref" and isinstance(child, str):
                yield child
            else:
                yield from walk_refs(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_refs(child)


def require_local_refs(source: Path, document: Any) -> None:
    for reference in walk_refs(document):
        if reference.startswith("#") or "://" in reference:
            continue
        path_part = reference.split("#", 1)[0]
        if path_part and not (source.parent / path_part).resolve().is_file():
            raise ValueError(f"{source.relative_to(ROOT)} has missing $ref {reference}")


def validate_json_schemas() -> tuple[int, set[str]]:
    schema_files = sorted((ROOT / "schemas").rglob("*.json"))
    event_files = sorted((ROOT / "events").glob("*.json"))
    schema_ids: set[str] = set()

    for source in schema_files + event_files:
        document = json.loads(source.read_text(encoding="utf-8"))
        schema_id = document.get("$id")
        if not schema_id:
            raise ValueError(f"{source.relative_to(ROOT)} is missing $id")
        if schema_id in schema_ids:
            raise ValueError(f"Duplicate $id: {schema_id}")
        schema_ids.add(schema_id)

        validator_class = validator_for(document)
        validator_class.check_schema(document)
        require_local_refs(source, document)

    for source in event_files:
        document = json.loads(source.read_text(encoding="utf-8"))
        expected_name = source.stem
        if document.get("title") != expected_name:
            raise ValueError(f"{source.name} title must be {expected_name}")

    return len(schema_files) + len(event_files), schema_ids


def iter_operations(document: dict[str, Any]) -> Iterable[tuple[str, str, dict[str, Any]]]:
    for path, path_item in document.get("paths", {}).items():
        for method, operation in path_item.items():
            if method.lower() in HTTP_METHODS:
                yield path, method.lower(), operation


def validate_security_scopes(source: Path, document: dict[str, Any]) -> None:
    schemes = document.get("components", {}).get("securitySchemes", {})
    catalog_scopes: set[str] = set()
    for scheme in schemes.values():
        for flow in scheme.get("flows", {}).values():
            catalog_scopes.update(flow.get("scopes", {}).keys())
    for path, method, operation in iter_operations(document):
        requirements = operation.get("security", document.get("security", []))
        for requirement in requirements:
            for scheme_name, requested_scopes in requirement.items():
                scheme = schemes.get(scheme_name)
                if not scheme:
                    raise ValueError(
                        f"{source.name} {method.upper()} {path} uses unknown security scheme {scheme_name}"
                    )
                if scheme.get("type") == "oauth2":
                    declared_scopes: set[str] = set()
                    for flow in scheme.get("flows", {}).values():
                        declared_scopes.update(flow.get("scopes", {}).keys())
                    unknown = set(requested_scopes) - declared_scopes
                else:
                    unknown = set(requested_scopes) - catalog_scopes
                if unknown:
                    raise ValueError(
                        f"{source.name} {method.upper()} {path} uses undeclared scopes {sorted(unknown)}"
                    )


CORE_PRERELEASE_SECURITY = {
    ("/v1/me", "get"): [{"userOAuth": ["profile:read"]}, {"personalAccessToken": ["profile:read"]}],
    ("/v1/developer-apps", "post"): [
        {"userOAuth": ["developer-apps:manage"]},
        {"personalAccessToken": ["developer-apps:manage"]},
    ],
    ("/v1/developer-apps", "get"): [
        {"userOAuth": ["developer-apps:read"]},
        {"personalAccessToken": ["developer-apps:read"]},
    ],
    ("/v1/developer-apps/{appId}", "get"): [
        {"userOAuth": ["developer-apps:read"]},
        {"personalAccessToken": ["developer-apps:read"]},
    ],
    ("/v1/developer-apps/{appId}", "patch"): [
        {"userOAuth": ["developer-apps:manage"]},
        {"personalAccessToken": ["developer-apps:manage"]},
    ],
    ("/v1/developer-apps/{appId}", "delete"): [
        {"userOAuth": ["developer-apps:manage"]},
        {"personalAccessToken": ["developer-apps:manage"]},
    ],
    # Creating tokens must accept only the OIDC user scheme so tokens can never mint tokens.
    ("/v1/personal-access-tokens", "post"): [{"userOAuth": ["pat:manage"]}],
    ("/v1/personal-access-tokens", "get"): [
        {"userOAuth": ["pat:read"]},
        {"personalAccessToken": ["pat:read"]},
    ],
    ("/v1/personal-access-tokens/{tokenId}", "delete"): [
        {"userOAuth": ["pat:manage"]},
        {"personalAccessToken": ["pat:manage"]},
    ],
}

PAT_GRANTABLE_SCOPES = {
    "profile:read",
    "credits:read",
    "developer-apps:read",
    "developer-apps:manage",
    "pat:read",
    "pat:manage",
}


def validate_core_prerelease(document: dict[str, Any]) -> None:
    version = document.get("info", {}).get("version")
    if version != "0.1.0-alpha.2":
        raise ValueError("core.yaml must lock the developer app and PAT slice as 0.1.0-alpha.2")

    operation = document.get("paths", {}).get("/v1/me", {}).get("get", {})
    if operation.get("operationId") != "getCurrentUser":
        raise ValueError("core.yaml GET /v1/me must keep operationId getCurrentUser")
    if operation.get("security") != CORE_PRERELEASE_SECURITY[("/v1/me", "get")]:
        raise ValueError(
            "core.yaml GET /v1/me must require profile:read for OIDC and personal access tokens"
        )
    if operation.get("x-mc-plan-stability") != "locked":
        raise ValueError("core.yaml GET /v1/me must be marked locked")

    responses = operation.get("responses", {})
    expected_refs = {
        "200": "../schemas/common/actor.json",
        "401": "#/components/responses/AuthenticationRequired",
        "403": "#/components/responses/AccessForbidden",
    }
    actual_refs = {
        "200": responses.get("200", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
        .get("$ref"),
        "401": responses.get("401", {}).get("$ref"),
        "403": responses.get("403", {}).get("$ref"),
    }
    if actual_refs != expected_refs:
        raise ValueError(f"core.yaml GET /v1/me response refs changed: {actual_refs}")

    for (path, method), expected_security in CORE_PRERELEASE_SECURITY.items():
        if (path, method) == ("/v1/me", "get"):
            continue
        locked_operation = document.get("paths", {}).get(path, {}).get(method, {})
        if not locked_operation:
            raise ValueError(f"core.yaml {method.upper()} {path} is missing")
        if locked_operation.get("security") != expected_security:
            raise ValueError(
                f"core.yaml {method.upper()} {path} must keep its locked security requirement"
            )

    problem = json.loads((ROOT / "schemas/common/problem.json").read_text(encoding="utf-8"))
    problem_validator = validator_for(problem)(problem)
    components = document.get("components", {}).get("responses", {})
    expected_errors = [
        ("AuthenticationRequired", "example", 401, "AUTHENTICATION_REQUIRED"),
        ("AccessForbidden", "examples.insufficientScope.value", 403, "INSUFFICIENT_SCOPE"),
        ("AccessForbidden", "examples.accountUnavailable.value", 403, "ACCOUNT_UNAVAILABLE"),
        ("AccessForbidden", "examples.roleRequired.value", 403, "ROLE_REQUIRED"),
        ("ValidationFailed", "example", 400, "VALIDATION_FAILED"),
        ("NotFound", "example", 404, "NOT_FOUND"),
    ]
    for response_name, example_path, status, code in expected_errors:
        media_type = components.get(response_name, {}).get("content", {}).get(
            "application/problem+json", {}
        )
        example: Any = media_type
        for segment in example_path.split("."):
            example = example.get(segment) if isinstance(example, dict) else None
        errors = sorted(problem_validator.iter_errors(example), key=lambda error: list(error.path))
        if errors:
            raise ValueError(f"core.yaml {response_name} example is not ProblemDetails: {errors[0].message}")
        if example.get("status") != status or example.get("code") != code:
            raise ValueError(f"core.yaml {response_name} must use status {status} and code {code}")

    actor = json.loads((ROOT / "schemas/common/actor.json").read_text(encoding="utf-8"))
    public_fields = set(actor.get("properties", {}))
    if public_fields != {"user_id", "display_name", "avatar_url"}:
        raise ValueError(f"PublicActor exposes unexpected fields: {sorted(public_fields)}")
    if actor.get("additionalProperties") is not False:
        raise ValueError("PublicActor must reject identity-provider or business-state fields")

    pat = json.loads(
        (ROOT / "schemas/core/personal-access-token.json").read_text(encoding="utf-8")
    )
    pat_fields = set(pat.get("properties", {}))
    if pat_fields != {
        "token_id",
        "token_prefix",
        "scopes",
        "status",
        "expires_at",
        "created_at",
        "last_used_at",
        "revoked_at",
    }:
        raise ValueError(f"PersonalAccessToken metadata exposes unexpected fields: {sorted(pat_fields)}")
    if pat.get("additionalProperties") is not False:
        raise ValueError("PersonalAccessToken metadata must never expose plaintext or hash fields")

    pat_created = json.loads(
        (ROOT / "schemas/core/personal-access-token-created.json").read_text(encoding="utf-8")
    )
    if set(pat_created.get("properties", {})) != {
        "token_id",
        "token",
        "token_prefix",
        "scopes",
        "status",
        "expires_at",
        "created_at",
    }:
        raise ValueError(
            "PersonalAccessTokenCreated must expose exactly the once-only token plus metadata fields"
        )
    if pat_created.get("additionalProperties") is not False:
        raise ValueError("PersonalAccessTokenCreated must reject unexpected fields")

    app_created = json.loads(
        (ROOT / "schemas/core/developer-app-created.json").read_text(encoding="utf-8")
    )
    if set(app_created.get("properties", {})) != {
        "app_id",
        "name",
        "client_type",
        "redirect_uris",
        "approved_scopes",
        "status",
        "client_secret",
        "created_at",
        "updated_at",
    }:
        raise ValueError("DeveloperAppCreated must expose the app fields plus the once-only secret")
    if app_created.get("additionalProperties") is not False:
        raise ValueError("DeveloperAppCreated must reject unexpected fields")

    create_schema = (
        document.get("components", {})
        .get("schemas", {})
        .get("CreatePersonalAccessTokenRequest", {})
    )
    expiry = create_schema.get("properties", {}).get("expires_in_days", {})
    if expiry.get("maximum") != 30 or expiry.get("default") != 30:
        raise ValueError(
            "core.yaml must lock the decided 30-day default maximum PAT validity (Q-007)"
        )
    scope_enum = set(create_schema.get("properties", {}).get("scopes", {}).get("items", {}).get("enum", []))
    if scope_enum != PAT_GRANTABLE_SCOPES:
        raise ValueError(f"CreatePersonalAccessTokenRequest scope enum must match the declared catalog: {sorted(scope_enum)}")

    compatibility = (ROOT / "docs/compatibility.md").read_text(encoding="utf-8")
    if "Core `0.1.0-alpha.1`" not in compatibility or "预发布兼容收敛" not in compatibility:
        raise ValueError("docs/compatibility.md must classify Core 0.1.0-alpha.1")
    if "Core `0.1.0-alpha.2`" not in compatibility or "预发布兼容新增" not in compatibility:
        raise ValueError("docs/compatibility.md must classify Core 0.1.0-alpha.2")


def validate_openapi() -> tuple[int, set[str]]:
    sources = sorted((ROOT / "openapi").glob("*.yaml"))
    operation_ids: set[str] = set()

    for source in sources:
        document = yaml.safe_load(source.read_text(encoding="utf-8"))
        if not str(document.get("openapi", "")).startswith("3.1."):
            raise ValueError(f"{source.name} must use OpenAPI 3.1")
        if not document.get("info", {}).get("license"):
            raise ValueError(f"{source.name} is missing info.license")
        require_local_refs(source, document)

        for path, path_item in document.get("paths", {}).items():
            if not path.startswith("/v1/"):
                raise ValueError(f"{source.name} path is not versioned: {path}")
            for method, operation in path_item.items():
                if method.lower() not in HTTP_METHODS:
                    continue
                operation_id = operation.get("operationId")
                if not operation_id:
                    raise ValueError(f"{source.name} {method.upper()} {path} lacks operationId")
                if operation_id in operation_ids:
                    raise ValueError(f"Duplicate operationId: {operation_id}")
                operation_ids.add(operation_id)
                responses = operation.get("responses", {})
                if not any(str(code).startswith("4") for code in responses):
                    raise ValueError(f"{source.name} {operation_id} lacks an explicit 4xx response")

        validate_security_scopes(source, document)
        if source.name == "core.yaml":
            validate_core_prerelease(document)

    return len(sources), operation_ids


def main() -> None:
    schema_count, schema_ids = validate_json_schemas()
    openapi_count, operation_ids = validate_openapi()
    print(
        "Contract validation passed: "
        f"{schema_count} JSON schemas/events, {len(schema_ids)} unique $ids, "
        f"{openapi_count} OpenAPI documents, {len(operation_ids)} unique operationIds."
    )


if __name__ == "__main__":
    main()
