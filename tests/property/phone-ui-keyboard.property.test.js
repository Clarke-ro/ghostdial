import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { handleKeyboardEvent } from '../../src/ui/keyboard.js';

const MAX_INPUT_LENGTH = 160;

const printableUnicodeScalar = fc
  .integer({ min: 0, max: 0x10ffff })
  .filter((codePoint) => codePoint < 0xd800 || codePoint > 0xdfff)
  .map((codePoint) => String.fromCodePoint(codePoint))
  .filter((character) => !/^\p{C}$/u.test(character));

const printableKey = fc.oneof(
  fc.constantFrom(' ', 'a', '7', '.', '!', '*', '#', 'é', '中', '😀'),
  printableUnicodeScalar,
);

const boundedBuffer = fc
  .tuple(
    fc.integer({ min: 0, max: MAX_INPUT_LENGTH }),
    fc.array(printableKey, { maxLength: 80 }),
  )
  .map(([targetLength, characters]) => {
    let buffer = '';

    for (const character of characters) {
      if (buffer.length + character.length <= targetLength) {
        buffer += character;
      }
    }

    return buffer + 'x'.repeat(targetLength - buffer.length);
  });

const modifierCombination = fc
  .record({
    ctrlKey: fc.boolean(),
    altKey: fc.boolean(),
    metaKey: fc.boolean(),
  })
  .filter(({ ctrlKey, altKey, metaKey }) => ctrlKey || altKey || metaKey);

const arbitraryModifiers = fc.record({
  ctrlKey: fc.boolean(),
  altKey: fc.boolean(),
  metaKey: fc.boolean(),
});

const keyboardCase = fc.oneof(
  printableKey.map((key) => ({
    kind: 'printable',
    key,
    modifiers: { ctrlKey: false, altKey: false, metaKey: false },
  })),
  fc.tuple(printableKey, modifierCombination).map(([key, modifiers]) => ({
    kind: 'modified-printable',
    key,
    modifiers,
  })),
  arbitraryModifiers.map((modifiers) => ({
    kind: 'enter',
    key: 'Enter',
    modifiers,
  })),
  arbitraryModifiers.map((modifiers) => ({
    kind: 'backspace',
    key: 'Backspace',
    modifiers,
  })),
  fc
    .tuple(
      fc.constantFrom(
        'Tab',
        'Escape',
        'ArrowLeft',
        'ArrowRight',
        'PageUp',
        'PageDown',
        'Delete',
        'Home',
        'End',
        'Shift',
        'Dead',
        'Process',
        'F1',
      ),
      arbitraryModifiers,
    )
    .map(([key, modifiers]) => ({ kind: 'unsupported', key, modifiers })),
);

function createKeyboardEvent({ key, modifiers }) {
  return {
    key,
    ...modifiers,
    preventDefault: vi.fn(),
  };
}

function removeFinalScalar(value) {
  const characters = Array.from(value);
  characters.pop();
  return characters.join('');
}

describe('Phone UI keyboard properties', () => {
  it('Feature: phone-ui, Property 3: Keyboard Classification and Default Behavior', () => {
    // **Validates: Requirements 5.1, 5.2, 5.4, 5.5, 5.6, 5.7**
    fc.assert(
      fc.property(
        boundedBuffer,
        fc.boolean(),
        keyboardCase,
        (initialBuffer, shouldHavePending, generatedCase) => {
          let inputBuffer = initialBuffer;
          let pending = shouldHavePending && initialBuffer.length > 0
            ? {
                digit: '2',
                index: 0,
                bufferPosition: initialBuffer.length - 1,
                activatedAt: 100,
              }
            : null;
          const pendingAtStart = pending ? { ...pending } : null;
          const event = createKeyboardEvent(generatedCase);
          const commitPendingMultiTap = vi.fn(() => {
            pending = null;
          });
          const clearPendingMultiTap = vi.fn(() => {
            pending = null;
          });
          const submit = vi.fn();

          const handled = handleKeyboardEvent(event, {
            getInputBuffer: () => inputBuffer,
            setInputBuffer: (value) => {
              inputBuffer = value;
            },
            commitPendingMultiTap,
            clearPendingMultiTap,
            submit,
          });

          if (generatedCase.kind === 'printable') {
            const canAppend = initialBuffer.length + generatedCase.key.length
              <= MAX_INPUT_LENGTH;

            expect(handled).toBe(true);
            expect(inputBuffer).toBe(
              canAppend ? initialBuffer + generatedCase.key : initialBuffer,
            );
            expect(pending).toBeNull();
            expect(commitPendingMultiTap).toHaveBeenCalledTimes(1);
            expect(clearPendingMultiTap).not.toHaveBeenCalled();
            expect(submit).not.toHaveBeenCalled();
            expect(event.preventDefault).toHaveBeenCalledTimes(1);
            return;
          }

          if (generatedCase.kind === 'modified-printable') {
            expect(handled).toBe(false);
            expect(inputBuffer).toBe(initialBuffer);
            expect(pending).toEqual(pendingAtStart);
            expect(commitPendingMultiTap).not.toHaveBeenCalled();
            expect(clearPendingMultiTap).not.toHaveBeenCalled();
            expect(submit).not.toHaveBeenCalled();
            expect(event.preventDefault).not.toHaveBeenCalled();
            return;
          }

          if (generatedCase.kind === 'enter') {
            expect(handled).toBe(true);
            expect(inputBuffer).toBe(initialBuffer);
            expect(pending).toBeNull();
            expect(commitPendingMultiTap).toHaveBeenCalledTimes(1);
            expect(clearPendingMultiTap).not.toHaveBeenCalled();
            expect(submit).toHaveBeenCalledTimes(1);
            expect(event.preventDefault).toHaveBeenCalledTimes(1);
            return;
          }

          if (generatedCase.kind === 'backspace') {
            expect(handled).toBe(true);
            expect(inputBuffer).toBe(
              initialBuffer.length > 0
                ? removeFinalScalar(initialBuffer)
                : initialBuffer,
            );
            expect(pending).toBeNull();
            expect(commitPendingMultiTap).not.toHaveBeenCalled();
            expect(clearPendingMultiTap).toHaveBeenCalledTimes(
              initialBuffer.length > 0 ? 1 : 0,
            );
            expect(submit).not.toHaveBeenCalled();
            expect(event.preventDefault).toHaveBeenCalledTimes(1);
            return;
          }

          expect(generatedCase.kind).toBe('unsupported');
          expect(handled).toBe(false);
          expect(inputBuffer).toBe(initialBuffer);
          expect(pending).toEqual(pendingAtStart);
          expect(commitPendingMultiTap).not.toHaveBeenCalled();
          expect(clearPendingMultiTap).not.toHaveBeenCalled();
          expect(submit).not.toHaveBeenCalled();
          expect(event.preventDefault).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 250 },
    );
  });
});
