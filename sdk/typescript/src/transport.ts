/**
 * Injectable transport: caller-provided `fetch`, per-request timeout,
 * caller abort and bounded retries. Retries apply only to requests whose
 * operation is idempotent by contract (GETs and consumeCredits); the exact
 * same request, including the Idempotency-Key header, is replayed.
 */

export interface TransportRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  body?: string | undefined;
  /** Caller-provided abort signal. */
  signal?: AbortSignal | undefined;
  /** Whether the operation is idempotent by contract and may be retried. */
  idempotent: boolean;
}

export interface TransportOptions {
  fetchImpl?: typeof fetch;
  /** Request timeout in milliseconds (default 10 000). */
  timeoutMs?: number;
  /** Maximum retries per request for retryable failures (default 2, hard-capped at 4). */
  maxRetries?: number;
}

export const DEFAULT_TIMEOUT_MS = 10_000 as const;
export const MAX_RETRY_LIMIT = 4 as const;

/** The request exceeded the configured timeout. */
export class McPlanTimeoutError extends Error {
  public constructor(timeoutMs: number) {
    super(`Core request timed out after ${timeoutMs}ms`);
    this.name = 'McPlanTimeoutError';
  }
}

/** The caller aborted the request before completion. */
export class McPlanAbortError extends Error {
  public override readonly cause: unknown;

  public constructor(cause: unknown) {
    super('Core request was aborted by the caller');
    this.name = 'McPlanAbortError';
    this.cause = cause;
  }
}

/** A network-level failure (fetch rejected) that is not retried or exceeded retries. */
export class McPlanNetworkError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(`Core request failed at the network level: ${message}`);
    this.name = 'McPlanNetworkError';
    if (options !== undefined && 'cause' in options) {
      this.cause = options.cause;
    }
  }
}

export interface TransportResult {
  status: number;
  headers: Headers;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

const RETRYABLE_STATUSES: readonly number[] = [500, 502, 503, 504];

function combineAbortSignals(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timeoutSignal: AbortSignal } {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal =
    callerSignal === undefined ? timeoutSignal : AbortSignal.any([callerSignal, timeoutSignal]);
  return { signal, timeoutSignal };
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.includes(status);
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function transportSend(
  request: TransportRequest,
  options: TransportOptions = {},
): Promise<TransportResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = Math.min(options.maxRetries ?? 2, MAX_RETRY_LIMIT);
  if (fetchImpl === undefined) {
    throw new McPlanNetworkError('no fetch implementation available');
  }

  const { signal, timeoutSignal } = combineAbortSignals(request.signal, timeoutMs);
  let attempt = 0;

  for (;;) {
    try {
      const init: RequestInit = {
        method: request.method,
        headers: request.headers,
        signal,
      };
      if (request.body !== undefined) {
        init.body = request.body;
      }
      const response = await fetchImpl(request.url, init);

      if (isRetryableStatus(response.status) && request.idempotent && attempt < maxRetries) {
        // Drain the body so the connection can be reused before retrying.
        await response.arrayBuffer().catch(() => undefined);
        attempt += 1;
        await sleep(100 * attempt);
        continue;
      }
      return {
        status: response.status,
        headers: response.headers,
        text: () => response.text(),
        json: async () => {
          const raw = await response.text();
          return JSON.parse(raw) as unknown;
        },
      };
    } catch (error) {
      if (callerAborted(request.signal)) {
        throw new McPlanAbortError(error);
      }
      if (timeoutSignal.aborted) {
        throw new McPlanTimeoutError(timeoutMs);
      }
      if (request.idempotent && attempt < maxRetries) {
        attempt += 1;
        await sleep(100 * attempt);
        continue;
      }
      throw new McPlanNetworkError(error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    }
  }
}

function callerAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}
