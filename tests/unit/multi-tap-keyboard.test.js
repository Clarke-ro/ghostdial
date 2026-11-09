import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMultiTapController,
  INPUT_LINE_MAXIMUM,
  MULTI_TAP_COMMIT_DELAY,
  MULTI_TAP_MAPPING,
} from '../../src/ui/multi-tap.js';
import {
  handleKeyboardEvent,
  isPrintableKeyboardCharacter,
  normalizeKeyboardEvent,
} from '../../src/ui/keyboard.js';

const QUESTION_STATE = { view: { kind: 'question' } };
const OTHER_STATE = { view: { kind: 'main' } };

function createMultiTap() {
  return createMultiTapController({
    clock: { now: () => Date.now() },
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
  });
}

function keyboardEvent(key, modifiers = {}) {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers,
    preventDefault: vi.fn(),
  };
}

describe('question-state multi-tap input', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(Object.entries(MULTI_TAP_MAPPING))(
    'inserts the first mapped character for digit %s',
    (digit, mapping) => {
      const multiTap = createMultiTap();

      multiTap.activate(digit, QUESTION_STATE);

      expect(multiTap.getInputBuffer()).toBe(mapping[0]);
      expect(multiTap.getPending()).toMatchObject({
        digit,
        index: 0,
        bufferPosition: 0,
        activatedAt: 0,
      });
    },
  );

  it.each(Object.entries(MULTI_TAP_MAPPING))(
    'uses mapped digit %s literally outside a question view',
    (digit) => {
      const multiTap = createMultiTap();

      multiTap.activate(digit, OTHER_STATE);

      expect(multiTap.getSnapshot()).toEqual({
        inputBuffer: digit,
        multiTap: null,
      });
    },
  );

  it('cycles at 799 ms, commits at exactly 800 ms, and starts fresh at 801 ms', () => {
    const multiTap = createMultiTap();

    multiTap.activate('2', QUESTION_STATE);
    vi.advanceTimersByTime(799);
    multiTap.activate('2', QUESTION_STATE);
    expect(multiTap.getSnapshot()).toMatchObject({
      inputBuffer: 'b',
      multiTap: { digit: '2', index: 1, activatedAt: 799 },
    });

    vi.advanceTimersByTime(800);
    expect(multiTap.getPending()).toBeNull();
    expect(multiTap.getInputBuffer()).toBe('b');

    multiTap.activate('2', QUESTION_STATE);
    expect(multiTap.getInputBuffer()).toBe('ba');
    expect(multiTap.getPending()).toMatchObject({
      digit: '2',
      index: 0,
      activatedAt: 1599,
    });

    vi.advanceTimersByTime(801);
    multiTap.activate('2', QUESTION_STATE);
    expect(multiTap.getInputBuffer()).toBe('baa');
    expect(multiTap.getPending()).toMatchObject({
      digit: '2',
      index: 0,
      activatedAt: 2400,
    });
  });

  it('commits exactly at the fake 800 ms timer threshold', () => {
    const onChange = vi.fn();
    const multiTap = createMultiTapController({
      clock: { now: () => Date.now() },
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
      onChange,
    });

    multiTap.activate('7', QUESTION_STATE);
    expect(multiTap.getPending()).not.toBeNull();

    vi.advanceTimersByTime(MULTI_TAP_COMMIT_DELAY - 1);
    expect(multiTap.getPending()).not.toBeNull();
    vi.advanceTimersByTime(1);

    expect(multiTap.getInputBuffer()).toBe('p');
    expect(multiTap.getPending()).toBeNull();
    expect(onChange).toHaveBeenCalled();
  });

  it.each(Object.entries(MULTI_TAP_MAPPING))(
    'wraps digit %s from its final mapped character to its first',
    (digit, mapping) => {
      const multiTap = createMultiTap();

      multiTap.activate(digit, QUESTION_STATE);
      for (let index = 1; index < mapping.length; index += 1) {
        vi.advanceTimersByTime(1);
        multiTap.activate(digit, QUESTION_STATE);
      }
      expect(multiTap.getInputBuffer()).toBe(mapping.at(-1));
      expect(multiTap.getPending().index).toBe(mapping.length - 1);

      vi.advanceTimersByTime(1);
      multiTap.activate(digit, QUESTION_STATE);
      expect(multiTap.getInputBuffer()).toBe(mapping[0]);
      expect(multiTap.getPending()).toMatchObject({ digit, index: 0 });
    },
  );

  it('treats every repeated activation as one cycle', () => {
    const multiTap = createMultiTap();

    multiTap.activate('9', QUESTION_STATE);
    vi.advanceTimersByTime(10);
    multiTap.activate('9', QUESTION_STATE);
    vi.advanceTimersByTime(10);
    multiTap.activate('9', QUESTION_STATE);
    expect(multiTap.getInputBuffer()).toBe('y');
    expect(multiTap.getPending()).toMatchObject({ digit: '9', index: 2 });

    vi.advanceTimersByTime(10);
    multiTap.activate('9', QUESTION_STATE);
    expect(multiTap.getInputBuffer()).toBe('z');
    expect(multiTap.getPending()).toMatchObject({ digit: '9', index: 3 });

    vi.advanceTimersByTime(10);
    multiTap.activate('9', QUESTION_STATE);
    expect(multiTap.getInputBuffer()).toBe('w');
    expect(multiTap.getPending()).toMatchObject({ digit: '9', index: 0 });
  });

  it('commits pending output before a different mapped or literal key', () => {
    const multiTap = createMultiTap();

    multiTap.activate('2', QUESTION_STATE);
    vi.advanceTimersByTime(100);
    multiTap.activate('3', QUESTION_STATE);
    expect(multiTap.getSnapshot()).toMatchObject({
      inputBuffer: 'ad',
      multiTap: { digit: '3', index: 0, bufferPosition: 1 },
    });

    vi.advanceTimersByTime(100);
    multiTap.activate('*', QUESTION_STATE);
    expect(multiTap.getSnapshot()).toEqual({
      inputBuffer: 'ad*',
      multiTap: null,
    });
  });

  it.each(['1', '*', '#'])(
    'keeps question-state literal key %s literal after committing pending output',
    (label) => {
      const multiTap = createMultiTap();

      multiTap.activate('2', QUESTION_STATE);
      vi.advanceTimersByTime(10);
      multiTap.activate(label, QUESTION_STATE);

      expect(multiTap.getSnapshot()).toEqual({
        inputBuffer: `a${label}`,
        multiTap: null,
      });
    },
  );

  it('clears the input and pending multi-tap state without submitting', () => {
    const multiTap = createMultiTap();

    multiTap.activate('2', QUESTION_STATE);
    expect(multiTap.clear()).toEqual({ inputBuffer: '', multiTap: null });
    vi.advanceTimersByTime(MULTI_TAP_COMMIT_DELAY);
    expect(multiTap.getSnapshot()).toEqual({ inputBuffer: '', multiTap: null });
  });

  it('reserves the pending character position and rejects additions at capacity', () => {
    const multiTap = createMultiTap();
    multiTap.replaceBuffer('x'.repeat(INPUT_LINE_MAXIMUM - 1));

    multiTap.activate('2', QUESTION_STATE);
    expect(multiTap.getInputBuffer()).toHaveLength(INPUT_LINE_MAXIMUM);
    expect(multiTap.getPending()).toMatchObject({
      digit: '2',
      bufferPosition: INPUT_LINE_MAXIMUM - 1,
    });

    vi.advanceTimersByTime(1);
    multiTap.activate('#', QUESTION_STATE);
    expect(multiTap.getInputBuffer()).toBe('x'.repeat(INPUT_LINE_MAXIMUM - 1) + 'a');
    expect(multiTap.getPending()).toBeNull();
  });

  it('leaves a full buffer and pending state unchanged when no output fits', () => {
    const multiTap = createMultiTap();
    const fullBuffer = 'z'.repeat(INPUT_LINE_MAXIMUM);
    multiTap.replaceBuffer(fullBuffer);

    multiTap.activate('2', QUESTION_STATE);
    expect(multiTap.getSnapshot()).toEqual({
      inputBuffer: fullBuffer,
      multiTap: null,
    });

    multiTap.activate('*', QUESTION_STATE);
    expect(multiTap.getInputBuffer()).toBe(fullBuffer);
  });

  it('rejects a new mapped output without discarding an eligible pending character when full', () => {
    const multiTap = createMultiTap();
    multiTap.replaceBuffer('x'.repeat(INPUT_LINE_MAXIMUM - 1));
    multiTap.activate('2', QUESTION_STATE);
    const before = multiTap.getSnapshot();

    multiTap.activate('3', QUESTION_STATE);

    expect(multiTap.getInputBuffer()).toBe(before.inputBuffer);
    expect(multiTap.getPending()).toBeNull();
  });
});

