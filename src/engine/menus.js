import { getQuestion } from './quiz-bank.js';

export const INVALID_CHOICE_MESSAGE =
  'Invalid choice. The spirits are confused.';
export const EXIT_MESSAGE = 'The line goes dead... Goodbye.';

export const LOCAL_TIPS = Object.freeze({
  studyPlan: [
    'Study plan: List each topic, then give the hardest ones extra time.',
    'Work in short blocks, test yourself without notes, and mark weak spots.',
    'Review those spots tomorrow. Leave a final day for mixed practice and rest.',
  ].join(' '),
  examDay: [
    'Exam-day tips: Pack your pens and ID the night before.',
    'Arrive early, read every instruction, and start with a question you can answer.',
    'Watch the clock, leave time to check your work, and do not let one hard question haunt you.',
  ].join(' '),
  beatStress: [
    'Beat stress: Put both feet down and breathe in slowly, then breathe out for longer.',
    'Name the next small task and do only that task.',
    'Drink water, take brief breaks, and ask someone you trust for help when worry feels too heavy.',
  ].join(' '),
});

const MAIN_MENU = [
  'GhostDial Main Menu',
  '1 Ask the Oracle',
  '2 Quiz Me',
  '3 Exam Survival',
  "4 Explain Like I'm 5",
  '5 My Haunt Score',
  '0 Exit',
].join('\n');

const QUIZ_CATEGORY_MENU = [
  'Choose a haunted quiz:',
  '1 Maths',
  '2 Physics',
  '3 Programming',
  '4 General',
  '0.Back 00.Home',
].join('\n');

const EXAM_SURVIVAL_MENU = [
  'Exam Survival',
  '1 Study plan',
  '2 Exam-day tips',
  '3 Beat stress',
  '0.Back 00.Home',
].join('\n');

const QUESTION_PROMPTS = Object.freeze({
  oracle: 'Ask the Oracle your study question.\n0.Back 00.Home',
  eli5: "What should the spirits explain simply?\n0.Back 00.Home",
});

const AI_ERROR =
  'The Oracle lost the signal in the fog. Please try again.\n0.Back 00.Home';

function renderQuestion(view) {
  const question = getQuestion(view.questionId);

  if (!question) {
    throw new RangeError(`Unknown quiz question: ${view.questionId}`);
  }

  return [
    `Question ${view.questionNumber}/5: ${question.text}`,
    ...question.options.map((option, index) => `${index + 1}.${option}`),
  ].join('\n');
}

function getAcceptance(state, acceptanceId) {
  const acceptance = state.acceptedAnswers?.find(
    (answer) => answer.id === acceptanceId,
  );

  if (!acceptance) {
    throw new RangeError(`Unknown accepted answer: ${acceptanceId}`);
  }

  return acceptance;
}

function renderFeedback(state, view) {
  const acceptance = getAcceptance(state, view.acceptanceId);

  if (acceptance.correct) {
    return 'Correct! The friendly ghosts cheer.\n1.Next 0.Back';
  }

  const question = getQuestion(acceptance.questionId);
  const optionNumber = Number(acceptance.correctAnswer);
  const optionText = question?.options[optionNumber - 1];
  const correctAnswer = optionText
    ? `${acceptance.correctAnswer} ${optionText}`
    : acceptance.correctAnswer;

  return [
    'Not quite. A helpful ghost points to the answer:',
    correctAnswer,
    '1.Next 0.Back',
  ].join('\n');
}

function getPage(view) {
  if (!Array.isArray(view.pages) || view.pages.length === 0) {
    throw new TypeError(`${view.kind} view must contain pages`);
  }

  if (
    !Number.isInteger(view.pageIndex)
    || view.pageIndex < 0
    || view.pageIndex >= view.pages.length
  ) {
    throw new RangeError(`${view.kind} pageIndex is out of bounds`);
  }

  const page = view.pages[view.pageIndex];
  if (typeof page !== 'string') {
    throw new TypeError(`${view.kind} page must be a string`);
  }

  return page;
}

function renderActiveView(state) {
  const { view } = state;

  if (!view || typeof view.kind !== 'string') {
    throw new TypeError('state.view must have a kind');
  }

  switch (view.kind) {
    case 'main':
      return MAIN_MENU;
    case 'question': {
      const prompt = QUESTION_PROMPTS[view.mode];
      if (!prompt) {
        throw new RangeError(`Unknown question mode: ${view.mode}`);
      }
      return prompt;
    }
    case 'answer':
    case 'tip':
      return getPage(view);
    case 'ai-error':
      return AI_ERROR;
    case 'quiz-categories':
      return QUIZ_CATEGORY_MENU;
    case 'quiz-question':
      return renderQuestion(view);
    case 'quiz-feedback':
      return renderFeedback(state, view);
    case 'quiz-result':
      if (!state.quiz || !Number.isInteger(state.quiz.roundCorrect)) {
        throw new TypeError('quiz result requires an integer roundCorrect');
      }
      return `The spirits are pleased (${state.quiz.roundCorrect}/5)\n1.Again 0.Back`;
    case 'exam-menu':
      return EXAM_SURVIVAL_MENU;
    case 'score':
      if (!Number.isInteger(state.hauntScore)) {
        throw new TypeError('score view requires an integer hauntScore');
      }
      return `Your Haunt Score is ${state.hauntScore}.\n0.Back 00.Home`;
    case 'ended':
      throw new TypeError('an active session cannot render an ended view');
    default:
      throw new RangeError(`Unknown view kind: ${view.kind}`);
  }
}

/**
 * Renders a session state without mutating it.
 *
 * @param {object} state
 * @returns {{ type: 'CON' | 'END', text: string }}
 */
export function renderScreen(state) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('state must be an object');
  }

  let type;
  let text;

  if (state.status === 'ended') {
    if (state.view?.kind !== 'ended') {
      throw new TypeError('an ended session requires an ended view');
    }
    type = 'END';
    text = EXIT_MESSAGE;
  } else if (state.status === 'active') {
    type = 'CON';
    text = renderActiveView(state);

    if (state.notice === 'invalid') {
      text += `\n${INVALID_CHOICE_MESSAGE}`;
    } else if (state.notice != null) {
      throw new RangeError(`Unknown notice: ${state.notice}`);
    }
  } else {
    throw new RangeError(`Unknown session status: ${state.status}`);
  }

  if (text.length > 160) {
    throw new RangeError(
      `Rendered screen exceeds 160 characters (${text.length})`,
    );
  }

  return { type, text };
}
