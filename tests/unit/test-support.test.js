import { describe, expect, it } from 'vitest';
import {
  buildAcceptedAnswer,
  buildActiveViewState,
  buildAnswerState,
  buildEndedState,
  buildFreshState,
  buildQuizState,
  buildScoreState,
} from '../support/state-builders.js';
import {
  createLongAnswerAIProvider,
  createNonStringAIProvider,
  createRejectingAIProvider,
  createSuccessfulAIProvider,
  createThrowingAIProvider,
} from '../support/mock-ai-providers.js';

describe('shared state builders', () => {
  it('builds isolated fresh session states', () => {
    const first = buildFreshState();
    const second = buildFreshState();

    first.view.kind = 'changed';
    first.history.push({ view: { kind: 'score' } });
    first.acceptedAnswers.push(buildAcceptedAnswer());

    expect(second).toEqual({
      version: 1,
      status: 'active',
      view: { kind: 'main' },
      history: [],
      quiz: null,
      acceptedAnswers: [],
      hauntScore: 0,
      notice: null,
    });
  });

  it('copies nested values supplied to an active-view state', () => {
    const view = { kind: 'question', mode: 'eli5' };
    const history = [{ view: { kind: 'main' } }];
    const state = buildActiveViewState(view, { history });

    view.mode = 'oracle';
    history[0].view.kind = 'changed';

    expect(state.view).toEqual({ kind: 'question', mode: 'eli5' });
    expect(state.history).toEqual([{ view: { kind: 'main' } }]);
  });

  it('builds isolated answer states with their originating prompt', () => {
    const pages = ['first\n1.More 0.Back', 'second\n0.Back 00.Home'];
    const first = buildAnswerState({
      mode: 'eli5',
      question: 'What is gravity?',
      pages,
      pageIndex: 1,
    });
    const second = buildAnswerState();

    pages[0] = 'changed';
    first.view.pages[1] = 'also changed';
    first.history[0].view.mode = 'oracle';

    expect(first.view).toMatchObject({
      kind: 'answer',
      mode: 'eli5',
      question: 'What is gravity?',
      pageIndex: 1,
    });
    expect(first.view.pages[0]).toBe('first\n1.More 0.Back');
    expect(second.view.pages).toEqual([
      'A light source or object moved.\n0.Back 00.Home',
    ]);
    expect(second.history).toEqual([
      { view: { kind: 'question', mode: 'oracle' } },
    ]);
  });

  it('builds a valid quiz state and derives counts from copied answers', () => {
    const correct = buildAcceptedAnswer();
    const incorrect = buildAcceptedAnswer({
      questionId: 'maths-2',
      submittedAnswer: '3',
      correct: false,
      correctAnswer: '2',
    });
    const answers = [correct, incorrect];
    const state = buildQuizState({
      questionIndex: 2,
      acceptedAnswers: answers,
    });

    answers[0].correct = false;
    state.quiz.questionIds[0] = 'changed';

    expect(state.view).toEqual({
      kind: 'quiz-question',
      questionId: 'maths-3',
      questionNumber: 3,
    });
    expect(state.quiz).toMatchObject({
      roundId: 1,
      category: 'maths',
      questionIndex: 2,
      roundCorrect: 1,
      roundAcceptanceIds: ['1:maths-1', '1:maths-2'],
    });
    expect(state.quiz.questionIds).toHaveLength(5);
    expect(state.acceptedAnswers[0].correct).toBe(true);
    expect(state.hauntScore).toBe(1);
  });

  it('builds score and ended states with independent progress data', () => {
    const answer = buildAcceptedAnswer();
    const score = buildScoreState({ acceptedAnswers: [answer] });
    const ended = buildEndedState({ acceptedAnswers: [answer] });

    answer.correct = false;
    score.acceptedAnswers[0].correct = false;

    expect(score.view).toEqual({ kind: 'score' });
    expect(score.history).toEqual([{ view: { kind: 'main' } }]);
    expect(score.hauntScore).toBe(1);
    expect(ended).toMatchObject({
      version: 1,
      status: 'ended',
      view: { kind: 'ended' },
      history: [],
      hauntScore: 1,
      notice: null,
    });
    expect(ended.acceptedAnswers[0].correct).toBe(true);
  });
});

describe('mock AI providers', () => {
  const request = { mode: 'oracle', question: 'Why?' };

  it('records successful calls and can reset its spy history', () => {
    const provider = createSuccessfulAIProvider('Because moonlight bends.');

    expect(provider(request)).toBe('Because moonlight bends.');
    request.question = 'Changed later';

    expect(provider.callCount).toBe(1);
    expect(provider.calls).toEqual([{ mode: 'oracle', question: 'Why?' }]);
    expect(provider.lastRequest).toEqual({ mode: 'oracle', question: 'Why?' });

    provider.reset();
    expect(provider.callCount).toBe(0);
    expect(provider.lastRequest).toBeUndefined();
  });

  it('records a call before throwing synchronously', () => {
    const error = new Error('hidden failure');
    const provider = createThrowingAIProvider(error);

    expect(() => provider(request)).toThrow(error);
    expect(provider.callCount).toBe(1);
  });

  it('records a call and returns a rejected Promise', async () => {
    const error = new Error('hidden rejection');
    const provider = createRejectingAIProvider(error);
    const result = provider(request);

    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toBe(error);
    expect(provider.callCount).toBe(1);
  });

  it('returns configurable non-string values', () => {
    const value = { unexpected: true };
    const provider = createNonStringAIProvider(value);

    expect(provider(request)).toBe(value);
    expect(provider.callCount).toBe(1);
    expect(() => createNonStringAIProvider('not allowed')).toThrow(TypeError);
  });

  it('returns exact or generated deterministic long answers', () => {
    const exact = createLongAnswerAIProvider({ answer: 'x'.repeat(400) });
    const generated = createLongAnswerAIProvider({
      segment: 'ghost lesson',
      repetitions: 3,
      separator: '|',
    });

    expect(exact(request)).toBe('x'.repeat(400));
    expect(generated(request)).toBe(
      'ghost lesson|ghost lesson|ghost lesson',
    );
    expect(generated(request)).toBe(
      'ghost lesson|ghost lesson|ghost lesson',
    );
    expect(exact.callCount).toBe(1);
    expect(generated.callCount).toBe(2);
  });

  it('rejects invalid successful and long-answer configurations', () => {
    expect(() => createSuccessfulAIProvider(42)).toThrow(TypeError);
    expect(() => createLongAnswerAIProvider({ repetitions: 0 })).toThrow(
      RangeError,
    );
    expect(() => createLongAnswerAIProvider({ segment: 42 })).toThrow(TypeError);
  });
});
