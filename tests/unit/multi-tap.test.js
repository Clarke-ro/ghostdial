import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMultiTapController,
  INPUT_LINE_MAXIMUM,
  MULTI_TAP_COMMIT_DELAY,
  MULTI_TAP_MAPPING,
} from '../../src/ui/multi-tap.js';

const QUESTION_STATE = { view: { kind: 'question' } };
const MENU_STATE = { view: { kind: 'main' } };

function createFakeClock() {
  let now = 0;
  return {
    now: () => now,
    advance(milliseconds) {
      now += milliseconds;
      vi.advanceTimersByTime(milliseconds);
    },
  };
}

describe('multi-tap mappings', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(Object.entries(MULTI_TAP_MAPPING))(
    'inserts the first mapped character for digit %s',
    (digit, mapping) => {
      vi.useFakeTimers();
      const clock = createFakeClock();
      const controller = createMultiTapController({
        clock,
        setTimeoutFn: setTimeout,
        clearTimeoutFn: clearTimeout,
      });

      controller.activate(digit, QUESTION_STATE);

      expect(controller.getInputBuffer()).toBe(mapping[0]);
      expect(controller.getPending()).toMatchObject({
        digit,
        index: 0,
        bufferPosition: 0,
        activatedAt: 0,
      });
    },
  );

  it('uses mapped characters only in question state and treats them literally elsewhere', () => {
    vi.useFakeTimers();
    const clock = createFakeClock();
    const controller = createMultiTapController({ clock });

    controller.activate('2', MENU_STATE);
    controller.activate('0', null);

    expect(controller.getInputBuffer()).toBe('20');
    expect(controller.getPending()).toBeNull();
  });

  it('keeps a pending character inside the buffer and reserves its capacity', () => {
    vi.useFakeTimers();
    const clock = createFakeClock();
    const controller = createMultiTapController({ clock });

    controller.replaceBuffer('x'.repeat(INPUT_LINE_MAXIMUM - 1));
    controller.activate('2', QUESTION_STATE);

    expect(controller.getInputBuffer()).toBe('x'.repeat(INPUT_LINE_MAXIMUM - 1) + 'a');
    expect(controller.getInputBuffer()).toHaveLength(INPUT_LINE_MAXIMUM);
    expect(controller.getPending()).toMatchObject({
      digit: '2',
      bufferPosition: INPUT_LINE_MAXIMUM - 1,
    });

    controller.activate('3', QUESTION_STATE);
    expect(controller.getInputBuffer()).toHaveLength(INPUT_LINE_MAXIMUM);
    expect(controller.getInputBuffer()).toBe('x'.repeat(INPUT_LINE_MAXIMUM - 1) + 'a');
    expect(controller.getPending()).toBeNull();
  });

  it('rejects a mapped activation when the input buffer is already full', () => {
    vi.useFakeTimers();
    const clock = createFakeClock();
    const controller = createMultiTapController({ clock });
    const fullBuffer = 'x'.repeat(INPUT_LINE_MAXIMUM);

    controller.replaceBuffer(fullBuffer);
    controller.activate('2', QUESTION_STATE);

    expect(controller.getInputBuffer()).toBe(fullBuffer);
    expect(controller.getPending()).toBeNull();
  });

  it('cycles the same mapped digit at 799 ms and keeps the new activation eligible', () => {
    vi.useFakeTimers();
    const clock = createFakeClock();
    const controller = createMultiTapController({ clock });

    controller.activate('2', QUESTION_STATE);
    clock.advance(MULTI_TAP_COMMIT_DELAY - 1);
    controller.activate('2', QUESTION_STATE);

    expect(controller.getInputBuffer()).toBe('b');
    expect(controller.getPending()).toMatchObject({
      digit: '2',
      index: 1,
      activatedAt: 799,
    });
  });

  it('commits at exactly 800 ms and starts a fresh candidate at 801 ms', () => {
    vi.useFakeTimers();
    const clock = createFakeClock();
    const controller = createMultiTapController({ clock });

    controller.activate('2', QUESTION_STATE);
    clock.advance(MULTI_TAP_COMMIT_DELAY);

    expect(controller.getInputBuffer()).toBe('a');
    expect(controller.getPending()).toBeNull();

    clock.advance(1);
    controller.activate('2', QUESTION_STATE);

    expect(controller.getInputBuffer()).toBe('aa');
    expect(controller.getPending()).toMatchObject({
      digit: '2',
      index: 0,
      bufferPosition: 1,
      activatedAt: 801,
    });
  });

  it('commits before a different character and then processes that character', () => {
    vi.useFakeTimers();
    const clock = createFakeClock();
    const controller = createMultiTapController({ clock });

    controller.activate('2', QUESTION_STATE);
    clock.advance(100);
    controller.activate('3', QUESTION_STATE);

    expect(controller.getInputBuffer()).toBe('ad');
    expect(controller.getPending()).toMatchObject({
      digit: '3',
      index: 0,
      bufferPosition: 1,
      activatedAt: 100,
    });
  });

  it('commits pending mapped output before a literal question key', () => {
    vi.useFakeTimers();
    const clock = createFakeClock();
    const controller = createMultiTapController({ clock });

    controller.activate('7', QUESTION_STATE);
    clock.advance(100);
    controller.activate('#', QUESTION_STATE);

    expect(controller.getInputBuffer()).toBe('p#');
    expect(controller.getPending()).toBeNull();
  });

  it.each(Object.entries(MULTI_TAP_MAPPING))(
    'wraps digit %s from its final character to its first character',
    (digit, mapping) => {
      vi.useFakeTimers();
      const clock = createFakeClock();
      const controller = createMultiTapController({ clock });

      controller.activate(digit, QUESTION_STATE);
      for (let index = 1; index < mapping.length; index += 1) {
        clock.advance(100);
        controller.activate(digit, QUESTION_STATE);
      }
      expect(controller.getInputBuffer()).toBe(mapping.at(-1));

      clock.advance(100);
      controller.activate(digit, QUESTION_STATE);

      expect(controller.getInputBuffer()).toBe(mapping[0]);
      expect(controller.getPending()).toMatchObject({
        digit,
        index: 0,
        bufferPosition: 0,
        activatedAt: mapping.length * 100,
      });
    },
  );

  it('treats repeated activations exactly like separate activations', () => {
    vi.useFakeTimers();
    const clock = createFakeClock();
    const controller = createMultiTapController({ clock });

    controller.activate('9', QUESTION_STATE);
    clock.advance(100);
    controller.activate('9', QUESTION_STATE);
    clock.advance(100);
    controller.activate('9', QUESTION_STATE);

    expect(controller.getInputBuffer()).toBe('y');
    expect(controller.getPending()).toMatchObject({
      digit: '9',
      index: 2,
      activatedAt: 200,
    });
  });

  it('commits pending output when the 800 ms timer fires', () => {
    vi.useFakeTimers();
    const clock = createFakeClock();
    const controller = createMultiTapController({ clock });

    controller.activate('8', QUESTION_STATE);
    clock.advance(MULTI_TAP_COMMIT_DELAY - 1);
    expect(controller.getPending()).not.toBeNull();

    clock.advance(1);

    expect(controller.getInputBuffer()).toBe('t');
    expect(controller.getPending()).toBeNull();
  });

  it('does not replace a pending character after the 800 ms threshold', () => {
    vi.useFakeTimers();
    const clock = createFakeClock();
    const controller = createMultiTapController({ clock });

    controller.activate('4', QUESTION_STATE);
    clock.advance(MULTI_TAP_COMMIT_DELAY + 1);
    controller.activate('4', QUESTION_STATE);

    expect(controller.getInputBuffer()).toBe('gg');
    expect(controller.getPending()).toMatchObject({
      digit: '4',
      index: 0,
      bufferPosition: 1,
      activatedAt: MULTI_TAP_COMMIT_DELAY + 1,
    });
  });

  it('clears the buffer, pending state, and timer without submitting', () => {
    vi.useFakeTimers();
    const clock = createFakeClock();
    const controller = createMultiTapController({ clock });

    controller.activate('2', QUESTION_STATE);
    controller.clear();
    clock.advance(MULTI_TAP_COMMIT_DELAY);

    expect(controller.getSnapshot()).toEqual({ inputBuffer: '', multiTap: null });
  });
});
