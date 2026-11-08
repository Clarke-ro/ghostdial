import { describe, expect, it } from 'vitest';
import { next } from '../../src/engine/ussd.js';
import { renderScreen } from '../../src/engine/menus.js';
import {
  buildAcceptedAnswer,
  buildActiveViewState,
} from '../support/state-builders.js';
import {
  createNonStringAIProvider,
  createRejectingAIProvider,
  createSuccessfulAIProvider,
  createThrowingAIProvider,
} from '../support/mock-ai-providers.js';

function buildPromptState(mode, options = {}) {
  return buildActiveViewState(
    { kind: 'question', mode },
    {
      history: [{ view: { kind: 'main' } }],
      ...options,
    },
  );
}

function expectSynchronousResult(result) {
  expect(result).not.toBeInstanceOf(Promise);
  expect(result.screen).toEqual(renderScreen(result.state));
}

describe('AI question prompt controls and requests', () => {
  it.each([
    ['oracle', '0'],
    ['oracle', '00'],
    ['eli5', '0'],
    ['eli5', '00'],
  ])('gives exact %s prompt control %j precedence without calling AI', (mode, input) => {
    const provider = createSuccessfulAIProvider('This answer must not be used.');
    const state = buildPromptState(mode, { notice: 'invalid' });

    const result = next(state, input, provider);

    expectSynchronousResult(result);
    expect(result.state.view).toEqual({ kind: 'main' });
    expect(result.state.history).toEqual([]);
    expect(result.state.notice).toBeNull();
    expect(provider.callCount).toBe(0);
  });

  it.each(
    ['oracle', 'eli5'].flatMap((mode) => [
      '',
      '10',
      '000',
      '0 question',
      ' 0',
      '00 please',
    ].map((question) => [mode, question])),
  )(
    'passes near-control free-form input unchanged in one %s request: %j',
    async (mode, question) => {
      const provider = createSuccessfulAIProvider('A clear answer from the fog.');
      const state = buildPromptState(mode);

      const transition = next(state, question, provider);

      expect(transition).toBeInstanceOf(Promise);
      const result = await transition;
      expect(provider.callCount).toBe(1);
      expect(provider.calls).toEqual([{ mode, question }]);
      expect(result.state.view).toMatchObject({
        kind: 'answer',
        mode,
        question,
        pageIndex: 0,
      });
      expect(result.screen).toEqual(renderScreen(result.state));
    },
  );

  it('preserves a complete question string and returns a native Promise for a synchronous provider', async () => {
    const question = '  Why is 0.00 different?\nKeep 👻 and trailing space.  ';
    const provider = createSuccessfulAIProvider('Because place value matters.');
    const state = buildPromptState('oracle');

    const transition = next(state, question, provider);

    expect(transition).toBeInstanceOf(Promise);
    const result = await transition;
    expect(provider.calls).toEqual([{ mode: 'oracle', question }]);
    expect(result.state.view.question).toBe(question);
    expect(result.screen.type).toBe('CON');
  });
});

describe('AI provider failure handling', () => {
  const failures = [
    [
      'synchronous throw',
      () => createThrowingAIProvider(new Error('SYNC_SECRET_42')),
      'SYNC_SECRET_42',
    ],
    [
      'rejected Promise',
      () => createRejectingAIProvider(new Error('REJECTION_SECRET_42')),
      'REJECTION_SECRET_42',
    ],
    [
      'non-string result',
      () => createNonStringAIProvider({ secret: 'OBJECT_SECRET_42' }),
      'OBJECT_SECRET_42',
    ],
  ];

  it.each(failures)(
    'resolves a friendly local error for a %s without leaking details',
    async (_label, createProvider, leakedDetail) => {
      const acceptedAnswer = buildAcceptedAnswer();
      const quiz = {
        roundId: 1,
        category: 'maths',
        questionIds: ['maths-1', 'maths-2', 'maths-3', 'maths-4', 'maths-5'],
        questionIndex: 0,
        roundCorrect: 1,
        roundAcceptanceIds: [acceptedAnswer.id],
      };
      const state = buildPromptState('eli5', {
        quiz,
        acceptedAnswers: [acceptedAnswer],
        hauntScore: 1,
      });
      const provider = createProvider();

      const transition = next(state, 'Explain gravity', provider);

      expect(transition).toBeInstanceOf(Promise);
      const result = await transition;
      expect(provider.callCount).toBe(1);
      expect(provider.calls).toEqual([
        { mode: 'eli5', question: 'Explain gravity' },
      ]);
      expect(result.state.view).toEqual({
        kind: 'ai-error',
        mode: 'eli5',
        question: 'Explain gravity',
      });
      expect(result.state.quiz).toEqual(quiz);
      expect(result.state.acceptedAnswers).toEqual([acceptedAnswer]);
      expect(result.state.hauntScore).toBe(1);
      expect(result.screen).toEqual({
        type: 'CON',
        text: 'The Oracle lost the signal in the fog. Please try again.\n0.Back 00.Home',
      });
      expect(result.screen.text).not.toContain(leakedDetail);
      expect(result.screen.text).not.toContain('[object Object]');
    },
  );
});
