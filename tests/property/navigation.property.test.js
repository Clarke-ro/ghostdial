import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  EXIT_MESSAGE,
  INVALID_CHOICE_MESSAGE,
  renderScreen,
} from '../../src/engine/menus.js';
import { next } from '../../src/engine/ussd.js';
import {
  buildAcceptedAnswer,
  buildActiveViewState,
  buildEndedState,
  buildFreshState,
} from '../support/state-builders.js';
import { createSuccessfulAIProvider } from '../support/mock-ai-providers.js';

const DIAL_CODE = '*266#';

const arbitraryInput = fc.oneof(
  fc.constant(DIAL_CODE),
  fc.constantFrom('', '*266', '266#', ' *266#', '*266# ', '*0266#'),
  fc
    .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 40 })
    .map((codeUnits) => String.fromCharCode(...codeUnits)),
);

const endedStateArbitrary = fc
  .record({
    category: fc.constantFrom('maths', 'physics', 'programming', 'general'),
    correctness: fc.array(fc.boolean(), { maxLength: 15 }),
    retainQuiz: fc.boolean(),
  })
  .map(({ category, correctness, retainQuiz }) => {
    const acceptedAnswers = correctness.map((correct, index) => {
      const roundId = Math.floor(index / 5) + 1;
      const questionId = `${category}-${(index % 5) + 1}`;

      return buildAcceptedAnswer({
        roundId,
        questionId,
        submittedAnswer: correct ? '1' : '2',
        correct,
        correctAnswer: '1',
      });
    });

    let quiz = null;
    if (retainQuiz) {
      const roundId = Math.floor(Math.max(correctness.length - 1, 0) / 5) + 1;
      const roundAnswers = acceptedAnswers.filter(
        (answer) => answer.roundId === roundId,
      );

      quiz = {
        roundId,
        category,
        questionIds: Array.from(
          { length: 5 },
          (_, index) => `${category}-${index + 1}`,
        ),
        questionIndex: Math.min(roundAnswers.length, 4),
        roundCorrect: roundAnswers.filter((answer) => answer.correct).length,
        roundAcceptanceIds: roundAnswers.map((answer) => answer.id),
      };
    }

    return buildEndedState({ quiz, acceptedAnswers });
  });

const absentOrEndedStateArbitrary = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  endedStateArbitrary,
);

function expectFreshMainMenu(result) {
  expect(result.state).toEqual(buildFreshState());
  expect(result.state.view).toEqual({ kind: 'main' });
  expect(result.state.hauntScore).toBe(0);
  expect(result.state.quiz).toBeNull();
  expect(result.state.acceptedAnswers).toEqual([]);
  expect(result.screen.type).toBe('CON');
}

