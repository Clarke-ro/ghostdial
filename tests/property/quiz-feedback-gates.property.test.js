import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { INVALID_CHOICE_MESSAGE } from '../../src/engine/menus.js';
import { getQuestion } from '../../src/engine/quiz-bank.js';
import { next } from '../../src/engine/ussd.js';

const CATEGORY_OPTIONS = Object.freeze(['1', '2', '3', '4']);
const unsupportedFollowUpArbitrary = fc.string().filter(
  (input) => input !== '0' && input !== '00' && input !== '1',
);
const preFinalAnswersArbitrary = fc.array(fc.boolean(), {
  minLength: 1,
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

function submitForCorrectness(state, shouldBeCorrect) {
  const question = getQuestion(state.view.questionId);
  const submittedAnswer = shouldBeCorrect
    ? question.correctAnswer
    : incorrectOption(question);

  return {
    question,
    submittedAnswer,
    result: transition(state, submittedAnswer),
  };
}

function reachPreFinalQuestion(categoryOption, priorCorrectness) {
  let state = transition(null, '*266#').state;
  state = transition(state, '2').state;
  state = transition(state, categoryOption).state;

  for (const shouldBeCorrect of priorCorrectness) {
    const feedback = submitForCorrectness(state, shouldBeCorrect).result;
    state = transition(feedback.state, '1').state;
  }

  return state;
}

describe('quiz feedback gate properties', () => {
  it('Feature: ussd-menu-engine, Property 9: Quiz Feedback Gates Progress', () => {
    // **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.11**
    fc.assert(
      fc.property(
        fc.constantFrom(...CATEGORY_OPTIONS),
        preFinalAnswersArbitrary,
        unsupportedFollowUpArbitrary,
        (categoryOption, correctnessSequence, unsupportedInput) => {
          const questionIndex = correctnessSequence.length - 1;
          const state = reachPreFinalQuestion(
            categoryOption,
            correctnessSequence.slice(0, -1),
          );

          expect(state.view).toMatchObject({
            kind: 'quiz-question',
            questionNumber: questionIndex + 1,
          });
          expect(state.quiz.questionIndex).toBe(questionIndex);

          const shouldBeCorrect = correctnessSequence.at(-1);
          const { question, submittedAnswer, result: feedback } =
            submitForCorrectness(state, shouldBeCorrect);
          const acceptance = feedback.state.acceptedAnswers.at(-1);

          expect(feedback.state.view).toEqual({
            kind: 'quiz-feedback',
            acceptanceId: acceptance.id,
          });
          expect(feedback.state.quiz.questionIndex).toBe(questionIndex);
          expect(feedback.state.view.kind).not.toBe('quiz-question');
          expect(feedback.screen.text).toMatch(/1\.Next 0\.Back$/);
          expect(acceptance).toMatchObject({
            questionId: question.id,
            submittedAnswer,
            correct: shouldBeCorrect,
            correctAnswer: question.correctAnswer,
          });

          if (shouldBeCorrect) {
            expect(feedback.screen.text).toContain('Correct!');
          } else {
            const correctOption = question.options[
              Number(question.correctAnswer) - 1
            ];
            expect(feedback.screen.text).toContain('Not quite.');
            expect(feedback.screen.text).toContain(
              `${question.correctAnswer} ${correctOption}`,
            );
          }

          const recordedAnswers = feedback.state.acceptedAnswers;
          const recordedQuiz = feedback.state.quiz;
          const recordedScore = feedback.state.hauntScore;

          const invalid = transition(feedback.state, unsupportedInput);
          expect(invalid.state).toEqual({
            ...feedback.state,
            notice: 'invalid',
          });
          expect(invalid.state.view).toEqual(feedback.state.view);
          expect(invalid.state.quiz).toEqual(recordedQuiz);
          expect(invalid.state.acceptedAnswers).toEqual(recordedAnswers);
          expect(invalid.state.hauntScore).toBe(recordedScore);
          expect(invalid.screen.text).toBe(
            `${feedback.screen.text}\n${INVALID_CHOICE_MESSAGE}`,
          );

          const back = transition(feedback.state, '0');
          expect(back.state.view).toEqual(state.view);
          expect(back.state.quiz).toEqual(recordedQuiz);
          expect(back.state.acceptedAnswers).toEqual(recordedAnswers);
          expect(back.state.hauntScore).toBe(recordedScore);

          const advanced = transition(feedback.state, '1');
          expect(advanced.state.view).toEqual({
            kind: 'quiz-question',
            questionId: advanced.state.quiz.questionIds[questionIndex + 1],
            questionNumber: questionIndex + 2,
          });
          expect(advanced.state.quiz.questionIndex).toBe(questionIndex + 1);
          expect(advanced.state.quiz.roundCorrect).toBe(
            recordedQuiz.roundCorrect,
          );
          expect(advanced.state.quiz.roundAcceptanceIds).toEqual(
            recordedQuiz.roundAcceptanceIds,
          );
          expect(advanced.state.acceptedAnswers).toEqual(recordedAnswers);
          expect(advanced.state.hauntScore).toBe(recordedScore);
        },
      ),
      { numRuns: 200 },
    );
  });
});
