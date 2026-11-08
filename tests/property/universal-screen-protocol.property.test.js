import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  EXIT_MESSAGE,
  INVALID_CHOICE_MESSAGE,
  LOCAL_TIPS,
} from '../../src/engine/menus.js';
import { getQuestion } from '../../src/engine/quiz-bank.js';
import { next } from '../../src/engine/ussd.js';
import {
  createSuccessfulAIProvider,
  createThrowingAIProvider,
} from '../support/mock-ai-providers.js';

const AI_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const AI_FINAL_SUFFIX = '\n0.Back 00.Home';
const TIP_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const TIP_FINAL_SUFFIX = '\n0.Back';
const INVALID_NOTICE_SUFFIX = `\n${INVALID_CHOICE_MESSAGE}`;

const MAIN_MENU_TEXT = [
  'GhostDial Main Menu',
  '1 Ask the Oracle',
  '2 Quiz Me',
  '3 Exam Survival',
  "4 Explain Like I'm 5",
  '5 My Haunt Score',
  '0 Exit',
].join('\n');

const CATEGORY_OPTIONS = Object.freeze(['1', '2', '3', '4']);
const TOPICS_BY_OPTION = Object.freeze({
  1: 'studyPlan',
  2: 'examDay',
  3: 'beatStress',
});

const safeAnswerCharacterArbitrary = fc.constantFrom(
  ...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?\n'.split(''),
);

const shortAnswerArbitrary = fc
  .array(safeAnswerCharacterArbitrary, { maxLength: 60 })
  .map((characters) => characters.join(''));

const longAnswerArbitrary = fc
  .array(safeAnswerCharacterArbitrary, { minLength: 180, maxLength: 360 })
  .map((characters) => characters.join(''));

const absorbedInputArbitrary = fc
  .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 30 })
  .map((codeUnits) => String.fromCharCode(...codeUnits))
  .filter((input) => input !== '*266#');

function expectScreenProtocol(result) {
  expect(result).toEqual({
    state: expect.any(Object),
    screen: {
      type: expect.stringMatching(/^(CON|END)$/),
      text: expect.any(String),
    },
  });
  expect(result.state.version).toBe(1);
  expect(JSON.parse(JSON.stringify(result.state))).toEqual(result.state);
  expect(result.screen.text.length).toBeLessThanOrEqual(160);

  if (result.state.status === 'active') {
    expect(result.screen.type).toBe('CON');
  } else {
    expect(result.state.status).toBe('ended');
    expect(result.screen.type).toBe('END');
  }

  if (result.state.notice === 'invalid') {
    expect(result.screen.text.endsWith(INVALID_NOTICE_SUFFIX)).toBe(true);
  }

  return result;
}

function transition(state, input) {
  const result = next(state, input);
  expect(result).not.toBeInstanceOf(Promise);
  return expectScreenProtocol(result);
}

async function aiTransition(state, input, provider) {
  const pending = next(state, input, provider);
  expect(pending).toBeInstanceOf(Promise);
  return expectScreenProtocol(await pending);
}

function expectInvalidTransition(validResult) {
  const invalidResult = transition(validResult.state, '9');

  expect(invalidResult.state).toEqual({
    ...validResult.state,
    notice: 'invalid',
  });
  expect(invalidResult.screen.text).toBe(
    `${validResult.screen.text}${INVALID_NOTICE_SUFFIX}`,
  );

  return invalidResult;
}

function contentWithoutPageSuffixes(pages, nonFinalSuffix, finalSuffix) {
  return pages.map((page, index) => {
    const suffix = index === pages.length - 1
      ? finalSuffix
      : nonFinalSuffix;

    expect(page.endsWith(suffix)).toBe(true);
    return page.slice(0, -suffix.length);
  }).join('');
}

function answerFor(questionId, shouldBeCorrect) {
  const question = getQuestion(questionId);

  if (shouldBeCorrect) {
    return question.correctAnswer;
  }

  return String((Number(question.correctAnswer) % 4) + 1);
}

