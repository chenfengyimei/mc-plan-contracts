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
    for path, method, operation in iter_operations(document):
        requirements = operation.get("security", document.get("security", []))
        for requirement in requirements:
            for scheme_name, requested_scopes in requirement.items():
                scheme = schemes.get(scheme_name)
                if not scheme:
                    raise ValueError(
                        f"{source.name} {method.upper()} {path} uses unknown security scheme {scheme_name}"
                    )
                declared_scopes: set[str] = set()
                for flow in scheme.get("flows", {}).values():
                    declared_scopes.update(flow.get("scopes", {}).keys())
                unknown = set(requested_scopes) - declared_scopes
                if unknown:
                    raise ValueError(
                        f"{source.name} {method.upper()} {path} uses undeclared scopes {sorted(unknown)}"
                    )


def validate_core_identity_prerelease(document: dict[str, Any]) -> None:
    version = document.get("info", {}).get("version")
    if version != "0.1.0-alpha.1":
        raise ValueError("core.yaml must lock the identity slice as 0.1.0-alpha.1")

    operation = document.get("paths", {}).get("/v1/me", {}).get("get", {})
    if operation.get("operationId") != "getCurrentUser":
        raise ValueError("core.yaml GET /v1/me must keep operationId getCurrentUser")
    if operation.get("security") != [{"userOAuth": ["profile:read"]}]:
        raise ValueError("core.yaml GET /v1/me must require only profile:read")
    if operation.get("x-mc-plan-stability") != "locked":
        raise ValueError("core.yaml GET /v1/me must be marked locked")

    responses = operation.get("responses", {})
    expected_refs = {
        "200": "../schemas/common/actor.json",
        "401": "#/components/responses/AuthenticationRequired",
        "403": "#/components/responses/AccountUnavailable",
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

    problem = json.loads((ROOT / "schemas/common/problem.json").read_text(encoding="utf-8"))
    problem_validator = validator_for(problem)(problem)
    components = document.get("components", {}).get("responses", {})
    expected_errors = {
        "AuthenticationRequired": (401, "AUTHENTICATION_REQUIRED"),
        "AccountUnavailable": (403, "ACCOUNT_UNAVAILABLE"),
    }
    for response_name, (status, code) in expected_errors.items():
        example = (
            components.get(response_name, {})
            .get("content", {})
            .get("application/problem+json", {})
            .get("example")
        )
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

    compatibility = (ROOT / "docs/compatibility.md").read_text(encoding="utf-8")
    if "Core `0.1.0-alpha.1`" not in compatibility or "预发布兼容收敛" not in compatibility:
        raise ValueError("docs/compatibility.md must classify Core 0.1.0-alpha.1")


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
            validate_core_identity_prerelease(document)

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
