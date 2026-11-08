import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  INVALID_CHOICE_MESSAGE,
  renderScreen,
} from '../../src/engine/menus.js';
import {
  getQuestion,
  selectRoundQuestionIds,
} from '../../src/engine/quiz-bank.js';
import { next } from '../../src/engine/ussd.js';
import { createSuccessfulAIProvider } from '../support/mock-ai-providers.js';
import {
  buildAcceptedAnswer,
  buildActiveViewState,
} from '../support/state-builders.js';

const categoryArbitrary = fc.constantFrom(
  'maths',
  'physics',
  'programming',
  'general',
);

const roundArbitrary = fc.record({
  category: categoryArbitrary,
  correctness: fc.array(fc.boolean(), { maxLength: 5 }),
});

const acceptedAnswerLedgerArbitrary = fc
  .array(roundArbitrary, { maxLength: 6 })
  .map((rounds) => rounds.flatMap(({ category, correctness }, roundIndex) => {
    const roundId = roundIndex + 1;
    const questionIds = selectRoundQuestionIds(category, roundId);

    return correctness.map((correct, questionIndex) => {
      const question = getQuestion(questionIds[questionIndex]);
      const submittedAnswer = correct
        ? question.correctAnswer
        : String((Number(question.correctAnswer) % 4) + 1);

      return buildAcceptedAnswer({
        roundId,
        questionId: question.id,
        submittedAnswer,
        correct,
        correctAnswer: question.correctAnswer,
      });
    });
  }));

const unsupportedInputArbitrary = fc
  .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 24 })
  .map((codeUnits) => String.fromCharCode(...codeUnits))
  .filter((input) => input !== '0' && input !== '00');

function runLocalTransition(state, input) {
  const provider = createSuccessfulAIProvider();
  const result = next(state, input, provider);

  expect(result).not.toBeInstanceOf(Promise);
  expect(provider.callCount).toBe(0);
  return result;
}

function countCorrect(acceptedAnswers) {
  return acceptedAnswers.filter((answer) => answer.correct).length;
}

describe('Haunt Score display and control properties', () => {
  it('Feature: ussd-menu-engine, Property 12: Haunt Score Display and Controls', () => {
    // **Validates: Requirements 3.8, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13**
    fc.assert(
      fc.property(
        acceptedAnswerLedgerArbitrary,
        unsupportedInputArbitrary,
        (acceptedAnswers, unsupportedInput) => {
          const expectedScore = countCorrect(acceptedAnswers);
          const mainState = buildActiveViewState(
            { kind: 'main' },
            { acceptedAnswers },
          );

          expect(new Set(acceptedAnswers.map((answer) => answer.id)).size)
            .toBe(acceptedAnswers.length);
          expect(mainState.hauntScore).toBe(expectedScore);

          const scoreResult = runLocalTransition(mainState, '5');
          const scoreState = scoreResult.state;

          expect(scoreState.view).toEqual({ kind: 'score' });
          expect(scoreState.history).toEqual([{ view: { kind: 'main' } }]);
          expect(scoreState.acceptedAnswers).toEqual(acceptedAnswers);
          expect(scoreState.hauntScore).toBe(expectedScore);
          expect(scoreResult.screen).toEqual({
            type: 'CON',
            text: `Your Haunt Score is ${expectedScore}.\n0.Back 00.Home`,
          });
          expect(scoreResult.screen.text.endsWith('0.Back 00.Home')).toBe(true);

          const backResult = runLocalTransition(scoreState, '0');
          expect(backResult.state.view).toEqual({ kind: 'main' });
          expect(backResult.state.history).toEqual([]);
          expect(backResult.state.acceptedAnswers).toEqual(acceptedAnswers);
          expect(backResult.state.hauntScore).toBe(expectedScore);

          const homeResult = runLocalTransition(scoreState, '00');
          expect(homeResult.state.view).toEqual({ kind: 'main' });
          expect(homeResult.state.history).toEqual([]);
          expect(homeResult.state.acceptedAnswers).toEqual(acceptedAnswers);
          expect(homeResult.state.hauntScore).toBe(expectedScore);

          const invalidResult = runLocalTransition(
            scoreState,
            unsupportedInput,
          );
          const expectedInvalidState = {
            ...scoreState,
            notice: 'invalid',
          };

          expect(invalidResult.state).toEqual(expectedInvalidState);
          expect(invalidResult.state.hauntScore).toBe(expectedScore);
          expect(invalidResult.state.acceptedAnswers).toEqual(acceptedAnswers);
          expect(invalidResult.screen).toEqual(renderScreen(expectedInvalidState));
          expect(invalidResult.screen.text).toBe(
            `Your Haunt Score is ${expectedScore}.\n0.Back 00.Home\n${INVALID_CHOICE_MESSAGE}`,
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
