const AI_FINAL_SUFFIX = '\n0.Back 00.Home';

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

function countCorrect(acceptedAnswers) {
  return acceptedAnswers.filter((answer) => answer.correct).length;
}

function createState({
  status = 'active',
  view,
  history = [],
  quiz = null,
  acceptedAnswers = [],
  hauntScore,
  notice = null,
}) {
  const copiedAnswers = cloneValue(acceptedAnswers);

  return {
    version: 1,
    status,
    view: cloneValue(view),
    history: cloneValue(history),
    quiz: cloneValue(quiz),
    acceptedAnswers: copiedAnswers,
    hauntScore: hauntScore ?? countCorrect(copiedAnswers),
    notice,
  };
}

/** Build a new session with no progress and the Main Menu active. */
export function buildFreshState() {
  return createState({ view: { kind: 'main' }, hauntScore: 0 });
}

/** Build an active session around any renderable view. */
export function buildActiveViewState(view = { kind: 'main' }, options = {}) {
  return createState({ ...options, status: 'active', view });
}

/** Build an answer-page session with a matching question origin by default. */
export function buildAnswerState({
  mode = 'oracle',
  question = 'Why do shadows move?',
  pages = [`A light source or object moved.${AI_FINAL_SUFFIX}`],
  pageIndex = 0,
  history,
  quiz = null,
  acceptedAnswers = [],
  hauntScore,
  notice = null,
} = {}) {
  return createState({
    view: { kind: 'answer', mode, question, pages, pageIndex },
    history: history ?? [{ view: { kind: 'question', mode } }],
    quiz,
    acceptedAnswers,
    hauntScore,
    notice,
  });
}

/** Build an accepted-answer ledger record. */
export function buildAcceptedAnswer({
  roundId = 1,
  questionId = 'maths-1',
  submittedAnswer = '1',
  correct = true,
  correctAnswer = '1',
} = {}) {
  return {
    id: `${roundId}:${questionId}`,
    roundId,
    questionId,
    submittedAnswer,
    correct,
    correctAnswer,
  };
}

/** Build a valid active five-question quiz session. */
export function buildQuizState({
  roundId = 1,
  category = 'maths',
  questionIds,
  questionIndex = 0,
  roundCorrect,
  roundAcceptanceIds,
  view,
  history = [{ view: { kind: 'quiz-categories' } }],
  acceptedAnswers = [],
  hauntScore,
  notice = null,
} = {}) {
  const ids = questionIds ?? Array.from(
    { length: 5 },
    (_, index) => `${category}-${index + 1}`,
  );
  const copiedAnswers = cloneValue(acceptedAnswers);
  const currentRoundAnswers = copiedAnswers.filter(
    (answer) => answer.roundId === roundId,
  );
  const quiz = {
    roundId,
    category,
    questionIds: ids,
    questionIndex,
    roundCorrect:
      roundCorrect ?? currentRoundAnswers.filter((answer) => answer.correct).length,
    roundAcceptanceIds:
      roundAcceptanceIds ?? currentRoundAnswers.map((answer) => answer.id),
  };
  const activeView = view ?? {
    kind: 'quiz-question',
    questionId: ids[questionIndex],
    questionNumber: questionIndex + 1,
  };

  return createState({
    view: activeView,
    history,
    quiz,
    acceptedAnswers: copiedAnswers,
    hauntScore,
    notice,
  });
}

/** Build an active Haunt Score screen with a consistent answer ledger. */
export function buildScoreState({
  history = [{ view: { kind: 'main' } }],
  quiz = null,
  acceptedAnswers = [],
  hauntScore,
  notice = null,
} = {}) {
  return createState({
    view: { kind: 'score' },
    history,
    quiz,
    acceptedAnswers,
    hauntScore,
    notice,
  });
}

/** Build an ended session while preserving any supplied session progress. */
export function buildEndedState({
  quiz = null,
  acceptedAnswers = [],
  hauntScore,
} = {}) {
  return createState({
    status: 'ended',
    view: { kind: 'ended' },
    history: [],
    quiz,
    acceptedAnswers,
    hauntScore,
    notice: null,
  });
}
