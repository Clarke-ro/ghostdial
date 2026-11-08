import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { paginate } from '../../src/engine/paginate.js';

const AI_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const AI_FINAL_SUFFIX = '\n0.Back 00.Home';

const codeUnitStringArbitrary = fc
  .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 600 })
  .map((codeUnits) => String.fromCharCode(...codeUnits));

const whitespaceStringArbitrary = fc
  .array(fc.constantFrom(' ', '\n', '\t', '\r'), { maxLength: 600 })
  .map((characters) => characters.join(''));

const unbrokenRunArbitrary = fc
  .array(
    fc.constantFrom('a', 'Z', '0', '_', '-', '\u0000', '\ud800', '\udfff'),
    { minLength: 1, maxLength: 600 },
  )
  .map((characters) => characters.join(''));

const textArbitrary = fc.oneof(
  { depthSize: 'large' },
  codeUnitStringArbitrary,
  whitespaceStringArbitrary,
  unbrokenRunArbitrary,
  fc.constant(''),
  fc.constant('space near a page boundary then more text'),
  fc.constant('newline near a page boundary\nthen more text'),
);

const capableLimitArbitrary = fc.integer({
  min: Math.max(AI_NON_FINAL_SUFFIX.length, AI_FINAL_SUFFIX.length) + 1,
  max: 256,
});

function assertLosslessPagination(text, limit, pages) {
  expect(pages.length).toBeGreaterThan(0);

  const reconstructed = pages
    .map((page, index) => {
      const suffix =
        index === pages.length - 1
          ? AI_FINAL_SUFFIX
          : AI_NON_FINAL_SUFFIX;

      expect(page.length).toBeGreaterThan(0);
      expect(page.length).toBeLessThanOrEqual(limit);
      expect(page.endsWith(suffix)).toBe(true);

      return page.slice(0, -suffix.length);
    })
    .join('');

  expect(reconstructed).toBe(text);
}

describe('paginate properties', () => {
  it('Feature: ussd-menu-engine, Property 6: Lossless Ordered AI Pagination', () => {
    // **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 10.1**
    fc.assert(
      fc.property(textArbitrary, capableLimitArbitrary, (text, limit) => {
        assertLosslessPagination(text, limit, paginate(text, limit));
        assertLosslessPagination(text, 160, paginate(text));
      }),
      { numRuns: 200 },
    );
  });
});
