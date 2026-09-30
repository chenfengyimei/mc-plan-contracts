#!/usr/bin/env python3
"""Validate MC Plan contract structure without generating artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

import yaml
from jsonschema.validators import validator_for


ROOT = Path(__file__).resolve().parents[1]


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
                if method.lower() not in {"get", "post", "put", "patch", "delete"}:
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
