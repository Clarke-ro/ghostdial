import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { next } from '../../src/engine/ussd.js';
import { getQuestion } from '../../src/engine/quiz-bank.js';

const AI_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const AI_FINAL_SUFFIX = '\n0.Back 00.Home';

const codeUnitStringArbitrary = (maxLength) => fc
  .array(fc.integer({ min: 0, max: 0xffff }), { maxLength })
  .map((codeUnits) => String.fromCharCode(...codeUnits));

const questionArbitrary = codeUnitStringArbitrary(50)
  .filter((question) => question !== '0' && question !== '00');
const answerArbitrary = codeUnitStringArbitrary(240);
const endedInputArbitrary = codeUnitStringArbitrary(30)
  .filter((input) => input !== '*266#');
const categoryOptionArbitrary = fc.constantFrom('1', '2', '3', '4');
const topicOptionArbitrary = fc.constantFrom('1', '2', '3');
const menuInputArbitrary = fc.constantFrom('0', '00', '1', '2', '3', '4', '5', '9');
const answerInputArbitrary = fc.constantFrom('0', '00', '1', '9');
const scoreInputArbitrary = fc.constantFrom('0', '00', '7');
const tipInputArbitrary = fc.constantFrom('0', '00', '1', '8');
const quizAnswersArbitrary = fc.array(fc.constantFrom('1', '2', '3', '4'), {
  minLength: 5,
  maxLength: 5,
});

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
    Object.freeze(value);
  }

  return value;
}

function expectPublicResult(result) {
  expect(result).not.toBeNull();
  expect(typeof result).toBe('object');
  expect(Object.keys(result).sort()).toEqual(['screen', 'state']);
  expect(Object.keys(result.screen).sort()).toEqual(['text', 'type']);
  expect(['CON', 'END']).toContain(result.screen.type);
  expect(typeof result.screen.text).toBe('string');
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
}

function runSetupTransition(state, input) {
  const result = next(state, input);
  expect(result).not.toBeInstanceOf(Promise);
  return result.state;
}

function createProvider(answer, asynchronous = false) {
  const calls = [];
  const provider = (request) => {
    calls.push(structuredClone(request));
    return asynchronous ? Promise.resolve(answer) : answer;
  };
  provider.calls = calls;
  return provider;
}

function answerContent(pages) {
  return pages.map((page, index) => {
    const suffix = index < pages.length - 1
      ? AI_NON_FINAL_SUFFIX
      : AI_FINAL_SUFFIX;

    expect(page.endsWith(suffix)).toBe(true);
    return page.slice(0, -suffix.length);
  }).join('');
}

function completeQuizRound(quizQuestionState, submittedAnswers) {
  let current = quizQuestionState;
  let firstFeedback;

  for (let index = 0; index < submittedAnswers.length; index += 1) {
    const outcome = runSetupTransition(current, submittedAnswers[index]);

    if (index < submittedAnswers.length - 1) {
      firstFeedback ??= outcome;
      current = runSetupTransition(outcome, '1');
    } else {
      current = outcome;
    }
  }

  return { firstFeedback, result: current };
}

async function buildReachableStates({
  answer,
  categoryOption,
  question,
  quizAnswers,
  topicOption,
}) {
  const main = runSetupTransition(null, '*266#');
  const oraclePrompt = runSetupTransition(main, '1');
  const eli5Prompt = runSetupTransition(main, '4');

  const answerProvider = createProvider(answer);
  const answerState = (await next(oraclePrompt, question, answerProvider)).state;
  expect(answerProvider.calls).toEqual([{ mode: 'oracle', question }]);

  const quizCategories = runSetupTransition(main, '2');
  const quizQuestion = runSetupTransition(quizCategories, categoryOption);
  const { firstFeedback, result: quizResult } = completeQuizRound(
    quizQuestion,
    quizAnswers,
  );

  const score = runSetupTransition(main, '5');
  const examMenu = runSetupTransition(main, '3');
  const tip = runSetupTransition(examMenu, topicOption);
  const ended = runSetupTransition(main, '0');

  return {
    answer: answerState,
    eli5Prompt,
    ended,
    examMenu,
    main,
    oraclePrompt,
    quizCategories,
    quizFeedback: firstFeedback,
    quizQuestion,
    quizResult,
    score,
    tip,
  };
}

function expectDeterministicNonAITransition(state, input) {
  const snapshot = structuredClone(state);
  deepFreeze(state);

  const firstProvider = createProvider('unused first answer');
  const secondProvider = createProvider('unused second answer');
  const first = next(state, input, firstProvider);
  const second = next(state, input, secondProvider);

  expect(first).not.toBeInstanceOf(Promise);
  expect(second).not.toBeInstanceOf(Promise);
  expect(firstProvider.calls).toEqual([]);
  expect(secondProvider.calls).toEqual([]);
  expect(first).toEqual(second);
  expectPublicResult(first);
  expect(state).toEqual(snapshot);
}

async function expectDeterministicAITransition(state, mode, question, answer) {
  const snapshot = structuredClone(state);
  deepFreeze(state);

  const synchronousProvider = createProvider(answer);
  const asynchronousProvider = createProvider(answer, true);
  const firstTransition = next(state, question, synchronousProvider);
  const secondTransition = next(state, question, asynchronousProvider);

  expect(firstTransition).toBeInstanceOf(Promise);
  expect(secondTransition).toBeInstanceOf(Promise);

  const [first, second] = await Promise.all([
    firstTransition,
    secondTransition,
  ]);

  expect(synchronousProvider.calls).toEqual([{ mode, question }]);
  expect(asynchronousProvider.calls).toEqual([{ mode, question }]);
  expect(first).toEqual(second);
  expectPublicResult(first);
  expect(first.state.view).toMatchObject({ kind: 'answer', mode, question });
  expect(answerContent(first.state.view.pages)).toBe(answer);
  expect(state).toEqual(snapshot);
}

describe('public transition contract properties', () => {
  it('Feature: ussd-menu-engine, Property 1: Public Contract, Deep Immutability, and Determinism', async () => {
    // **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 2.4**
    await fc.assert(
      fc.asyncProperty(
        questionArbitrary,
        answerArbitrary,
        categoryOptionArbitrary,
        topicOptionArbitrary,
        quizAnswersArbitrary,
        menuInputArbitrary,
        answerInputArbitrary,
        scoreInputArbitrary,
        tipInputArbitrary,
        endedInputArbitrary,
        async (
          question,
          answer,
          categoryOption,
          topicOption,
          quizAnswers,
          menuInput,
          answerInput,
          scoreInput,
          tipInput,
          endedInput,
        ) => {
          const states = await buildReachableStates({
            answer,
            categoryOption,
            question,
            quizAnswers,
            topicOption,
          });

          const quizQuestion = getQuestion(states.quizQuestion.view.questionId);
          const nonAITransitions = [
            [states.main, menuInput],
            [states.oraclePrompt, '0'],
            [states.eli5Prompt, '00'],
            [states.answer, answerInput],
            [states.quizCategories, categoryOption],
            [states.quizQuestion, quizQuestion.correctAnswer],
            [states.quizFeedback, '1'],
            [states.quizResult, '1'],
            [states.score, scoreInput],
            [states.examMenu, topicOption],
            [states.tip, tipInput],
            [states.ended, endedInput],
          ];

          for (const [state, input] of nonAITransitions) {
            expectDeterministicNonAITransition(state, input);
          }

          await expectDeterministicAITransition(
            states.oraclePrompt,
            'oracle',
            question,
            answer,
          );
          await expectDeterministicAITransition(
            states.eli5Prompt,
            'eli5',
            question,
            answer,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
