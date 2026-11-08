import { describe, expect, it } from 'vitest';
import { next } from '../../src/engine/ussd.js';
import {
  EXIT_MESSAGE,
  INVALID_CHOICE_MESSAGE,
  renderScreen,
} from '../../src/engine/menus.js';
import {
  buildAcceptedAnswer,
  buildActiveViewState,
  buildEndedState,
  buildFreshState,
} from '../support/state-builders.js';
import { createSuccessfulAIProvider } from '../support/mock-ai-providers.js';

const DIAL_CODE = '*266#';

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
    Object.freeze(value);
  }

  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectSynchronousTransition(result) {
  expect(result).not.toBeInstanceOf(Promise);
  expect(result).toEqual({
    state: result.state,
    screen: renderScreen(result.state),
  });
}

function expectFreshSession(result) {
  expect(result).toEqual({
    state: buildFreshState(),
    screen: renderScreen(buildFreshState()),
  });
}

function expectSameContextWithInvalidNotice(before, result) {
  expect(result.state).toEqual({ ...before, notice: 'invalid' });
  expect(result.screen).toEqual({
    type: 'CON',
    text: `${renderScreen(before).text}\n${INVALID_CHOICE_MESSAGE}`,
  });
}

describe('session lifecycle', () => {
  it.each([null, undefined])(
    'starts a fresh synchronous session from an absent %s state only with the exact Dial Code',
    (absentState) => {
      const provider = createSuccessfulAIProvider();
      const result = next(absentState, DIAL_CODE, provider);

      expectSynchronousTransition(result);
      expectFreshSession(result);
      expect(provider.callCount).toBe(0);
    },
  );

  it('restarts an ended session with isolated score, quiz, ledger, history, and notice data', () => {
    const acceptedAnswer = buildAcceptedAnswer({
      roundId: 7,
      questionId: 'physics-2',
      submittedAnswer: '3',
      correct: true,
      correctAnswer: '3',
    });
    const ended = buildEndedState({
      quiz: {
        roundId: 7,
        category: 'physics',
        questionIds: ['physics-1', 'physics-2', 'physics-3', 'physics-4', 'physics-5'],
        questionIndex: 4,
        roundCorrect: 1,
        roundAcceptanceIds: [acceptedAnswer.id],
      },
      acceptedAnswers: [acceptedAnswer],
      hauntScore: 1,
    });
    const before = clone(ended);
    deepFreeze(ended);
    const provider = createSuccessfulAIProvider();

    const result = next(ended, DIAL_CODE, provider);

    expectSynchronousTransition(result);
    expectFreshSession(result);
    expect(ended).toEqual(before);
    expect(result.state).not.toBe(ended);
    expect(provider.callCount).toBe(0);
  });

  it.each(['', '0', '00', '1', '*266# ', 'anything else'])(
    'absorbs non-Dial-Code input %j and preserves the complete ended session',
    (input) => {
      const acceptedAnswer = buildAcceptedAnswer();
      const ended = buildEndedState({
        quiz: {
          roundId: 1,
          category: 'maths',
          questionIds: ['maths-1', 'maths-2', 'maths-3', 'maths-4', 'maths-5'],
          questionIndex: 2,
          roundCorrect: 1,
          roundAcceptanceIds: [acceptedAnswer.id],
        },
        acceptedAnswers: [acceptedAnswer],
        hauntScore: 1,
      });
      const before = clone(ended);
      deepFreeze(ended);
      const provider = createSuccessfulAIProvider();

      const result = next(ended, input, provider);

      expectSynchronousTransition(result);
      expect(result.state).toBe(ended);
      expect(result.state).toEqual(before);
      expect(result.screen).toEqual({ type: 'END', text: EXIT_MESSAGE });
      expect(provider.callCount).toBe(0);
    },
  );

  it('ends the session on exact Back from Main Menu while preserving session progress', () => {
    const acceptedAnswer = buildAcceptedAnswer();
    const state = buildActiveViewState(
      { kind: 'main' },
      {
        quiz: {
          roundId: 1,
          category: 'maths',
          questionIds: ['maths-1', 'maths-2', 'maths-3', 'maths-4', 'maths-5'],
          questionIndex: 0,
          roundCorrect: 1,
          roundAcceptanceIds: [acceptedAnswer.id],
        },
        acceptedAnswers: [acceptedAnswer],
        hauntScore: 1,
      },
    );
    const before = clone(state);
    deepFreeze(state);
    const provider = createSuccessfulAIProvider();

    const result = next(state, '0', provider);

    expectSynchronousTransition(result);
    expect(result.screen).toEqual({ type: 'END', text: EXIT_MESSAGE });
    expect(result.state).toMatchObject({
      version: 1,
      status: 'ended',
      view: { kind: 'ended' },
      history: [],
      quiz: before.quiz,
      acceptedAnswers: before.acceptedAnswers,
      hauntScore: 1,
      notice: null,
    });
    expect(state).toEqual(before);
    expect(provider.callCount).toBe(0);
  });
});

