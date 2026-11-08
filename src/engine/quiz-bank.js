export const QUIZ_CATEGORIES = Object.freeze([
  'maths',
  'physics',
  'programming',
  'general',
]);

function createQuestion(id, category, text, options, correctAnswer) {
  return Object.freeze({
    id,
    category,
    text,
    options: Object.freeze([...options]),
    correctAnswer,
  });
}

const QUESTIONS = Object.freeze([
  createQuestion('maths-1', 'maths', 'What is 7 x 8?', ['54', '56', '64', '48'], '2'),
  createQuestion('maths-2', 'maths', 'What is 25% of 80?', ['15', '20', '25', '30'], '2'),
  createQuestion('maths-3', 'maths', 'Solve: 3 + 4 x 2', ['14', '11', '10', '8'], '2'),
  createQuestion('maths-4', 'maths', 'A triangle has how many sides?', ['2', '3', '4', '5'], '2'),
  createQuestion('maths-5', 'maths', 'What is the square root of 81?', ['7', '8', '9', '10'], '3'),

  createQuestion('physics-1', 'physics', 'What unit measures force?', ['Joule', 'Newton', 'Watt', 'Volt'], '2'),
  createQuestion('physics-2', 'physics', 'Light travels fastest in what?', ['Water', 'Glass', 'Vacuum', 'Air'], '3'),
  createQuestion('physics-3', 'physics', 'What pulls objects toward Earth?', ['Heat', 'Gravity', 'Sound', 'Light'], '2'),
  createQuestion('physics-4', 'physics', 'Which unit measures electric current?', ['Ampere', 'Metre', 'Pascal', 'Kelvin'], '1'),
  createQuestion('physics-5', 'physics', 'Energy of motion is called?', ['Chemical', 'Kinetic', 'Nuclear', 'Potential'], '2'),

  createQuestion('programming-1', 'programming', 'Which value is Boolean?', ['42', 'true', '"hi"', 'null'], '2'),
  createQuestion('programming-2', 'programming', 'Which keyword declares a constant in JS?', ['let', 'var', 'const', 'set'], '3'),
  createQuestion('programming-3', 'programming', 'What does an array store?', ['One bit', 'Values', 'Only text', 'A loop'], '2'),
  createQuestion('programming-4', 'programming', 'Which symbol starts a JS line comment?', ['//', '##', '<!--', '**'], '1'),
  createQuestion('programming-5', 'programming', 'What repeats code while a condition holds?', ['Loop', 'String', 'Object', 'Comment'], '1'),

  createQuestion('general-1', 'general', 'Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Jupiter', 'Mercury'], '2'),
  createQuestion('general-2', 'general', 'What is the largest ocean?', ['Atlantic', 'Indian', 'Arctic', 'Pacific'], '4'),
  createQuestion('general-3', 'general', 'Plants take in which gas?', ['Oxygen', 'Helium', 'Carbon dioxide', 'Hydrogen'], '3'),
  createQuestion('general-4', 'general', 'How many days are in a leap year?', ['365', '366', '364', '360'], '2'),
  createQuestion('general-5', 'general', 'Which organ pumps blood?', ['Lung', 'Brain', 'Heart', 'Liver'], '3'),
]);

const QUESTIONS_BY_ID = new Map(
  QUESTIONS.map((question) => [question.id, question]),
);

const QUESTION_IDS_BY_CATEGORY = Object.freeze(
  Object.fromEntries(
    QUIZ_CATEGORIES.map((category) => [
      category,
      Object.freeze(
        QUESTIONS
          .filter((question) => question.category === category)
          .map((question) => question.id),
      ),
    ]),
  ),
);

/**
 * Selects five question IDs from one category in a stable rotating order.
 *
 * @param {'maths' | 'physics' | 'programming' | 'general'} category
 * @param {number} [roundNumber=1]
 * @returns {string[]}
 */
export function selectRoundQuestionIds(category, roundNumber = 1) {
  const categoryIds = QUESTION_IDS_BY_CATEGORY[category];

  if (!categoryIds) {
    throw new RangeError(`Unknown quiz category: ${category}`);
  }

  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    throw new RangeError('roundNumber must be a positive integer');
  }

  const startIndex = (roundNumber - 1) % categoryIds.length;

  return Array.from(
    { length: 5 },
    (_, index) => categoryIds[(startIndex + index) % categoryIds.length],
  );
}

/**
 * Returns the frozen question record for an ID, or undefined when absent.
 *
 * @param {string} questionId
 */
export function getQuestion(questionId) {
  return QUESTIONS_BY_ID.get(questionId);
}

/**
 * Returns the complete frozen question bank.
 */
export function getAllQuestions() {
  return QUESTIONS;
}

/**
 * Compares a submitted numbered option with a question's local answer key.
 *
 * @param {{ correctAnswer: string }} question
 * @param {string} submittedAnswer
 * @returns {boolean}
 */
export function isCorrectAnswer(question, submittedAnswer) {
  if (!question || typeof question.correctAnswer !== 'string') {
    throw new TypeError('question must contain a correctAnswer string');
  }

  return typeof submittedAnswer === 'string'
    && submittedAnswer.trim() === question.correctAnswer;
}
