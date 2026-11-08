import { describe, expect, it } from 'vitest';
import { renderScreen, INVALID_CHOICE_MESSAGE } from '../../src/engine/menus.js';
import {
  QUIZ_CATEGORIES,
  getAllQuestions,
  getQuestion,
  isCorrectAnswer,
  selectRoundQuestionIds,
} from '../../src/engine/quiz-bank.js';
import { buildQuizState } from '../support/state-builders.js';

const EXPECTED_CATEGORY_IDS = {
  maths: ['maths-1', 'maths-2', 'maths-3', 'maths-4', 'maths-5'],
  physics: ['physics-1', 'physics-2', 'physics-3', 'physics-4', 'physics-5'],
  programming: [
    'programming-1',
    'programming-2',
    'programming-3',
    'programming-4',
    'programming-5',
  ],
  general: ['general-1', 'general-2', 'general-3', 'general-4', 'general-5'],
};

describe('quiz bank', () => {
  it('maps all four categories to their exact category-only five-question rounds', () => {
    expect(QUIZ_CATEGORIES).toEqual([
      'maths',
      'physics',
      'programming',
      'general',
    ]);

    for (const category of QUIZ_CATEGORIES) {
      const questionIds = selectRoundQuestionIds(category, 1);

      expect(questionIds).toEqual(EXPECTED_CATEGORY_IDS[category]);
      expect(questionIds).toHaveLength(5);
      expect(new Set(questionIds).size).toBe(5);

      for (const questionId of questionIds) {
        expect(getQuestion(questionId)).toMatchObject({
          id: questionId,
          category,
        });
      }
    }
  });

  it('selects stable deterministic five-ID rounds for every category', () => {
    for (const category of QUIZ_CATEGORIES) {
      for (const roundNumber of [1, 2, 5, 6, 17]) {
        const firstSelection = selectRoundQuestionIds(category, roundNumber);
        const secondSelection = selectRoundQuestionIds(category, roundNumber);

        expect(firstSelection).toEqual(secondSelection);
        expect(firstSelection).toHaveLength(5);
        expect(new Set(firstSelection).size).toBe(5);
        expect(firstSelection.every(
          (questionId) => getQuestion(questionId)?.category === category,
        )).toBe(true);
      }
    }
  });

  it('provides exactly four options and compares numbered answers locally', () => {
    const questions = getAllQuestions();

    expect(questions).toHaveLength(20);

    for (const question of questions) {
      expect(question.options).toHaveLength(4);
      expect(question.correctAnswer).toMatch(/^[1-4]$/);
      expect(isCorrectAnswer(question, question.correctAnswer)).toBe(true);
      expect(isCorrectAnswer(question, ` ${question.correctAnswer} `)).toBe(true);

      for (const optionNumber of ['1', '2', '3', '4']) {
        expect(isCorrectAnswer(question, optionNumber)).toBe(
          optionNumber === question.correctAnswer,
        );
      }

      expect(isCorrectAnswer(question, 'not-an-option')).toBe(false);
      expect(isCorrectAnswer(question, null)).toBe(false);
    }
  });

  it('renders every bank record with all content, invalid notice, and at most 160 characters', () => {
    const questions = getAllQuestions();

    for (const question of questions) {
      const questionIds = selectRoundQuestionIds(question.category, 1);
      const questionIndex = questionIds.indexOf(question.id);
      expect(questionIndex).toBeGreaterThanOrEqual(0);

      const state = buildQuizState({
        category: question.category,
        questionIds,
        questionIndex,
        notice: 'invalid',
      });
      const screen = renderScreen(state);

      expect(screen.type).toBe('CON');
      expect(screen.text).toContain(question.text);

      question.options.forEach((option, optionIndex) => {
        expect(screen.text).toContain(`${optionIndex + 1}.${option}`);
      });

      expect(screen.text).toContain(INVALID_CHOICE_MESSAGE);
      expect(screen.text.length).toBeLessThanOrEqual(160);
    }
  });
});
