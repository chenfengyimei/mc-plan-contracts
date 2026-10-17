import type { components, operations } from './generated/core-api.js';
import { validateIdempotencyKey } from './idempotency.js';
import { McPlanProblemError, McPlanUnexpectedResponseError, parseProblem } from './problem.js';
import { transportSend, type TransportOptions, type TransportResult } from './transport.js';

// ---------------------------------------------------------------------------
// Public contract types (all derived from the generated locked contract)
// ---------------------------------------------------------------------------

export type PublicActor = components['schemas']['actor'];
export type DeveloperApp = components['schemas']['developer-app'];
export type DeveloperAppCreated = components['schemas']['developer-app-created'];
export type PersonalAccessToken = components['schemas']['personal-access-token'];
export type PersonalAccessTokenCreated = components['schemas']['personal-access-token-created'];
export type EntitlementBalance = components['schemas']['entitlement'];
export type CreditBalance = components['schemas']['credit-balance'];
export type ConsumptionResult = components['schemas']['ConsumptionResult'];
export type CreateDeveloperAppRequest = components['schemas']['CreateDeveloperAppRequest'];
export type ApproveDeveloperAppScopesRequest =
  components['schemas']['ApproveDeveloperAppScopesRequest'];
export type CreatePersonalAccessTokenRequest =
  components['schemas']['CreatePersonalAccessTokenRequest'];
export type ConsumeCreditsRequest =
  operations['consumeCredits']['requestBody']['content']['application/json'];
export type DeveloperAppList =
  operations['listDeveloperApps']['responses']['200']['content']['application/json'];
export type PersonalAccessTokenList =
  operations['listPersonalAccessTokens']['responses']['200']['content']['application/json'];
export type EntitlementList =
  operations['listCurrentEntitlements']['responses']['200']['content']['application/json'];
export type EventPage =
  operations['listDeliveredEvents']['responses']['200']['content']['application/json'];
/** One locked event envelope as delivered on the pull surface. */
export type EventEnvelope = EventPage['items'][number];
export type EventAcknowledgment =
  operations['acknowledgeEvents']['responses']['200']['content']['application/json'];
export type EventAcknowledgmentRequest =
  operations['acknowledgeEvents']['requestBody']['content']['application/json'];
export type UpdateCurrentUserRequest =
  operations['updateCurrentUser']['requestBody']['content']['application/json'];
export type AdminUserPage =
  operations['listAdminUsers']['responses']['200']['content']['application/json'];
export type AdminUser =
  operations['getAdminUser']['responses']['200']['content']['application/json'];
export type AdminCreditLedgerPage =
  operations['listAdminCreditLedger']['responses']['200']['content']['application/json'];
export type AdminEntitlementRecordPage =
  operations['listAdminEntitlementRecords']['responses']['200']['content']['application/json'];
export type AdminAuditRecordPage =
  operations['listAdminAuditRecords']['responses']['200']['content']['application/json'];
export type AdminOutboxRecordPage =
  operations['listAdminOutboxRecords']['responses']['200']['content']['application/json'];

/** Result envelope for consumeCredits: 201 means a fresh consumption, 200 an idempotent replay. */
export interface ConsumptionCall {
  data: ConsumptionResult;
  /** True when the producer answered 200 (recorded idempotent replay of the same key + request). */
  replayed: boolean;
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export type MaybePromise<T> = T | Promise<T>;

export interface McPlanCoreClientOptions extends TransportOptions {
  /** Base URL of the Core API, for example `https://core.example.com` (no default is invented). */
  baseUrl: string;
  /**
   * Bearer token provider for user-facing operations (browser PKCE OIDC
   * access token or a personal access token). The SDK never acquires,
   * stores or refreshes credentials itself.
   */
  getUserToken?: () => MaybePromise<string | null | undefined>;
  /**
   * Bearer token provider for service-to-service operations
   * (client-credentials token with credits:consume). Never persist the
   * client secret inside the SDK.
   */
  getServiceToken?: () => MaybePromise<string | null | undefined>;
}

function normalizeBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError(`baseUrl must be an http(s) URL, got: ${baseUrl}`);
  }
  return baseUrl.replace(/\/+$/, '');
}

