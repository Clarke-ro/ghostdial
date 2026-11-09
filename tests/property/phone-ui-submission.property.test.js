import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import { MULTI_TAP_MAPPING } from '../../src/ui/multi-tap.js';
import { mountPhoneUI } from '../../src/ui/phone-ui.js';

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

const bufferCharacter = fc.constantFrom(
  'a', 'Z', '0', ' ', '.', ',', '!', '?', '*', '#', '<', '&', '😀',
);

const completeBuffer = fc.oneof(
  fc.constant(''),
  fc.constant('x'.repeat(160)),
  fc.array(bufferCharacter, { maxLength: 160 })
    .map((characters) => characters.join(''))
    .filter((buffer) => buffer.length <= 160),
);

const pendingPrefix = fc.array(bufferCharacter, { maxLength: 159 })
  .map((characters) => characters.join(''))
  .filter((buffer) => buffer.length <= 159);

const serializableState = fc.record({
  sessionId: fc.string({ maxLength: 24 }),
  payload: fc.jsonValue(),
  view: fc.record({
    kind: fc.constantFrom('main', 'quiz-category', 'quiz-question', 'score'),
  }),
});

const mappedDigit = fc.constantFrom('0', '2', '3', '4', '5', '6', '7', '8', '9');

const submissionCase = fc.oneof(
  fc.record({
    lifecycle: fc.constant('idle'),
    buffer: completeBuffer,
    state: serializableState,
  }),
  fc.record({
    lifecycle: fc.constant('interactive'),
    buffer: completeBuffer,
    state: serializableState,
  }),
  fc.record({
    lifecycle: fc.constant('question-pending'),
    prefix: pendingPrefix,
    digit: mappedDigit,
    state: serializableState.map((state) => ({
      ...state,
      view: { kind: 'question', mode: 'oracle' },
    })),
  }),
);

function mountTestPhone(transition, aiProvider) {
  const documentRef = new TestDocument();
  const root = documentRef.createElement('main');
  const controller = mountPhoneUI(root, {
    transition,
    aiProvider,
    clock: { now: () => 100 },
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
  });

  return controller;
}

describe('Phone UI submission properties', () => {
  it('Feature: phone-ui, Property 4: Submission Snapshot and Single Invocation', () => {
    // **Validates: Requirements 1.5, 4.10, 4.11, 4.12**
    fc.assert(
      fc.property(submissionCase, (testCase) => {
        const aiProvider = () => 'stable answer';
        const transition = vi.fn(() => ({
          state: testCase.state,
          screen: { type: 'CON', text: 'Ready' },
        }));
        const controller = mountTestPhone(transition, aiProvider);

        try {
          if (testCase.lifecycle !== 'idle') {
            // Establish the generated serializable state through the same public
            // engine-result boundary used by the browser UI.
            expect(controller.dispatch({ type: 'call' })).toBe(true);
            expect(controller.getSnapshot().engineState).toBe(testCase.state);
            transition.mockClear();
          }

          let expectedInput;
          if (testCase.lifecycle === 'question-pending') {
            if (testCase.prefix.length > 0) {
              expect(controller.dispatch({
                type: 'printable',
                value: testCase.prefix,
              })).toBe(true);
            }
            expect(controller.dispatch({
              type: 'character',
              label: testCase.digit,
            })).toBe(true);

            expectedInput = testCase.prefix + MULTI_TAP_MAPPING[testCase.digit][0];
            const before = controller.getSnapshot();
            expect(before.inputBuffer).toBe(expectedInput);
            expect(before.multiTap).toMatchObject({
              digit: testCase.digit,
              bufferPosition: testCase.prefix.length,
            });
          } else {
            expectedInput = testCase.buffer;
            if (expectedInput.length > 0) {
              expect(controller.dispatch({
                type: 'printable',
                value: expectedInput,
              })).toBe(true);
            }
            expect(controller.getSnapshot().inputBuffer).toBe(expectedInput);
            expect(controller.getSnapshot().multiTap).toBeNull();
          }

          const stateAtStart = testCase.lifecycle === 'idle'
            ? null
            : testCase.state;

          expect(controller.dispatch({ type: 'call' })).toBe(true);

          expect(transition).toHaveBeenCalledTimes(1);
          expect(transition.mock.calls[0]).toHaveLength(3);
          expect(transition.mock.calls[0][0]).toBe(stateAtStart);
          expect(transition.mock.calls[0][1]).toBe(expectedInput);
          expect(transition.mock.calls[0][2]).toBe(aiProvider);

          const after = controller.getSnapshot();
          expect(after.inputBuffer).toBe('');
          expect(after.multiTap).toBeNull();
        } finally {
          controller.destroy();
        }
      }),
      {
        numRuns: 200,
        examples: [
          [{ lifecycle: 'idle', buffer: ' *266# ', state: {
            sessionId: 'idle', payload: null, view: { kind: 'main' },
          } }],
          [{ lifecycle: 'interactive', buffer: 'x'.repeat(160), state: {
            sessionId: 'full', payload: { score: 4 }, view: { kind: 'score' },
          } }],
          [{ lifecycle: 'question-pending', prefix: 'ghost ', digit: '2', state: {
            sessionId: 'pending', payload: ['serializable'],
            view: { kind: 'question', mode: 'oracle' },
          } }],
        ],
      },
    );
  });
});
