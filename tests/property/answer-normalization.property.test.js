import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { normalizeAnswer } from '../../api/ask.js';

const unicodeCodeUnitStringArbitrary = fc
  .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 900 })
  .map((codeUnits) => String.fromCharCode(...codeUnits));

const markdownLikeArbitrary = fc
  .tuple(
    fc.constantFrom('# ', '## ', '> ', '- ', '* ', '1. '),
    fc.string({ maxLength: 250 }),
    fc.webUrl(),
  )
  .map(([marker, label, url]) => (
    `${marker}**${label}** [${label}](${url}) \`${label}\``
  ));

const longStringArbitrary = fc
  .array(fc.constantFrom('a', 'Z', '0', ' ', '👻'), {
    minLength: 481,
    maxLength: 700,
  })
  .map((characters) => characters.join(''));

const invisibleMarkdownArbitrary = fc
  .array(
    fc.constantFrom(
      ' ',
      '\t',
      '\r\n',
      '#',
      '##',
      '>',
      '- ',
      '*',
      '_',
      '~',
      '`',
      '***',
      '[](https://example.test)',
    ),
    { maxLength: 30 },
  )
  .map((pieces) => pieces.join('\n'));

const candidateArbitrary = fc.oneof(
  unicodeCodeUnitStringArbitrary.map((text) => ({ text, mustFail: false })),
  markdownLikeArbitrary.map((text) => ({ text, mustFail: false })),
  longStringArbitrary.map((text) => ({ text, mustFail: false })),
  invisibleMarkdownArbitrary.map((text) => ({ text, mustFail: true })),
);

describe('answer normalization property', () => {
  it('Feature: real-ai, Property 4: Answer Normalization Enforces the Plain-Text Contract', () => {
    // **Validates: Requirements 3.1, 3.2**
    fc.assert(
      fc.property(candidateArbitrary, ({ text, mustFail }) => {
        const answer = normalizeAnswer(text);

        if (mustFail) {
          expect(answer).toBeNull();
          return;
        }

        if (answer === null) {
          expect(normalizeAnswer(text)).toBeNull();
          return;
        }

        expect(answer.length).toBeGreaterThanOrEqual(1);
        expect(answer.length).toBeLessThanOrEqual(480);
        expect(answer).toBe(answer.trim());
        expect(answer).not.toMatch(/[\r\n\t]/);
        expect(answer).not.toMatch(/\s{2,}/);
        expect(answer).not.toMatch(/[`*_~]/);
        expect(answer).not.toMatch(/!?\[[^\]]*\]\([^)]*\)/);
        expect(answer).not.toMatch(/^(?:#{1,6}(?:\s+|$)|>\s*|[-+*]\s+|\d+[.)]\s+)/);
        expect(normalizeAnswer(answer)).toBe(answer);
      }),
      { numRuns: 200 },
    );
  });
});
