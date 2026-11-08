import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  getQuestion,
  selectRoundQuestionIds,
} from '../../src/engine/quiz-bank.js';
import { next } from '../../src/engine/ussd.js';

const CATEGORY_OPTIONS = Object.freeze({
  maths: '1',
  physics: '2',
  programming: '3',
  general: '4',
});

const categoryArbitrary = fc.constantFrom(...Object.keys(CATEGORY_OPTIONS));
const roundNumberArbitrary = fc.integer({ min: 1, max: 12 });
const correctnessSequenceArbitrary = fc.array(fc.boolean(), {
  minLength: 5,
  maxLength: 5,
});

function transition(state, input) {
  const result = next(state, input);
  expect(result).not.toBeInstanceOf(Promise);
  return result;
}

function answersForRound(state) {
  return state.acceptedAnswers.filter(
    (answer) => answer.roundId === state.quiz.roundId,
  );
}

function expectRoundBounds(state, category, roundNumber) {
  const { quiz } = state;
  const roundAnswers = answersForRound(state);

  expect(quiz.roundId).toBe(roundNumber);
  expect(quiz.category).toBe(category);
  expect(quiz.questionIds).toHaveLength(5);
  expect(quiz.questionIds).toEqual(
    selectRoundQuestionIds(category, roundNumber),
  );

  for (const questionId of quiz.questionIds) {
    expect(getQuestion(questionId)?.category).toBe(category);
  }

  expect(Number.isInteger(quiz.questionIndex)).toBe(true);
  expect(quiz.questionIndex).toBeGreaterThanOrEqual(0);
  expect(quiz.questionIndex).toBeLessThanOrEqual(4);
  expect(Number.isInteger(quiz.roundCorrect)).toBe(true);
  expect(quiz.roundCorrect).toBeGreaterThanOrEqual(0);
  expect(quiz.roundCorrect).toBeLessThanOrEqual(roundAnswers.length);
  expect(roundAnswers).toHaveLength(quiz.roundAcceptanceIds.length);
  expect(roundAnswers.length).toBeLessThanOrEqual(5);

  if (state.view.kind === 'quiz-question') {
    expect(state.view.questionNumber).toBe(quiz.questionIndex + 1);
    expect(state.view.questionNumber).toBeGreaterThanOrEqual(1);
    expect(state.view.questionNumber).toBeLessThanOrEqual(5);
    expect(state.view.questionId).toBe(quiz.questionIds[quiz.questionIndex]);
  }
}

function expectFreshRound(state, category, roundNumber) {
  expectRoundBounds(state, category, roundNumber);
  expect(state.view).toEqual({
    kind: 'quiz-question',
    questionId: state.quiz.questionIds[0],
    questionNumber: 1,
  });
  expect(state.quiz.questionIndex).toBe(0);
  expect(state.quiz.roundCorrect).toBe(0);
  expect(state.quiz.roundAcceptanceIds).toEqual([]);
  expect(answersForRound(state)).toEqual([]);
}

function submittedOption(questionId, shouldBeCorrect) {
  const question = getQuestion(questionId);

  if (shouldBeCorrect) {
    return question.correctAnswer;
  }

  return String((Number(question.correctAnswer) % 4) + 1);
}

function completeRound(state, category, roundNumber, correctnessSequence) {
  let current = state;

  for (let questionIndex = 0; questionIndex < 5; questionIndex += 1) {
    expectRoundBounds(current, category, roundNumber);
    expect(current.view.kind).toBe('quiz-question');
    expect(answersForRound(current)).toHaveLength(questionIndex);

    const answer = submittedOption(
      current.view.questionId,
      correctnessSequence[questionIndex],
    );
    current = transition(current, answer).state;

    expectRoundBounds(current, category, roundNumber);
    expect(answersForRound(current)).toHaveLength(questionIndex + 1);
    expect(current.quiz.roundCorrect).toBe(
      correctnessSequence.slice(0, questionIndex + 1).filter(Boolean).length,
    );

    if (questionIndex < 4) {
      expect(current.view.kind).toBe('quiz-feedback');
      current = transition(current, '1').state;
      expectRoundBounds(current, category, roundNumber);
      expect(current.view.kind).toBe('quiz-question');
      expect(current.quiz.questionIndex).toBe(questionIndex + 1);
    } else {
      expect(current.view).toEqual({
        kind: 'quiz-result',
        roundId: roundNumber,
      });
    }
  }

  expect(answersForRound(current)).toHaveLength(5);
  return current;
}

describe('quiz round construction properties', () => {
  it('Feature: ussd-menu-engine, Property 8: Quiz Category Preservation and Five-Question Bounds', () => {
    // **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 7.9**
    fc.assert(
      fc.property(
        categoryArbitrary,
        roundNumberArbitrary,
        correctnessSequenceArbitrary,
        (category, roundNumber, correctnessSequence) => {
          let state = transition(null, '*266#').state;
          state = transition(state, '2').state;

          expect(state.view).toEqual({ kind: 'quiz-categories' });
          expect(state.quiz).toBeNull();

          state = transition(state, CATEGORY_OPTIONS[category]).state;
          expectFreshRound(state, category, 1);

          for (let currentRound = 1; currentRound < roundNumber; currentRound += 1) {
            state = completeRound(
              state,
              category,
              currentRound,
              [false, false, false, false, false],
            );
            state = transition(state, '1').state;
            expectFreshRound(state, category, currentRound + 1);
          }

          expectFreshRound(state, category, roundNumber);
          state = completeRound(
            state,
            category,
            roundNumber,
            correctnessSequence,
          );

          const repeated = transition(state, '1').state;
          expectFreshRound(repeated, category, roundNumber + 1);
          expect(repeated.quiz.category).toBe(state.quiz.category);
        },
      ),
      { numRuns: 200 },
    );
  }, 30_000);
});