describe('session lifecycle properties', () => {
  it('Feature: ussd-menu-engine, Property 2: Exact Session Start and Restart Isolation', () => {
    // **Validates: Requirements 2.1, 2.3, 2.4, 2.7, 8.1**
    fc.assert(
      fc.property(
        absentOrEndedStateArbitrary,
        arbitraryInput,
        (state, input) => {
          expectFreshMainMenu(next(state, DIAL_CODE));

          const result = next(state, input);
          if (input === DIAL_CODE) {
            expectFreshMainMenu(result);
            return;
          }

          expect(result.state).not.toEqual(buildFreshState());

          if (state == null) {
            expect(result.screen.type).toBe('END');
            return;
          }

          expect(result.state).toEqual(state);
          expect(result.screen).toEqual({
            type: 'END',
            text: EXIT_MESSAGE,
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});

const navigationCharacterArbitrary = fc.constantFrom(
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '*',
  '#',
);

const navigationInputArbitrary = fc
  .array(navigationCharacterArbitrary, { minLength: 1, maxLength: 24 })
  .map((characters) => characters.join(''));

const outsideNavigationCharacterArbitrary = fc
  .integer({ min: 0, max: 0xffff })
  .filter((codeUnit) => !/[0-9*#]/.test(String.fromCharCode(codeUnit)))
  .map((codeUnit) => String.fromCharCode(codeUnit));

const outsideNavigationInputArbitrary = fc
  .tuple(
    fc.array(navigationCharacterArbitrary, { maxLength: 12 }),
    outsideNavigationCharacterArbitrary,
    fc.array(navigationCharacterArbitrary, { maxLength: 12 }),
  )
  .map(([prefix, outsideCharacter, suffix]) =>
    [...prefix, outsideCharacter, ...suffix].join(''));

const activeMainMenuStateArbitrary = fc
  .array(fc.boolean(), { maxLength: 20 })
  .map((correctness) => {
    const acceptedAnswers = correctness.map((correct, index) =>
      buildAcceptedAnswer({
        roundId: index + 1,
        questionId: `maths-${(index % 5) + 1}`,
        submittedAnswer: correct ? '1' : '2',
        correct,
        correctAnswer: '1',
      }));

    return buildActiveViewState(
      { kind: 'main' },
      { acceptedAnswers },
    );
  });

const supportedMainMenuInputs = new Set(['0', '00', '1', '2', '3', '4', '5']);

function expectExactInvalidChoice(state, result) {
  expect(result.state).toEqual({ ...state, notice: 'invalid' });
  expect(result.screen).toEqual({
    type: 'CON',
    text: `${renderScreen(state).text}\n${INVALID_CHOICE_MESSAGE}`,
  });
}

describe('menu input properties', () => {
  it('Feature: ussd-menu-engine, Property 3: Menu Input Alphabet and Invalid-Choice Stability', () => {
    // **Validates: Requirements 3.1, 3.2, 3.3, 10.6**
    fc.assert(
      fc.property(
        activeMainMenuStateArbitrary,
        navigationInputArbitrary,
        outsideNavigationInputArbitrary,
        (state, navigationInput, outsideNavigationInput) => {
          const stateSnapshot = structuredClone(state);
          const navigationProvider = createSuccessfulAIProvider();
          const navigationResult = next(
            state,
            navigationInput,
            navigationProvider,
          );

          expect(navigationResult).not.toBeInstanceOf(Promise);
          expect(navigationProvider.callCount).toBe(0);

          if (supportedMainMenuInputs.has(navigationInput)) {
            expect(navigationResult.state.notice).toBeNull();
            expect(navigationResult.screen.text).not.toContain(
              INVALID_CHOICE_MESSAGE,
            );
          } else {
            expectExactInvalidChoice(state, navigationResult);
          }

          const outsideProvider = createSuccessfulAIProvider();
          const outsideResult = next(
            state,
            outsideNavigationInput,
            outsideProvider,
          );

          expect(outsideResult).not.toBeInstanceOf(Promise);
          expectExactInvalidChoice(state, outsideResult);
          expect(outsideProvider.callCount).toBe(0);
          expect(state).toEqual(stateSnapshot);
        },
      ),
      { numRuns: 200 },
    );
  });
});

const EXPECTED_MAIN_MENU = [
  'GhostDial Main Menu',
  '1 Ask the Oracle',
  '2 Quiz Me',
  '3 Exam Survival',
  "4 Explain Like I'm 5",
  '5 My Haunt Score',
  '0 Exit',
].join('\n');

const MAIN_MENU_ROUTE_EXPECTATIONS = Object.freeze({
  1: Object.freeze({
    view: Object.freeze({ kind: 'question', mode: 'oracle' }),
    text: 'Ask the Oracle your study question.\n0.Back 00.Home',
  }),
  2: Object.freeze({
    view: Object.freeze({ kind: 'quiz-categories' }),
    text: [
      'Choose a haunted quiz:',
      '1 Maths',
      '2 Physics',
      '3 Programming',
      '4 General',
      '0.Back 00.Home',
    ].join('\n'),
  }),
  3: Object.freeze({
    view: Object.freeze({ kind: 'exam-menu' }),
    text: [
      'Exam Survival',
      '1 Study plan',
      '2 Exam-day tips',
      '3 Beat stress',
      '0.Back 00.Home',
    ].join('\n'),
  }),
  4: Object.freeze({
    view: Object.freeze({ kind: 'question', mode: 'eli5' }),
    text: "What should the spirits explain simply?\n0.Back 00.Home",
  }),
  5: Object.freeze({
    view: Object.freeze({ kind: 'score' }),
  }),
});

describe('main menu routing properties', () => {
  it('Feature: ussd-menu-engine, Property 4: Exact Main Menu Routing', () => {
    // **Validates: Requirements 2.2, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 10.4, 10.7**
    fc.assert(
      fc.property(activeMainMenuStateArbitrary, (state) => {
        expect(renderScreen(state)).toEqual({
          type: 'CON',
          text: EXPECTED_MAIN_MENU,
        });

        for (const [input, expected] of Object.entries(
          MAIN_MENU_ROUTE_EXPECTATIONS,
        )) {
          const provider = createSuccessfulAIProvider();
          const result = next(state, input, provider);

          expect(result).not.toBeInstanceOf(Promise);
          expect(provider.callCount).toBe(0);
          expect(result.state).toEqual({
            ...state,
            view: expected.view,
            history: [{ view: { kind: 'main' } }],
            notice: null,
          });
          expect(result.screen.type).toBe('CON');
          expect(result.screen.text).toBe(
            input === '5'
              ? `Your Haunt Score is ${state.hauntScore}.\n0.Back 00.Home`
              : expected.text,
          );
        }

        const exitProvider = createSuccessfulAIProvider();
        const exitResult = next(state, '0', exitProvider);

        expect(exitResult).not.toBeInstanceOf(Promise);
        expect(exitProvider.callCount).toBe(0);
        expect(exitResult.state).toEqual({
          version: 1,
          status: 'ended',
          view: { kind: 'ended' },
          history: [],
          quiz: null,
          acceptedAnswers: state.acceptedAnswers,
          hauntScore: state.hauntScore,
          notice: null,
        });
        expect(exitResult.screen).toEqual({
          type: 'END',
          text: EXIT_MESSAGE,
        });
      }),
      { numRuns: 200 },
    );
  });
});
