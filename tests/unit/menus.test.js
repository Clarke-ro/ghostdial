import { describe, expect, it } from 'vitest';
import {
  EXIT_MESSAGE,
  INVALID_CHOICE_MESSAGE,
  LOCAL_TIPS,
  renderScreen,
} from '../../src/engine/menus.js';
import { paginateWithControls } from '../../src/engine/paginate.js';
import {
  buildAcceptedAnswer,
  buildActiveViewState,
  buildAnswerState,
  buildEndedState,
  buildFreshState,
  buildQuizState,
  buildScoreState,
} from '../support/state-builders.js';

const AI_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const AI_FINAL_SUFFIX = '\n0.Back 00.Home';
const TIP_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const TIP_FINAL_SUFFIX = '\n0.Back';
const INVALID_NOTICE_SUFFIX = `\n${INVALID_CHOICE_MESSAGE}`;
const INTERACTIVE_PAGE_LIMIT = 160 - INVALID_NOTICE_SUFFIX.length;

function buildCorrectFeedbackState() {
  const acceptance = buildAcceptedAnswer({
    questionId: 'maths-1',
    submittedAnswer: '2',
    correct: true,
    correctAnswer: '2',
  });

  return buildQuizState({
    acceptedAnswers: [acceptance],
    view: { kind: 'quiz-feedback', acceptanceId: acceptance.id },
  });
}

function buildIncorrectFeedbackState() {
  const acceptance = buildAcceptedAnswer({
    questionId: 'maths-1',
    submittedAnswer: '1',
    correct: false,
    correctAnswer: '2',
  });

  return buildQuizState({
    acceptedAnswers: [acceptance],
    view: { kind: 'quiz-feedback', acceptanceId: acceptance.id },
  });
}

function buildTipState(topic = 'studyPlan', pageIndex = 0) {
  const pages = paginateWithControls(
    LOCAL_TIPS[topic],
    INTERACTIVE_PAGE_LIMIT,
    TIP_NON_FINAL_SUFFIX,
    TIP_FINAL_SUFFIX,
  );

  return buildActiveViewState({ kind: 'tip', topic, pages, pageIndex });
}

function activeViewCases() {
  return [
    ['Main Menu', buildFreshState()],
    [
      'Oracle question prompt',
      buildActiveViewState({ kind: 'question', mode: 'oracle' }),
    ],
    [
      'ELI5 question prompt',
      buildActiveViewState({ kind: 'question', mode: 'eli5' }),
    ],
    [
      'non-final AI answer page',
      buildAnswerState({
        pages: [`A ghost begins the lesson.${AI_NON_FINAL_SUFFIX}`, `The lesson ends.${AI_FINAL_SUFFIX}`],
      }),
    ],
    [
      'final AI answer page',
      buildAnswerState({
        pages: [`A ghost begins the lesson.${AI_NON_FINAL_SUFFIX}`, `The lesson ends.${AI_FINAL_SUFFIX}`],
        pageIndex: 1,
      }),
    ],
    [
      'AI error',
      buildActiveViewState({
        kind: 'ai-error',
        mode: 'oracle',
        question: 'Where did the signal go?',
      }),
    ],
    ['quiz categories', buildActiveViewState({ kind: 'quiz-categories' })],
    ['quiz question', buildQuizState()],
    ['correct quiz feedback', buildCorrectFeedbackState()],
    ['incorrect quiz feedback', buildIncorrectFeedbackState()],
    [
      'quiz result',
      buildQuizState({
        questionIndex: 4,
        roundCorrect: 3,
        view: { kind: 'quiz-result', roundId: 1 },
      }),
    ],
    ['Exam Survival menu', buildActiveViewState({ kind: 'exam-menu' })],
    ['non-final local tip page', buildTipState('studyPlan')],
    [
      'final local tip page',
      (() => {
        const state = buildTipState('studyPlan');
        state.view.pageIndex = state.view.pages.length - 1;
        return state;
      })(),
    ],
    ['Haunt Score', buildScoreState({ hauntScore: 4 })],
  ];
}

