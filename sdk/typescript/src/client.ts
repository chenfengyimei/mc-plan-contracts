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
 * Producer-verified client for the twelve supported Core 0.1.0-alpha.4
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

  // -- internals ---------------------------------------------------------------

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
          : 'McPlanCoreClient: consumeCredits requires a getServiceToken provider (client-credentials token with credits:consume); keep the client secret out of the SDK.',
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
