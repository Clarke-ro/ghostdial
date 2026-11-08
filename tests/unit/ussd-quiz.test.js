import { describe, expect, it } from 'vitest';
import { next } from '../../src/engine/ussd.js';
import { INVALID_CHOICE_MESSAGE, renderScreen } from '../../src/engine/menus.js';
import { getQuestion } from '../../src/engine/quiz-bank.js';
import { buildFreshState } from '../support/state-builders.js';
import { createSuccessfulAIProvider } from '../support/mock-ai-providers.js';

const CATEGORY_OPTIONS = [
  ['1', 'maths'],
  ['2', 'physics'],
  ['3', 'programming'],
  ['4', 'general'],
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
    Object.freeze(value);
  }

  return value;
}

function localStep(state, input, provider) {
  const before = clone(state);
  const callsBefore = provider.callCount;
  deepFreeze(state);

  const result = next(state, input, provider);

  expect(result).not.toBeInstanceOf(Promise);
  expect(result).toEqual({
    state: result.state,
    screen: renderScreen(result.state),
  });
  expect(provider.callCount).toBe(callsBefore);
  expect(state).toEqual(before);

  return result;
}

function enterQuizCategory(option, provider) {
  const categoryMenu = localStep(buildFreshState(), '2', provider);
  expect(categoryMenu.state.view).toEqual({ kind: 'quiz-categories' });
  return localStep(categoryMenu.state, option, provider);
}

function incorrectOption(question) {
  return question.correctAnswer === '1' ? '2' : '1';
}

function completeRound(questionResult, correctness, provider) {
  let current = questionResult;
  const roundId = current.state.quiz.roundId;

  correctness.forEach((shouldBeCorrect, index) => {
    expect(current.state.view).toMatchObject({
      kind: 'quiz-question',
      questionNumber: index + 1,
    });
    expect(current.state.quiz.questionIndex).toBe(index);
    expect(current.state.quiz.questionIndex).toBeGreaterThanOrEqual(0);
    expect(current.state.quiz.questionIndex).toBeLessThanOrEqual(4);

    const question = getQuestion(current.state.view.questionId);
    const answer = shouldBeCorrect
      ? question.correctAnswer
      : incorrectOption(question);
    current = localStep(current.state, answer, provider);

    const roundAnswers = current.state.acceptedAnswers.filter(
      (accepted) => accepted.roundId === roundId,
    );
    expect(roundAnswers).toHaveLength(index + 1);
    expect(new Set(roundAnswers.map((accepted) => accepted.id)).size)
      .toBe(index + 1);
    expect(current.state.quiz.roundAcceptanceIds).toEqual(
      roundAnswers.map((accepted) => accepted.id),
    );
    expect(current.state.quiz.roundCorrect)
      .toBe(correctness.slice(0, index + 1).filter(Boolean).length);
    expect(current.state.quiz.roundCorrect).toBeGreaterThanOrEqual(0);
    expect(current.state.quiz.roundCorrect).toBeLessThanOrEqual(index + 1);

    if (index < 4) {
      expect(current.state.view.kind).toBe('quiz-feedback');
      current = localStep(current.state, '1', provider);
      expect(current.state.quiz.questionIndex).toBe(index + 1);
    } else {
      expect(current.state.view).toEqual({ kind: 'quiz-result', roundId });
    }
  });

  return current;
}

describe('quiz category and round construction', () => {
  it.each(CATEGORY_OPTIONS)(
    'maps category option %s to a five-question %s round',
    (option, category) => {
      const provider = createSuccessfulAIProvider();
      const result = enterQuizCategory(option, provider);

      expect(result.state.quiz).toMatchObject({
        roundId: 1,
        category,
        questionIndex: 0,
        roundCorrect: 0,
        roundAcceptanceIds: [],
      });
      expect(result.state.quiz.questionIds).toHaveLength(5);
      expect(new Set(result.state.quiz.questionIds).size).toBe(5);
      expect(
        result.state.quiz.questionIds.every(
          (questionId) => getQuestion(questionId)?.category === category,
        ),
      ).toBe(true);
      expect(result.state.view).toEqual({
        kind: 'quiz-question',
        questionId: result.state.quiz.questionIds[0],
        questionNumber: 1,
      });
      expect(result.state.acceptedAnswers).toEqual([]);
      expect(result.state.hauntScore).toBe(0);
      expect(provider.callCount).toBe(0);
    },
  );

  it('accepts exactly five answers while keeping question and count bounds', () => {
    const provider = createSuccessfulAIProvider();
    const firstQuestion = enterQuizCategory('1', provider);
    const result = completeRound(
      firstQuestion,
      [true, false, true, false, true],
      provider,
    );

    expect(result.state.view.kind).toBe('quiz-result');
    expect(result.state.quiz.questionIndex).toBe(4);
    expect(result.state.quiz.roundCorrect).toBe(3);
    expect(result.state.quiz.roundAcceptanceIds).toHaveLength(5);
    expect(result.state.acceptedAnswers).toHaveLength(5);
    expect(result.state.hauntScore).toBe(3);
    expect(provider.callCount).toBe(0);
  });
});

