import {
  INVALID_CHOICE_MESSAGE,
  LOCAL_TIPS,
  renderScreen,
} from './menus.js';
import { paginate, paginateWithControls } from './paginate.js';
import {
  getQuestion,
  isCorrectAnswer,
  selectRoundQuestionIds,
} from './quiz-bank.js';

const DIAL_CODE = '*266#';
const BACK_CONTROL = '0';
const HOME_CONTROL = '00';
const NAVIGATION_INPUT = /^[0-9*#]+$/;
const INVALID_NOTICE_LENGTH = `\n${INVALID_CHOICE_MESSAGE}`.length;
const INTERACTIVE_PAGE_LIMIT = 160 - INVALID_NOTICE_LENGTH;
const TIP_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const TIP_FINAL_SUFFIX = '\n0.Back';

const EXAM_TOPIC_ROUTES = Object.freeze({
  1: 'studyPlan',
  2: 'examDay',
  3: 'beatStress',
});

const MAIN_ROUTES = Object.freeze({
  1: Object.freeze({ kind: 'question', mode: 'oracle' }),
  2: Object.freeze({ kind: 'quiz-categories' }),
  3: Object.freeze({ kind: 'exam-menu' }),
  4: Object.freeze({ kind: 'question', mode: 'eli5' }),
  5: Object.freeze({ kind: 'score' }),
});

const QUIZ_CATEGORY_ROUTES = Object.freeze({
  1: 'maths',
  2: 'physics',
  3: 'programming',
  4: 'general',
});

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        cloneValue(nestedValue),
      ]),
    );
  }

  return value;
}

function createFreshState() {
  return {
    version: 1,
    status: 'active',
    view: { kind: 'main' },
    history: [],
    quiz: null,
    acceptedAnswers: [],
    hauntScore: 0,
    notice: null,
  };
}

function createEndedState(state = null) {
  return {
    version: 1,
    status: 'ended',
    view: { kind: 'ended' },
    history: [],
    quiz: state?.quiz == null ? null : cloneValue(state.quiz),
    acceptedAnswers: cloneValue(state?.acceptedAnswers ?? []),
    hauntScore: state?.hauntScore ?? 0,
    notice: null,
  };
}

function replaceView(state, view) {
  return {
    ...state,
    view: cloneValue(view),
    notice: null,
  };
}

function pushView(state, view) {
  return {
    ...state,
    view: cloneValue(view),
    history: [
      ...state.history.map(cloneValue),
      { view: cloneValue(state.view) },
    ],
    notice: null,
  };
}

function goBack(state) {
  if (state.history.length === 0) {
    return invalidChoice(state);
  }

  const previous = state.history[state.history.length - 1];
  return {
    ...state,
    view: cloneValue(previous.view),
    history: state.history.slice(0, -1).map(cloneValue),
    notice: null,
  };
}

function goHome(state) {
  return {
    ...state,
    view: { kind: 'main' },
    history: [],
    notice: null,
  };
}

function invalidChoice(state) {
  return {
    ...state,
    notice: 'invalid',
  };
}

function toResult(state) {
  return {
    state,
    screen: renderScreen(state),
  };
}

function transitionMain(state, input) {
  if (!NAVIGATION_INPUT.test(input)) {
    return invalidChoice(state);
  }

  if (input === BACK_CONTROL) {
    return createEndedState(state);
  }

  if (input === HOME_CONTROL) {
    return goHome(state);
  }

  const route = MAIN_ROUTES[input];
  return route ? pushView(state, route) : invalidChoice(state);
}

