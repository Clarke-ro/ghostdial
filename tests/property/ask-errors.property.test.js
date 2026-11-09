import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { PUBLIC_ERRORS, createAskHandler } from '../../api/ask.js';

const sentinelArbitrary = fc.uuid().map((value) => `SENTINEL_${value}`);

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

async function execute({
  request,
  env,
  fetchImpl,
}) {
  const response = createResponse();
  const handler = createAskHandler({ fetchImpl, env });
  await handler(request, response);
  return response;
}

describe('server safe error property', () => {
  it('Feature: real-ai, Property 2: Error Responses Are Safe', async () => {
    // **Validates: Requirements 1.7, 2.5, 2.6, 2.7**
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(sentinelArbitrary, {
          minLength: 4,
          maxLength: 4,
        }),
        async ([apiKey, questionValue, upstreamBody, internalError]) => {
          const question = `Question ${questionValue}`;
          const validRequest = {
            method: 'POST',
            body: { mode: 'oracle', question },
          };
          const unusedFetch = vi.fn(async () => {
            throw new Error('This fetch must stay unused');
          });

          const scenarios = [
            {
              expectedStatus: 405,
              expectedError: PUBLIC_ERRORS.method,
              response: await execute({
                request: { method: 'GET', body: validRequest.body },
                env: { GEMINI_API_KEY: apiKey },
                fetchImpl: unusedFetch,
              }),
            },
            {
              expectedStatus: 400,
              expectedError: PUBLIC_ERRORS.invalidRequest,
              response: await execute({
                request: {
                  method: 'POST',
                  body: { mode: `BAD_${internalError}`, question },
                },
                env: { GEMINI_API_KEY: apiKey },
                fetchImpl: unusedFetch,
              }),
            },
            {
              expectedStatus: 500,
              expectedError: PUBLIC_ERRORS.configuration,
              response: await execute({
                request: validRequest,
                env: {},
                fetchImpl: unusedFetch,
              }),
            },
            {
              expectedStatus: 502,
              expectedError: PUBLIC_ERRORS.upstream,
              response: await execute({
                request: validRequest,
                env: { GEMINI_API_KEY: apiKey },
                fetchImpl: vi.fn(async () => {
                  throw new Error(internalError);
                }),
              }),
            },
            {
              expectedStatus: 502,
              expectedError: PUBLIC_ERRORS.upstream,
              response: await execute({
                request: validRequest,
                env: { GEMINI_API_KEY: apiKey },
                fetchImpl: vi.fn(async () => ({
                  ok: false,
                  status: 503,
                  async json() {
                    return { upstreamBody };
                  },
                })),
              }),
            },
            {
              expectedStatus: 502,
              expectedError: PUBLIC_ERRORS.upstream,
              response: await execute({
                request: validRequest,
                env: { GEMINI_API_KEY: apiKey },
                fetchImpl: vi.fn(async () => ({
                  ok: true,
                  async json() {
                    throw new Error(internalError);
                  },
                })),
              }),
            },
            {
              expectedStatus: 502,
              expectedError: PUBLIC_ERRORS.upstream,
              response: await execute({
                request: validRequest,
                env: { GEMINI_API_KEY: apiKey },
                fetchImpl: vi.fn(async () => ({
                  ok: true,
                  async json() {
                    return {
                      candidates: [{
                        content: { parts: [{ notText: upstreamBody }] },
                      }],
                    };
                  },
                })),
              }),
            },
          ];

          for (const scenario of scenarios) {
            expect(scenario.response.statusCode).toBe(scenario.expectedStatus);
            expect(scenario.response.headers['content-type']).toBe(
              'application/json; charset=utf-8',
            );
            expect(scenario.response.body).toEqual({
              error: scenario.expectedError,
            });
            expect(Object.keys(scenario.response.body)).toEqual(['error']);

            const serialized = JSON.stringify(scenario.response.body);
            for (const sentinel of [
              apiKey,
              questionValue,
              upstreamBody,
              internalError,
            ]) {
              expect(serialized).not.toContain(sentinel);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