describe('quiz feedback and progression gate', () => {
  it('records a correct answer once and renders correct feedback', () => {
    const provider = createSuccessfulAIProvider();
    const questionResult = enterQuizCategory('2', provider);
    const question = getQuestion(questionResult.state.view.questionId);

    const feedback = localStep(
      questionResult.state,
      question.correctAnswer,
      provider,
    );

    expect(feedback.state.view.kind).toBe('quiz-feedback');
    expect(feedback.screen.text).toContain('Correct!');
    expect(feedback.screen.text).toMatch(/1\.Next 0\.Back$/);
    expect(feedback.state.acceptedAnswers).toEqual([
      {
        id: `1:${question.id}`,
        roundId: 1,
        questionId: question.id,
        submittedAnswer: question.correctAnswer,
        correct: true,
        correctAnswer: question.correctAnswer,
      },
    ]);
    expect(feedback.state.quiz.roundCorrect).toBe(1);
    expect(feedback.state.hauntScore).toBe(1);
    expect(provider.callCount).toBe(0);
  });

  it('records an incorrect answer and includes the local correct answer', () => {
    const provider = createSuccessfulAIProvider();
    const questionResult = enterQuizCategory('3', provider);
    const question = getQuestion(questionResult.state.view.questionId);
    const submittedAnswer = incorrectOption(question);

    const feedback = localStep(
      questionResult.state,
      submittedAnswer,
      provider,
    );

    expect(feedback.screen.text).toContain('Not quite.');
    expect(feedback.screen.text).toContain(
      `${question.correctAnswer} ${question.options[Number(question.correctAnswer) - 1]}`,
    );
    expect(feedback.screen.text).toMatch(/1\.Next 0\.Back$/);
    expect(feedback.state.acceptedAnswers[0]).toMatchObject({
      submittedAnswer,
      correct: false,
      correctAnswer: question.correctAnswer,
    });
    expect(feedback.state.quiz.roundCorrect).toBe(0);
    expect(feedback.state.hauntScore).toBe(0);
    expect(provider.callCount).toBe(0);
  });

  it('allows only exact 1 through the feedback gate and preserves its ledger', () => {
    const provider = createSuccessfulAIProvider();
    const questionResult = enterQuizCategory('4', provider);
    const question = getQuestion(questionResult.state.view.questionId);
    const feedback = localStep(
      questionResult.state,
      question.correctAnswer,
      provider,
    );
    const recorded = clone(feedback.state.acceptedAnswers);

    const invalid = localStep(feedback.state, '2', provider);

    expect(invalid.state).toEqual({ ...feedback.state, notice: 'invalid' });
    expect(invalid.screen.text).toContain(INVALID_CHOICE_MESSAGE);
    expect(invalid.state.view).toEqual(feedback.state.view);
    expect(invalid.state.acceptedAnswers).toEqual(recorded);
    expect(invalid.state.quiz.roundCorrect).toBe(1);
    expect(invalid.state.hauntScore).toBe(1);

    const nextQuestion = localStep(invalid.state, '1', provider);
    expect(nextQuestion.state.view).toEqual({
      kind: 'quiz-question',
      questionId: nextQuestion.state.quiz.questionIds[1],
      questionNumber: 2,
    });
    expect(nextQuestion.state.quiz.questionIndex).toBe(1);
    expect(nextQuestion.state.acceptedAnswers).toEqual(recorded);
    expect(nextQuestion.state.hauntScore).toBe(1);
    expect(provider.callCount).toBe(0);
  });

  it('cannot change correctness or score by resubmitting a historical question', () => {
    const provider = createSuccessfulAIProvider();
    const questionResult = enterQuizCategory('1', provider);
    const question = getQuestion(questionResult.state.view.questionId);
    const feedback = localStep(
      questionResult.state,
      question.correctAnswer,
      provider,
    );
    const originalLedger = clone(feedback.state.acceptedAnswers);

    const historicalQuestion = localStep(feedback.state, '0', provider);
    expect(historicalQuestion.state.view).toEqual(questionResult.state.view);

    const repeatedFeedback = localStep(
      historicalQuestion.state,
      incorrectOption(question),
      provider,
    );

    expect(repeatedFeedback.state.view).toEqual(feedback.state.view);
    expect(repeatedFeedback.screen.text).toContain('Correct!');
    expect(repeatedFeedback.state.acceptedAnswers).toEqual(originalLedger);
    expect(repeatedFeedback.state.acceptedAnswers).toHaveLength(1);
    expect(repeatedFeedback.state.quiz.roundAcceptanceIds).toEqual([
      originalLedger[0].id,
    ]);
    expect(repeatedFeedback.state.quiz.roundCorrect).toBe(1);
    expect(repeatedFeedback.state.hauntScore).toBe(1);
    expect(provider.callCount).toBe(0);
  });
});