function transitionQuestion(state, input, aiProvider) {
  if (input === BACK_CONTROL) {
    return goBack(state);
  }

  if (input === HOME_CONTROL) {
    return goHome(state);
  }

  const { mode } = state.view;
  const request = { mode, question: input };

  return Promise.resolve()
    .then(() => aiProvider(request))
    .then((answer) => {
      if (typeof answer !== 'string') {
        throw new TypeError('AI provider result must be a string');
      }

      return replaceView(state, {
        kind: 'answer',
        mode,
        question: input,
        pages: paginate(answer, INTERACTIVE_PAGE_LIMIT),
        pageIndex: 0,
      });
    })
    .then(toResult)
    .catch(() => toResult(replaceView(state, {
      kind: 'ai-error',
      mode,
      question: input,
    })));
}

function transitionAnswer(state, input) {
  const { view } = state;

  if (input === HOME_CONTROL) {
    return goHome(state);
  }

  if (input === BACK_CONTROL) {
    return replaceView(state, { kind: 'question', mode: view.mode });
  }

  if (input === '1' && view.pageIndex < view.pages.length - 1) {
    return replaceView(state, {
      ...view,
      pageIndex: view.pageIndex + 1,
    });
  }

  return invalidChoice(state);
}

function transitionAIError(state, input) {
  if (input === HOME_CONTROL) {
    return goHome(state);
  }

  if (input === BACK_CONTROL) {
    return replaceView(state, {
      kind: 'question',
      mode: state.view.mode,
    });
  }

  return invalidChoice(state);
}

function getNextRoundId(state) {
  const roundIds = [
    state.quiz?.roundId,
    ...state.acceptedAnswers.map((answer) => answer.roundId),
  ].filter((roundId) => Number.isInteger(roundId) && roundId > 0);

  return roundIds.length === 0 ? 1 : Math.max(...roundIds) + 1;
}

function createQuizQuestionView(questionIds, questionIndex) {
  return {
    kind: 'quiz-question',
    questionId: questionIds[questionIndex],
    questionNumber: questionIndex + 1,
  };
}

function historyThroughQuizCategories(state) {
  let categoryFrameIndex = -1;

  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    if (state.history[index].view?.kind === 'quiz-categories') {
      categoryFrameIndex = index;
      break;
    }
  }

  if (categoryFrameIndex >= 0) {
    return state.history
      .slice(0, categoryFrameIndex + 1)
      .map(cloneValue);
  }

  return [
    ...state.history.map(cloneValue),
    { view: { kind: 'quiz-categories' } },
  ];
}

function startQuizRound(state, category, history) {
  const roundId = getNextRoundId(state);
  const questionIds = selectRoundQuestionIds(category, roundId);

  return {
    ...state,
    view: createQuizQuestionView(questionIds, 0),
    history,
    quiz: {
      roundId,
      category,
      questionIds,
      questionIndex: 0,
      roundCorrect: 0,
      roundAcceptanceIds: [],
    },
    notice: null,
  };
}

function transitionQuizCategories(state, input) {
  if (input === HOME_CONTROL) {
    return goHome(state);
  }

  if (input === BACK_CONTROL) {
    return goBack(state);
  }

  if (!NAVIGATION_INPUT.test(input)) {
    return invalidChoice(state);
  }

  const category = QUIZ_CATEGORY_ROUTES[input];
  if (!category) {
    return invalidChoice(state);
  }

  const history = [
    ...state.history.map(cloneValue),
    { view: cloneValue(state.view) },
  ];
  return startQuizRound(state, category, history);
}

function requireActiveQuiz(state) {
  const { quiz } = state;

  if (
    !quiz
    || !Number.isInteger(quiz.roundId)
    || !Array.isArray(quiz.questionIds)
    || quiz.questionIds.length !== 5
  ) {
    throw new TypeError('quiz transition requires an active five-question round');
  }

  return quiz;
}

function showRecordedQuizOutcome(state, acceptance, questionIndex) {
  if (questionIndex === 4) {
    return replaceView(state, {
      kind: 'quiz-result',
      roundId: acceptance.roundId,
    });
  }

  return pushView(state, {
    kind: 'quiz-feedback',
    acceptanceId: acceptance.id,
  });
}

