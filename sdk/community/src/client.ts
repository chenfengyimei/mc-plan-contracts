import type { components, operations } from './generated/community-api.js';
import { validateIdempotencyKey } from './idempotency.js';
import { McPlanProblemError, McPlanUnexpectedResponseError, parseProblem } from './problem.js';
import { transportSend, type TransportOptions, type TransportResult } from './transport.js';

// ---------------------------------------------------------------------------
// Public contract types (all derived from the generated locked contract)
// ---------------------------------------------------------------------------

export type UploadSession = components['schemas']['UploadSession'];
export type ResourcePage = components['schemas']['ResourcePage'];
export type CompletedUpload = components['schemas']['CompletedUpload'];
export type CommunityResource = components['schemas']['resource'];
export type ResourceVersion = components['schemas']['resource-version'];
export type ResourceFile = components['schemas']['resource-file'];
export type LicenseSnapshot = components['schemas']['license-snapshot'];
export type SkinMetadata = components['schemas']['skin-metadata'];
export type CreateUploadSessionRequest =
  operations['createUploadSession']['requestBody']['content']['application/json'];
export type CreateResourceRequest =
  operations['createResource']['requestBody']['content']['application/json'];
export type CreateResourceVersionRequest =
  operations['createResourceVersion']['requestBody']['content']['application/json'];
export type ResourceDetail =
  operations['getResource']['responses']['200']['content']['application/json'];

/** Verified immutable PNG bytes returned by downloadResourceVersion. */
export interface DownloadedVersionFile {
  /** Exact verified PNG bytes streamed by the producer (sha256 matches files[0].sha256). */
  bytes: Uint8Array;
  /** Content-Type reported by the producer; the locked contract declares image/png. */
  mediaType: string;
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export type MaybePromise<T> = T | Promise<T>;

export interface McPlanCommunityClientOptions extends TransportOptions {
  /** Base URL of the Community API, for example `https://community.example.com` (no default is invented). */
  baseUrl: string;
  /**
   * Bearer token provider for the authenticated faces (browser PKCE OIDC
   * access token carrying the operation's scopes plus profile:read; the
   * token must be accepted by BOTH the Community and Core audiences per the
   * locked alpha.2 semantics). The SDK never acquires, stores or refreshes
   * credentials itself.
   */
  getUserToken?: () => MaybePromise<string | null | undefined>;
}

/** Locked upload size ceiling: 1 MiB (community.yaml size_bytes maximum). */
export const MAX_UPLOAD_SIZE_BYTES = 1_048_576 as const;

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

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function validateLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('limit must be an integer between 1 and 100 (locked contract range)');
  }
}

function validateCursor(cursor: string): void {
  if (cursor.length < 1 || cursor.length > 2048) {
    throw new RangeError('cursor must be 1..2048 characters (locked contract range)');
  }
}

/**
 * Producer-verified client for the ten supported Community 0.1.0-alpha.2
 * operations. Every method maps 1:1 to a locked operationId; see
 * SUPPORTED_OPERATIONS. All six mutations declare a required
 * Idempotency-Key (8..200 characters): retries replay the exact same key and
 * request, so a same-key/same-request replay returns the original recorded
 * response while a same-key/different-request is rejected 409
 * IDEMPOTENCY_KEY_CONFLICT by the producer.
 */
export class McPlanCommunityClient {
  private readonly baseUrl: string;
  private readonly options: Omit<McPlanCommunityClientOptions, 'baseUrl'>;

  public constructor(options: McPlanCommunityClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    const { baseUrl: _ignoredBaseUrl, ...rest } = options;
    void _ignoredBaseUrl;
    this.options = rest;
  }

  // -- Uploads ----------------------------------------------------------------

