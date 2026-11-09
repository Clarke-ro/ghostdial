import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { next } from '../../src/engine/ussd.js';
import {
  buildMockAnswer,
  createMockAIProvider,
  MOCK_AI_DELAY_MS,
} from '../../src/ui/mock-ai.js';

/**
 * A manually advanced timer keeps the property independent of wall-clock time.
 * It also records every requested delay so equal requests can be compared.
 */
function createDeterministicTimer() {
  const scheduled = [];

  return {
    setTimeoutFn(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    get delays() {
      return scheduled.map(({ delayMs }) => delayMs);
    },
    runAll() {
      const callbacks = scheduled.splice(0, scheduled.length);
      callbacks.forEach(({ callback }) => callback());
    },
  };
}

function createQuestionState(mode) {
  return {
    version: 1,
    status: 'active',
    view: { kind: 'question', mode },
    history: [{ kind: 'main' }],
    quiz: null,
    acceptedAnswers: [],
    hauntScore: 0,
    notice: null,
  };
}

const modeArbitrary = fc.string({ maxLength: 40 });

// The engine reserves exact "0" and "00" as navigation controls. All other
// strings, including empty and whitespace-only strings, are complete questions.
const questionArbitrary = fc
  .string({ maxLength: 160 })
  .filter((question) => question !== '0' && question !== '00');

describe('mock AI provider properties', () => {
  it('Feature: phone-ui, Property 8: Mock Provider Determinism', async () => {
    // **Validates: Requirements 8.2, 8.3, 8.4**
    await fc.assert(
      fc.asyncProperty(
        modeArbitrary,
        questionArbitrary,
        async (mode, question) => {
          const equalRequestTimer = createDeterministicTimer();
          const provider = createMockAIProvider({
            delayMs: MOCK_AI_DELAY_MS,
            setTimeoutFn: equalRequestTimer.setTimeoutFn,
          });
          const request = { mode, question };
          let settledCount = 0;

          const firstAnswer = provider(request).then((answer) => {
            settledCount += 1;
            return answer;
          });
          const secondAnswer = provider({ ...request }).then((answer) => {
            settledCount += 1;
            return answer;
          });

          expect(MOCK_AI_DELAY_MS).toBe(1200);
          expect(equalRequestTimer.delays).toEqual([
            MOCK_AI_DELAY_MS,
            MOCK_AI_DELAY_MS,
          ]);
          expect(settledCount).toBe(0);

          equalRequestTimer.runAll();
          const [first, second] = await Promise.all([
            firstAnswer,
            secondAnswer,
          ]);

          expect(first).toBe(second);
          expect(first).toBe(buildMockAnswer(mode, question));
          expect(settledCount).toBe(2);

          const engineTimer = createDeterministicTimer();
          const engineProvider = createMockAIProvider({
            delayMs: MOCK_AI_DELAY_MS,
            setTimeoutFn: engineTimer.setTimeoutFn,
          });
          const engineResultPromise = next(
            createQuestionState(mode),
            question,
            engineProvider,
          );

          // The engine invokes its provider in a Promise microtask.
          await Promise.resolve();
          expect(engineTimer.delays).toEqual([MOCK_AI_DELAY_MS]);
          engineTimer.runAll();

          const engineResult = await engineResultPromise;
          expect(engineResult.state.view.kind).toBe('answer');
          expect(engineResult.state.view.mode).toBe(mode);
          expect(engineResult.state.view.question).toBe(question);
          expect(engineResult.state.view.pages.length).toBeGreaterThanOrEqual(2);
          expect(engineResult.screen).toEqual({
            type: 'CON',
            text: engineResult.state.view.pages[0],
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