function transitionQuizQuestion(state, input) {
  if (input === HOME_CONTROL) {
    return goHome(state);
  }

  if (input === BACK_CONTROL) {
    return goBack(state);
  }

  if (!['1', '2', '3', '4'].includes(input)) {
    return invalidChoice(state);
  }

  const quiz = requireActiveQuiz(state);
  const questionIndex = quiz.questionIds.indexOf(state.view.questionId);
  if (questionIndex < 0) {
    throw new RangeError('quiz question does not belong to the active round');
  }

  const acceptanceId = `${quiz.roundId}:${state.view.questionId}`;
  const recordedAcceptance = state.acceptedAnswers.find(
    (answer) => answer.id === acceptanceId,
  );

  if (recordedAcceptance) {
    return showRecordedQuizOutcome(state, recordedAcceptance, questionIndex);
  }

  const question = getQuestion(state.view.questionId);
  if (!question || question.category !== quiz.category) {
    throw new RangeError('quiz question does not belong to the selected category');
  }

  const correct = isCorrectAnswer(question, input);
  const acceptance = {
    id: acceptanceId,
    roundId: quiz.roundId,
    questionId: question.id,
    submittedAnswer: input,
    correct,
    correctAnswer: question.correctAnswer,
  };
  const acceptedState = {
    ...state,
    quiz: {
      ...quiz,
      questionIndex,
      roundCorrect: quiz.roundCorrect + (correct ? 1 : 0),
      roundAcceptanceIds: [
        ...quiz.roundAcceptanceIds,
        acceptanceId,
      ],
    },
    acceptedAnswers: [
      ...state.acceptedAnswers,
      acceptance,
    ],
    hauntScore: state.hauntScore + (correct ? 1 : 0),
    notice: null,
  };

  return showRecordedQuizOutcome(acceptedState, acceptance, questionIndex);
}

function transitionQuizFeedback(state, input) {
  if (input === HOME_CONTROL) {
    return goHome(state);
  }

  if (input === BACK_CONTROL) {
    return goBack(state);
  }

  if (input !== '1') {
    return invalidChoice(state);
  }

  const quiz = requireActiveQuiz(state);
  const acceptance = state.acceptedAnswers.find(
    (answer) => answer.id === state.view.acceptanceId,
  );
  if (!acceptance) {
    throw new RangeError('quiz feedback requires a recorded acceptance');
  }

  const acceptedQuestionIndex = quiz.questionIds.indexOf(
    acceptance.questionId,
  );
  if (acceptedQuestionIndex < 0 || acceptedQuestionIndex >= 4) {
    throw new RangeError('quiz feedback cannot advance this question');
  }

  const questionIndex = acceptedQuestionIndex + 1;
  return {
    ...replaceView(
      state,
      createQuizQuestionView(quiz.questionIds, questionIndex),
    ),
    quiz: {
      ...quiz,
      questionIndex,
    },
  };
}

function transitionQuizResult(state, input) {
  if (input === HOME_CONTROL) {
    return goHome(state);
  }

  const quiz = requireActiveQuiz(state);

  if (input === BACK_CONTROL) {
    const categoryHistory = historyThroughQuizCategories(state);
    return {
      ...state,
      view: { kind: 'quiz-categories' },
      history: categoryHistory.slice(0, -1).map(cloneValue),
      notice: null,
    };
  }

  if (input === '1') {
    return startQuizRound(
      state,
      quiz.category,
      historyThroughQuizCategories(state),
    );
  }

  return invalidChoice(state);
}

function transitionScore(state, input) {
  if (input === HOME_CONTROL) {
    return goHome(state);
  }

  if (input === BACK_CONTROL) {
    return goBack(state);
  }

  return invalidChoice(state);
}