describe('physical keyboard normalization', () => {
  it.each([' ', '!', 'é', '*', '#', '𐐷'])(
    'accepts printable scalar %j',
    (key) => {
      expect(isPrintableKeyboardCharacter(key)).toBe(true);
      expect(normalizeKeyboardEvent(keyboardEvent(key))).toEqual({
        type: 'printable',
        value: key,
      });
    },
  );

  it.each(['Enter', 'Backspace', 'ArrowLeft', 'Tab', '\n', '\u0000', '\uD800', '\u0378'])(
    'rejects non-printable or named key %j',
    (key) => {
      expect(isPrintableKeyboardCharacter(key)).toBe(false);
      const normalized = normalizeKeyboardEvent(keyboardEvent(key));
      if (key === 'Enter') {
        expect(normalized).toEqual({ type: 'submit' });
      } else if (key === 'Backspace') {
        expect(normalized).toEqual({ type: 'backspace' });
      } else {
        expect(normalized).toBeNull();
      }
    },
  );

  it.each(['ctrlKey', 'altKey', 'metaKey'])(
    'preserves modified printable key %s and browser default behavior',
    (modifier) => {
      const event = keyboardEvent('x', { [modifier]: true });
      const options = { inputBuffer: 'pending' };

      expect(handleKeyboardEvent(event, options)).toBe(false);
      expect(options.inputBuffer).toBe('pending');
      expect(event.preventDefault).not.toHaveBeenCalled();
    },
  );

  it('appends exact printable spaces, punctuation, and supplementary scalars', () => {
    const options = { inputBuffer: '' };
    for (const key of [' ', '!', '𐐷', '#']) {
      const event = keyboardEvent(key);
      expect(handleKeyboardEvent(event, options)).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    }

    expect(options.inputBuffer).toBe(' !𐐷#');
  });

  it('uses UTF-16 length for the 160-character limit while preserving exact text', () => {
    const accepted = { inputBuffer: 'x'.repeat(158) };
    const acceptedEvent = keyboardEvent('𐐷');
    handleKeyboardEvent(acceptedEvent, accepted);
    expect(accepted.inputBuffer).toBe('x'.repeat(158) + '𐐷');
    expect(accepted.inputBuffer).toHaveLength(160);
    expect(acceptedEvent.preventDefault).toHaveBeenCalledTimes(1);

    const rejected = { inputBuffer: 'x'.repeat(159) };
    const rejectedEvent = keyboardEvent('𐐷');
    handleKeyboardEvent(rejectedEvent, rejected);
    expect(rejected.inputBuffer).toBe('x'.repeat(159));
    expect(rejectedEvent.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('commits pending multi-tap before appending an unmodified printable key', () => {
    const commitPendingMultiTap = vi.fn();
    const appendCharacter = vi.fn(() => true);
    const event = keyboardEvent('q');

    expect(handleKeyboardEvent(event, {
      commitPendingMultiTap,
      appendCharacter,
    })).toBe(true);

    expect(commitPendingMultiTap).toHaveBeenCalledTimes(1);
    expect(appendCharacter).toHaveBeenCalledWith('q');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('submits Enter once, commits pending output, and prevents the default', () => {
    const commitPendingMultiTap = vi.fn();
    const submit = vi.fn();
    const event = keyboardEvent('Enter');

    expect(handleKeyboardEvent(event, {
      commitPendingMultiTap,
      submit,
    })).toBe(true);

    expect(commitPendingMultiTap).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('removes exactly one final Unicode scalar and clears pending state on Backspace', () => {
    let inputBuffer = 'abc𐐷';
    const clearPendingMultiTap = vi.fn();
    const event = keyboardEvent('Backspace');

    expect(handleKeyboardEvent(event, {
      getInputBuffer: () => inputBuffer,
      setInputBuffer: (value) => {
        inputBuffer = value;
      },
      clearPendingMultiTap,
    })).toBe(true);

    expect(inputBuffer).toBe('abc');
    expect(clearPendingMultiTap).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('handles Backspace with and without input without changing unrelated state', () => {
    const nonEmpty = { inputBuffer: 'abc' };
    const nonEmptyEvent = keyboardEvent('Backspace');
    handleKeyboardEvent(nonEmptyEvent, nonEmpty);
    expect(nonEmpty.inputBuffer).toBe('ab');
    expect(nonEmptyEvent.preventDefault).toHaveBeenCalledTimes(1);

    const empty = { inputBuffer: '' };
    const emptyEvent = keyboardEvent('Backspace');
    handleKeyboardEvent(emptyEvent, empty);
    expect(empty.inputBuffer).toBe('');
    expect(emptyEvent.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('leaves unsupported keys uncancelled and disabled input untouched', () => {
    const unsupported = keyboardEvent('Escape');
    const disabled = { inputBuffer: 'keep', interactive: false };

    expect(handleKeyboardEvent(unsupported, { inputBuffer: 'keep' })).toBe(false);
    expect(unsupported.preventDefault).not.toHaveBeenCalled();
    expect(handleKeyboardEvent(keyboardEvent('x'), disabled)).toBe(false);
    expect(disabled.inputBuffer).toBe('keep');
  });
});
