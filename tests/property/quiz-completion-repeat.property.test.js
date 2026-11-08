import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { getQuestion } from '../../src/engine/quiz-bank.js';
import { next } from '../../src/engine/ussd.js';

const CATEGORY_OPTIONS = Object.freeze([
  Object.freeze({ option: '1', category: 'maths' }),
  Object.freeze({ option: '2', category: 'physics' }),
  Object.freeze({ option: '3', category: 'programming' }),
  Object.freeze({ option: '4', category: 'general' }),
]);

const categoryArbitrary = fc.constantFrom(...CATEGORY_OPTIONS);
const correctnessSequenceArbitrary = fc.array(fc.boolean(), {
  minLength: 5,
  maxLength: 5,
});

function transition(state, input) {
  const result = next(state, input);
  expect(result).not.toBeInstanceOf(Promise);
  return result;
}

function submittedOption(question, shouldBeCorrect) {
  if (shouldBeCorrect) {
    return question.correctAnswer;
  }

  return String((Number(question.correctAnswer) % question.options.length) + 1);
}

function startRound(categoryOption) {
  let result = transition(null, '*266#');
  result = transition(result.state, '2');
  return transition(result.state, categoryOption);
}

function completeRound(firstQuestion, correctnessSequence) {
  let current = firstQuestion;

  for (let index = 0; index < correctnessSequence.length; index += 1) {
    const question = getQuestion(current.state.view.questionId);
    const answer = submittedOption(question, correctnessSequence[index]);

    expect(current.state.view).toMatchObject({
      kind: 'quiz-question',
      questionNumber: index + 1,
    });

    current = transition(current.state, answer);

    if (index < 4) {
      expect(current.state.view.kind).toBe('quiz-feedback');
      expect(current.screen.text).toMatch(/1\.Next 0\.Back$/);
      current = transition(current.state, '1');
      expect(current.state.view).toMatchObject({
        kind: 'quiz-question',
        questionNumber: index + 2,
      });
    }
  }

  return current;
}

describe('quiz completion and repeat properties', () => {
  it('Feature: ussd-menu-engine, Property 10: Quiz Completion and Repeat Semantics', () => {
    // **Validates: Requirements 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 8.7**
    fc.assert(
      fc.property(
        categoryArbitrary,
        correctnessSequenceArbitrary,
        ({ option, category }, correctnessSequence) => {
          const firstQuestion = startRound(option);
          const roundId = firstQuestion.state.quiz.roundId;
          const expectedScore = correctnessSequence.filter(Boolean).length;
          const beforeFifth = completeRound(
            firstQuestion,
            correctnessSequence.slice(0, 4),
          );
          const fifthQuestion = getQuestion(beforeFifth.state.view.questionId);
          const fifthAnswer = submittedOption(
            fifthQuestion,
            correctnessSequence[4],
          );

          expect(beforeFifth.state.view).toMatchObject({
            kind: 'quiz-question',
            questionNumber: 5,
          });

          const result = transition(beforeFifth.state, fifthAnswer);

          expect(result.state.view).toEqual({
            kind: 'quiz-result',
            roundId,
          });
          expect(result.state.quiz.roundCorrect).toBe(expectedScore);
          expect(Number.isInteger(result.state.quiz.roundCorrect)).toBe(true);
          expect(result.state.quiz.roundAcceptanceIds).toHaveLength(5);
          expect(result.state.acceptedAnswers).toHaveLength(5);
          expect(result.state.hauntScore).toBe(expectedScore);
          expect(Number.isInteger(result.state.hauntScore)).toBe(true);
          expect(result.state.hauntScore).toBeGreaterThanOrEqual(0);
          expect(result.state.hauntScore).toBeLessThanOrEqual(
            result.state.acceptedAnswers.length,
          );
          expect(result.screen).toEqual({
            type: 'CON',
            text: `The spirits are pleased (${expectedScore}/5)\n1.Again 0.Back`,
          });
          expect(result.screen.text).toMatch(/1\.Again 0\.Back$/);

          const recordedLedger = result.state.acceptedAnswers;
          const recordedScore = result.state.hauntScore;
          const repeated = transition(result.state, '1');

          expect(repeated.state.view).toEqual({
            kind: 'quiz-question',
            questionId: repeated.state.quiz.questionIds[0],
            questionNumber: 1,
          });
          expect(repeated.state.quiz).toMatchObject({
            roundId: roundId + 1,
            category,
            questionIndex: 0,
            roundCorrect: 0,
            roundAcceptanceIds: [],
          });
          expect(repeated.state.quiz.questionIds).toHaveLength(5);
          expect(
            repeated.state.quiz.questionIds.every(
              (questionId) => getQuestion(questionId)?.category === category,
            ),
          ).toBe(true);
          expect(repeated.state.acceptedAnswers).toEqual(recordedLedger);
          expect(repeated.state.hauntScore).toBe(recordedScore);

          const categories = transition(result.state, '0');

          expect(categories.state.view).toEqual({ kind: 'quiz-categories' });
          expect(categories.state.acceptedAnswers).toEqual(recordedLedger);
          expect(categories.state.hauntScore).toBe(recordedScore);
          expect(categories.state.quiz).toEqual(result.state.quiz);
          expect(categories.screen.type).toBe('CON');
          expect(categories.screen.text).toContain('1 Maths');
          expect(categories.screen.text).toContain('4 General');
        },
      ),
      { numRuns: 200 },
    );
  });
});
