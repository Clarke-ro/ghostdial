import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import {
  createAskHandler,
  validateRequestBody,
} from '../../api/ask.js';

const supportedModeArbitrary = fc.constantFrom(
  'oracle',
  'explain-like-5',
  'exam-survival',
);

const randomQuestionArbitrary = fc
  .array(fc.integer({ min: 0, max: 0xffff }), {
    minLength: 1,
    maxLength: 160,
  })
  .map((codeUnits) => String.fromCharCode(...codeUnits));

const questionArbitrary = fc.oneof(
  fc.constant('x'),
  fc.constant('x'.repeat(160)),
  randomQuestionArbitrary,
);

const invalidBoundaryQuestionArbitrary = fc.constantFrom(
  '',
  'x'.repeat(161),
);

function referenceAccepts(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ['oracle', 'explain-like-5', 'exam-survival'].includes(value.mode) &&
    typeof value.question === 'string' &&
    value.question.length >= 1 &&
    value.question.length <= 160
  );
}

function createResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    json(payload) {
      this.body = payload;
    },
  };
}

function successResponse() {
  return {
    ok: true,
    async json() {
      return {
        candidates: [{ content: { parts: [{ text: 'Safe answer.' }] } }],
      };
    },
  };
}

describe('server request validation property', () => {
  it('Feature: real-ai, Property 1: Server Request Validation Is an Exact Allowlist', async () => {
    // **Validates: Requirements 1.1, 1.5, 1.6**
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (body) => {
        const expected = referenceAccepts(body);
        const validated = validateRequestBody(body);

        expect(validated !== null).toBe(expected);
        if (expected) {
          expect(validated).toEqual({
            mode: body.mode,
            question: body.question,
          });
        }

        const fetchImpl = vi.fn(async () => successResponse());
        const response = createResponse();
        const handler = createAskHandler({
          fetchImpl,
          env: { GEMINI_API_KEY: 'SERVER_ONLY_KEY' },
        });
        await handler({ method: 'POST', body }, response);

        if (expected) {
          expect(response.statusCode).toBe(200);
          expect(fetchImpl).toHaveBeenCalledOnce();
        } else {
          expect(response.statusCode).toBe(400);
          expect(fetchImpl).not.toHaveBeenCalled();
        }
      }),
      { numRuns: 100 },
    );

    await fc.assert(
      fc.asyncProperty(
        supportedModeArbitrary,
        questionArbitrary,
        fc.jsonValue(),
        async (mode, question, extraValue) => {
          const body = { mode, question, extraValue };
          const fetchImpl = vi.fn(async () => successResponse());
          const response = createResponse();
          const handler = createAskHandler({
            fetchImpl,
            env: { GEMINI_API_KEY: 'SERVER_ONLY_KEY' },
          });

          await handler({ method: 'POST', body }, response);

          expect(validateRequestBody(body)).toEqual({ mode, question });
          expect(response.statusCode).toBe(200);
          expect(fetchImpl).toHaveBeenCalledOnce();
        },
      ),
      { numRuns: 100 },
    );
    await fc.assert(
      fc.asyncProperty(
        supportedModeArbitrary,
        invalidBoundaryQuestionArbitrary,
        async (mode, question) => {
          const body = { mode, question };
          const fetchImpl = vi.fn(async () => successResponse());
          const response = createResponse();
          const handler = createAskHandler({
            fetchImpl,
            env: { GEMINI_API_KEY: 'SERVER_ONLY_KEY' },
          });

          await handler({ method: 'POST', body }, response);

          expect(validateRequestBody(body)).toBeNull();
          expect(response.statusCode).toBe(400);
          expect(fetchImpl).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
