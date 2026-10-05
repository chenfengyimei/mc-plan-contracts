import { describe, expect, it } from 'vitest';

import { isKnownProblemCode, McPlanProblemError, parseProblem } from '../src/problem.js';

const lockedProblem = {
  type: '/problems/insufficient-scope',
  title: 'Insufficient scope',
  status: 403,
  code: 'INSUFFICIENT_SCOPE',
  trace_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
};

describe('parseProblem', () => {
  it('parses a locked problem with the full field set', () => {
    const problem = parseProblem({
      ...lockedProblem,
      detail: 'credits:read is required',
      errors: [{ field: 'redirect_uris', code: 'INVALID_REDIRECT_URI', message: 'nope' }],
    });
    expect(problem).toEqual({
      type: '/problems/insufficient-scope',
      title: 'Insufficient scope',
      status: 403,
      code: 'INSUFFICIENT_SCOPE',
      trace_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
      detail: 'credits:read is required',
      errors: [{ field: 'redirect_uris', code: 'INVALID_REDIRECT_URI', message: 'nope' }],
    });
    expect(problem !== undefined && isKnownProblemCode(problem.code)).toBe(true);
  });

  it('rejects payloads missing locked required fields', () => {
    expect(parseProblem(null)).toBeUndefined();
    expect(parseProblem('not-an-object')).toBeUndefined();
    expect(parseProblem({ title: 'x', status: 400, code: 'Y', trace_id: 't' })).toBeUndefined();
    expect(parseProblem({ ...lockedProblem, status: '403' })).toBeUndefined();
  });

  it('keeps unknown codes visible as strings', () => {
    const problem = parseProblem({ ...lockedProblem, code: 'SOMETHING_NEW' });
    expect(problem?.code).toBe('SOMETHING_NEW');
    expect(problem !== undefined && isKnownProblemCode(problem.code)).toBe(false);
  });

  it('exposes the problem on McPlanProblemError', () => {
    const problem = parseProblem(lockedProblem)!;
    const error = new McPlanProblemError(problem, 403);
    expect(error.name).toBe('McPlanProblemError');
    expect(error.httpStatus).toBe(403);
    expect(error.problem.trace_id).toBe('01HZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(error.message).toContain('INSUFFICIENT_SCOPE');
  });
});