function transitionExamMenu(state, input) {
  if (input === HOME_CONTROL) {
    return goHome(state);
  }

  if (input === BACK_CONTROL) {
    return goBack(state);
  }

  if (!NAVIGATION_INPUT.test(input)) {
    return invalidChoice(state);
  }

  const topic = EXAM_TOPIC_ROUTES[input];
  if (!topic) {
    return invalidChoice(state);
  }

  const pages = paginateWithControls(
    LOCAL_TIPS[topic],
    INTERACTIVE_PAGE_LIMIT,
    TIP_NON_FINAL_SUFFIX,
    TIP_FINAL_SUFFIX,
  );

  return pushView(state, {
    kind: 'tip',
    topic,
    pages,
    pageIndex: 0,
  });
}

function returnToExamMenu(state) {
  let examMenuFrameIndex = -1;

  for (let index = state.history.length - 1; index >= 0; index -= 1) {
    if (state.history[index].view?.kind === 'exam-menu') {
      examMenuFrameIndex = index;
      break;
    }
  }

  return {
    ...state,
    view: { kind: 'exam-menu' },
    history: examMenuFrameIndex >= 0
      ? state.history.slice(0, examMenuFrameIndex).map(cloneValue)
      : state.history.map(cloneValue),
    notice: null,
  };
}

function transitionTip(state, input) {
  const { view } = state;

  if (input === HOME_CONTROL) {
    return goHome(state);
  }

  if (input === BACK_CONTROL) {
    return returnToExamMenu(state);
  }

  if (input === '1' && view.pageIndex < view.pages.length - 1) {
    return replaceView(state, {
      ...view,
      pageIndex: view.pageIndex + 1,
    });
  }

  return invalidChoice(state);
}

function transitionActive(state, input, aiProvider) {
  if (state.view.kind === 'main') {
    return transitionMain(state, input);
  }

  if (state.view.kind === 'question') {
    return transitionQuestion(state, input, aiProvider);
  }

  if (state.view.kind === 'answer') {
    return transitionAnswer(state, input);
  }

  if (state.view.kind === 'ai-error') {
    return transitionAIError(state, input);
  }

  if (state.view.kind === 'quiz-categories') {
    return transitionQuizCategories(state, input);
  }

  if (state.view.kind === 'quiz-question') {
    return transitionQuizQuestion(state, input);
  }

  if (state.view.kind === 'quiz-feedback') {
    return transitionQuizFeedback(state, input);
  }

  if (state.view.kind === 'quiz-result') {
    return transitionQuizResult(state, input);
  }

  if (state.view.kind === 'score') {
    return transitionScore(state, input);
  }

  if (state.view.kind === 'exam-menu') {
    return transitionExamMenu(state, input);
  }

  if (state.view.kind === 'tip') {
    return transitionTip(state, input);
  }

  if (input === HOME_CONTROL) {
    return goHome(state);
  }

  if (input === BACK_CONTROL) {
    return goBack(state);
  }

  return invalidChoice(state);
}

/**
 * Advances one GhostDial session transition.
 * Non-AI transitions return synchronously and never inspect or call aiProvider.
 *
 * @param {object | null | undefined} state
 * @param {string} input
 * @param {(request: object) => Promise<string> | string} aiProvider
 * @returns {{ state: object, screen: { type: 'CON' | 'END', text: string } }}
 */
export function next(state, input, aiProvider) {
  if (typeof input !== 'string') {
    throw new TypeError('input must be a string');
  }

  if (state == null) {
    const initialState = input === DIAL_CODE
      ? createFreshState()
      : createEndedState();
    return toResult(initialState);
  }

  if (state.status === 'ended') {
    if (input === DIAL_CODE) {
      return toResult(createFreshState());
    }

    return toResult(state);
  }

  if (state.status !== 'active') {
    throw new RangeError(`Unknown session status: ${state.status}`);
  }

  const transition = transitionActive(state, input, aiProvider);
  return transition instanceof Promise ? transition : toResult(transition);
}
