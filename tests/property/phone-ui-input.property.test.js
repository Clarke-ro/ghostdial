import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { MULTI_TAP_MAPPING } from '../../src/ui/multi-tap.js';
import { mountPhoneUI } from '../../src/ui/phone-ui.js';

const MAX_INPUT_LENGTH = 160;

class TestElement {
  constructor(documentRef) {
    this.ownerDocument = documentRef;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.disabled = false;
    this._textContent = '';
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((item) => item !== listener));
  }
}

class TestDocument {
  constructor() {
    this.listeners = new Map();
  }

  createElement() {
    return new TestElement(this);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((item) => item !== listener));
  }
}

const requiredCharacters = fc.constantFrom(
  ' ', '.', ',', '!', '?', ':', ';', '-', '_', '*', '#',
);

const printableUnicodeScalar = fc
  .integer({ min: 0, max: 0x10ffff })
  .filter((codePoint) => codePoint < 0xd800 || codePoint > 0xdfff)
  .map((codePoint) => String.fromCodePoint(codePoint))
  .filter((character) => !/^\p{C}$/u.test(character));

const acceptedCharacter = fc.oneof(requiredCharacters, printableUnicodeScalar);

// Build buffers with an exact generated JavaScript code-unit length. Generated
// scalars are retained whenever they fit; a one-unit printable fill character
// makes every boundary from zero through 160 reachable without splitting a
// surrogate pair.
const boundedBuffer = fc
  .tuple(
    fc.integer({ min: 0, max: MAX_INPUT_LENGTH }),
    fc.array(acceptedCharacter, { maxLength: 80 }),
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

const keypadLabel = fc.constantFrom(
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#',
);
const questionLiteralLabel = fc.constantFrom('1', '*', '#');
const questionMappedLabel = fc.constantFrom('0', '2', '3', '4', '5', '6', '7', '8', '9');

const acceptedAction = fc.oneof(
  fc.record({
    source: fc.constant('printable'),
    question: fc.boolean(),
    value: acceptedCharacter,
  }),
  fc.record({
    source: fc.constant('keypad'),
    question: fc.constant(false),
    label: keypadLabel,
  }),
  fc.record({
    source: fc.constant('question-literal'),
    question: fc.constant(true),
    label: questionLiteralLabel,
  }),
  fc.record({
    source: fc.constant('question-mapped'),
    question: fc.constant(true),
    label: questionMappedLabel,
  }),
);

function expectedActionText(action) {
  if (action.source === 'printable') {
    return action.value;
  }

  if (action.source === 'question-mapped') {
    return MULTI_TAP_MAPPING[action.label][0];
  }

  return action.label;
}

function controllerAction(action) {
  if (action.source === 'printable') {
    return { type: 'printable', value: action.value };
  }

  return { type: 'character', label: action.label };
}

function mountFor(action) {
  const documentRef = new TestDocument();
  const root = documentRef.createElement('main');
  const engineState = {
    view: { kind: action.question ? 'question' : 'main' },
  };
  const transition = () => ({
    state: engineState,
    screen: { type: 'CON', text: 'Ready' },
  });
  const controller = mountPhoneUI(root, {
    transition,
    aiProvider: () => '',
    clock: { now: () => 0 },
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
  });

  // Enter an active CON screen so both idle and displayed input-line behavior
  // use the same public controller actions under test.
  expect(controller.dispatch({ type: 'call' })).toBe(true);
  return controller;
}

describe('Phone UI input properties', () => {
  it('Feature: phone-ui, Property 1: Bounded, Exact Input Buffer', () => {
    // **Validates: Requirements 3.4, 3.8, 3.9, 3.10, 4.1, 4.2, 4.3, 5.1**
    fc.assert(
      fc.property(boundedBuffer, acceptedAction, (initialBuffer, action) => {
        const controller = mountFor(action);

        try {
          for (const character of Array.from(initialBuffer)) {
            expect(controller.dispatch({ type: 'printable', value: character })).toBe(true);
          }

          expect(controller.getSnapshot().inputBuffer).toBe(initialBuffer);
          expect(controller.controls.inputLine.textContent).toBe(initialBuffer);

          const actionText = expectedActionText(action);
          const canAppend = initialBuffer.length + actionText.length <= MAX_INPUT_LENGTH;
          const expectedBuffer = canAppend
            ? initialBuffer + actionText
            : initialBuffer;

          expect(controller.dispatch(controllerAction(action))).toBe(canAppend);

          const snapshot = controller.getSnapshot();
          expect(snapshot.inputBuffer).toBe(expectedBuffer);
          expect(snapshot.inputBuffer.length).toBeLessThanOrEqual(MAX_INPUT_LENGTH);
          expect(controller.controls.inputLine.textContent).toBe(expectedBuffer);

          if (canAppend) {
            expect(snapshot.inputBuffer.slice(0, initialBuffer.length)).toBe(initialBuffer);
            expect(snapshot.inputBuffer.slice(initialBuffer.length)).toBe(actionText);
          } else {
            expect(snapshot.inputBuffer).toBe(initialBuffer);
          }

          if (action.source === 'question-mapped' && canAppend) {
            expect(snapshot.multiTap).toEqual({
              digit: action.label,
              index: 0,
              bufferPosition: initialBuffer.length,
              activatedAt: 0,
            });

            // A pending character already occupies its final buffer position,
            // including when that position fills the 160-code-unit capacity.
            expect(snapshot.inputBuffer[snapshot.multiTap.bufferPosition]).toBe(actionText);
            if (snapshot.inputBuffer.length === MAX_INPUT_LENGTH) {
              expect(snapshot.multiTap.bufferPosition).toBe(MAX_INPUT_LENGTH - 1);
            }
          } else {
            expect(snapshot.multiTap).toBeNull();
          }
        } finally {
          controller.destroy();
        }
      }),
      {
        numRuns: 200,
        examples: [
          ['', { source: 'printable', question: false, value: ' ' }],
          ['notes', { source: 'printable', question: true, value: '!' }],
          ['x'.repeat(159), { source: 'question-literal', question: true, label: '*' }],
          ['x'.repeat(159), { source: 'question-literal', question: true, label: '#' }],
          ['x'.repeat(159), { source: 'question-mapped', question: true, label: '2' }],
          ['x'.repeat(159), { source: 'printable', question: false, value: '😀' }],
          ['x'.repeat(160), { source: 'printable', question: false, value: '?' }],
        ],
      },
    );
  });
});