function encodePathSegment(value: string): string {
  const encoded = encodeURIComponent(value);
  if (encoded.length === 0) {
    throw new RangeError('path parameters must not be empty');
  }
  return encoded;
}

/**
 * Producer-verified client for the twenty-three supported Core 0.1.0-alpha.9
 * operations. Every method maps 1:1 to a locked operationId; see
 * SUPPORTED_OPERATIONS.
 */
export class McPlanCoreClient {
  private readonly baseUrl: string;
  private readonly options: Omit<McPlanCoreClientOptions, 'baseUrl'>;

  public constructor(options: McPlanCoreClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    const { baseUrl: _ignoredBaseUrl, ...rest } = options;
    void _ignoredBaseUrl;
    this.options = rest;
  }

  // -- Profile --------------------------------------------------------------

  public async getCurrentUser(signal?: AbortSignal): Promise<PublicActor> {
    return this.getJson('/v1/me', 'user', signal);
  }

  /**
   * Public creator profile read (prerelease). The locked surface has NO
   * authentication: the request must not carry any credential header, and
   * unknown, malformed, or non-ACTIVE identifiers all answer 404 without
   * disclosing existence or account state. The SDK therefore requires no
   * token provider on this client for this call.
   */
  public async getPublicUser(userId: string, signal?: AbortSignal): Promise<PublicActor> {
    const headers = new Headers({ Accept: 'application/json' });
    const response = await transportSend(
      {
        method: 'GET',
        url: `${this.baseUrl}/v1/users/${encodePathSegment(userId)}`,
        headers: Object.fromEntries(headers.entries()),
        signal,
        idempotent: true,
      },
      this.options,
    );
    if (response.status >= 200 && response.status < 300) {
      return (await response.json()) as PublicActor;
    }
    throw await problemFromResponse(response);
  }

  /**
   * Edit the calling user's public display name (prerelease). The body must
   * carry ONLY display_name (1..80 characters); personal access tokens can
   * never obtain profile:write, so this always requires an OIDC user token.
   * Not retried automatically: an edit is not an idempotent replay.
   */
  public async updateCurrentUser(
    body: UpdateCurrentUserRequest,
    signal?: AbortSignal,
  ): Promise<PublicActor> {
    if (
      typeof body?.display_name !== 'string' ||
      body.display_name.length < 1 ||
      body.display_name.length > 80
    ) {
      throw new TypeError('updateCurrentUser requires a display_name string of 1..80 characters');
    }
    return this.sendJson('PATCH', '/v1/me', { display_name: body.display_name }, 'user', {
      idempotent: false,
      signal,
    });
  }

  /**
   * Deactivate (close) the calling user's own account (prerelease). The
   * locked surface carries NO request body and answers 204 with NO response
   * body, so this method resolves to void without parsing the response.
   * Personal access tokens can never obtain profile:write, so only an
   * interactive OIDC user token can deactivate. The call is NOT retried
   * automatically: a timeout or a dropped connection must never fire a
   * second deactivation request. After a successful deactivation the
   * business account is CLOSED and every later authenticated call -
   * including a repeated deactivation with the same token - rejects with
   * the locked 403 ACCOUNT_UNAVAILABLE problem; the SDK never turns that
   * repeat into an idempotent success.
   */
  public async deactivateCurrentUser(signal?: AbortSignal): Promise<void> {
    const headers = await this.authHeaders('user');
    // No request body is declared by the locked contract, so no media type
    // header is sent either.
    headers.delete('Content-Type');
    const response = await transportSend(
      {
        method: 'POST',
        url: `${this.baseUrl}/v1/me/deactivation`,
        headers: Object.fromEntries(headers.entries()),
        signal,
        idempotent: false,
      },
      this.options,
    );
    if (response.status === 204) {
      return;
    }
    throw await problemFromResponse(response);
  }

  // -- Developer Apps --------------------------------------------------------

  public async createDeveloperApp(
    body: CreateDeveloperAppRequest,
    signal?: AbortSignal,
  ): Promise<DeveloperAppCreated> {
    return this.postJson('/v1/developer-apps', body, 'user', { idempotent: false, signal });
  }

  public async listDeveloperApps(signal?: AbortSignal): Promise<DeveloperAppList> {
    return this.getJson('/v1/developer-apps', 'user', signal);
  }

