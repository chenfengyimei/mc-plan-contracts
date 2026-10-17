import type { components, operations } from './generated/skin-api.js';
import { validateIdempotencyKey } from './idempotency.js';
import { McPlanProblemError, McPlanUnexpectedResponseError, parseProblem } from './problem.js';
import { transportSend, type TransportOptions, type TransportResult } from './transport.js';

// ---------------------------------------------------------------------------
// Public contract types (all derived from the generated locked contract)
// ---------------------------------------------------------------------------

export type Conversation = components['schemas']['Conversation'];
export type ConversationDetail = components['schemas']['ConversationDetail'];
export type ConversationMessage = ConversationDetail['messages'][number];
export type JobAccepted = components['schemas']['JobAccepted'];
export type Job = components['schemas']['Job'];
export type CreateConversationRequest =
  operations['createConversation']['requestBody']['content']['application/json'];
export type CreateRenderRequest =
  operations['createRender']['requestBody']['content']['application/json'];
export type FinalizeSkinRequest =
  operations['finalizeSkin']['requestBody']['content']['application/json'];

/** Verified 64x64 PNG bytes returned by getCandidatePreview and downloadSkin. */
export interface SkinPng {
  /** Exact PNG bytes streamed by the producer, validated to carry a 64x64 IHDR. */
  bytes: Uint8Array;
  /** Content-Type reported by the producer; the locked contract declares image/png. */
  mediaType: string;
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface McPlanSkinClientOptions extends TransportOptions {
  /** Base URL of the Skin API, for example `https://skin-api.example.com` (no default is invented). */
  baseUrl: string;
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

function validateMessage(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4000) {
    throw new RangeError(`${field} must be a string of 1..4000 characters (locked contract range)`);
  }
}

/**
 * Assert the bytes carry the PNG magic and a 64x64 IHDR exactly as the
 * locked contract states for candidate previews and finalized skins.
 */
function assertSkinPng64(bytes: Uint8Array): void {
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const hasIhdr =
    bytes.length >= 24 &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52;
  const width = hasIhdr
    ? (((bytes[16] ?? 0) << 24) |
        ((bytes[17] ?? 0) << 16) |
        ((bytes[18] ?? 0) << 8) |
        (bytes[19] ?? 0)) >>>
      0
    : 0;
  const height = hasIhdr
    ? (((bytes[20] ?? 0) << 24) |
        ((bytes[21] ?? 0) << 16) |
        ((bytes[22] ?? 0) << 8) |
        (bytes[23] ?? 0)) >>>
      0
    : 0;
  if (!isPng || width !== 64 || height !== 64) {
    throw new TypeError(
      'Skin producer returned bytes that are not a 64x64 PNG (locked contract violation)',
    );
  }
}

/**
 * Producer-verified client for the eight supported Skin 0.1.0-alpha.1
 * operations. Every method maps 1:1 to a locked operationId; see
 * SUPPORTED_OPERATIONS. The Standalone surface is the ADR-0012 anonymous
 * window: there is NO credential object model, the client takes no token
 * providers and never sends credential headers. All three mutations declare
 * a required Idempotency-Key (8..200 characters): retries replay the exact
 * same key and request, so a same-key/same-request replay returns the
 * original recorded response while a same-key/different-request is rejected
 * 409 SKIN_IDEMPOTENCY_CONFLICT by the producer.
 */
export class McPlanSkinClient {
  private readonly baseUrl: string;
  private readonly options: Omit<McPlanSkinClientOptions, 'baseUrl'>;

  public constructor(options: McPlanSkinClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    const { baseUrl: _ignoredBaseUrl, ...rest } = options;
    void _ignoredBaseUrl;
    this.options = rest;
  }

  // -- Conversations ---------------------------------------------------------

