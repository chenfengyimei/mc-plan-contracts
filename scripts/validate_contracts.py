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
    # GET entitlements accepts OIDC users and personal access tokens with credits:read.
    ("/v1/entitlements", "get"): [
        {"userOAuth": ["credits:read"]},
        {"personalAccessToken": ["credits:read"]},
    ],
    # GET credit balance accepts OIDC users and personal access tokens with credits:read.
    ("/v1/credits/balance", "get"): [
        {"userOAuth": ["credits:read"]},
        {"personalAccessToken": ["credits:read"]},
    ],
    # Consume is service-to-service only and never treats a service token as a user login.
    ("/v1/credits/consume", "post"): [{"serviceOAuth": ["credits:consume"]}],
    # Consumer-pull event delivery (ADR-0011) is service-to-service only.
    ("/v1/events", "get"): [{"serviceOAuth": ["events:consume"]}],
    ("/v1/events/acknowledgments", "post"): [{"serviceOAuth": ["events:consume"]}],
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
    if version != "0.1.0-alpha.9":
        raise ValueError("core.yaml must lock the ADR-0018 admin console read-only slice as 0.1.0-alpha.9")

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
        (
            "ConsumptionConflict",
            "examples.idempotencyKeyConflict.value",
            409,
            "IDEMPOTENCY_KEY_CONFLICT",
        ),
        (
            "ConsumptionConflict",
            "examples.entitlementExhausted.value",
            409,
            "ENTITLEMENT_EXHAUSTED",
        ),
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

    entitlement = json.loads(
        (ROOT / "schemas/core/entitlement.json").read_text(encoding="utf-8")
    )
    if set(entitlement.get("properties", {})) != {
        "module",
        "policy_date",
        "timezone",
        "granted",
        "consumed",
        "remaining",
    }:
        raise ValueError(f"Entitlement exposes unexpected fields: {sorted(entitlement.get('properties', {}))}")
    if entitlement.get("properties", {}).get("timezone", {}).get("const") != "Asia/Shanghai":
        raise ValueError("Entitlement timezone must stay locked to Asia/Shanghai")
    if entitlement.get("properties", {}).get("module", {}).get("enum") != ["skin"]:
        raise ValueError("Entitlement module enum must stay locked to skin")
    if entitlement.get("additionalProperties") is not False:
        raise ValueError("Entitlement must reject internal policy rows or database identifiers")

    balance_path = document.get("paths", {}).get("/v1/credits/balance", {})
    balance_methods = {
        method for method in balance_path if isinstance(method, str) and method.lower() in HTTP_METHODS
    }
    if balance_methods != {"get"}:
        raise ValueError(
            "core.yaml /v1/credits/balance must stay a read-only GET surface with no other methods"
        )
    balance_operation = balance_path.get("get", {})
    if balance_operation.get("operationId") != "getCreditBalance":
        raise ValueError(
            "core.yaml GET /v1/credits/balance must keep operationId getCreditBalance"
        )
    if balance_operation.get("x-mc-plan-stability") != "prerelease":
        raise ValueError("core.yaml GET /v1/credits/balance must be marked prerelease")
    balance_responses = balance_operation.get("responses", {})
    if (
        balance_responses.get("200", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
        .get("$ref")
        != "../schemas/core/credit-balance.json"
    ):
        raise ValueError(
            "core.yaml GET /v1/credits/balance 200 must use the locked CreditBalance schema"
        )
    if (
        balance_responses.get("401", {}).get("$ref")
        != "#/components/responses/AuthenticationRequired"
    ):
        raise ValueError("core.yaml GET /v1/credits/balance must keep the locked 401 problem")
    if (
        balance_responses.get("403", {}).get("$ref")
        != "#/components/responses/AccessForbidden"
    ):
        raise ValueError("core.yaml GET /v1/credits/balance must keep the locked 403 problem")
    if "404" in balance_responses:
        raise ValueError(
            "core.yaml GET /v1/credits/balance must not invent a 404 for the caller's own balance"
        )

    balance = json.loads((ROOT / "schemas/core/credit-balance.json").read_text(encoding="utf-8"))
    if set(balance.get("properties", {})) != {"user_id", "balance"}:
        raise ValueError(
            f"CreditBalance exposes unexpected fields: {sorted(balance.get('properties', {}))}"
        )
    if balance.get("properties", {}).get("balance", {}).get("minimum") != 0:
        raise ValueError("CreditBalance must lock a non-negative integer balance")
    if balance.get("additionalProperties") is not False:
        raise ValueError("CreditBalance must reject unexpected fields")

    ledger_entry = json.loads(
        (ROOT / "schemas/core/credit-ledger-entry.json").read_text(encoding="utf-8")
    )
    if ledger_entry.get("properties", {}).get("kind", {}).get("enum") != [
        "grant",
        "consume",
        "refund",
        "adjustment",
    ]:
        raise ValueError("CreditLedgerEntry must keep the four immutable ledger kinds")
    if ledger_entry.get("properties", {}).get("balance_after", {}).get("minimum") != 0:
        raise ValueError("CreditLedgerEntry must keep non-negative balances")

    consume = document.get("paths", {}).get("/v1/credits/consume", {}).get("post", {})
    if consume.get("operationId") != "consumeCredits":
        raise ValueError("core.yaml POST /v1/credits/consume must keep operationId consumeCredits")
    consume_parameters = consume.get("parameters", [])
    if not any(
        parameter.get("$ref") == "#/components/parameters/IdempotencyKey"
        for parameter in consume_parameters
    ):
        raise ValueError("core.yaml POST /v1/credits/consume must require the Idempotency-Key parameter")
    consume_responses = consume.get("responses", {})
    if consume_responses.get("200", {}).get("content", {}).get("application/json", {}).get("schema", {}).get("$ref") != "#/components/schemas/ConsumptionResult":
        raise ValueError("core.yaml POST /v1/credits/consume 200 must use ConsumptionResult")
    if consume_responses.get("201", {}).get("content", {}).get("application/json", {}).get("schema", {}).get("$ref") != "#/components/schemas/ConsumptionResult":
        raise ValueError("core.yaml POST /v1/credits/consume 201 must use ConsumptionResult")
    if consume_responses.get("409", {}).get("$ref") != "#/components/responses/ConsumptionConflict":
        raise ValueError("core.yaml POST /v1/credits/consume 409 must use ConsumptionConflict")
    consumption_result = (
        document.get("components", {}).get("schemas", {}).get("ConsumptionResult", {})
    )
    if consumption_result.get("properties", {}).get("source", {}).get("enum") != ["daily_entitlement"]:
        raise ValueError("ConsumptionResult must claim only the implemented daily_entitlement source")
    entitlements_view = (
        document.get("paths", {})
        .get("/v1/entitlements", {})
        .get("get", {})
        .get("responses", {})
        .get("200", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
    )
    if (
        entitlements_view.get("properties", {}).get("items", {}).get("items", {}).get("$ref")
        != "../schemas/core/entitlement.json"
    ):
        raise ValueError("core.yaml GET /v1/entitlements must return locked entitlement items")

    # --- Consumer-pull event delivery slice (0.1.0-alpha.5, ADR-0011) -----
    service_flow_scopes = set()
    schemes = document.get("components", {}).get("securitySchemes", {})
    for flow in schemes.get("serviceOAuth", {}).get("flows", {}).values():
        service_flow_scopes.update(flow.get("scopes", {}).keys())
    if "events:consume" not in service_flow_scopes:
        raise ValueError("core.yaml serviceOAuth must declare the events:consume scope")
    for scheme_name in ("userOAuth", "personalAccessToken"):
        scheme_scopes: set[str] = set()
        for flow in schemes.get(scheme_name, {}).get("flows", {}).values():
            scheme_scopes.update(flow.get("scopes", {}).keys())
        if "events:consume" in scheme_scopes:
            raise ValueError(f"core.yaml {scheme_name} must never declare the service-only events:consume scope")
    if "events:consume" in PAT_GRANTABLE_SCOPES:
        raise ValueError("events:consume must never be personal-access-token grantable")

    events_path = document.get("paths", {}).get("/v1/events", {})
    if set(key for key in events_path if isinstance(key, str) and key.lower() in HTTP_METHODS) != {"get"}:
        raise ValueError("core.yaml /v1/events must stay a read-only GET surface with no other methods")
    events_get = events_path.get("get", {})
    if events_get.get("operationId") != "listDeliveredEvents":
        raise ValueError("core.yaml GET /v1/events must keep operationId listDeliveredEvents")
    if events_get.get("x-mc-plan-stability") != "prerelease":
        raise ValueError("core.yaml GET /v1/events must be marked prerelease")
    if (
        events_get.get("responses", {})
        .get("200", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
        .get("$ref")
        != "../schemas/core/event-page.json"
    ):
        raise ValueError("core.yaml GET /v1/events 200 must use the locked EventPage schema")
    if (
        events_get.get("responses", {}).get("401", {}).get("$ref")
        != "#/components/responses/AuthenticationRequired"
    ):
        raise ValueError("core.yaml GET /v1/events must keep the locked 401 problem")
    if (
        events_get.get("responses", {}).get("403", {}).get("$ref")
        != "#/components/responses/AccessForbidden"
    ):
        raise ValueError("core.yaml GET /v1/events must keep the locked 403 problem")
    if "404" in events_get.get("responses", {}):
        raise ValueError("core.yaml GET /v1/events must not invent a 404")
    limit_schema = {}
    for parameter in events_get.get("parameters", []):
        if parameter.get("name") == "limit":
            limit_schema = parameter.get("schema", {})
    if limit_schema.get("minimum") != 1 or limit_schema.get("maximum") != 200:
        raise ValueError("core.yaml GET /v1/events limit must stay bounded to 1..200")

    ack_path = document.get("paths", {}).get("/v1/events/acknowledgments", {})
    if set(key for key in ack_path if isinstance(key, str) and key.lower() in HTTP_METHODS) != {"post"}:
        raise ValueError("core.yaml /v1/events/acknowledgments must stay a POST-only surface")
    ack_post = ack_path.get("post", {})
    if ack_post.get("operationId") != "acknowledgeEvents":
        raise ValueError("core.yaml POST /v1/events/acknowledgments must keep operationId acknowledgeEvents")
    if ack_post.get("x-mc-plan-stability") != "prerelease":
        raise ValueError("core.yaml POST /v1/events/acknowledgments must be marked prerelease")
    ack_request = (
        ack_post.get("requestBody", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
    )
    if ack_request.get("required") != ["cursor"] or ack_request.get("additionalProperties") is not False:
        raise ValueError("core.yaml acknowledgeEvents request must require only a cursor field")
    ack_cursor = ack_request.get("properties", {}).get("cursor", {})
    if ack_cursor.get("minLength") != 1 or ack_cursor.get("maxLength") != 512:
        raise ValueError("core.yaml acknowledgeEvents cursor must stay a bounded non-empty string")
    if (
        ack_post.get("responses", {})
        .get("200", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
        .get("$ref")
        != "../schemas/core/event-acknowledgment.json"
    ):
        raise ValueError("core.yaml acknowledgeEvents 200 must use the locked EventAcknowledgment schema")
    if (
        ack_post.get("responses", {}).get("400", {}).get("$ref")
        != "#/components/responses/ValidationFailed"
    ):
        raise ValueError("core.yaml acknowledgeEvents must keep the locked 400 validation problem")
    if (
        ack_post.get("responses", {}).get("401", {}).get("$ref")
        != "#/components/responses/AuthenticationRequired"
        or ack_post.get("responses", {}).get("403", {}).get("$ref")
        != "#/components/responses/AccessForbidden"
    ):
        raise ValueError("core.yaml acknowledgeEvents must keep the locked 401/403 problems")

    event_page = json.loads((ROOT / "schemas/core/event-page.json").read_text(encoding="utf-8"))
    if set(event_page.get("properties", {})) != {"items", "next_cursor"}:
        raise ValueError(f"EventPage exposes unexpected fields: {sorted(event_page.get('properties', {}))}")
    if (
        event_page.get("properties", {})
        .get("items", {})
        .get("items", {})
        .get("$ref")
        != "../common/event-envelope.json"
    ):
        raise ValueError("EventPage items must be the locked event envelope")
    if event_page.get("required") != ["items", "next_cursor"]:
        raise ValueError("EventPage must require items and next_cursor")
    if event_page.get("additionalProperties") is not False:
        raise ValueError("EventPage must reject unexpected fields")

    event_ack = json.loads(
        (ROOT / "schemas/core/event-acknowledgment.json").read_text(encoding="utf-8")
    )
    if set(event_ack.get("properties", {})) != {"cursor"}:
        raise ValueError("EventAcknowledgment must expose only the cursor field")
    if event_ack.get("properties", {}).get("cursor", {}).get("minLength") != 1:
        raise ValueError("EventAcknowledgment cursor must be a non-empty string")
    if event_ack.get("additionalProperties") is not False:
        raise ValueError("EventAcknowledgment must reject unexpected fields")

    # --- Public profile slice (0.1.0-alpha.6, W02 phase one) --------------
    user_flow_scopes = set()
    for flow in schemes.get("userOAuth", {}).get("flows", {}).values():
        user_flow_scopes.update(flow.get("scopes", {}).keys())
    if "profile:write" not in user_flow_scopes:
        raise ValueError("core.yaml userOAuth must declare the profile:write scope")
    if "profile:write" in PAT_GRANTABLE_SCOPES:
        raise ValueError("profile:write must never be personal-access-token grantable")

    public_user_path = document.get("paths", {}).get("/v1/users/{userId}", {})
    public_user_get = public_user_path.get("get", {})
    if public_user_get.get("operationId") != "getPublicUser":
        raise ValueError("core.yaml GET /v1/users/{userId} must keep operationId getPublicUser")
    if public_user_get.get("x-mc-plan-stability") != "prerelease":
        raise ValueError("core.yaml getPublicUser must be marked prerelease")
    if public_user_get.get("security") != []:
        raise ValueError("core.yaml getPublicUser must stay an unauthenticated public surface")
    if (
        public_user_get.get("responses", {})
        .get("200", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
        .get("$ref")
        != "../schemas/common/actor.json"
    ):
        raise ValueError("core.yaml getPublicUser 200 must stay the locked PublicActor schema")
    if "401" in public_user_get.get("responses", {}):
        raise ValueError("core.yaml getPublicUser must not invent an authentication requirement")

    me_path = document.get("paths", {}).get("/v1/me", {})
    me_patch = me_path.get("patch", {})
    if me_patch.get("operationId") != "updateCurrentUser":
        raise ValueError("core.yaml PATCH /v1/me must keep operationId updateCurrentUser")
    if me_patch.get("x-mc-plan-stability") != "prerelease":
        raise ValueError("core.yaml PATCH /v1/me must be marked prerelease")
    patch_security = me_patch.get("security", [])
    if patch_security != [
        {"userOAuth": ["profile:write"]},
        {"personalAccessToken": ["profile:write"]},
    ]:
        raise ValueError(
            "core.yaml PATCH /v1/me must require exactly the profile:write scope on both credential kinds"
        )
    patch_request = (
        me_patch.get("requestBody", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
    )
    if (
        patch_request.get("required") != ["display_name"]
        or patch_request.get("additionalProperties") is not False
    ):
        raise ValueError("core.yaml PATCH /v1/me request must require only a display_name field")
    display_name = patch_request.get("properties", {}).get("display_name", {})
    if display_name.get("minLength") != 1 or display_name.get("maxLength") != 80:
        raise ValueError("core.yaml PATCH /v1/me display_name must stay bounded to 1..80")
    if (
        me_patch.get("responses", {})
        .get("200", {})
        .get("content", {})
        .get("application/json", {})
        .get("schema", {})
        .get("$ref")
        != "../schemas/common/actor.json"
    ):
        raise ValueError("core.yaml PATCH /v1/me 200 must stay the locked PublicActor schema")
    for status, ref in (
        ("400", "#/components/responses/ValidationFailed"),
        ("401", "#/components/responses/AuthenticationRequired"),
        ("403", "#/components/responses/AccessForbidden"),
    ):
        if me_patch.get("responses", {}).get(status, {}).get("$ref") != ref:
            raise ValueError(f"core.yaml PATCH /v1/me must keep the locked {status} problem")

    operations = {op["operationId"]: op for _, _, op in iter_operations(document)}
    # ADR-0017: app delegation is distinct from the unchanged PAT catalog.
    app_scopes = {"profile:read", "credits:read", "developer-apps:read", "developer-apps:manage",
                  "pat:read", "pat:manage", "resource:read", "resource:write", "upload:write"}
    for op in ("createDeveloperApp", "approveDeveloperAppScopes"):
        if set(operations[op].get("x-mc-plan-delegatable-scopes", [])) != app_scopes:
            raise ValueError("Developer App scope delegation catalog drift")
    if "moderation:review" in app_scopes or "events:consume" in app_scopes:
        raise ValueError("Privileged scopes cannot be ordinary app delegation")

    # --- W02-b deactivation rights slice (0.1.0-alpha.7) ------------------
    me_post = me_path.get("post", {})
    if me_post.get("operationId") != "deactivateCurrentUser":
        raise ValueError("core.yaml POST /v1/me/deactivation must use operationId deactivateCurrentUser")
    if me_post.get("x-mc-plan-stability") != "prerelease":
        raise ValueError("core.yaml deactivateCurrentUser must be marked prerelease")
    if me_post.get("security") != [{"userOAuth": ["profile:write"]}]:
        raise ValueError(
            "core.yaml deactivateCurrentUser must require exactly profile:write on the "
            "interactive userOAuth scheme only"
        )
    if "requestBody" in me_post:
        raise ValueError("core.yaml deactivateCurrentUser must not accept a request body")
    deactivation_responses = me_post.get("responses", {})
    if set(deactivation_responses) != {"204", "401", "403", "default"}:
        raise ValueError(
            "core.yaml deactivateCurrentUser responses must be exactly 204/401/403/default: "
            f"{sorted(deactivation_responses)}"
        )
    if "content" in deactivation_responses.get("204", {}):
        raise ValueError("core.yaml deactivateCurrentUser 204 must carry no response body")
    for status, ref in (
        ("401", "#/components/responses/AuthenticationRequired"),
        ("403", "#/components/responses/AccessForbidden"),
    ):
        if deactivation_responses.get(status, {}).get("$ref") != ref:
            raise ValueError(f"core.yaml deactivateCurrentUser must keep the locked {status} problem")

    # --- ADR-0018 admin console read-only slice (0.1.0-alpha.9) -----------
    admin_scope = "admin:read"
    admin_user_flow_scopes: set[str] = set()
    for flow in schemes.get("userOAuth", {}).get("flows", {}).values():
        admin_user_flow_scopes.update(flow.get("scopes", {}).keys())
    if admin_scope not in admin_user_flow_scopes:
        raise ValueError("core.yaml userOAuth must declare the admin:read scope")
    admin_service_flow_scopes: set[str] = set()
    for flow in schemes.get("serviceOAuth", {}).get("flows", {}).values():
        admin_service_flow_scopes.update(flow.get("scopes", {}).keys())
    if admin_scope in admin_service_flow_scopes:
        raise ValueError("core.yaml serviceOAuth must never declare the admin-only admin:read scope")
    if admin_scope in PAT_GRANTABLE_SCOPES:
        raise ValueError("admin:read must never be personal-access-token grantable")
    if admin_scope in app_scopes:
        raise ValueError("admin:read must never be ordinary developer-app delegation")

    expected_admin_pages = {
        "listAdminUsers": ("/v1/admin/users", "../schemas/core/admin-user-page.json"),
        "getAdminUser": ("/v1/admin/users/{userId}", "../schemas/core/admin-user.json"),
        "listAdminCreditLedger": ("/v1/admin/users/{userId}/credit-ledger", "../schemas/core/admin-credit-ledger-page.json"),
        "listAdminEntitlementRecords": ("/v1/admin/users/{userId}/entitlement-records", "../schemas/core/admin-entitlement-record-page.json"),
        "listAdminAuditRecords": ("/v1/admin/audit", "../schemas/core/admin-audit-record-page.json"),
        "listAdminOutboxRecords": ("/v1/admin/outbox", "../schemas/core/admin-outbox-record-page.json"),
    }
    user_scoped_admin_ops = {"getAdminUser", "listAdminCreditLedger", "listAdminEntitlementRecords"}
    listed_admin_ops = {
        "listAdminUsers",
        "listAdminCreditLedger",
        "listAdminEntitlementRecords",
        "listAdminAuditRecords",
        "listAdminOutboxRecords",
    }
    for operation_id, (path, page_ref) in expected_admin_pages.items():
        operation = operations[operation_id]
        if operation.get("x-mc-plan-stability") != "prerelease":
            raise ValueError(f"core.yaml {operation_id} must be marked prerelease")
        if operation.get("security") != [{"userOAuth": [admin_scope]}]:
            raise ValueError(
                f"core.yaml {operation_id} must require exactly the admin:read scope on the interactive userOAuth scheme only"
            )
        admin_responses = operation.get("responses", {})
        if (
            admin_responses.get("200", {})
            .get("content", {})
            .get("application/json", {})
            .get("schema", {})
            .get("$ref")
            != page_ref
        ):
            raise ValueError(f"core.yaml {operation_id} 200 must use {page_ref.rsplit('/', 1)[-1]}")
        for status, ref in (
            ("401", "#/components/responses/AuthenticationRequired"),
            ("403", "#/components/responses/AccessForbidden"),
        ):
            if admin_responses.get(status, {}).get("$ref") != ref:
                raise ValueError(f"core.yaml {operation_id} must keep the locked {status} problem")
        if operation_id in user_scoped_admin_ops:
            if admin_responses.get("404", {}).get("$ref") != "#/components/responses/NotFound":
                raise ValueError(f"core.yaml {operation_id} must keep the locked 404 problem")
        elif "404" in admin_responses:
            raise ValueError(f"core.yaml {operation_id} is a global surface and must not invent a 404")
        if operation_id in listed_admin_ops:
            admin_limit_schema: dict[str, Any] = {}
            for parameter in operation.get("parameters", []):
                if parameter.get("name") == "limit":
                    admin_limit_schema = parameter.get("schema", {})
            if (
                admin_limit_schema.get("minimum"),
                admin_limit_schema.get("maximum"),
                admin_limit_schema.get("default"),
            ) != (1, 100, 20):
                raise ValueError(f"core.yaml {operation_id} limit must stay bounded to 1..100 default 20")
            if not any(
                parameter.get("$ref") == "#/components/parameters/PageCursor"
                for parameter in operation.get("parameters", [])
            ):
                raise ValueError(f"core.yaml {operation_id} must use the PageCursor parameter")
            if admin_responses.get("400", {}).get("$ref") != "#/components/responses/ValidationFailed":
                raise ValueError(f"core.yaml {operation_id} must keep the locked 400 validation problem")
        elif "400" in admin_responses:
            raise ValueError(f"core.yaml {operation_id} must not invent a 400 for path identifiers")

    page_cursor = document.get("components", {}).get("parameters", {}).get("PageCursor", {})
    cursor_schema = page_cursor.get("schema", {})
    if (
        page_cursor.get("name") != "cursor"
        or page_cursor.get("in") != "query"
        or page_cursor.get("required") is not False
        or cursor_schema.get("minLength") != 1
        or cursor_schema.get("maxLength") != 512
    ):
        raise ValueError("core.yaml PageCursor must stay a bounded optional query cursor")

    outbox_state_schema: dict[str, Any] = {}
    for parameter in operations["listAdminOutboxRecords"].get("parameters", []):
        if parameter.get("name") == "state":
            outbox_state_schema = parameter.get("schema", {})
    if outbox_state_schema.get("enum") != ["PENDING", "PUBLISHED"]:
        raise ValueError("core.yaml listAdminOutboxRecords state filter must stay the locked enum")
    audit_user_schema: dict[str, Any] = {}
    for parameter in operations["listAdminAuditRecords"].get("parameters", []):
        if parameter.get("name") == "user_id":
            audit_user_schema = parameter.get("schema", {})
    if audit_user_schema.get("format") != "uuid":
        raise ValueError("core.yaml listAdminAuditRecords user_id filter must be a uuid")

    admin_summary = json.loads((ROOT / "schemas/core/admin-user-summary.json").read_text(encoding="utf-8"))
    if set(admin_summary.get("properties", {})) != {"user_id", "display_name", "status", "role", "created_at"}:
        raise ValueError("AdminUserSummary exposes unexpected fields")
    if (
        admin_summary.get("properties", {}).get("status", {}).get("enum")
        != ["ACTIVE", "SUSPENDED", "CLOSED", "SECURITY_HOLD"]
        or admin_summary.get("properties", {}).get("role", {}).get("enum")
        != ["USER", "CREATOR", "DEVELOPER", "MODERATOR", "ADMIN"]
    ):
        raise ValueError("AdminUserSummary must keep the locked status and role enums")
    if admin_summary.get("additionalProperties") is not False:
        raise ValueError("AdminUserSummary must reject identity-provider or secret fields")

    admin_user = json.loads((ROOT / "schemas/core/admin-user.json").read_text(encoding="utf-8"))
    if set(admin_user.get("properties", {})) != {
        "user_id",
        "display_name",
        "status",
        "role",
        "created_at",
        "updated_at",
        "credit_balance",
        "identity_links_count",
        "developer_apps_count",
        "personal_access_tokens_count",
    }:
        raise ValueError("AdminUser exposes unexpected fields")
    if admin_user.get("properties", {}).get("credit_balance", {}).get("minimum") != 0:
        raise ValueError("AdminUser must keep a non-negative credit balance")
    if admin_user.get("additionalProperties") is not False:
        raise ValueError("AdminUser must reject unexpected fields")

    admin_ledger = json.loads(
        (ROOT / "schemas/core/admin-credit-ledger-entry.json").read_text(encoding="utf-8")
    )
    if set(admin_ledger.get("properties", {})) != {
        "entry_id",
        "user_id",
        "kind",
        "amount",
        "balance_before",
        "balance_after",
        "source",
        "reference_id",
        "reason",
        "actor_id",
        "created_at",
    }:
        raise ValueError("AdminCreditLedgerEntry exposes unexpected fields")
    if admin_ledger.get("properties", {}).get("kind", {}).get("enum") != [
        "grant",
        "consume",
        "refund",
        "adjustment",
    ]:
        raise ValueError("AdminCreditLedgerEntry must keep the four immutable ledger kinds")
    if admin_ledger.get("properties", {}).get("reason", {}).get("maxLength") != 512:
        raise ValueError("AdminCreditLedgerEntry reason must stay bounded to the recorded 512")
    if admin_ledger.get("properties", {}).get("actor_id", {}).get("maxLength") != 255:
        raise ValueError("AdminCreditLedgerEntry actor_id must stay bounded to the recorded 255")
    if admin_ledger.get("additionalProperties") is not False:
        raise ValueError("AdminCreditLedgerEntry must reject unexpected fields")

    admin_entitlement = json.loads(
        (ROOT / "schemas/core/admin-entitlement-record.json").read_text(encoding="utf-8")
    )
    if set(admin_entitlement.get("properties", {})) != {
        "entitlement_id",
        "module",
        "operation",
        "policy_date",
        "granted",
        "consumed",
        "created_at",
    }:
        raise ValueError("AdminEntitlementRecord exposes unexpected fields")
    if (
        admin_entitlement.get("properties", {}).get("module", {}).get("enum") != ["skin"]
        or admin_entitlement.get("properties", {}).get("operation", {}).get("enum")
        != ["creation_session"]
    ):
        raise ValueError("AdminEntitlementRecord must keep the locked policy enums")
    if admin_entitlement.get("additionalProperties") is not False:
        raise ValueError("AdminEntitlementRecord must reject internal policy rows")

    admin_audit = json.loads((ROOT / "schemas/core/admin-audit-record.json").read_text(encoding="utf-8"))
    if set(admin_audit.get("properties", {})) != {
        "audit_id",
        "user_id",
        "action",
        "target_id",
        "metadata",
        "created_at",
    }:
        raise ValueError("AdminAuditRecord exposes unexpected fields")
    if admin_audit.get("properties", {}).get("metadata", {}).get("type") != "object":
        raise ValueError("AdminAuditRecord metadata must stay the recorded action-specific object")
    if admin_audit.get("additionalProperties") is not False:
        raise ValueError("AdminAuditRecord must reject unexpected fields")

    admin_outbox = json.loads((ROOT / "schemas/core/admin-outbox-record.json").read_text(encoding="utf-8"))
    if set(admin_outbox.get("properties", {})) != {
        "record_id",
        "user_id",
        "event_type",
        "state",
        "attempt_count",
        "delivery_position",
        "last_error",
        "created_at",
        "published_at",
    }:
        raise ValueError("AdminOutboxRecord exposes unexpected fields")
    if admin_outbox.get("properties", {}).get("state", {}).get("enum") != ["PENDING", "PUBLISHED"]:
        raise ValueError("AdminOutboxRecord must keep the locked delivery states")
    if admin_outbox.get("properties", {}).get("last_error", {}).get("maxLength") != 512:
        raise ValueError("AdminOutboxRecord last_error must stay bounded to 512")
    if admin_outbox.get("additionalProperties") is not False:
        raise ValueError("AdminOutboxRecord must reject unexpected fields")

    for page_name, item_ref in (
        ("admin-user-page.json", "admin-user-summary.json"),
        ("admin-credit-ledger-page.json", "admin-credit-ledger-entry.json"),
        ("admin-entitlement-record-page.json", "admin-entitlement-record.json"),
        ("admin-audit-record-page.json", "admin-audit-record.json"),
        ("admin-outbox-record-page.json", "admin-outbox-record.json"),
    ):
        page = json.loads((ROOT / "schemas/core" / page_name).read_text(encoding="utf-8"))
        if set(page.get("properties", {})) != {"items", "next_cursor"} or page.get("required") != [
            "items",
            "next_cursor",
        ]:
            raise ValueError(f"{page_name} must be a closed items+next_cursor page")
        if page.get("properties", {}).get("items", {}).get("items", {}).get("$ref") != item_ref:
            raise ValueError(f"{page_name} items must reference {item_ref}")
        if page.get("additionalProperties") is not False:
            raise ValueError(f"{page_name} must reject unexpected fields")

    compatibility = (ROOT / "docs/compatibility.md").read_text(encoding="utf-8")
    if "Core `0.1.0-alpha.1`" not in compatibility or "预发布兼容收敛" not in compatibility:
        raise ValueError("docs/compatibility.md must classify Core 0.1.0-alpha.1")
    if "Core `0.1.0-alpha.2`" not in compatibility or "预发布兼容新增" not in compatibility:
        raise ValueError("docs/compatibility.md must classify Core 0.1.0-alpha.2")
    if "Core `0.1.0-alpha.3`" not in compatibility or "预发布兼容收敛（未实现表面）" not in compatibility:
        raise ValueError("docs/compatibility.md must classify Core 0.1.0-alpha.3")
    if (
        "Core `0.1.0-alpha.4`" not in compatibility
        or "预发布兼容新增（只读余额）" not in compatibility
    ):
        raise ValueError(
            "docs/compatibility.md must classify Core 0.1.0-alpha.4 as a read-only compatible addition"
        )
    if (
        "Core `0.1.0-alpha.5`" not in compatibility
        or "预发布兼容新增（服务事件投递）" not in compatibility
    ):
        raise ValueError(
            "docs/compatibility.md must classify Core 0.1.0-alpha.5 as a service event delivery addition"
        )
    if (
        "Core `0.1.0-alpha.6`" not in compatibility
        or "预发布兼容新增（公开资料与资料名编辑）" not in compatibility
    ):
        raise ValueError(
            "docs/compatibility.md must classify Core 0.1.0-alpha.6 as a public profile addition"
        )
    if (
        "Core `0.1.0-alpha.7`" not in compatibility
        or "预发布兼容新增（注销权利端点）" not in compatibility
    ):
        raise ValueError(
            "docs/compatibility.md must classify Core 0.1.0-alpha.7 as a deactivation rights addition"
        )
    if (
        "Community `0.1.0-alpha.3`" not in compatibility
        or "预发布兼容新增（匿名内联预览）" not in compatibility
    ):
        raise ValueError(
            "docs/compatibility.md must classify Community 0.1.0-alpha.3 as an anonymous inline preview addition"
        )
    if (
        "Core `0.1.0-alpha.9`" not in compatibility
        or "预发布兼容新增（管理员只读查询面）" not in compatibility
    ):
        raise ValueError(
            "docs/compatibility.md must classify Core 0.1.0-alpha.9 as an admin read-only query addition"
        )


def validate_community_prerelease(document: dict[str, Any]) -> None:
    if document["info"]["version"] != "0.1.0-alpha.4":
        raise ValueError("community.yaml must lock 0.1.0-alpha.4")
    operations = {operation["operationId"]: operation for _, _, operation in iter_operations(document)}
    expected = {"createUploadSession", "completeUploadSession", "listResources", "listAuthorResources",
                "createResource", "getResource", "unpublishResource", "createResourceVersion",
                "publishResource", "downloadResourceVersion", "previewResourceVersion", "reviewResourceVersion"}
    if set(operations) != expected:
        raise ValueError("Community alpha.4 operation set drift")
    upload = operations["createUploadSession"]["requestBody"]["content"]["application/json"]["schema"]
    if upload["additionalProperties"] is not False or upload["properties"]["size_bytes"].get("maximum") != 1048576:
        raise ValueError("Community uploads must be closed objects capped at 1 MiB")
    for name, scope in (("createUploadSession", "upload:write"), ("completeUploadSession", "upload:write"),
                        ("createResource", "resource:write"), ("createResourceVersion", "resource:write"),
                        ("publishResource", "resource:write"), ("unpublishResource", "resource:write"),
                        ("reviewResourceVersion", "moderation:review")):
        op = operations[name]
        if op["security"] != [{"userOAuth": [scope, "profile:read"]}]:
            raise ValueError(f"{name} must require userOAuth {scope}")
        if not any(p.get("$ref") == "#/components/parameters/IdempotencyKey" for p in op.get("parameters", [])):
            raise ValueError(f"{name} must require Idempotency-Key")
        if not {"400", "401", "403", "409", "503"}.issubset(op["responses"]):
            raise ValueError(f"{name} is missing bounded error semantics")
    for name in ("listResources", "listAuthorResources", "downloadResourceVersion", "previewResourceVersion"):
        if operations[name]["security"] != []:
            raise ValueError(f"{name} must allow anonymous published reads")
    review = operations["reviewResourceVersion"]
    body = review["requestBody"]["content"]["application/json"]["schema"]
    if (body.get("required") != ["decision"] or body.get("additionalProperties") is not False
            or set(body["properties"]) != {"decision", "reason"}
            or body["properties"]["decision"].get("enum") != ["approve", "reject"]
            or body["properties"]["reason"].get("maxLength") != 1000):
        raise ValueError("Manual review must keep its closed ADR-0016 request")
    if not {"200", "404", "429"}.issubset(review["responses"]):
        raise ValueError("Manual review must lock response/state errors")
    if "Community `0.1.0-alpha.4`" not in (ROOT / "docs/compatibility.md").read_text(encoding="utf-8"):
        raise ValueError("Manual review compatibility classification missing")
    preview = operations["previewResourceVersion"]
    if "requestBody" in preview:
        raise ValueError("previewResourceVersion must be bodyless")
    if set(preview["responses"]["200"]["content"]) != {"image/png"}:
        raise ValueError("Community previews must stream PNG bytes")
    if not {"400", "404", "429", "503"}.issubset(preview["responses"]):
        raise ValueError("previewResourceVersion is missing bounded error semantics")
    if "404" not in operations["downloadResourceVersion"]["responses"]:
        raise ValueError("Community downloads must keep 404 semantics")
    for name in ("completeUploadSession", "publishResource", "unpublishResource"):
        if "requestBody" in operations[name]:
            raise ValueError(f"{name} must not accept unapproved command fields")
    if "content" in operations["unpublishResource"]["responses"]["204"]:
        raise ValueError("Community unpublish 204 must be bodyless")
    if set(operations["downloadResourceVersion"]["responses"]["200"]["content"]) != {"image/png"}:
        raise ValueError("Community downloads must be PNG bytes")
    if "upload_headers" not in document["components"]["schemas"]["UploadSession"]["required"]:
        raise ValueError("UploadSession must tell clients the signed upload headers")
    limits = document["components"]["parameters"]["Limit"]["schema"]
    if (limits.get("minimum"), limits.get("maximum"), limits.get("default")) != (1, 100, 20):
        raise ValueError("Community page limit drift")
    validator_for(upload)(upload).validate(json.loads(
        (ROOT / "examples/community/create-upload.json").read_text(encoding="utf-8")))
    completed = document["components"]["schemas"]["CompletedUpload"]
    validator_for(completed)(completed).validate(json.loads(
        (ROOT / "examples/community/complete-upload.json").read_text(encoding="utf-8")))


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
        elif source.name == "community.yaml":
            validate_community_prerelease(document)

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
