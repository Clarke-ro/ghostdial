import { describe, expect, it, vi } from 'vitest';
import {
  handleKeyboardEvent,
  hasKeyboardModifier,
  isPrintableKeyboardCharacter,
  normalizeKeyboardEvent,
} from '../../src/ui/keyboard.js';

function keyboardEvent(key, modifiers = {}) {
  return {
    key,
    ctrlKey: Boolean(modifiers.ctrlKey),
    altKey: Boolean(modifiers.altKey),
    metaKey: Boolean(modifiers.metaKey),
    preventDefault: vi.fn(),
  };
}

describe('printable keyboard classification', () => {
  it.each(['a', '7', ' ', ',', '!', '*', '#', 'é', '中', '😀'])('accepts printable scalar %j', (key) => {
    expect(isPrintableKeyboardCharacter(key)).toBe(true);
    expect(normalizeKeyboardEvent(keyboardEvent(key))).toEqual({
      type: 'printable',
      value: key,
    });
  });

  it.each(['', 'ab', '\n', '\u0000', '\u0007', '\u200b', '\uE000'])('rejects non-printable or non-scalar key %j', (key) => {
    expect(isPrintableKeyboardCharacter(key)).toBe(false);
    expect(normalizeKeyboardEvent(keyboardEvent(key))).toBeNull();
  });

  it.each(['Tab', 'Escape', 'ArrowLeft', 'PageDown', 'Dead', 'Process'])('rejects unsupported named key %s', (key) => {
    const event = keyboardEvent(key);

    expect(normalizeKeyboardEvent(event)).toBeNull();
    expect(handleKeyboardEvent(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it.each(['ctrlKey', 'altKey', 'metaKey'])('identifies the %s modifier', (modifier) => {
    const event = keyboardEvent('a', { [modifier]: true });

    expect(hasKeyboardModifier(event)).toBe(true);
    expect(normalizeKeyboardEvent(event)).toEqual({
      type: 'modified-printable',
      value: 'a',
    });
  });
});

describe('keyboard event handling', () => {
  it.each([' ', '!', ',', '*', '#', 'é', '😀'])('appends the exact unmodified printable key %j and prevents default once', (key) => {
    const event = keyboardEvent(key);
    const options = { inputBuffer: '' };

    expect(handleKeyboardEvent(event, options)).toBe(true);
    expect(options.inputBuffer).toBe(key);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it.each(['ctrlKey', 'altKey', 'metaKey'])('leaves a modified printable key unchanged and uncancelled for %s', (modifier) => {
    const event = keyboardEvent('x', { [modifier]: true });
    const commitPending = vi.fn();
    const options = {
      inputBuffer: 'pending',
      commitPendingMultiTap: commitPending,
    };

    expect(handleKeyboardEvent(event, options)).toBe(false);
    expect(options.inputBuffer).toBe('pending');
    expect(commitPending).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not append a printable key beyond the 160-code-unit limit but still handles the event', () => {
    const event = keyboardEvent('x');
    const options = { inputBuffer: 'a'.repeat(160) };

    expect(handleKeyboardEvent(event, options)).toBe(true);
    expect(options.inputBuffer).toBe('a'.repeat(160));
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('uses JavaScript code-unit capacity for supplementary Unicode scalars', () => {
    const event = keyboardEvent('😀');
    const options = { inputBuffer: 'a'.repeat(159) };

    expect(handleKeyboardEvent(event, options)).toBe(true);
    expect(options.inputBuffer).toBe('a'.repeat(159));
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('commits pending multi-tap output before appending an unmodified printable key', () => {
    const event = keyboardEvent('x');
    const order = [];
    const options = {
      inputBuffer: 'a',
      commitPendingMultiTap: vi.fn(() => order.push('commit')),
      appendCharacter: vi.fn((value) => {
        order.push(`append:${value}`);
        return true;
      }),
    };

    expect(handleKeyboardEvent(event, options)).toBe(true);
    expect(order).toEqual(['commit', 'append:x']);
    expect(options.appendCharacter).toHaveBeenCalledWith('x');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('handles Enter as one submission after committing pending multi-tap output', () => {
    const event = keyboardEvent('Enter');
    const order = [];
    const submit = vi.fn(() => order.push('submit'));
    const commitPending = vi.fn(() => order.push('commit'));

    expect(handleKeyboardEvent(event, {
      commitPendingMultiTap: commitPending,
      submit,
    })).toBe(true);

    expect(order).toEqual(['commit', 'submit']);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('removes exactly the final Unicode scalar with Backspace and clears pending state', () => {
    const event = keyboardEvent('Backspace');
    let pending = { digit: '9', index: 1 };
    const options = {
      inputBuffer: 'ab😀',
      clearPendingMultiTap: vi.fn(() => {
        pending = null;
      }),
    };

    expect(handleKeyboardEvent(event, options)).toBe(true);
    expect(options.inputBuffer).toBe('ab');
    expect(pending).toBeNull();
    expect(options.clearPendingMultiTap).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('removes the final character without creating pending state when none existed', () => {
    const event = keyboardEvent('Backspace');
    const clearPending = vi.fn();
    const options = {
      inputBuffer: 'abc',
      clearPendingMultiTap: clearPending,
    };

    expect(handleKeyboardEvent(event, options)).toBe(true);
    expect(options.inputBuffer).toBe('ab');
    expect(clearPending).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('keeps an empty buffer unchanged for Backspace and prevents default once', () => {
    const event = keyboardEvent('Backspace');
    const options = { inputBuffer: '' };

    expect(handleKeyboardEvent(event, options)).toBe(true);
    expect(options.inputBuffer).toBe('');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('ignores keyboard input while the lifecycle is disabled', () => {
    const event = keyboardEvent('Enter');
    const submit = vi.fn();
    const options = {
      interactive: false,
      inputBuffer: 'unchanged',
      submit,
    };

    expect(handleKeyboardEvent(event, options)).toBe(false);
    expect(options.inputBuffer).toBe('unchanged');
    expect(submit).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not cancel modified Enter-like printable input and leaves the buffer untouched', () => {
    const event = keyboardEvent('x', { ctrlKey: true });
    const options = { inputBuffer: 'unchanged' };

    expect(handleKeyboardEvent(event, options)).toBe(false);
    expect(options.inputBuffer).toBe('unchanged');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
