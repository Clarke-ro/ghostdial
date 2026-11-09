import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  createMultiTapController,
  INPUT_LINE_MAXIMUM,
  MULTI_TAP_COMMIT_DELAY,
  MULTI_TAP_MAPPING,
} from '../../src/ui/multi-tap.js';

const QUESTION_STATE = { view: { kind: 'question' } };
const MAPPED_DIGITS = Object.keys(MULTI_TAP_MAPPING);
const QUESTION_LITERALS = ['1', '*', '#'];

const mappedDigit = fc.constantFrom(...MAPPED_DIGITS);
const differentMappedDigits = fc
  .tuple(mappedDigit, mappedDigit)
  .filter(([first, second]) => first !== second);
const questionLiteral = fc.constantFrom(...QUESTION_LITERALS);
const prefixLength = fc.integer({ min: 0, max: INPUT_LINE_MAXIMUM - 1 });
const repeatCount = fc.integer({ min: 0, max: 12 });
const heldRepeatCount = fc.integer({ min: 1, max: 8 });
const belowThreshold = fc.integer({ min: 0, max: MULTI_TAP_COMMIT_DELAY - 1 });
const aboveThreshold = fc.integer({
  min: MULTI_TAP_COMMIT_DELAY + 1,
  max: MULTI_TAP_COMMIT_DELAY * 3,
});

function createController(clock = { now: () => 0 }, timers = {}) {
  return createMultiTapController({
    clock,
    setTimeoutFn: timers.setTimeoutFn ?? (() => 1),
    clearTimeoutFn: timers.clearTimeoutFn ?? (() => {}),
  });
}

function expectBoundedSnapshot(snapshot) {
  expect(snapshot.inputBuffer.length).toBeLessThanOrEqual(INPUT_LINE_MAXIMUM);

  if (snapshot.multiTap) {
    const { digit, index, bufferPosition } = snapshot.multiTap;
    expect(bufferPosition).toBe(snapshot.inputBuffer.length - 1);
    expect(snapshot.inputBuffer[bufferPosition]).toBe(MULTI_TAP_MAPPING[digit][index]);
  }
}

function exerciseSameDigit({ digit, prefix, count, elapsed, held }) {
  const controller = createController();
  const mapping = MULTI_TAP_MAPPING[digit];
  let activatedAt = 0;

  controller.replaceBuffer(prefix);
  controller.activate(digit, QUESTION_STATE, activatedAt);

  for (let index = 0; index < count; index += 1) {
    activatedAt += elapsed;

    // Each detected activation is sent to the multi-tap helper. A browser
    // repeat from a held key follows this exact path and counts once.
    const activation = { digit, activatedAt, repeat: held };
    controller.activate(activation.digit, QUESTION_STATE, activation.activatedAt);
  }

  const expectedIndex = count % mapping.length;
  const snapshot = controller.getSnapshot();

  expect(snapshot.inputBuffer).toBe(prefix + mapping[expectedIndex]);
  expect(snapshot.multiTap).toEqual({
    digit,
    index: expectedIndex,
    bufferPosition: prefix.length,
    activatedAt,
  });
  expectBoundedSnapshot(snapshot);
  controller.destroy();
}

function exerciseDifferentLabel({ digit, differentLabel, prefix, elapsed }) {
  const controller = createController();
  const firstCharacter = MULTI_TAP_MAPPING[digit][0];
  const differentMapping = MULTI_TAP_MAPPING[differentLabel] ?? null;

  controller.replaceBuffer(prefix);
  controller.activate(digit, QUESTION_STATE, 0);
  controller.activate(differentLabel, QUESTION_STATE, elapsed);

  const hasCapacity = prefix.length + 2 <= INPUT_LINE_MAXIMUM;
  const appendedCharacter = differentMapping?.[0] ?? differentLabel;
  const snapshot = controller.getSnapshot();

  // The first candidate remains unchanged, proving it was committed before
  // the different label was processed.
  expect(snapshot.inputBuffer).toBe(
    prefix + firstCharacter + (hasCapacity ? appendedCharacter : ''),
  );

  if (differentMapping && hasCapacity) {
    expect(snapshot.multiTap).toEqual({
      digit: differentLabel,
      index: 0,
      bufferPosition: prefix.length + 1,
      activatedAt: elapsed,
    });
  } else {
    expect(snapshot.multiTap).toBeNull();
  }

  expectBoundedSnapshot(snapshot);
  controller.destroy();
}

