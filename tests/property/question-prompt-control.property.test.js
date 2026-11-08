import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { next } from '../../src/engine/ussd.js';
import { createSuccessfulAIProvider } from '../support/mock-ai-providers.js';
import { buildActiveViewState } from '../support/state-builders.js';

const promptModeArbitrary = fc.constantFrom('oracle', 'eli5');

const arbitraryJavaScriptString = fc.oneof(
  fc.constantFrom(
    '',
    '0',
    '00',
    '10',
    '000',
    '0 question',
    'question 00',
    ' 0',
    '00 ',
  ),
  fc
    .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 80 })
    .map((codeUnits) => String.fromCharCode(...codeUnits)),
);

function buildPromptState(mode) {
  return buildActiveViewState(
    { kind: 'question', mode },
    { history: [{ view: { kind: 'main' } }] },
  );
}

describe('question prompt control properties', () => {
  it('Feature: ussd-menu-engine, Property 5: Question Prompt Control Precedence', async () => {
    // **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
    await fc.assert(
      fc.asyncProperty(
        promptModeArbitrary,
        arbitraryJavaScriptString,
        async (mode, input) => {
          const state = buildPromptState(mode);
          const provider = createSuccessfulAIProvider('A friendly ghost answers.');
          const transition = next(state, input, provider);

          if (input === '0' || input === '00') {
            expect(transition).not.toBeInstanceOf(Promise);
            expect(provider.callCount).toBe(0);
            expect(transition.state.view).toEqual({ kind: 'main' });
            expect(transition.state.history).toEqual([]);
            expect(transition.screen.type).toBe('CON');
            return;
          }

          expect(transition).toBeInstanceOf(Promise);
          const result = await transition;

          expect(provider.callCount).toBe(1);
          expect(provider.calls).toEqual([{ mode, question: input }]);
          expect(result.state.view).toMatchObject({
            kind: 'answer',
            mode,
            question: input,
          });
          expect(result.screen.type).toBe('CON');
        },
      ),
      { numRuns: 200 },
    );
  });
});