describe('universal screen protocol property', () => {
  it('Feature: ussd-menu-engine, Property 14: Universal Screen Protocol', async () => {
    // **Validates: Requirements 2.2, 2.4, 5.4, 5.5, 7.5, 7.7, 7.8, 8.8, 9.2, 9.3, 9.4, 9.7, 9.8, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6**
    await fc.assert(
      fc.asyncProperty(
        shortAnswerArbitrary,
        longAnswerArbitrary,
        fc.constantFrom(...CATEGORY_OPTIONS),
        fc.array(fc.boolean(), { minLength: 5, maxLength: 5 }),
        absorbedInputArbitrary,
        async (
          shortAnswer,
          longAnswer,
          categoryOption,
          correctness,
          absorbedInput,
        ) => {
          const fresh = transition(null, '*266#');
          expect(fresh.state.view).toEqual({ kind: 'main' });
          expect(fresh.screen).toEqual({ type: 'CON', text: MAIN_MENU_TEXT });
          expect(fresh.screen.text).toContain('GhostDial');
          expect(fresh.screen.text).toContain('Oracle');
          expectInvalidTransition(fresh);

          for (const [mode, option] of [['oracle', '1'], ['eli5', '4']]) {
            const prompt = transition(fresh.state, option);
            expect(prompt.state.view).toEqual({ kind: 'question', mode });
            expect(prompt.screen.text.endsWith('\n0.Back 00.Home')).toBe(true);

            const shortProvider = createSuccessfulAIProvider(shortAnswer);
            const onePageAnswer = await aiTransition(
              prompt.state,
              'Explain this lesson.',
              shortProvider,
            );
            expect(shortProvider.callCount).toBe(1);
            expect(onePageAnswer.state.view.kind).toBe('answer');
            expect(onePageAnswer.state.view.pages).toHaveLength(1);
            expect(onePageAnswer.screen.text.endsWith(AI_FINAL_SUFFIX)).toBe(true);
            expectInvalidTransition(onePageAnswer);

            const longProvider = createSuccessfulAIProvider(longAnswer);
            let answerPage = await aiTransition(
              prompt.state,
              'Give me the long lesson.',
              longProvider,
            );
            expect(longProvider.callCount).toBe(1);
            expect(answerPage.state.view.pages.length).toBeGreaterThan(1);
            expect(contentWithoutPageSuffixes(
              answerPage.state.view.pages,
              AI_NON_FINAL_SUFFIX,
              AI_FINAL_SUFFIX,
            )).toBe(longAnswer);

            while (true) {
              const { pageIndex, pages } = answerPage.state.view;
              const isFinal = pageIndex === pages.length - 1;
              const suffix = isFinal ? AI_FINAL_SUFFIX : AI_NON_FINAL_SUFFIX;

              expect(answerPage.screen.text.endsWith(suffix)).toBe(true);
              if (!isFinal) {
                expect(answerPage.screen.text).not.toContain('00.Home');
              }
              expectInvalidTransition(answerPage);

              if (isFinal) {
                break;
              }
              answerPage = transition(answerPage.state, '1');
            }

            const failedAnswer = await aiTransition(
              prompt.state,
              'Can the Oracle hear me?',
              createThrowingAIProvider(new Error('hidden provider failure')),
            );
            expect(failedAnswer.state.view.kind).toBe('ai-error');
            expect(failedAnswer.screen.text.endsWith('\n0.Back 00.Home')).toBe(true);
            expect(failedAnswer.screen.text).toContain('fog');
            expect(failedAnswer.screen.text).not.toContain('hidden provider failure');
            expectInvalidTransition(failedAnswer);
          }

          const categories = transition(fresh.state, '2');
          expect(categories.state.view).toEqual({ kind: 'quiz-categories' });
          expect(categories.screen.text.endsWith('\n0.Back 00.Home')).toBe(true);
          expectInvalidTransition(categories);

          let quizScreen = transition(categories.state, categoryOption);
          for (let questionIndex = 0; questionIndex < 5; questionIndex += 1) {
            expect(quizScreen.state.view.kind).toBe('quiz-question');
            expect(quizScreen.state.view.questionNumber).toBe(questionIndex + 1);
            expectInvalidTransition(quizScreen);

            quizScreen = transition(
              quizScreen.state,
              answerFor(
                quizScreen.state.view.questionId,
                correctness[questionIndex],
              ),
            );

            if (questionIndex < 4) {
              expect(quizScreen.state.view.kind).toBe('quiz-feedback');
              expect(quizScreen.screen.text.endsWith('\n1.Next 0.Back')).toBe(true);
              expect(quizScreen.screen.text).not.toContain('00.Home');
              expect(quizScreen.screen.text).toContain(
                correctness[questionIndex] ? 'Correct!' : 'Not quite.',
              );
              const invalidFeedback = expectInvalidTransition(quizScreen);
              expect(invalidFeedback.screen.text).not.toContain('00.Home');
              quizScreen = transition(quizScreen.state, '1');
            }
          }

          const expectedRoundScore = correctness.filter(Boolean).length;
          expect(quizScreen.state.view.kind).toBe('quiz-result');
          expect(quizScreen.screen.text).toBe(
            `The spirits are pleased (${expectedRoundScore}/5)\n1.Again 0.Back`,
          );
          expect(quizScreen.screen.text).not.toContain('00.Home');
          const invalidResult = expectInvalidTransition(quizScreen);
          expect(invalidResult.screen.text).not.toContain('00.Home');

          const scoredMain = transition(quizScreen.state, '00');
          const score = transition(scoredMain.state, '5');
          expect(score.state.view).toEqual({ kind: 'score' });
          expect(score.screen.text).toBe(
            `Your Haunt Score is ${expectedRoundScore}.\n0.Back 00.Home`,
          );
          expectInvalidTransition(score);

          const examMenu = transition(fresh.state, '3');
          expect(examMenu.state.view).toEqual({ kind: 'exam-menu' });
          expect(examMenu.screen.text.endsWith('\n0.Back 00.Home')).toBe(true);
          expectInvalidTransition(examMenu);

          for (const [option, topic] of Object.entries(TOPICS_BY_OPTION)) {
            let tipPage = transition(examMenu.state, option);
            expect(tipPage.state.view).toMatchObject({ kind: 'tip', topic });
            expect(contentWithoutPageSuffixes(
              tipPage.state.view.pages,
              TIP_NON_FINAL_SUFFIX,
              TIP_FINAL_SUFFIX,
            )).toBe(LOCAL_TIPS[topic]);

            while (true) {
              const { pageIndex, pages } = tipPage.state.view;
              const isFinal = pageIndex === pages.length - 1;
              const suffix = isFinal ? TIP_FINAL_SUFFIX : TIP_NON_FINAL_SUFFIX;

              expect(tipPage.screen.text.endsWith(suffix)).toBe(true);
              expect(tipPage.screen.text).not.toContain('00.Home');
              const invalidTip = expectInvalidTransition(tipPage);
              expect(invalidTip.screen.text).not.toContain('00.Home');

              if (isFinal) {
                break;
              }
              tipPage = transition(tipPage.state, '1');
            }
          }

          const ended = transition(scoredMain.state, '0');
          expect(ended.state.status).toBe('ended');
          expect(ended.screen).toEqual({ type: 'END', text: EXIT_MESSAGE });

          const absorbed = transition(ended.state, absorbedInput);
          expect(absorbed.state).toEqual(ended.state);
          expect(absorbed.screen).toEqual({ type: 'END', text: EXIT_MESSAGE });
        },
      ),
      { numRuns: 100 },
    );
  });
});