function exerciseThreshold({ digit, prefix, elapsed }) {
  const controller = createController();
  const firstCharacter = MULTI_TAP_MAPPING[digit][0];

  controller.replaceBuffer(prefix);
  controller.activate(digit, QUESTION_STATE, 0);
  controller.activate(digit, QUESTION_STATE, elapsed);

  const hasCapacity = prefix.length + 2 <= INPUT_LINE_MAXIMUM;
  const snapshot = controller.getSnapshot();

  // At 800 ms or later, the old candidate is committed and the same digit
  // starts a new candidate instead of replacing the old character.
  expect(snapshot.inputBuffer).toBe(
    prefix + firstCharacter + (hasCapacity ? firstCharacter : ''),
  );

  if (hasCapacity) {
    expect(snapshot.multiTap).toEqual({
      digit,
      index: 0,
      bufferPosition: prefix.length + 1,
      activatedAt: elapsed,
    });
  } else {
    expect(snapshot.multiTap).toBeNull();
  }

  expectBoundedSnapshot(snapshot);
  controller.destroy();
}

function createScheduler() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();

  function setTimeoutFn(callback, delay) {
    const id = nextId;
    nextId += 1;
    tasks.set(id, { callback, dueAt: now + delay });
    return id;
  }

  function clearTimeoutFn(id) {
    tasks.delete(id);
  }

  function advance(milliseconds) {
    const target = now + milliseconds;

    while (true) {
      const dueTask = [...tasks.entries()]
        .filter(([, task]) => task.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];

      if (!dueTask) {
        break;
      }

      const [id, task] = dueTask;
      tasks.delete(id);
      now = task.dueAt;
      task.callback();
    }

    now = target;
  }

  return {
    now: () => now,
    setTimeoutFn,
    clearTimeoutFn,
    advance,
  };
}

describe('Phone UI multi-tap properties', () => {
  it('Feature: phone-ui, Property 2: Question-State Multi-Tap Sequence', () => {
    // **Validates: Requirements 3.11, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8**
    fc.assert(
      fc.property(
        differentMappedDigits,
        questionLiteral,
        prefixLength,
        repeatCount,
        heldRepeatCount,
        belowThreshold,
        aboveThreshold,
        (
          [digit, differentDigit],
          literalLabel,
          generatedPrefixLength,
          generatedRepeatCount,
          generatedHeldRepeatCount,
          generatedBelowThreshold,
          generatedAboveThreshold,
        ) => {
          const prefix = 'x'.repeat(generatedPrefixLength);

          exerciseSameDigit({
            digit,
            prefix,
            count: generatedRepeatCount,
            elapsed: generatedBelowThreshold,
            held: false,
          });
          exerciseSameDigit({
            digit,
            prefix,
            count: generatedHeldRepeatCount,
            elapsed: generatedBelowThreshold,
            held: true,
          });

          exerciseDifferentLabel({
            digit,
            differentLabel: differentDigit,
            prefix,
            elapsed: generatedBelowThreshold,
          });
          exerciseDifferentLabel({
            digit,
            differentLabel: literalLabel,
            prefix,
            elapsed: generatedBelowThreshold,
          });

          exerciseThreshold({
            digit,
            prefix,
            elapsed: MULTI_TAP_COMMIT_DELAY,
          });
          exerciseThreshold({
            digit,
            prefix,
            elapsed: generatedAboveThreshold,
          });

          // The scheduled commit keeps the candidate pending below 800 ms,
          // then commits it exactly at the threshold without changing text.
          const scheduler = createScheduler();
          const timedController = createController(scheduler, scheduler);
          timedController.replaceBuffer(prefix);
          timedController.activate(digit, QUESTION_STATE);
          const beforeCommit = timedController.getSnapshot();

          scheduler.advance(MULTI_TAP_COMMIT_DELAY - 1);
          expect(timedController.getSnapshot()).toEqual(beforeCommit);
          expectBoundedSnapshot(timedController.getSnapshot());

          scheduler.advance(1);
          const committed = timedController.getSnapshot();
          expect(committed.inputBuffer).toBe(prefix + MULTI_TAP_MAPPING[digit][0]);
          expect(committed.multiTap).toBeNull();
          expectBoundedSnapshot(committed);
          timedController.destroy();
        },
      ),
      {
        numRuns: 200,
        examples: [
          [['7', '2'], '#', 0, 8, 5, 799, 801],
          [['0', '9'], '*', 159, 12, 8, 0, 2400],
          [['9', '8'], '1', 158, 4, 4, 400, 1200],
        ],
      },
    );
  });
});