describe('quiz results, repeats, and running score', () => {
  it.each([0, 1, 2, 3, 4, 5])(
    'shows the direct fifth-answer result for a %i/5 round',
    (correctCount) => {
      const provider = createSuccessfulAIProvider();
      const firstQuestion = enterQuizCategory('1', provider);
      const correctness = Array.from(
        { length: 5 },
        (_, index) => index < correctCount,
      );

      const result = completeRound(firstQuestion, correctness, provider);

      expect(result.screen).toEqual({
        type: 'CON',
        text: `The spirits are pleased (${correctCount}/5)\n1.Again 0.Back`,
      });
      expect(result.state.quiz.roundCorrect).toBe(correctCount);
      expect(result.state.acceptedAnswers).toHaveLength(5);
      expect(result.state.hauntScore).toBe(correctCount);
      expect(provider.callCount).toBe(0);
    },
  );

  it('starts another round in the same category and preserves the running score', () => {
    const provider = createSuccessfulAIProvider();
    const firstQuestion = enterQuizCategory('3', provider);
    const firstResult = completeRound(
      firstQuestion,
      [true, false, true, false, false],
      provider,
    );
    const firstRoundIds = [...firstResult.state.quiz.questionIds];
    const firstRoundLedger = clone(firstResult.state.acceptedAnswers);

    const repeatedRound = localStep(firstResult.state, '1', provider);

    expect(repeatedRound.state.view.kind).toBe('quiz-question');
    expect(repeatedRound.state.quiz).toMatchObject({
      roundId: 2,
      category: 'programming',
      questionIndex: 0,
      roundCorrect: 0,
      roundAcceptanceIds: [],
    });
    expect(repeatedRound.state.quiz.questionIds).toHaveLength(5);
    expect(
      repeatedRound.state.quiz.questionIds.every(
        (questionId) => getQuestion(questionId)?.category === 'programming',
      ),
    ).toBe(true);
    expect(repeatedRound.state.quiz.questionIds).not.toEqual(firstRoundIds);
    expect(repeatedRound.state.acceptedAnswers).toEqual(firstRoundLedger);
    expect(repeatedRound.state.hauntScore).toBe(2);

    const repeatedQuestion = getQuestion(repeatedRound.state.view.questionId);
    const repeatedFeedback = localStep(
      repeatedRound.state,
      repeatedQuestion.correctAnswer,
      provider,
    );

    expect(repeatedFeedback.state.acceptedAnswers).toHaveLength(6);
    expect(repeatedFeedback.state.acceptedAnswers.at(-1)).toMatchObject({
      roundId: 2,
      questionId: repeatedQuestion.id,
      correct: true,
    });
    expect(repeatedFeedback.state.quiz.roundCorrect).toBe(1);
    expect(repeatedFeedback.state.hauntScore).toBe(3);
    expect(provider.callCount).toBe(0);
  });

  it('returns from a completed result directly to Quiz Categories without changing progress', () => {
    const provider = createSuccessfulAIProvider();
    const firstQuestion = enterQuizCategory('4', provider);
    const result = completeRound(
      firstQuestion,
      [false, true, false, true, false],
      provider,
    );
    const ledger = clone(result.state.acceptedAnswers);
    const quiz = clone(result.state.quiz);

    const categories = localStep(result.state, '0', provider);

    expect(categories.state.view).toEqual({ kind: 'quiz-categories' });
    expect(categories.state.history).toEqual([{ view: { kind: 'main' } }]);
    expect(categories.state.quiz).toEqual(quiz);
    expect(categories.state.acceptedAnswers).toEqual(ledger);
    expect(categories.state.hauntScore).toBe(2);
    expect(categories.screen.text).toContain('1 Maths');
    expect(categories.screen.text).toContain('4 General');
    expect(provider.callCount).toBe(0);
  });
});
