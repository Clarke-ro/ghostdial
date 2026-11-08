import { describe, expect, it } from 'vitest';
import { next } from '../../src/engine/ussd.js';
import {
  INVALID_CHOICE_MESSAGE,
  LOCAL_TIPS,
  renderScreen,
} from '../../src/engine/menus.js';
import { getQuestion } from '../../src/engine/quiz-bank.js';
import { buildActiveViewState, buildFreshState } from '../support/state-builders.js';
import { createSuccessfulAIProvider } from '../support/mock-ai-providers.js';

const TIP_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const TIP_FINAL_SUFFIX = '\n0.Back';

const TOPIC_CASES = [
  ['1', 'studyPlan', 'Study plan:'],
  ['2', 'examDay', 'Exam-day tips:'],
  ['3', 'beatStress', 'Beat stress:'],
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

function incorrectOption(question) {
  return question.correctAnswer === '1' ? '2' : '1';
}

function completeRound(firstQuestion, correctness, provider) {
  let current = firstQuestion;

  correctness.forEach((shouldBeCorrect, index) => {
    const question = getQuestion(current.state.view.questionId);
    const answer = shouldBeCorrect
      ? question.correctAnswer
      : incorrectOption(question);

    current = localStep(current.state, answer, provider);

    if (index < 4) {
      current = localStep(current.state, '1', provider);
    }
  });

  expect(current.state.view.kind).toBe('quiz-result');
  return current;
}

function stripTipSuffix(page, isFinal) {
  const suffix = isFinal ? TIP_FINAL_SUFFIX : TIP_NON_FINAL_SUFFIX;
  expect(page.endsWith(suffix)).toBe(true);
  return page.slice(0, -suffix.length);
}

describe('Haunt Score navigation integration', () => {
  it('displays the mixed-answer score across repeated rounds and handles Back, Home, and invalid input locally', () => {
    const provider = createSuccessfulAIProvider('must not be requested');

    const categoryMenu = localStep(buildFreshState(), '2', provider);
    const firstQuestion = localStep(categoryMenu.state, '1', provider);
    const firstResult = completeRound(
      firstQuestion,
      [true, false, true, false, true],
      provider,
    );
    expect(firstResult.state.hauntScore).toBe(3);

    const repeatedQuestion = localStep(firstResult.state, '1', provider);
    const repeatedResult = completeRound(
      repeatedQuestion,
      [false, true, false, true, false],
      provider,
    );
    expect(repeatedResult.state.hauntScore).toBe(5);
    expect(repeatedResult.state.acceptedAnswers).toHaveLength(10);

    const main = localStep(repeatedResult.state, '00', provider);
    const score = localStep(main.state, '5', provider);

    expect(score.state.view).toEqual({ kind: 'score' });
    expect(score.state.hauntScore).toBe(5);
    expect(score.screen).toEqual({
      type: 'CON',
      text: 'Your Haunt Score is 5.\n0.Back 00.Home',
    });

    const invalid = localStep(score.state, '1', provider);
    expect(invalid.state).toEqual({ ...score.state, notice: 'invalid' });
    expect(invalid.screen.text).toBe(
      `${score.screen.text}\n${INVALID_CHOICE_MESSAGE}`,
    );
    expect(invalid.screen.text.length).toBeLessThanOrEqual(160);

    const back = localStep(score.state, '0', provider);
    expect(back.state.view).toEqual({ kind: 'main' });
    expect(back.state.history).toEqual([]);
    expect(back.state.hauntScore).toBe(5);

    const home = localStep(invalid.state, '00', provider);
    expect(home.state.view).toEqual({ kind: 'main' });
    expect(home.state.history).toEqual([]);
    expect(home.state.notice).toBeNull();
    expect(home.state.hauntScore).toBe(5);
    expect(provider.callCount).toBe(0);
  });
});

describe('Exam Survival local-tip integration', () => {
  it.each(TOPIC_CASES)(
    'maps option %s to %s and preserves every page through local controls',
    (option, topic, opening) => {
      const provider = createSuccessfulAIProvider('must not be requested');
      const examMenu = localStep(buildFreshState(), '3', provider);

      expect(examMenu.state.view).toEqual({ kind: 'exam-menu' });
      expect(examMenu.screen.text).toContain('Exam Survival');

      const firstPage = localStep(examMenu.state, option, provider);
      const pages = firstPage.state.view.pages;

      expect(firstPage.state.view).toMatchObject({
        kind: 'tip',
        topic,
        pageIndex: 0,
      });
      expect(firstPage.screen.text).toContain(opening);
      expect(pages.length).toBeGreaterThan(1);
      expect(
        pages.map((page, index) => stripTipSuffix(
          page,
          index === pages.length - 1,
        )).join(''),
      ).toBe(LOCAL_TIPS[topic]);

      let current = firstPage;
      const displayedPages = [];

      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        expect(current.state.view.pageIndex).toBe(pageIndex);
        expect(current.screen.text).toBe(pages[pageIndex]);
        expect(current.screen.text.length).toBeLessThanOrEqual(160);
        expect(current.screen.text.endsWith(
          pageIndex === pages.length - 1
            ? TIP_FINAL_SUFFIX
            : TIP_NON_FINAL_SUFFIX,
        )).toBe(true);
        displayedPages.push(current.screen.text);

        const invalid = localStep(current.state, '9', provider);
        expect(invalid.state).toEqual({ ...current.state, notice: 'invalid' });
        expect(invalid.screen.text).toBe(
          `${current.screen.text}\n${INVALID_CHOICE_MESSAGE}`,
        );
        expect(invalid.screen.text.length).toBeLessThanOrEqual(160);

        const back = localStep(current.state, '0', provider);
        expect(back.state.view).toEqual({ kind: 'exam-menu' });
        expect(back.state.history).toEqual([{ view: { kind: 'main' } }]);

        const home = localStep(current.state, '00', provider);
        expect(home.state.view).toEqual({ kind: 'main' });
        expect(home.state.history).toEqual([]);

        if (pageIndex < pages.length - 1) {
          const previousIndex = current.state.view.pageIndex;
          current = localStep(current.state, '1', provider);
          expect(current.state.view.pageIndex).toBe(previousIndex + 1);
        }
      }

      expect(displayedPages).toEqual(pages);
      expect(
        displayedPages.map((page, index) => stripTipSuffix(
          page,
          index === displayedPages.length - 1,
        )).join(''),
      ).toBe(LOCAL_TIPS[topic]);

      const finalMore = localStep(current.state, '1', provider);
      expect(finalMore.state).toEqual({ ...current.state, notice: 'invalid' });
      expect(finalMore.state.view.pageIndex).toBe(pages.length - 1);
      expect(finalMore.screen.text).toBe(
        `${current.screen.text}\n${INVALID_CHOICE_MESSAGE}`,
      );
      expect(finalMore.screen.text.length).toBeLessThanOrEqual(160);
      expect(provider.callCount).toBe(0);
    },
  );

  it('keeps one-page local-tip controls final and rejects More without changing context', () => {
    const provider = createSuccessfulAIProvider('must not be requested');
    const page = `A short local reminder.${TIP_FINAL_SUFFIX}`;
    const state = buildActiveViewState(
      {
        kind: 'tip',
        topic: 'studyPlan',
        pages: [page],
        pageIndex: 0,
      },
      {
        history: [
          { view: { kind: 'main' } },
          { view: { kind: 'exam-menu' } },
        ],
      },
    );

    expect(renderScreen(state)).toEqual({ type: 'CON', text: page });
    expect(page.endsWith(TIP_FINAL_SUFFIX)).toBe(true);
    expect(page.endsWith(TIP_NON_FINAL_SUFFIX)).toBe(false);

    const invalidMore = localStep(state, '1', provider);
    expect(invalidMore.state).toEqual({ ...state, notice: 'invalid' });
    expect(invalidMore.screen.text).toBe(
      `${page}\n${INVALID_CHOICE_MESSAGE}`,
    );
    expect(invalidMore.screen.text.length).toBeLessThanOrEqual(160);

    const back = localStep(state, '0', provider);
    expect(back.state.view).toEqual({ kind: 'exam-menu' });
    expect(back.state.history).toEqual([{ view: { kind: 'main' } }]);

    const home = localStep(state, '00', provider);
    expect(home.state.view).toEqual({ kind: 'main' });
    expect(home.state.history).toEqual([]);
    expect(provider.callCount).toBe(0);
  });
});
