import { describe, expect, it } from 'vitest';
import { next } from '../../src/engine/ussd.js';
import {
  EXIT_MESSAGE,
  INVALID_CHOICE_MESSAGE,
  LOCAL_TIPS,
  renderScreen,
} from '../../src/engine/menus.js';
import { getQuestion } from '../../src/engine/quiz-bank.js';
import {
  createLongAnswerAIProvider,
  createNonStringAIProvider,
  createRejectingAIProvider,
  createSuccessfulAIProvider,
  createThrowingAIProvider,
} from '../support/mock-ai-providers.js';

const AI_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const AI_FINAL_SUFFIX = '\n0.Back 00.Home';
const TIP_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const TIP_FINAL_SUFFIX = '\n0.Back';

function serializeState(state) {
  const serialized = JSON.stringify(state);
  expect(typeof serialized).toBe('string');
  const parsed = JSON.parse(serialized);
  expect(parsed).toEqual(state);
  return parsed;
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function validateAndSerializeResult(result) {
  expect(Object.keys(result).sort()).toEqual(['screen', 'state']);
  expect(Object.keys(result.screen).sort()).toEqual(['text', 'type']);
  expect(['CON', 'END']).toContain(result.screen.type);
  expect(result.screen.text.length).toBeLessThanOrEqual(160);
  expect(result.screen.type).toBe(
    result.state.status === 'active' ? 'CON' : 'END',
  );

  const parsedState = serializeState(result.state);
  expect(renderScreen(parsedState)).toEqual(result.screen);

  return { state: parsedState, screen: result.screen };
}

function syncStep(state, input, provider) {
  const transitionState = state == null ? state : serializeState(state);
  const before = transitionState == null ? transitionState : serializeState(transitionState);
  if (transitionState != null) {
    deepFreeze(transitionState);
  }
  const callsBefore = provider.callCount;

  const result = next(transitionState, input, provider);

  expect(result).not.toBeInstanceOf(Promise);
  expect(provider.callCount).toBe(callsBefore);
  expect(transitionState).toEqual(before);
  return validateAndSerializeResult(result);
}

async function aiStep(state, input, provider) {
  const transitionState = serializeState(state);
  const before = serializeState(transitionState);
  deepFreeze(transitionState);
  const callsBefore = provider.callCount;

  const pending = next(transitionState, input, provider);

  expect(pending).toBeInstanceOf(Promise);
  const result = await pending;
  expect(provider.callCount).toBe(callsBefore + 1);
  expect(transitionState).toEqual(before);
  return validateAndSerializeResult(result);
}

function stripPages(pages, nonFinalSuffix, finalSuffix) {
  return pages.map((page, index) => {
    const suffix = index === pages.length - 1
      ? finalSuffix
      : nonFinalSuffix;
    expect(page.endsWith(suffix)).toBe(true);
    expect(page.length).toBeLessThanOrEqual(160);
    return page.slice(0, -suffix.length);
  }).join('');
}

function incorrectOption(question) {
  return question.correctAnswer === '1' ? '2' : '1';
}

function completeQuizRound(
  firstQuestion,
  correctness,
  provider,
  { revisitFirstQuestion = false } = {},
) {
  let current = firstQuestion;
  const startingAccepted = current.state.acceptedAnswers.length;
  const startingScore = current.state.hauntScore;
  let expectedCorrect = 0;

  correctness.forEach((shouldBeCorrect, questionIndex) => {
    const question = getQuestion(current.state.view.questionId);
    expect(question.category).toBe(current.state.quiz.category);
    const answer = shouldBeCorrect
      ? question.correctAnswer
      : incorrectOption(question);

    current = syncStep(current.state, answer, provider);
    expectedCorrect += shouldBeCorrect ? 1 : 0;
    expect(current.state.acceptedAnswers).toHaveLength(
      startingAccepted + questionIndex + 1,
    );
    expect(current.state.hauntScore).toBe(startingScore + expectedCorrect);

    if (questionIndex < 4) {
      expect(current.state.view.kind).toBe('quiz-feedback');
      expect(current.screen.text).toMatch(/1\.Next 0\.Back$/);

      if (questionIndex === 0 && revisitFirstQuestion) {
        const feedback = current;
        const historicalQuestion = syncStep(feedback.state, '0', provider);
        expect(historicalQuestion.state.view.questionId).toBe(question.id);

        current = syncStep(
          historicalQuestion.state,
          shouldBeCorrect ? incorrectOption(question) : question.correctAnswer,
          provider,
        );
        expect(current.state.acceptedAnswers).toHaveLength(startingAccepted + 1);
        expect(current.state.hauntScore).toBe(startingScore + expectedCorrect);
        expect(current.state.view).toEqual(feedback.state.view);
      }

      current = syncStep(current.state, '1', provider);
      expect(current.state.view).toMatchObject({
        kind: 'quiz-question',
        questionNumber: questionIndex + 2,
      });
    }
  });

  expect(current.state.view.kind).toBe('quiz-result');
  expect(current.state.quiz.roundCorrect).toBe(expectedCorrect);
  expect(current.screen.text).toBe(
    `The spirits are pleased (${expectedCorrect}/5)\n1.Again 0.Back`,
  );
  expect(current.state.acceptedAnswers).toHaveLength(startingAccepted + 5);
  return current;
}

describe('complete engine integration with serialized transition boundaries', () => {
  it('round-trips lifecycle, Oracle and ELI5 success, paging, controls, and provider failures', async () => {
    const localProvider = createSuccessfulAIProvider('unused local answer');
    let current = syncStep(null, '*266#', localProvider);

    expect(current.state).toEqual({
      version: 1,
      status: 'active',
      view: { kind: 'main' },
      history: [],
      quiz: null,
      acceptedAnswers: [],
      hauntScore: 0,
      notice: null,
    });
    for (const option of [
      '1 Ask the Oracle',
      '2 Quiz Me',
      '3 Exam Survival',
      "4 Explain Like I'm 5",
      '5 My Haunt Score',
      '0 Exit',
    ]) {
      expect(current.screen.text).toContain(option);
    }

    current = syncStep(current.state, '1', localProvider);
    expect(current.state.view).toEqual({ kind: 'question', mode: 'oracle' });

    const oracleAnswer = Array.from(
      { length: 18 },
      (_, index) => `Spectral step ${index + 1} explains the chapter carefully.`,
    ).join(' ');
    const oracleProvider = createLongAnswerAIProvider({ answer: oracleAnswer });
    current = await aiStep(
      current.state,
      'How should I revise this chapter?',
      oracleProvider,
    );
    expect(oracleProvider.calls).toEqual([{
      mode: 'oracle',
      question: 'How should I revise this chapter?',
    }]);
    expect(current.state.view.pages.length).toBeGreaterThan(1);
    expect(stripPages(
      current.state.view.pages,
      AI_NON_FINAL_SUFFIX,
      AI_FINAL_SUFFIX,
    )).toBe(oracleAnswer);

    while (current.state.view.pageIndex < current.state.view.pages.length - 1) {
      const previousIndex = current.state.view.pageIndex;
      current = syncStep(current.state, '1', oracleProvider);
      expect(current.state.view.pageIndex).toBe(previousIndex + 1);
    }

    current = syncStep(current.state, '1', oracleProvider);
    expect(current.state.notice).toBe('invalid');
    expect(current.screen.text).toContain(INVALID_CHOICE_MESSAGE);
    current = syncStep(current.state, '0', oracleProvider);
    expect(current.state.view).toEqual({ kind: 'question', mode: 'oracle' });
    current = syncStep(current.state, '00', oracleProvider);
    expect(current.state.view).toEqual({ kind: 'main' });

    current = syncStep(current.state, '4', localProvider);
    expect(current.state.view).toEqual({ kind: 'question', mode: 'eli5' });
    const eli5Provider = createSuccessfulAIProvider(
      'A tiny friendly ghost uses one simple example.',
    );
    current = await aiStep(current.state, '00 is part of my question', eli5Provider);
    expect(eli5Provider.calls).toEqual([{
      mode: 'eli5',
      question: '00 is part of my question',
    }]);
    expect(current.state.view.kind).toBe('answer');
    expect(current.state.view.pages).toHaveLength(1);
    current = syncStep(current.state, '00', eli5Provider);

    current = syncStep(current.state, '1', localProvider);
    const rejectingProvider = createRejectingAIProvider(
      new Error('private rejected-provider detail'),
    );
    current = await aiStep(current.state, 'Why did the signal fail?', rejectingProvider);
    expect(current.state.view.kind).toBe('ai-error');
    expect(current.screen.text).not.toContain('private rejected-provider detail');
    current = syncStep(current.state, '0', rejectingProvider);
    expect(current.state.view).toEqual({ kind: 'question', mode: 'oracle' });
    current = syncStep(current.state, '00', rejectingProvider);

    current = syncStep(current.state, '4', localProvider);
    const throwingProvider = createThrowingAIProvider(
      new Error('private thrown-provider detail'),
    );
    current = await aiStep(current.state, 'Explain failure simply', throwingProvider);
    expect(current.state.view.kind).toBe('ai-error');
    expect(current.screen.text).not.toContain('private thrown-provider detail');
    current = syncStep(current.state, '00', throwingProvider);

    current = syncStep(current.state, '4', localProvider);
    const nonStringProvider = createNonStringAIProvider({ answer: 'wrong shape' });
    current = await aiStep(current.state, 'Can this result be used?', nonStringProvider);
    expect(current.state.view.kind).toBe('ai-error');
    current = syncStep(current.state, '00', nonStringProvider);

    expect(current.state.view).toEqual({ kind: 'main' });
    expect(localProvider.callCount).toBe(0);
  });

  it('round-trips every quiz category, a repeated round, duplicate prevention, and Haunt Score', () => {
    const provider = createSuccessfulAIProvider('must never be requested');
    let current = syncStep(null, '*266#', provider);
    current = syncStep(current.state, '2', provider);
    expect(current.state.view).toEqual({ kind: 'quiz-categories' });

    const rounds = [
      ['1', 'maths', [true, false, true, false, true]],
      ['2', 'physics', [true, true, true, true, true]],
      ['3', 'programming', [false, false, false, false, false]],
      ['4', 'general', [true, true, false, false, true]],
    ];

    current = syncStep(current.state, rounds[0][0], provider);
    expect(current.state.quiz.category).toBe('maths');
    expect(current.state.quiz.questionIds).toHaveLength(5);
    expect(current.state.quiz.questionIndex).toBe(0);
    expect(current.state.quiz.roundCorrect).toBe(0);
    current = completeQuizRound(current, rounds[0][2], provider, {
      revisitFirstQuestion: true,
    });

    const firstMathRoundId = current.state.quiz.roundId;
    current = syncStep(current.state, '1', provider);
    expect(current.state.quiz.category).toBe('maths');
    expect(current.state.quiz.roundId).toBeGreaterThan(firstMathRoundId);
    expect(current.state.quiz.questionIndex).toBe(0);
    expect(current.state.quiz.roundCorrect).toBe(0);
    expect(current.state.hauntScore).toBe(3);
    current = completeQuizRound(
      current,
      [false, true, false, true, false],
      provider,
    );
    expect(current.state.hauntScore).toBe(5);
    current = syncStep(current.state, '0', provider);

    for (const [option, category, correctness] of rounds.slice(1)) {
      current = syncStep(current.state, option, provider);
      expect(current.state.quiz.category).toBe(category);
      expect(current.state.quiz.questionIds).toHaveLength(5);
      expect(new Set(current.state.quiz.questionIds).size).toBe(5);
      expect(current.state.quiz.questionIds.every(
        (questionId) => getQuestion(questionId).category === category,
      )).toBe(true);
      current = completeQuizRound(current, correctness, provider);
      current = syncStep(current.state, '0', provider);
      expect(current.state.view.kind).toBe('quiz-categories');
    }

    expect(current.state.acceptedAnswers).toHaveLength(25);
    expect(new Set(current.state.acceptedAnswers.map(({ id }) => id)).size).toBe(25);
    expect(current.state.hauntScore).toBe(13);
    expect(current.state.hauntScore).toBe(
      current.state.acceptedAnswers.filter(({ correct }) => correct).length,
    );

    current = syncStep(current.state, '00', provider);
    current = syncStep(current.state, '5', provider);
    expect(current.screen.text).toBe('Your Haunt Score is 13.\n0.Back 00.Home');
    current = syncStep(current.state, '9', provider);
    expect(current.state.notice).toBe('invalid');
    expect(current.screen.text).toContain(INVALID_CHOICE_MESSAGE);
    current = syncStep(current.state, '0', provider);
    expect(current.state.view).toEqual({ kind: 'main' });
    expect(current.state.hauntScore).toBe(13);
    expect(provider.callCount).toBe(0);
  });

  it('round-trips every local Exam Survival topic, Home, exit, ended absorption, and restart', () => {
    const provider = createSuccessfulAIProvider('must never be requested');
    let current = syncStep(null, '*266#', provider);
    current = syncStep(current.state, '3', provider);
    expect(current.state.view).toEqual({ kind: 'exam-menu' });

    const topics = [
      ['1', 'studyPlan'],
      ['2', 'examDay'],
      ['3', 'beatStress'],
    ];

    topics.forEach(([option, topic], topicIndex) => {
      current = syncStep(current.state, option, provider);
      expect(current.state.view).toMatchObject({
        kind: 'tip',
        topic,
        pageIndex: 0,
      });

      if (topicIndex === 0) {
        const home = syncStep(current.state, '00', provider);
        expect(home.state.view).toEqual({ kind: 'main' });
        const examMenu = syncStep(home.state, '3', provider);
        current = syncStep(examMenu.state, option, provider);
      }

      const pages = current.state.view.pages;
      expect(stripPages(
        pages,
        TIP_NON_FINAL_SUFFIX,
        TIP_FINAL_SUFFIX,
      )).toBe(LOCAL_TIPS[topic]);

      while (current.state.view.pageIndex < pages.length - 1) {
        const previousIndex = current.state.view.pageIndex;
        current = syncStep(current.state, '1', provider);
        expect(current.state.view.pageIndex).toBe(previousIndex + 1);
      }

      current = syncStep(current.state, '0', provider);
      expect(current.state.view).toEqual({ kind: 'exam-menu' });
    });

    current = syncStep(current.state, '0', provider);
    expect(current.state.view).toEqual({ kind: 'main' });
    current = syncStep(current.state, '0', provider);
    expect(current.screen).toEqual({ type: 'END', text: EXIT_MESSAGE });

    const endedState = serializeState(current.state);
    current = syncStep(current.state, 'anything', provider);
    expect(current.state).toEqual(endedState);
    expect(current.screen).toEqual({ type: 'END', text: EXIT_MESSAGE });

    current = syncStep(current.state, '*266#', provider);
    expect(current.state).toEqual({
      version: 1,
      status: 'active',
      view: { kind: 'main' },
      history: [],
      quiz: null,
      acceptedAnswers: [],
      hauntScore: 0,
      notice: null,
    });
    expect(current.screen.type).toBe('CON');
    expect(provider.callCount).toBe(0);
  });
});