  public async getDeveloperApp(appId: string, signal?: AbortSignal): Promise<DeveloperApp> {
    return this.getJson(`/v1/developer-apps/${encodePathSegment(appId)}`, 'user', signal);
  }

  public async approveDeveloperAppScopes(
    appId: string,
    body: ApproveDeveloperAppScopesRequest,
    signal?: AbortSignal,
  ): Promise<DeveloperApp> {
    return this.sendJson('PATCH', `/v1/developer-apps/${encodePathSegment(appId)}`, body, 'user', {
      idempotent: false,
      signal,
    });
  }

  public async revokeDeveloperApp(appId: string, signal?: AbortSignal): Promise<DeveloperApp> {
    return this.sendJson(
      'DELETE',
      `/v1/developer-apps/${encodePathSegment(appId)}`,
      undefined,
      'user',
      { idempotent: false, signal },
    );
  }

  // -- Personal Access Tokens ------------------------------------------------

  public async createPersonalAccessToken(
    body: CreatePersonalAccessTokenRequest,
    signal?: AbortSignal,
  ): Promise<PersonalAccessTokenCreated> {
    return this.postJson('/v1/personal-access-tokens', body, 'user', {
      idempotent: false,
      signal,
    });
  }

  public async listPersonalAccessTokens(signal?: AbortSignal): Promise<PersonalAccessTokenList> {
    return this.getJson('/v1/personal-access-tokens', 'user', signal);
  }

  public async revokePersonalAccessToken(
    tokenId: string,
    signal?: AbortSignal,
  ): Promise<PersonalAccessToken> {
    return this.sendJson(
      'DELETE',
      `/v1/personal-access-tokens/${encodePathSegment(tokenId)}`,
      undefined,
      'user',
      { idempotent: false, signal },
    );
  }

  // -- Entitlements / Credits -------------------------------------------------

  public async listCurrentEntitlements(signal?: AbortSignal): Promise<EntitlementList> {
    return this.getJson('/v1/entitlements', 'user', signal);
  }

  public async getCreditBalance(signal?: AbortSignal): Promise<CreditBalance> {
    return this.getJson('/v1/credits/balance', 'user', signal);
  }