  /**
   * Start a skin creation conversation and reserve one creation session
   * (201). The conversation identifier is the unguessable anonymous-window
   * address; retain it to render, finalize, read, download and delete.
   */
  public async createConversation(
    body: CreateConversationRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<Conversation> {
    validateMessage(body?.initial_message, 'initial_message');
    return this.command<Conversation>(
      'POST',
      '/v1/conversations',
      { initial_message: body.initial_message },
      idempotencyKey,
      { signal },
    );
  }

  /**
   * Request the next candidate render within the session attempt limit
   * (202, JobAccepted). Poll getJob with the returned job_id until it
   * reaches a terminal status; a succeeded render exposes candidate_id.
   * Exceeding the attempt limit answers 409 SKIN_ATTEMPTS_EXHAUSTED.
   */
  public async createRender(
    conversationId: string,
    body: CreateRenderRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<JobAccepted> {
    validateMessage(body?.message, 'message');
    if (
      body?.preferred_arm_model !== undefined &&
      body.preferred_arm_model !== 'steve' &&
      body.preferred_arm_model !== 'alex'
    ) {
      throw new RangeError("preferred_arm_model must be 'steve' or 'alex' when present");
    }
    const payload =
      body.preferred_arm_model === undefined
        ? { message: body.message }
        : { message: body.message, preferred_arm_model: body.preferred_arm_model };
    return this.command<JobAccepted>(
      'POST',
      `/v1/conversations/${encodePathSegment(conversationId)}/renders`,
      payload,
      idempotencyKey,
      { signal },
    );
  }

  /**
   * Confirm a candidate as the final standards-compliant skin (202,
   * JobAccepted). Only an active conversation with a valid candidate can
   * finalize; poll getJob until succeeded, which exposes the resource_id
   * used by downloadSkin.
   */
  public async finalizeSkin(
    conversationId: string,
    body: FinalizeSkinRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<JobAccepted> {
    if (typeof body?.candidate_id !== 'string' || body.candidate_id.length < 1) {
      throw new TypeError('finalizeSkin requires a non-empty candidate_id');
    }
    if (typeof body?.title !== 'string' || body.title.length < 1 || body.title.length > 120) {
      throw new RangeError('finalizeSkin requires a title string of 1..120 characters');
    }
    if (typeof body?.description !== 'string' || body.description.length > 4000) {
      throw new RangeError('finalizeSkin requires a description string of at most 4000 characters');
    }
    return this.command<JobAccepted>(
      'POST',
      `/v1/conversations/${encodePathSegment(conversationId)}/finalize`,
      { candidate_id: body.candidate_id, title: body.title, description: body.description },
      idempotencyKey,
      { signal },
    );
  }

  /**
   * Return the conversation detail including the message history (200).
   * Unknown, expired or deleted conversations answer 404 without revealing
   * retention details.
   */
  public async getConversation(
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<ConversationDetail> {
    return this.getJson<ConversationDetail>(
      `/v1/conversations/${encodePathSegment(conversationId)}`,
      signal,
    );
  }

  /**
   * Delete the conversation and cascade its messages, candidates and bytes
   * immediately (204, resolves to void). Idempotent within the retention
   * sweep: unknown, expired or already-deleted conversations answer 404.
   */
  public async deleteConversation(conversationId: string, signal?: AbortSignal): Promise<void> {
    const headers = new Headers({ Accept: 'application/json' });
    const response = await transportSend(
      {
        method: 'DELETE',
        url: `${this.baseUrl}/v1/conversations/${encodePathSegment(conversationId)}`,
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

  // -- Jobs --------------------------------------------------------------------

  /**
   * Return render or finalization job status (200). Unknown jobs answer
   * 404. A succeeded render job carries candidate_id; a succeeded finalize
   * job carries resource_id for downloadSkin.
   */
  public async getJob(jobId: string, signal?: AbortSignal): Promise<Job> {
    return this.getJson<Job>(`/v1/jobs/${encodePathSegment(jobId)}`, signal);
  }

  // -- Bytes ---------------------------------------------------------------------

  /**
   * Return the 64x64 candidate preview PNG bytes (200). Candidates are
   * retained for 24 hours and are removed by the conversation-level delete;
   * unknown, expired or deleted candidates answer 404 without distinguishing
   * the reason.
   */
  public async getCandidatePreview(
    conversationId: string,
    candidateId: string,
    signal?: AbortSignal,
  ): Promise<SkinPng> {
    return this.pngBytes(
      `/v1/conversations/${encodePathSegment(conversationId)}/candidates/${encodePathSegment(candidateId)}/preview`,
      signal,
    );
  }

  /**
   * Return the finalized 64x64 skin PNG bytes (200). The download is bounded
   * by the conversation retention window and is removed by the
   * conversation-level delete; unknown, expired or deleted resources answer
   * 404 without distinguishing the reason.
   */
  public async downloadSkin(
    conversationId: string,
    resourceId: string,
    signal?: AbortSignal,
  ): Promise<SkinPng> {
    return this.pngBytes(
      `/v1/conversations/${encodePathSegment(conversationId)}/skins/${encodePathSegment(resourceId)}/download`,
      signal,
    );
  }

  // -- internals ----------------------------------------------------------------

  private async getJson<T>(path: string, signal: AbortSignal | undefined): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' });
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

  private async pngBytes(path: string, signal: AbortSignal | undefined): Promise<SkinPng> {
    const headers = new Headers({ Accept: 'image/png' });
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
      const bytes = new Uint8Array(await response.arrayBuffer());
      assertSkinPng64(bytes);
      return { bytes, mediaType: response.headers.get('content-type') ?? '' };
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
    const headers = new Headers({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    });
    const response = await transportSend(
      {
        method,
        url: `${this.baseUrl}${path}`,
        headers: Object.fromEntries(headers.entries()),
        body: JSON.stringify(body),
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
export function createMcPlanSkinClient(options: McPlanSkinClientOptions): McPlanSkinClient {
  return new McPlanSkinClient(options);
}
