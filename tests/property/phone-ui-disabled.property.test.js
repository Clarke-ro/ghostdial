import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

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
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
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
    this.listeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatchKeydown(event) {
    for (const listener of [...(this.listeners.get('keydown') ?? [])]) {
      listener(event);
    }
  }
}

const keypadLabel = fc.constantFrom(
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#',
);

const printableCharacter = fc
  .integer({ min: 0, max: 0x10ffff })
  .filter((codePoint) => codePoint < 0xd800 || codePoint > 0xdfff)
  .map((codePoint) => String.fromCodePoint(codePoint))
  .filter((character) => !/^\p{C}$/u.test(character));

const disabledAction = fc.oneof(
  keypadLabel.map((label) => ({ type: 'keypad', label })),
  fc.constant({ type: 'clear' }),
  fc.constant({ type: 'call' }),
  printableCharacter.map((value) => ({ type: 'printable', value })),
  fc.constant({ type: 'enter' }),
  fc.constant({ type: 'backspace' }),
);

const disabledActionSequence = fc.array(disabledAction, {
  minLength: 1,
  maxLength: 40,
});

function keyboardEvent(key) {
  let preventDefaultCalls = 0;

  return {
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault() {
      preventDefaultCalls += 1;
    },
    get preventDefaultCalls() {
      return preventDefaultCalls;
    },
  };
}

function enterDisabledLifecycle(lifecycle) {
  const documentRef = new TestDocument();
  const root = documentRef.createElement('main');
  const calls = [];
  const questionState = { view: { kind: 'question' }, marker: 'preserve' };
  const endedState = { status: 'ended', marker: 'ended' };
  let transitionNumber = 0;

  const transition = (state, input, provider) => {
    calls.push({ state, input, provider });
    transitionNumber += 1;

    if (transitionNumber === 1) {
      return {
        state: questionState,
        screen: { type: 'CON', text: 'Ask a question' },
      };
    }

    if (lifecycle === 'loading') {
      return new Promise(() => {});
    }

    return {
      state: endedState,
      screen: { type: 'END', text: 'The line goes dead... Goodbye.' },
    };
  };

  const controller = mountPhoneUI(root, {
    transition,
    aiProvider: () => '',
    clock: { now: () => 0 },
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
  });

  // Reach a question screen, create pending multi-tap input, then submit it.
  // Submission must clear that input before either disabled lifecycle begins.
  expect(controller.dispatch({ type: 'call' })).toBe(true);
  expect(controller.dispatch({ type: 'printable', value: 'seed' })).toBe(true);
  expect(controller.dispatch({ type: 'character', label: '2' })).toBe(true);
  expect(controller.getSnapshot().multiTap).not.toBeNull();
  expect(controller.dispatch({ type: 'call' })).toBe(true);
  expect(controller.getSnapshot().lifecycle).toBe(lifecycle);

  calls.length = 0;
  return { calls, controller, documentRef };
}

function applyDisabledAction(controller, documentRef, action) {
  if (action.type === 'keypad') {
    expect(controller.dispatch({ type: 'character', label: action.label })).toBe(false);
    return;
  }

  if (action.type === 'clear' || action.type === 'call') {
    expect(controller.dispatch({ type: action.type })).toBe(false);
    return;
  }

  const key = action.type === 'printable'
    ? action.value
    : action.type === 'enter'
      ? 'Enter'
      : 'Backspace';
  const event = keyboardEvent(key);
  documentRef.dispatchKeydown(event);

  // Disabled keyboard actions belong to neither the phone nor its browser
  // defaults, so the adapter must leave default handling untouched.
  expect(event.preventDefaultCalls).toBe(0);
}

describe('Phone UI disabled-state properties', () => {
  it('Feature: phone-ui, Property 6: Disabled-State Action Invariance', () => {
    // **Validates: Requirements 6.5, 6.6, 6.8, 7.3, 7.4, 7.5**
    fc.assert(
      fc.property(disabledActionSequence, (actions) => {
        for (const lifecycle of ['loading', 'end-pause']) {
          const { calls, controller, documentRef } = enterDisabledLifecycle(lifecycle);
          const before = controller.getSnapshot();

          try {
            for (const action of actions) {
              applyDisabledAction(controller, documentRef, action);

              const after = controller.getSnapshot();
              expect(after.inputBuffer).toBe(before.inputBuffer);
              expect(after.multiTap).toEqual(before.multiTap);
              expect(after).toEqual(before);
              expect(calls).toHaveLength(0);
            }
          } finally {
            controller.destroy();
          }
        }
      }),
      { numRuns: 150 },
    );
  });
});