  /**
   * Consume one daily entitlement unit for an authorized module operation.
   * The same Idempotency-Key with the same request replays the recorded
   * result (200); a fresh consumption answers 201. Retries — if any —
   * always reuse the same key.
   */
  public async consumeCredits(
    body: ConsumeCreditsRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ConsumptionCall> {
    const key = validateIdempotencyKey(idempotencyKey);
    const headers = await this.authHeaders('service');
    headers.set('Idempotency-Key', key);
    const response = await transportSend(
      {
        method: 'POST',
        url: `${this.baseUrl}/v1/credits/consume`,
        headers: Object.fromEntries(headers.entries()),
        body: JSON.stringify(body),
        signal,
        idempotent: true,
      },
      this.options,
    );
    if (response.status === 200 || response.status === 201) {
      const data = (await response.json()) as ConsumptionResult;
      return { data, replayed: response.status === 200 };
    }
    throw await problemFromResponse(response);
  }

  // -- Events (service-only consumer-pull delivery) --------------------------

  /**
   * Pull the oldest unacknowledged delivered events for this service
   * consumer in publish order. Delivery is at-least-once: the same events
   * keep returning until acknowledged, so consumers must deduplicate by the
   * locked envelope's event_id. A caught-up consumer receives an empty
   * items array and a null next_cursor. The SDK never invents a cursor; the
   * cursor from the response goes straight to acknowledgeEvents.
   */
  public async listDeliveredEvents(
    options: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<EventPage> {
    const url = new URL(`${this.baseUrl}/v1/events`);
    if (options.limit !== undefined) {
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 200) {
        throw new RangeError('limit must be an integer between 1 and 200 (locked contract range)');
      }
      url.searchParams.set('limit', String(options.limit));
    }
    const headers = await this.authHeaders('service');
    const response = await transportSend(
      {
        method: 'GET',
        url: url.toString(),
        headers: Object.fromEntries(headers.entries()),
        signal: options.signal,
        idempotent: true,
      },
      this.options,
    );
    if (response.status >= 200 && response.status < 300) {
      return (await response.json()) as EventPage;
    }
    throw await problemFromResponse(response);
  }

  /**
   * Acknowledge every delivered event up to and including the cursor's
   * delivery position for this consumer. Idempotent: re-acknowledging an
   * already-acknowledged cursor returns the current acknowledged position.
   * The cursor must come from this consumer's own listDeliveredEvents page;
   * unknown, malformed, or foreign cursors are rejected as 400 problems by
   * the producer.
   */
  public async acknowledgeEvents(
    body: EventAcknowledgmentRequest,
    signal?: AbortSignal,
  ): Promise<EventAcknowledgment> {
    if (typeof body?.cursor !== 'string' || body.cursor.length === 0 || body.cursor.length > 512) {
      throw new TypeError('acknowledgeEvents requires a cursor string of 1..512 characters');
    }
    return this.postJson('/v1/events/acknowledgments', { cursor: body.cursor }, 'service', {
      idempotent: true,
      signal,
    });
  }

  // -- Admin read-only queries (ADR-0018 admin:read, user token only) --------

  /**
   * List MC Plan business users newest first with opaque cursor pagination
   * (ADR-0018 read-only admin surface). Requires a realm-designated
   * administrator OIDC user token carrying admin:read plus the ADMIN business
   * role on an ACTIVE account; personal access tokens can never obtain
   * admin:read. The field-closed page never includes identity emails, OIDC
   * subjects or issuer claims.
   */
  public async listAdminUsers(
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<AdminUserPage> {
    return this.getJson(this.adminPagePath('/v1/admin/users', options), 'user', options.signal);
  }

  /**
   * Return one MC Plan business user's administrative view: public display
   * name, business status and role, timestamps, non-negative credit balance
   * and linked identity / developer app / personal access token counts.
   * Unknown or malformed identifiers answer the locked 404 without
   * disclosing existence.
   */
  public async getAdminUser(userId: string, signal?: AbortSignal): Promise<AdminUser> {
    return this.getJson(`/v1/admin/users/${encodePathSegment(userId)}`, 'user', signal);
  }

  /**
   * List one user's immutable credit ledger entries newest first, including
   * the recorded reason and actor id (manual-adjustment audit extension).
   * Strictly read-only: the call never creates accounts, ledger entries,
   * audit records or outbox records.
   */
  public async listAdminCreditLedger(
    userId: string,
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<AdminCreditLedgerPage> {
    return this.getJson(
      this.adminPagePath(`/v1/admin/users/${encodePathSegment(userId)}/credit-ledger`, options),
      'user',
      options.signal,
    );
  }

  /**
   * List one user's materialized daily entitlement records newest first
   * (policy module, operation, policy date, granted/consumed units).
   * Strictly read-only: entitlements materialize only on real consumption.
   */
  public async listAdminEntitlementRecords(
    userId: string,
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<AdminEntitlementRecordPage> {
    return this.getJson(
      this.adminPagePath(
        `/v1/admin/users/${encodePathSegment(userId)}/entitlement-records`,
        options,
      ),
      'user',
      options.signal,
    );
  }

  /**
   * List the immutable audit trail newest first with opaque cursor pagination
   * and an optional MC Plan user id filter. The metadata object is
   * action-specific and surfaced exactly as recorded. Strictly read-only.
   */
  public async listAdminAuditRecords(
    options: { limit?: number; cursor?: string; user_id?: string; signal?: AbortSignal } = {},
  ): Promise<AdminAuditRecordPage> {
    const path = this.adminPagePath('/v1/admin/audit', options);
    if (options.user_id === undefined) {
      return this.getJson(path, 'user', options.signal);
    }
    if (typeof options.user_id !== 'string' || options.user_id.length === 0) {
      throw new TypeError('user_id filter must be a non-empty MC Plan user id string');
    }
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('user_id', options.user_id);
    return this.getJson(`${url.pathname}${url.search}`, 'user', options.signal);
  }

  /**
   * List internal outbox delivery records newest first with opaque cursor
   * pagination and an optional delivery state filter, exposing event type,
   * delivery state, attempt count, delivery position and the bounded last
   * error exactly as recorded. Strictly read-only: never mutates delivery
   * state or consumer progress.
   */
  public async listAdminOutboxRecords(
    options: {
      limit?: number;
      cursor?: string;
      state?: 'PENDING' | 'PUBLISHED';
      signal?: AbortSignal;
    } = {},
  ): Promise<AdminOutboxRecordPage> {
    const path = this.adminPagePath('/v1/admin/outbox', options);
    if (options.state === undefined) {
      return this.getJson(path, 'user', options.signal);
    }
    if (options.state !== 'PENDING' && options.state !== 'PUBLISHED') {
      throw new RangeError("state must be 'PENDING' or 'PUBLISHED' (locked contract enum)");
    }
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set('state', options.state);
    return this.getJson(`${url.pathname}${url.search}`, 'user', options.signal);
  }

  // -- internals ---------------------------------------------------------------

  /**
   * Shared page-query builder for the admin read-only surfaces: limit is the
   * locked 1..100 integer, cursor is the opaque next_cursor passthrough
   * (1..512 characters). The SDK never invents cursors.
   */
  private adminPagePath(path: string, options: { limit?: number; cursor?: string }): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (options.limit !== undefined) {
      if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
        throw new RangeError('limit must be an integer between 1 and 100 (locked contract range)');
      }
      url.searchParams.set('limit', String(options.limit));
    }
    if (options.cursor !== undefined) {
      if (
        typeof options.cursor !== 'string' ||
        options.cursor.length === 0 ||
        options.cursor.length > 512
      ) {
        throw new TypeError('cursor must be the opaque next_cursor string of 1..512 characters');
      }
      url.searchParams.set('cursor', options.cursor);
    }
    return `${url.pathname}${url.search}`;
  }

  private async getJson<T>(
    path: string,
    auth: 'user' | 'service',
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const headers = await this.authHeaders(auth);
    const response = await transportSend(
      {
        method: 'GET',
        url: `${this.baseUrl}${path}`,
        headers: Object.fromEntries(headers.entries()),
        signal,
        idempotent: true,
      },
      this.options,
    );
    if (response.status >= 200 && response.status < 300) {
      return (await response.json()) as T;
    }
    throw await problemFromResponse(response);
  }

  private async postJson<T>(
    path: string,
    body: unknown,
    auth: 'user' | 'service',
    init: { idempotent: boolean; signal?: AbortSignal | undefined },
  ): Promise<T> {
    return this.sendJson('POST', path, body, auth, init);
  }

  private async sendJson<T>(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    auth: 'user' | 'service',
    init: { idempotent: boolean; signal?: AbortSignal | undefined },
  ): Promise<T> {
    const headers = await this.authHeaders(auth);
    const response = await transportSend(
      {
        method,
        url: `${this.baseUrl}${path}`,
        headers: Object.fromEntries(headers.entries()),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: init.signal,
        idempotent: init.idempotent,
      },
      this.options,
    );
    if (response.status >= 200 && response.status < 300) {
      return (await response.json()) as T;
    }
    throw await problemFromResponse(response);
  }

  private async authHeaders(auth: 'user' | 'service'): Promise<Headers> {
    const headers = new Headers({ Accept: 'application/json' });
    const provider = auth === 'user' ? this.options.getUserToken : this.options.getServiceToken;
    if (provider === undefined) {
      throw new Error(
        auth === 'user'
          ? 'McPlanCoreClient: user operations require a getUserToken provider (OIDC PKCE access token or personal access token); the SDK never handles credentials itself.'
          : 'McPlanCoreClient: service operations (consumeCredits, listDeliveredEvents, acknowledgeEvents) require a getServiceToken provider (client-credentials token with the required scope); keep the client secret out of the SDK.',
      );
    }
    const token = await provider();
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error(
        `McPlanCoreClient: the ${auth === 'user' ? 'user' : 'service'} token provider returned no token`,
      );
    }
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Content-Type', 'application/json');
    return headers;
  }
}

async function problemFromResponse(response: TransportResult): Promise<Error> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    payload = undefined;
  }
  const problem = parseProblem(payload);
  if (problem !== undefined) {
    return new McPlanProblemError(problem, response.status);
  }
  return new McPlanUnexpectedResponseError(response.status, text.slice(0, 200));
}

/** Convenience factory. */
export function createMcPlanCoreClient(options: McPlanCoreClientOptions): McPlanCoreClient {
  return new McPlanCoreClient(options);
}