  /**
   * Create a short-lived direct upload session (201). The response carries a
   * signed PUT URL plus the exact headers the caller must replay verbatim
   * with the binary bytes (the caller supplies the declared byte length).
   * Same-key/same-request replay keeps the original URL and expiry; a new
   * key is required after expiry. The SDK never performs the S3 PUT itself.
   */
  public async createUploadSession(
    body: CreateUploadSessionRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<UploadSession> {
    if (body?.purpose !== 'resource_primary') {
      throw new TypeError('createUploadSession requires purpose "resource_primary"');
    }
    if (body?.media_type !== 'image/png') {
      throw new TypeError('createUploadSession requires media_type "image/png"');
    }
    if (
      typeof body?.size_bytes !== 'number' ||
      !Number.isInteger(body.size_bytes) ||
      body.size_bytes < 1 ||
      body.size_bytes > MAX_UPLOAD_SIZE_BYTES
    ) {
      throw new RangeError(
        `createUploadSession size_bytes must be an integer of 1..${MAX_UPLOAD_SIZE_BYTES} (1 MiB locked maximum)`,
      );
    }
    if (typeof body?.sha256 !== 'string' || !SHA256_PATTERN.test(body.sha256)) {
      throw new TypeError('createUploadSession requires a lowercase hex sha256 (64 characters)');
    }
    return this.command<UploadSession>('POST', '/v1/upload-sessions', body, idempotencyKey, {
      signal,
    });
  }

  /**
   * Verify and seal an owned upload (200, bodyless). The producer re-reads
   * the actual bytes and requires the exact declared size/SHA-256 plus a
   * decodable 64x64 PNG; missing bytes answer 409 UPLOAD_NOT_READY and
   * invalid bytes 400 UPLOAD_INVALID. A sealed upload can bind to only one
   * version.
   */
  public async completeUploadSession(
    uploadId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<CompletedUpload> {
    return this.command<CompletedUpload>(
      'POST',
      `/v1/upload-sessions/${encodePathSegment(uploadId)}/complete`,
      undefined,
      idempotencyKey,
      { signal },
    );
  }

  // -- Resources ----------------------------------------------------------------

  /** Create an owned skin resource container (201). */
  public async createResource(
    body: CreateResourceRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<CommunityResource> {
    if (body?.type !== 'skin') {
      throw new TypeError('createResource requires type "skin"');
    }
    if (typeof body?.title !== 'string' || body.title.length < 1 || body.title.length > 120) {
      throw new RangeError('createResource requires a title string of 1..120 characters');
    }
    if (typeof body?.description !== 'string' || body.description.length > 4000) {
      throw new RangeError(
        'createResource requires a description string of at most 4000 characters',
      );
    }
    return this.command<CommunityResource>('POST', '/v1/resources', body, idempotencyKey, {
      signal,
    });
  }

  /**
   * Attach a validated upload as an immutable resource version (202):
   * acceptance for validation and moderation, not publication. The sealed
   * upload must be owned by the resource author and the license must be an
   * explicitly configured approved license; metadata must match the actual
   * decoded layout. Same upload cannot bind twice.
   */
  public async createResourceVersion(
    resourceId: string,
    body: CreateResourceVersionRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<ResourceVersion> {
    if (typeof body?.upload_id !== 'string' || body.upload_id.length < 1) {
      throw new TypeError('createResourceVersion requires a non-empty upload_id');
    }
    if (typeof body?.version !== 'string' || body.version.length < 1 || body.version.length > 80) {
      throw new RangeError('createResourceVersion requires a version string of 1..80 characters');
    }
    if (body?.schema_version !== 1) {
      throw new TypeError('createResourceVersion requires schema_version 1');
    }
    if (typeof body?.metadata !== 'object' || body.metadata === null) {
      throw new TypeError('createResourceVersion requires a metadata object');
    }
    if (typeof body?.license_id !== 'string' || body.license_id.length < 1) {
      throw new TypeError('createResourceVersion requires a non-empty license_id');
    }
    return this.command<ResourceVersion>(
      'POST',
      `/v1/resources/${encodePathSegment(resourceId)}/versions`,
      body,
      idempotencyKey,
      { signal },
    );
  }

  /**
   * Request publication of the latest candidate version (202, bodyless).
   * 202 is acceptance, not approval: absent, timed-out or failed moderation
   * leaves the resource pending_moderation. Client assertions never
   * approve publication.
   */
  public async publishResource(
    resourceId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<CommunityResource> {
    return this.command<CommunityResource>(
      'POST',
      `/v1/resources/${encodePathSegment(resourceId)}/publish`,
      undefined,
      idempotencyKey,
      { signal },
    );
  }

  /**
   * Immediately unpublish an owned resource and schedule file cleanup
   * (204, bodyless, resolves to void). Unpublishing is terminal: it cannot
   * be reversed by late moderation jobs. Same-key replay and repeated owner
   * requests return 204 without duplicate audit or cleanup.
   */
  public async unpublishResource(
    resourceId: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const headers = await this.authHeaders();
    const key = validateIdempotencyKey(idempotencyKey);
    headers.set('Idempotency-Key', key);
    // The locked surface declares no request body, so no media type is sent.
    headers.delete('Content-Type');
    const response = await transportSend(
      {
        method: 'DELETE',
        url: `${this.baseUrl}/v1/resources/${encodePathSegment(resourceId)}`,
        headers: Object.fromEntries(headers.entries()),
        signal,
        idempotent: true,
      },
      this.options,
    );
    if (response.status === 204) {
      return;
    }
    throw await problemFromResponse(response);
  }

  /**
   * Get a published resource, or an owned non-public resource with the
   * authenticated owner view (200). By default the request is the locked
   * ANONYMOUS published read: no credential header is sent even when a user
   * token provider is configured, and only previously published versions are
   * returned. With `authenticated: true` the request carries the user token
   * (resource:read + profile:read) and the owner sees private candidate
   * versions; unknown or foreign non-public resources answer 404 without
   * exposing their state.
   */
  public async getResource(
    resourceId: string,
    options: { authenticated?: boolean; signal?: AbortSignal } = {},
  ): Promise<ResourceDetail> {
    const headers = new Headers({ Accept: 'application/json' });
    if (options.authenticated === true) {
      const authHeaders = await this.authHeaders();
      for (const [name, value] of authHeaders.entries()) {
        headers.set(name, value);
      }
    }
    const response = await transportSend(
      {
        method: 'GET',
        url: `${this.baseUrl}/v1/resources/${encodePathSegment(resourceId)}`,
        headers: Object.fromEntries(headers.entries()),
        signal: options.signal,
        idempotent: true,
      },
      this.options,
    );
    if (response.status >= 200 && response.status < 300) {
      return (await response.json()) as ResourceDetail;
    }
    throw await problemFromResponse(response);
  }

  /** List published resources (200, anonymous). Opaque cursors are bound to the resource type/author filter. */
  public async listResources(
    options: { limit?: number; cursor?: string; type?: 'skin'; signal?: AbortSignal } = {},
  ): Promise<ResourcePage> {
    const url = new URL(`${this.baseUrl}/v1/resources`);
    if (options.limit !== undefined) {
      validateLimit(options.limit);
      url.searchParams.set('limit', String(options.limit));
    }
    if (options.cursor !== undefined) {
      validateCursor(options.cursor);
      url.searchParams.set('cursor', options.cursor);
    }
    if (options.type !== undefined) {
      url.searchParams.set('type', options.type);
    }
    return this.getJson(url.toString(), options.signal);
  }

  /**
   * List an author's published resources (200, anonymous). User IDs are
   * opaque references; an unknown author returns an empty page.
   */
  public async listAuthorResources(
    userId: string,
    options: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
  ): Promise<ResourcePage> {
    const url = new URL(`${this.baseUrl}/v1/users/${encodePathSegment(userId)}/resources`);
    if (options.limit !== undefined) {
      validateLimit(options.limit);
      url.searchParams.set('limit', String(options.limit));
    }
    if (options.cursor !== undefined) {
      validateCursor(options.cursor);
      url.searchParams.set('cursor', options.cursor);
    }
    return this.getJson(url.toString(), options.signal);
  }

  /**
   * Download a published immutable skin version (200, anonymous). The
   * producer re-checks visibility on every request and streams the exact
   * verified PNG bytes with Content-Disposition attachment, nosniff, sandbox
   * CSP and Cache-Control no-store. The returned bytes hash to
   * version.files[0].sha256.
   */
  public async downloadResourceVersion(
    resourceId: string,
    versionId: string,
    signal?: AbortSignal,
  ): Promise<DownloadedVersionFile> {
    const headers = new Headers({ Accept: 'image/png' });
    const response = await transportSend(
      {
        method: 'GET',
        url: `${this.baseUrl}/v1/resources/${encodePathSegment(resourceId)}/versions/${encodePathSegment(versionId)}/download`,
        headers: Object.fromEntries(headers.entries()),
        signal,
        idempotent: true,
      },
      this.options,
    );
    if (response.status >= 200 && response.status < 300) {
      const buffer = await response.arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        mediaType: response.headers.get('content-type') ?? '',
      };
    }
    throw await problemFromResponse(response);
  }

  // -- internals ----------------------------------------------------------------

  private async getJson(url: string, signal: AbortSignal | undefined): Promise<ResourcePage> {
    const headers = new Headers({ Accept: 'application/json' });
    const response = await transportSend(
      {
        method: 'GET',
        url,
        headers: Object.fromEntries(headers.entries()),
        signal,
        idempotent: true,
      },
      this.options,
    );
    if (response.status >= 200 && response.status < 300) {
      return (await response.json()) as ResourcePage;
    }
    throw await problemFromResponse(response);
  }

  private async command<T>(
    method: 'POST',
    path: string,
    body: unknown,
    idempotencyKey: string,
    init: { signal?: AbortSignal | undefined },
  ): Promise<T> {
    const key = validateIdempotencyKey(idempotencyKey);
    const headers = await this.authHeaders();
    headers.set('Idempotency-Key', key);
    if (body === undefined) {
      // Bodyless commands (complete/publish) declare no request body, so no
      // media type header is sent either.
      headers.delete('Content-Type');
    }
    const response = await transportSend(
      {
        method,
        url: `${this.baseUrl}${path}`,
        headers: Object.fromEntries(headers.entries()),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: init.signal,
        idempotent: true,
      },
      this.options,
    );
    if (response.status >= 200 && response.status < 300) {
      return (await response.json()) as T;
    }
    throw await problemFromResponse(response);
  }

  private async authHeaders(): Promise<Headers> {
    const provider = this.options.getUserToken;
    if (provider === undefined) {
      throw new Error(
        'McPlanCommunityClient: authenticated operations require a getUserToken provider (browser PKCE OIDC access token with the operation scopes plus profile:read, accepted by both the Community and Core audiences); the SDK never handles credentials itself.',
      );
    }
    const token = await provider();
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('McPlanCommunityClient: the user token provider returned no token');
    }
    const headers = new Headers({ Accept: 'application/json' });
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
export function createMcPlanCommunityClient(
  options: McPlanCommunityClientOptions,
): McPlanCommunityClient {
  return new McPlanCommunityClient(options);
}
