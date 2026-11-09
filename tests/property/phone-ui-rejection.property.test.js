import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { mountPhoneUI } from '../../src/ui/phone-ui.js';

const FAILURE_MESSAGE = 'Request failed. Try again.';

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
    return this._textContent
      + this.children.map((child) => child.textContent).join('');
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
    this.listeners.set(
      type,
      listeners.filter((candidate) => candidate !== listener),
    );
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
    this.listeners.set(
      type,
      listeners.filter((candidate) => candidate !== listener),
    );
  }
}

const serializableEngineState = fc.record({
  version: fc.integer(),
  status: fc.constant('active'),
  view: fc.record({
    kind: fc.constantFrom('main', 'question', 'quiz-question', 'score'),
    details: fc.jsonValue(),
  }),
  history: fc.array(fc.jsonValue(), { maxLength: 5 }),
  quiz: fc.option(fc.jsonValue(), { nil: null }),
  acceptedAnswers: fc.array(fc.jsonValue(), { maxLength: 5 }),
  hauntScore: fc.nat({ max: 1000 }),
  notice: fc.option(fc.string(), { nil: null }),
  extension: fc.jsonValue(),
});

function deferred() {
  let reject;
  const promise = new Promise((_resolve, rejectPromise) => {
    reject = rejectPromise;
  });

  return { promise, reject };
}

async function settleRejection() {
  await Promise.resolve();
  await Promise.resolve();
}

function mountWithDeferredRejection(priorState) {
  const documentRef = new TestDocument();
  const root = documentRef.createElement('main');
  const pending = deferred();
  const calls = [];
  const aiProvider = () => '';
  let transitionNumber = 0;

  const transition = (state, input, provider) => {
    calls.push({ state, input, provider });
    transitionNumber += 1;

    if (transitionNumber === 1) {
      return {
        state: priorState,
        screen: { type: 'CON', text: 'Ready' },
      };
    }

    if (transitionNumber === 2) {
      return pending.promise;
    }

    return {
      state: priorState,
      screen: { type: 'CON', text: 'Ready again' },
    };
  };

  const controller = mountPhoneUI(root, {
    transition,
    aiProvider,
    clock: { now: () => 0 },
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
  });

  return {
    aiProvider,
    calls,
    controller,
    pending,
  };
}

describe('Phone UI rejection recovery properties', () => {
  it('Feature: phone-ui, Property 7: Recoverable Rejection Preservation', async () => {
    // **Validates: Requirements 6.9, 6.10, 6.11, 6.12, 6.13**
    await fc.assert(
      fc.asyncProperty(
        serializableEngineState,
        fc.jsonValue(),
        async (priorState, rejectionReason) => {
          const serializedBefore = JSON.stringify(priorState);
          const {
            aiProvider,
            calls,
            controller,
            pending,
          } = mountWithDeferredRejection(priorState);

          try {
            // Establish the generated state as the active pre-transition state.
            expect(controller.dispatch({ type: 'call' })).toBe(true);
            expect(controller.getSnapshot().engineState).toBe(priorState);

            expect(controller.dispatch({ type: 'printable', value: 'q' })).toBe(true);
            expect(controller.dispatch({ type: 'call' })).toBe(true);

            expect(calls).toHaveLength(2);
            expect(calls[1]).toEqual({
              state: priorState,
              input: 'q',
              provider: aiProvider,
            });
            expect(controller.getSnapshot()).toMatchObject({
              engineState: priorState,
              lifecycle: 'loading',
              inputBuffer: '',
              multiTap: null,
            });

            pending.reject(rejectionReason);
            await settleRejection();

            const recovered = controller.getSnapshot();
            expect(recovered.lifecycle).toBe('error');
            expect(recovered.lifecycle).not.toBe('loading');
            expect(recovered.engineState).toBe(priorState);
            expect(JSON.stringify(recovered.engineState)).toBe(serializedBefore);
            expect(recovered.inputBuffer).toBe('');
            expect(recovered.multiTap).toBeNull();
            expect(recovered.screen).toBeNull();
            expect(controller.controls.inputLine.textContent).toBe('');
            expect(controller.controls.screenOutput.textContent).toBe(FAILURE_MESSAGE);

            // Error recovery must restore both character entry and submission.
            expect(controller.controls.characterKeys.every((key) => !key.disabled)).toBe(true);
            expect(controller.controls.clearKey.disabled).toBe(false);
            expect(controller.controls.callKey.disabled).toBe(false);
            expect(controller.dispatch({ type: 'character', label: '1' })).toBe(true);
            expect(controller.getSnapshot().inputBuffer).toBe('1');
            expect(controller.dispatch({ type: 'call' })).toBe(true);
            expect(calls).toHaveLength(3);
            expect(calls[2]).toEqual({
              state: priorState,
              input: '1',
              provider: aiProvider,
            });
          } finally {
            controller.destroy();
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
