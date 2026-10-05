/**
 * Problem Details (RFC 9457) typing for Core error responses.
 *
 * The shape follows `schemas/common/problem.json` in this repository. Known
 * `code` values are the stable machine-recognizable codes locked in
 * `openapi/core.yaml`; unknown codes still surface as strings so the SDK
 * never hides producer evolution, while `isKnownProblemCode` lets callers
 * narrow safely.
 */

export type KnownProblemCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'INSUFFICIENT_SCOPE'
  | 'ACCOUNT_UNAVAILABLE'
  | 'ROLE_REQUIRED'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'ENTITLEMENT_EXHAUSTED';

export interface ProblemFieldError {
  field: string;
  code: string;
  message?: string;
}

export interface McPlanProblem {
  /** URI reference identifying the problem type; producers currently send `about:blank`-style values. */
  type: string;
  title: string;
  /** HTTP status carried by the response body (400..599 per the locked schema). */
  status: number;
  code: string;
  trace_id: string;
  detail?: string;
  errors?: ProblemFieldError[];
}

const KNOWN_CODES: readonly string[] = [
  'AUTHENTICATION_REQUIRED',
  'INSUFFICIENT_SCOPE',
  'ACCOUNT_UNAVAILABLE',
  'ROLE_REQUIRED',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'IDEMPOTENCY_KEY_CONFLICT',
  'ENTITLEMENT_EXHAUSTED',
];

export function isKnownProblemCode(code: string): code is KnownProblemCode {
  return KNOWN_CODES.includes(code);
}

/**
 * Parse an unknown payload as a Problem Details object. Returns `undefined`
 * when the payload does not satisfy the locked required fields
 * (`type`, `title`, `status`, `code`, `trace_id`), so callers can fall back to
 * an unexpected-response error instead of inventing a problem.
 */
export function parseProblem(payload: unknown): McPlanProblem | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const candidate = payload as Record<string, unknown>;
  if (
    typeof candidate.type !== 'string' ||
    typeof candidate.title !== 'string' ||
    typeof candidate.status !== 'number' ||
    typeof candidate.code !== 'string' ||
    typeof candidate.trace_id !== 'string'
  ) {
    return undefined;
  }
  const problem: McPlanProblem = {
    type: candidate.type,
    title: candidate.title,
    status: candidate.status,
    code: candidate.code,
    trace_id: candidate.trace_id,
  };
  if (typeof candidate.detail === 'string') {
    problem.detail = candidate.detail;
  }
  if (Array.isArray(candidate.errors)) {
    problem.errors = candidate.errors
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .filter((item) => typeof item['field'] === 'string' && typeof item['code'] === 'string')
      .map((item) => {
        const error: ProblemFieldError = {
          field: item['field'] as string,
          code: item['code'] as string,
        };
        if (typeof item['message'] === 'string') {
          error.message = item['message'];
        }
        return error;
      });
  }
  return problem;
}

/** Error thrown for every non-2xx Core response that carries a Problem Details body. */
export class McPlanProblemError extends Error {
  public readonly problem: McPlanProblem;
  /** HTTP status of the raw response (equal to `problem.status` in practice). */
  public readonly httpStatus: number;

  public constructor(problem: McPlanProblem, httpStatus: number) {
    super(`Core request failed: ${problem.status} ${problem.code} (trace_id=${problem.trace_id})`);
    this.name = 'McPlanProblemError';
    this.problem = problem;
    this.httpStatus = httpStatus;
  }
}

/** Error thrown for a non-2xx response without a recognizable Problem Details body. */
export class McPlanUnexpectedResponseError extends Error {
  public readonly httpStatus: number;
  public readonly bodyPreview: string;

  public constructor(httpStatus: number, bodyPreview: string) {
    super(`Core returned an unexpected non-problem response (status ${httpStatus})`);
    this.name = 'McPlanUnexpectedResponseError';
    this.httpStatus = httpStatus;
    this.bodyPreview = bodyPreview;
  }
}
