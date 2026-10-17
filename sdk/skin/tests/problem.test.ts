import { describe, expect, it } from 'vitest';

import { isKnownProblemCode, McPlanProblemError, parseProblem } from '../src/problem.js';

const lockedProblem = {
  type: '/problems/skin-conversation-not-found',
  title: 'Conversation not found',
  status: 404,
  code: 'SKIN_CONVERSATION_NOT_FOUND',
  trace_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
};

describe('parseProblem', () => {
  it('parses a locked problem with the full field set', () => {
    const problem = parseProblem({
      ...lockedProblem,
      detail: 'expired window',
      errors: [{ field: 'conversationId', code: 'UNKNOWN', message: 'nope' }],
    });
    expect(problem).toEqual({
      type: '/problems/skin-conversation-not-found',
      title: 'Conversation not found',
      status: 404,
      code: 'SKIN_CONVERSATION_NOT_FOUND',
      trace_id: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
      detail: 'expired window',
      errors: [{ field: 'conversationId', code: 'UNKNOWN', message: 'nope' }],
    });
    expect(problem !== undefined && isKnownProblemCode(problem.code)).toBe(true);
  });

  it('rejects payloads missing locked required fields', () => {
    expect(parseProblem(null)).toBeUndefined();
    expect(parseProblem('not-an-object')).toBeUndefined();
    expect(parseProblem({ title: 'x', status: 400, code: 'Y', trace_id: 't' })).toBeUndefined();
    expect(parseProblem({ ...lockedProblem, status: '404' })).toBeUndefined();
  });

  it('keeps unknown codes visible as strings', () => {
    const problem = parseProblem({ ...lockedProblem, code: 'SKIN_SOMETHING_NEW' });
    expect(problem?.code).toBe('SKIN_SOMETHING_NEW');
    expect(problem !== undefined && isKnownProblemCode(problem.code)).toBe(false);
  });

  it('knows every producer-stable SKIN problem code', () => {
    for (const code of [
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
    ]) {
      expect(isKnownProblemCode(code), code).toBe(true);
    }
    // Core/Community codes are NOT part of the Skin surface.
    expect(isKnownProblemCode('NOT_FOUND')).toBe(false);
    expect(isKnownProblemCode('IDEMPOTENCY_KEY_CONFLICT')).toBe(false);
    expect(isKnownProblemCode('ENTITLEMENT_EXHAUSTED')).toBe(false);
  });

  it('exposes the problem on McPlanProblemError', () => {
    const problem = parseProblem(lockedProblem)!;
    const error = new McPlanProblemError(problem, 404);
    expect(error.name).toBe('McPlanProblemError');
    expect(error.httpStatus).toBe(404);
    expect(error.problem.trace_id).toBe('01HZZZZZZZZZZZZZZZZZZZZZZZ');
    expect(error.message).toContain('SKIN_CONVERSATION_NOT_FOUND');
  });
});
