import { describe, expect, it } from 'vitest';

import { isKnownProblemCode, McPlanProblemError, parseProblem } from '../src/problem.js';

const lockedProblem = {
  type: '/problems/upload-invalid',
  title: 'Uploaded bytes are not a valid 64x64 PNG',
  status: 400,
  code: 'UPLOAD_INVALID',
  trace_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
};

describe('parseProblem', () => {
  it('parses a locked problem with the full field set', () => {
    const problem = parseProblem({
      ...lockedProblem,
      detail: 'sha256 mismatch',
      errors: [{ field: 'sha256', code: 'MISMATCH', message: 'nope' }],
    });
    expect(problem).toEqual({
      type: '/problems/upload-invalid',
      title: 'Uploaded bytes are not a valid 64x64 PNG',
      status: 400,
      code: 'UPLOAD_INVALID',
      trace_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
      detail: 'sha256 mismatch',
      errors: [{ field: 'sha256', code: 'MISMATCH', message: 'nope' }],
    });
    expect(problem !== undefined && isKnownProblemCode(problem.code)).toBe(true);
  });

  it('rejects payloads missing locked required fields', () => {
    expect(parseProblem(null)).toBeUndefined();
    expect(parseProblem('not-an-object')).toBeUndefined();
    expect(parseProblem({ title: 'x', status: 400, code: 'Y', trace_id: 't' })).toBeUndefined();
    expect(parseProblem({ ...lockedProblem, status: '400' })).toBeUndefined();
  });

  it('keeps unknown codes visible as strings', () => {
    const problem = parseProblem({ ...lockedProblem, code: 'SOMETHING_NEW' });
    expect(problem?.code).toBe('SOMETHING_NEW');
    expect(problem !== undefined && isKnownProblemCode(problem.code)).toBe(false);
  });

  it('knows every Community-locked problem code', () => {
    for (const code of [
      'AUTHENTICATION_REQUIRED',
      'INSUFFICIENT_SCOPE',
      'ACCOUNT_UNAVAILABLE',
      'VALIDATION_FAILED',
      'UPLOAD_INVALID',
      'NOT_FOUND',
      'IDEMPOTENCY_KEY_CONFLICT',
      'RESOURCE_STATE_CONFLICT',
      'UPLOAD_NOT_READY',
      'RATE_LIMITED',
      'DEPENDENCY_UNAVAILABLE',
    ]) {
      expect(isKnownProblemCode(code), code).toBe(true);
    }
    // Core-only codes are NOT part of the Community surface.
    expect(isKnownProblemCode('ENTITLEMENT_EXHAUSTED')).toBe(false);
    expect(isKnownProblemCode('ROLE_REQUIRED')).toBe(false);
  });

  it('exposes the problem on McPlanProblemError', () => {
    const problem = parseProblem(lockedProblem)!;
    const error = new McPlanProblemError(problem, 400);
    expect(error.name).toBe('McPlanProblemError');
    expect(error.httpStatus).toBe(400);
    expect(error.problem.trace_id).toBe('01HZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(error.message).toContain('UPLOAD_INVALID');
  });
});