describe('fixed menu copy', () => {
  it('renders the exact Main Menu options as a CON screen', () => {
    expect(renderScreen(buildFreshState())).toEqual({
      type: 'CON',
      text: [
        'GhostDial Main Menu',
        '1 Ask the Oracle',
        '2 Quiz Me',
        '3 Exam Survival',
        "4 Explain Like I'm 5",
        '5 My Haunt Score',
        '0 Exit',
      ].join('\n'),
    });
  });

  it('exports and renders the exact invalid-choice message', () => {
    expect(INVALID_CHOICE_MESSAGE).toBe(
      'Invalid choice. The spirits are confused.',
    );

    const validState = buildActiveViewState({
      kind: 'question',
      mode: 'oracle',
    });
    const invalidState = buildActiveViewState(validState.view, {
      notice: 'invalid',
    });

    expect(renderScreen(invalidState)).toEqual({
      type: 'CON',
      text: `${renderScreen(validState).text}${INVALID_NOTICE_SUFFIX}`,
    });
  });

  it('exports and renders the exact exit message as an END screen', () => {
    expect(EXIT_MESSAGE).toBe('The line goes dead... Goodbye.');
    expect(renderScreen(buildEndedState())).toEqual({
      type: 'END',
      text: EXIT_MESSAGE,
    });
  });

  it('uses representative friendly haunted-phone wording', () => {
    const main = renderScreen(buildFreshState()).text;
    const correctFeedback = renderScreen(buildCorrectFeedbackState()).text;
    const incorrectFeedback = renderScreen(buildIncorrectFeedbackState()).text;
    const aiError = renderScreen(buildActiveViewState({
      kind: 'ai-error',
      mode: 'oracle',
      question: 'Why?',
    })).text;
    const score = renderScreen(buildScoreState({ hauntScore: 2 })).text;

    expect(main).toContain('GhostDial');
    expect(main).toContain('Oracle');
    expect(correctFeedback).toContain('friendly ghosts cheer');
    expect(incorrectFeedback).toContain('helpful ghost');
    expect(aiError).toContain('signal in the fog');
    expect(score).toContain('Haunt Score');
  });
});

