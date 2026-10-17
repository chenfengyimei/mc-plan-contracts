/**
 * Problem Details (RFC 9457) typing for Skin error responses.
 *
 * The shape follows `schemas/common/problem.json` in this repository. Known
 * `code` values are the ten producer-stable SKIN_* codes emitted by the
 * locked MCP-F1-SKIN-008/009 producer (skin main 14a8fe3); unknown codes
 * still surface as strings so the SDK never hides producer evolution, while
 * `isKnownProblemCode` lets callers narrow safely.
 */

export type KnownProblemCode =
  | 'SKIN_BAD_REQUEST'
  | 'SKIN_IDEMPOTENCY_CONFLICT'
  | 'SKIN_CONVERSATION_NOT_FOUND'
  | 'SKIN_CONVERSATION_NOT_ACTIVE'
  | 'SKIN_CONVERSATION_FINALIZING'
  | 'SKIN_ATTEMPTS_EXHAUSTED'
  | 'SKIN_CANDIDATE_NOT_FOUND'
  | 'SKIN_RESOURCE_NOT_FOUND'
  | 'SKIN_JOB_NOT_FOUND'
  | 'SKIN_INTERNAL';

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
  'SKIN_BAD_REQUEST',
  'SKIN_IDEMPOTENCY_CONFLICT',
  'SKIN_CONVERSATION_NOT_FOUND',
  'SKIN_CONVERSATION_NOT_ACTIVE',
  'SKIN_CONVERSATION_FINALIZING',
  'SKIN_ATTEMPTS_EXHAUSTED',
  'SKIN_CANDIDATE_NOT_FOUND',
  'SKIN_RESOURCE_NOT_FOUND',
  'SKIN_JOB_NOT_FOUND',
  'SKIN_INTERNAL',
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

/** Error thrown for every non-2xx Skin response that carries a Problem Details body. */
export class McPlanProblemError extends Error {
  public readonly problem: McPlanProblem;
  /** HTTP status of the raw response (equal to `problem.status` in practice). */
  public readonly httpStatus: number;

  public constructor(problem: McPlanProblem, httpStatus: number) {
    super(`Skin request failed: ${problem.status} ${problem.code} (trace_id=${problem.trace_id})`);
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
    super(`Skin producer returned an unexpected non-problem response (status ${httpStatus})`);
    this.name = 'McPlanUnexpectedResponseError';
    this.httpStatus = httpStatus;
    this.bodyPreview = bodyPreview;
  }
}
