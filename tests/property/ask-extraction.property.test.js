import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { extractCandidateText } from '../../api/ask.js';

const textPartArbitrary = fc.oneof(
  fc.record({ text: fc.string({ maxLength: 80 }) }),
  fc.record({
    text: fc.oneof(
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.array(fc.string(), { maxLength: 3 }),
    ),
  }),
  fc.jsonValue(),
);

const geminiCandidateArbitrary = fc.oneof(
  fc.record({
    content: fc.record({
      parts: fc.array(textPartArbitrary, { maxLength: 10 }),
    }),
  }),
  fc.jsonValue(),
);

const payloadArbitrary = fc.oneof(
  fc.record({
    candidates: fc.array(geminiCandidateArbitrary, { maxLength: 8 }),
  }),
  fc.jsonValue(),
);

function referenceExtraction(payload) {
  if (!Array.isArray(payload?.candidates)) {
    return null;
  }

  const values = [];
  for (const candidate of payload.candidates) {
    if (!Array.isArray(candidate?.content?.parts)) {
      continue;
    }

    for (const part of candidate.content.parts) {
      if (typeof part?.text === 'string' && part.text.length > 0) {
        values.push(part.text);
      }
    }
  }

  return values.length > 0 ? values.join('') : null;
}

describe('Gemini candidate extraction property', () => {
  it('Feature: real-ai, Property 3: Candidate Extraction Accepts Only Text Parts', () => {
    // **Validates: Requirements 2.7, 3.2**
    fc.assert(
      fc.property(payloadArbitrary, (payload) => {
        expect(extractCandidateText(payload)).toBe(referenceExtraction(payload));
      }),
      { numRuns: 200 },
    );

    expect(extractCandidateText({
      candidates: [{
        content: {
          parts: [
            { text: 0 },
            { text: false },
            { text: null },
            { text: {} },
            { text: '' },
          ],
        },
      }],
    })).toBeNull();
  });
});