describe('renderer view coverage and controls', () => {
  it.each(activeViewCases())('renders the %s variant as CON', (_name, state) => {
    const screen = renderScreen(state);

    expect(screen.type).toBe('CON');
    expect(screen.text.length).toBeLessThanOrEqual(160);
  });

  it('renders both question prompts and the AI error with exact Back/Home endings', () => {
    const states = [
      buildActiveViewState({ kind: 'question', mode: 'oracle' }),
      buildActiveViewState({ kind: 'question', mode: 'eli5' }),
      buildActiveViewState({
        kind: 'ai-error',
        mode: 'eli5',
        question: 'Explain gravity.',
      }),
    ];

    for (const state of states) {
      expect(renderScreen(state).text).toMatch(/\n0\.Back 00\.Home$/);
    }
  });

  it('renders AI and local-tip pages with their required exact suffixes', () => {
    const nonFinalAnswer = buildAnswerState({
      pages: [`First.${AI_NON_FINAL_SUFFIX}`, `Last.${AI_FINAL_SUFFIX}`],
    });
    const finalAnswer = buildAnswerState({
      pages: [`First.${AI_NON_FINAL_SUFFIX}`, `Last.${AI_FINAL_SUFFIX}`],
      pageIndex: 1,
    });
    const nonFinalTip = buildTipState('examDay');
    const finalTip = buildTipState('examDay', 0);
    finalTip.view.pageIndex = finalTip.view.pages.length - 1;

    expect(renderScreen(nonFinalAnswer).text.endsWith(AI_NON_FINAL_SUFFIX)).toBe(true);
    expect(renderScreen(finalAnswer).text.endsWith(AI_FINAL_SUFFIX)).toBe(true);
    expect(renderScreen(nonFinalTip).text.endsWith(TIP_NON_FINAL_SUFFIX)).toBe(true);
    expect(renderScreen(finalTip).text.endsWith(TIP_FINAL_SUFFIX)).toBe(true);
  });

  it('renders category, Exam Survival, feedback, and score control endings', () => {
    expect(
      renderScreen(buildActiveViewState({ kind: 'quiz-categories' })).text,
    ).toMatch(/\n0\.Back 00\.Home$/);
    expect(
      renderScreen(buildActiveViewState({ kind: 'exam-menu' })).text,
    ).toMatch(/\n0\.Back 00\.Home$/);
    expect(renderScreen(buildCorrectFeedbackState()).text).toMatch(
      /\n1\.Next 0\.Back$/,
    );
    expect(renderScreen(buildIncorrectFeedbackState()).text).toMatch(
      /\n1\.Next 0\.Back$/,
    );
    expect(renderScreen(buildScoreState({ hauntScore: 7 })).text).toBe(
      'Your Haunt Score is 7.\n0.Back 00.Home',
    );
  });

  it.each([0, 1, 2, 3, 4, 5])(
    'renders a %i/5 result with exact result controls',
    (roundCorrect) => {
      const state = buildQuizState({
        questionIndex: 4,
        roundCorrect,
        view: { kind: 'quiz-result', roundId: 1 },
      });

      expect(renderScreen(state)).toEqual({
        type: 'CON',
        text: `The spirits are pleased (${roundCorrect}/5)\n1.Again 0.Back`,
      });
    },
  );

  it('renders correct and incorrect feedback from accepted answer records', () => {
    expect(renderScreen(buildCorrectFeedbackState()).text).toBe(
      'Correct! The friendly ghosts cheer.\n1.Next 0.Back',
    );
    expect(renderScreen(buildIncorrectFeedbackState()).text).toBe(
      [
        'Not quite. A helpful ghost points to the answer:',
        '2 56',
        '1.Next 0.Back',
      ].join('\n'),
    );
  });
});

describe('local content and screen-length invariants', () => {
  it('provides and renders every local Exam Survival topic without an AI provider', () => {
    const expectedOpenings = {
      studyPlan: 'Study plan:',
      examDay: 'Exam-day tips:',
      beatStress: 'Beat stress:',
    };

    for (const [topic, opening] of Object.entries(expectedOpenings)) {
      expect(LOCAL_TIPS[topic]).toContain(opening);

      const state = buildTipState(topic);
      const screen = renderScreen(state);

      expect(screen.type).toBe('CON');
      expect(screen.text).toContain(opening);
      expect(screen.text.length).toBeLessThanOrEqual(160);
    }
  });

  it('keeps every fixed active view within 160 characters with an invalid notice', () => {
    for (const [name, state] of activeViewCases()) {
      const invalidState = { ...state, notice: 'invalid' };
      const screen = renderScreen(invalidState);

      expect(screen.type, name).toBe('CON');
      expect(screen.text, name).toContain(INVALID_CHOICE_MESSAGE);
      expect(screen.text.length, name).toBeLessThanOrEqual(160);
    }
  });

  it('throws when base copy exceeds the 160-character invariant', () => {
    const state = buildAnswerState({
      pages: [`${'x'.repeat(161)}${AI_FINAL_SUFFIX}`],
    });

    expect(() => renderScreen(state)).toThrow(
      /Rendered screen exceeds 160 characters/,
    );
  });

  it('throws when appending an invalid notice would exceed 160 characters', () => {
    const page = `${'x'.repeat(INTERACTIVE_PAGE_LIMIT + 1 - AI_FINAL_SUFFIX.length)}${AI_FINAL_SUFFIX}`;
    const state = buildAnswerState({ pages: [page], notice: 'invalid' });

    expect(page.length).toBe(INTERACTIVE_PAGE_LIMIT + 1);
    expect(() => renderScreen(state)).toThrow(
      /Rendered screen exceeds 160 characters/,
    );
  });
});
