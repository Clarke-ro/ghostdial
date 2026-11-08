import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { getQuestion } from '../../src/engine/quiz-bank.js';
import { next } from '../../src/engine/ussd.js';

const CATEGORY_OPTIONS = Object.freeze(['1', '2', '3', '4']);
const INVALID_GATE_INPUTS = Object.freeze(['2', '3', '4', '01', '#']);

const roundTraceArbitrary = fc.record({
  correctness: fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
  historicalAnswers: fc.array(
    fc.integer({ min: 1, max: 4 }).map(String),
    { minLength: 4, maxLength: 4 },
  ),
  invalidGateInputs: fc.array(fc.constantFrom(...INVALID_GATE_INPUTS), {
    minLength: 5,
    maxLength: 5,
  }),
});

const multiRoundTraceArbitrary = fc.array(roundTraceArbitrary, {
  minLength: 2,
  maxLength: 4,
});

function transition(state, input) {
  const result = next(state, input);
  expect(result).not.toBeInstanceOf(Promise);
  return result;
}

function incorrectOption(question) {
  return question.correctAnswer === '1' ? '2' : '1';
}

function answerForCorrectness(question, shouldBeCorrect) {
  return shouldBeCorrect
    ? question.correctAnswer
    : incorrectOption(question);
}

function expectedScore(referenceLedger) {
  return [...referenceLedger.values()].filter((answer) => answer.correct).length;
}

function expectScoreInvariant(state, referenceLedger) {
  const uniqueAcceptedIds = new Set(
    state.acceptedAnswers.map((answer) => answer.id),
  );

  expect(uniqueAcceptedIds.size).toBe(state.acceptedAnswers.length);
  expect(state.acceptedAnswers).toEqual([...referenceLedger.values()]);
  expect(Number.isInteger(state.hauntScore)).toBe(true);
  expect(state.hauntScore).toBe(expectedScore(referenceLedger));
  expect(state.hauntScore).toBeGreaterThanOrEqual(0);
  expect(state.hauntScore).toBeLessThanOrEqual(
    state.acceptedAnswers.length,
  );
}

function expectRecordedValuesUnchanged(before, after, acceptanceId) {
  const previousAcceptance = before.acceptedAnswers.find(
    (answer) => answer.id === acceptanceId,
  );
  const repeatedAcceptance = after.acceptedAnswers.find(
    (answer) => answer.id === acceptanceId,
  );

  expect(after.acceptedAnswers).toEqual(before.acceptedAnswers);
  expect(after.acceptedAnswers).toHaveLength(before.acceptedAnswers.length);
  expect(repeatedAcceptance).toEqual(previousAcceptance);
  expect(after.quiz.roundAcceptanceIds).toEqual(
    before.quiz.roundAcceptanceIds,
  );
  expect(after.quiz.roundCorrect).toBe(before.quiz.roundCorrect);
  expect(after.hauntScore).toBe(before.hauntScore);
}

function startFirstRound(categoryOption) {
  let result = transition(null, '*266#');
  result = transition(result.state, '2');
  return transition(result.state, categoryOption);
}

describe('quiz score ledger properties', () => {
  it('Feature: ussd-menu-engine, Property 11: Integer Session Score and Duplicate Prevention', () => {
    // **Validates: Requirements 7.11, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7**
    fc.assert(
      fc.property(
        fc.constantFrom(...CATEGORY_OPTIONS),
        multiRoundTraceArbitrary,
        (categoryOption, roundTraces) => {
          const referenceLedger = new Map();
          let current = startFirstRound(categoryOption);

          expect(current.state.hauntScore).toBe(0);
          expectScoreInvariant(current.state, referenceLedger);

          for (
            let roundIndex = 0;
            roundIndex < roundTraces.length;
            roundIndex += 1
          ) {
            const trace = roundTraces[roundIndex];
            const roundId = current.state.quiz.roundId;
            const category = current.state.quiz.category;

            expect(current.state.quiz.roundCorrect).toBe(0);
            expect(current.state.quiz.roundAcceptanceIds).toEqual([]);
            expectScoreInvariant(current.state, referenceLedger);

            for (let questionIndex = 0; questionIndex < 5; questionIndex += 1) {
              const questionState = current.state;
              const question = getQuestion(questionState.view.questionId);
              const submittedAnswer = answerForCorrectness(
                question,
                trace.correctness[questionIndex],
              );
              const acceptanceId = `${roundId}:${question.id}`;
              const scoreBeforeAcceptance = questionState.hauntScore;

              expect(referenceLedger.has(acceptanceId)).toBe(false);
              current = transition(questionState, submittedAnswer);

              const acceptance = current.state.acceptedAnswers.find(
                (answer) => answer.id === acceptanceId,
              );
              referenceLedger.set(acceptanceId, acceptance);

              expect(acceptance).toMatchObject({
                id: acceptanceId,
                roundId,
                questionId: question.id,
                submittedAnswer,
                correct: trace.correctness[questionIndex],
                correctAnswer: question.correctAnswer,
              });
              expect(current.state.hauntScore).toBe(
                scoreBeforeAcceptance
                  + (trace.correctness[questionIndex] ? 1 : 0),
              );
              expectScoreInvariant(current.state, referenceLedger);

              if (questionIndex < 4) {
                const recordedState = current.state;
                const historicalQuestion = transition(recordedState, '0');
                expectScoreInvariant(historicalQuestion.state, referenceLedger);

                const repeated = transition(
                  historicalQuestion.state,
                  trace.historicalAnswers[questionIndex],
                );
                expectRecordedValuesUnchanged(
                  recordedState,
                  repeated.state,
                  acceptanceId,
                );
                expectScoreInvariant(repeated.state, referenceLedger);

                const invalidGate = transition(
                  repeated.state,
                  trace.invalidGateInputs[questionIndex],
                );
                expectRecordedValuesUnchanged(
                  repeated.state,
                  invalidGate.state,
                  acceptanceId,
                );
                expectScoreInvariant(invalidGate.state, referenceLedger);

                current = transition(invalidGate.state, '1');
                expectScoreInvariant(current.state, referenceLedger);
              }
            }

            expect(current.state.view).toEqual({
              kind: 'quiz-result',
              roundId,
            });
            expect(current.state.quiz.roundCorrect).toBe(
              trace.correctness.filter(Boolean).length,
            );
            expectScoreInvariant(current.state, referenceLedger);

            const invalidResult = transition(
              current.state,
              trace.invalidGateInputs[4],
            );
            expectRecordedValuesUnchanged(
              current.state,
              invalidResult.state,
              `${roundId}:${current.state.quiz.questionIds[4]}`,
            );
            expectScoreInvariant(invalidResult.state, referenceLedger);
            current = invalidResult;

            if (roundIndex < roundTraces.length - 1) {
              const previousLedger = current.state.acceptedAnswers;
              const previousScore = current.state.hauntScore;
              current = transition(current.state, '1');

              expect(current.state.quiz.roundId).toBe(roundId + 1);
              expect(current.state.quiz.category).toBe(category);
              expect(current.state.quiz.roundCorrect).toBe(0);
              expect(current.state.quiz.roundAcceptanceIds).toEqual([]);
              expect(current.state.acceptedAnswers).toEqual(previousLedger);
              expect(current.state.hauntScore).toBe(previousScore);
              expectScoreInvariant(current.state, referenceLedger);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 30_000);
});