describe('Main Menu routing', () => {
  const routes = [
    ['1', { kind: 'question', mode: 'oracle' }],
    ['2', { kind: 'quiz-categories' }],
    ['3', { kind: 'exam-menu' }],
    ['4', { kind: 'question', mode: 'eli5' }],
    ['5', { kind: 'score' }],
  ];

  it.each(routes)('routes exact option %s to its specified view', (input, expectedView) => {
    const acceptedAnswer = buildAcceptedAnswer();
    const state = buildActiveViewState(
      { kind: 'main' },
      { acceptedAnswers: [acceptedAnswer], hauntScore: 1 },
    );
    const before = clone(state);
    deepFreeze(state);
    const provider = createSuccessfulAIProvider();

    const result = next(state, input, provider);

    expectSynchronousTransition(result);
    expect(result.state).toEqual({
      ...before,
      view: expectedView,
      history: [{ view: { kind: 'main' } }],
      notice: null,
    });
    expect(result.screen.type).toBe('CON');
    if (input === '5') {
      expect(result.screen.text).toContain('Your Haunt Score is 1.');
    }
    expect(state).toEqual(before);
    expect(provider.callCount).toBe(0);
  });
});

describe('Back, Home, invalid navigation, and deep immutability', () => {
  it('pops exactly one nested Previous Screen on Back and clears an old notice', () => {
    const state = buildActiveViewState(
      { kind: 'score' },
      {
        history: [
          { view: { kind: 'main' } },
          { view: { kind: 'exam-menu' } },
        ],
        notice: 'invalid',
      },
    );
    const before = clone(state);
    deepFreeze(state);
    const provider = createSuccessfulAIProvider();

    const result = next(state, '0', provider);

    expectSynchronousTransition(result);
    expect(result.state).toEqual({
      ...before,
      view: { kind: 'exam-menu' },
      history: [{ view: { kind: 'main' } }],
      notice: null,
    });
    expect(state).toEqual(before);
    expect(provider.callCount).toBe(0);
  });

  it('opens Main Menu and clears the complete navigation stack on Home', () => {
    const acceptedAnswer = buildAcceptedAnswer();
    const state = buildActiveViewState(
      { kind: 'quiz-categories' },
      {
        history: [
          { view: { kind: 'main' } },
          { view: { kind: 'exam-menu' } },
        ],
        quiz: {
          roundId: 1,
          category: 'maths',
          questionIds: ['maths-1', 'maths-2', 'maths-3', 'maths-4', 'maths-5'],
          questionIndex: 0,
          roundCorrect: 1,
          roundAcceptanceIds: [acceptedAnswer.id],
        },
        acceptedAnswers: [acceptedAnswer],
        hauntScore: 1,
        notice: 'invalid',
      },
    );
    const before = clone(state);
    deepFreeze(state);
    const provider = createSuccessfulAIProvider();

    const result = next(state, '00', provider);

    expectSynchronousTransition(result);
    expect(result.state).toEqual({
      ...before,
      view: { kind: 'main' },
      history: [],
      notice: null,
    });
    expect(state).toEqual(before);
    expect(provider.callCount).toBe(0);
  });

  it.each([
    ['unsupported navigation value', '9'],
    ['multi-character unsupported navigation value', '123'],
    ['empty input outside the navigation alphabet', ''],
    ['letters outside the navigation alphabet', 'oracle'],
    ['whitespace outside the navigation alphabet', ' 1'],
    ['punctuation outside the navigation alphabet', '1!'],
  ])('preserves Main Menu context for an %s', (_case, input) => {
    const state = buildFreshState();
    const before = clone(state);
    deepFreeze(state);
    const provider = createSuccessfulAIProvider();

    const result = next(state, input, provider);

    expectSynchronousTransition(result);
    expectSameContextWithInvalidNotice(before, result);
    expect(state).toEqual(before);
    expect(provider.callCount).toBe(0);
  });

  it.each([
    ['quiz category menu', { kind: 'quiz-categories' }],
    ['Exam Survival menu', { kind: 'exam-menu' }],
  ])('preserves the complete nested %s context for unsupported input', (_name, view) => {
    const acceptedAnswer = buildAcceptedAnswer();
    const state = buildActiveViewState(view, {
      history: [{ view: { kind: 'main' } }],
      quiz: {
        roundId: 1,
        category: 'maths',
        questionIds: ['maths-1', 'maths-2', 'maths-3', 'maths-4', 'maths-5'],
        questionIndex: 2,
        roundCorrect: 1,
        roundAcceptanceIds: [acceptedAnswer.id],
      },
      acceptedAnswers: [acceptedAnswer],
      hauntScore: 1,
    });
    const before = clone(state);
    deepFreeze(state);
    const provider = createSuccessfulAIProvider();

    const result = next(state, '9#', provider);

    expectSynchronousTransition(result);
    expectSameContextWithInvalidNotice(before, result);
    expect(state).toEqual(before);
    expect(provider.callCount).toBe(0);
  });
});
