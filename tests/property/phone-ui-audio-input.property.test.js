import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createNoopAudioService } from '../../src/ui/audio.js';
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

  dispatch(type, event) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

function createTimerHarness() {
  let nextId = 1;
  const active = new Map();

  return {
    setTimeoutFn(callback, delay) {
      const id = nextId;
      nextId += 1;
      active.set(id, { callback, delay });
      return id;
    },
    clearTimeoutFn(id) {
      active.delete(id);
    },
    snapshot() {
      return [...active.values()].map(({ delay }) => delay).sort((left, right) => left - right);
    },
  };
}

function createRecordingAudio({ throws = false } = {}) {
  const calls = {
    keyBeep: 0,
    startConnecting: 0,
    stopConnecting: 0,
    setMuted: 0,
    destroy: 0,
  };

  function method(name) {
    return () => {
      calls[name] += 1;
      if (throws) {
        throw new Error('audio unavailable');
      }
    };
  }

  return {
    calls,
    keyBeep: method('keyBeep'),
    startConnecting: method('startConnecting'),
    stopConnecting: method('stopConnecting'),
    setMuted: method('setMuted'),
    isMuted: () => false,
    destroy: method('destroy'),
  };
}

function keyboardEvent(action) {
  let prevented = 0;
  const event = {
    key: action.value,
    ctrlKey: action.modifier === 'ctrl',
    altKey: action.modifier === 'alt',
    metaKey: action.modifier === 'meta',
    preventDefault() {
      prevented += 1;
    },
  };

  return { event, prevented: () => prevented };
}

function makeAudio(kind) {
  if (kind === 'recording') {
    return createRecordingAudio();
  }
  if (kind === 'throwing') {
    return createRecordingAudio({ throws: true });
  }
  return createNoopAudioService();
}

function makeTransition(scenario, calls, aiProvider) {
  const activeState = {
    id: `state-${scenario}`,
    view: { kind: scenario.includes('question') ? 'question' : 'main' },
  };
  let invocation = 0;

  return {
    activeState,
    transition(state, input, provider) {
      calls.push({
        state: structuredClone(state),
        input,
        providerMatches: provider === aiProvider,
      });
      invocation += 1;

      if (scenario === 'loading' && invocation === 1) {
        return new Promise(() => {});
      }
      if (scenario === 'end-pause' && invocation === 1) {
        return {
          state: { status: 'ended' },
          screen: { type: 'END', text: 'Goodbye' },
        };
      }

      return {
        state: activeState,
        screen: { type: 'CON', text: 'Ready' },
      };
    },
  };
}

function seedScenario(controller, scenario) {
  if (scenario !== 'idle') {
    expect(controller.dispatch({ type: 'call' })).toBe(true);
  }

  if (scenario.endsWith('-full')) {
    for (let index = 0; index < MAX_INPUT_LENGTH; index += 1) {
      expect(controller.dispatch({ type: 'printable', value: 'x' })).toBe(true);
    }
  }
}

function expectedKeyboardAcceptance(before, action) {
  const interactive = ['idle', 'interactive', 'error'].includes(before.lifecycle);
  if (!interactive || action.kind === 'keyboard-modified' || action.kind === 'keyboard-unsupported') {
    return false;
  }
  if (action.kind === 'keyboard-printable') {
    return before.inputBuffer.length + action.value.length <= MAX_INPUT_LENGTH;
  }
  return true;
}

function performAction(controller, documentRef, action) {
  if (action.kind === 'keypad-character') {
    return {
      accepted: controller.dispatch({ type: 'character', label: action.value }),
      prevented: 0,
    };
  }
  if (action.kind === 'keypad-call') {
    return { accepted: controller.dispatch({ type: 'call' }), prevented: 0 };
  }
  if (action.kind === 'keypad-clear') {
    return { accepted: controller.dispatch({ type: 'clear' }), prevented: 0 };
  }

  const before = controller.getSnapshot();
  const { event, prevented } = keyboardEvent(action);
  documentRef.dispatch('keydown', event);
  const accepted = expectedKeyboardAcceptance(before, action);
  const shouldPrevent = ['keyboard-printable', 'keyboard-enter', 'keyboard-backspace'].includes(action.kind)
    && ['idle', 'interactive', 'error'].includes(before.lifecycle);

  expect(prevented()).toBe(shouldPrevent ? 1 : 0);
  return { accepted, prevented: prevented() };
}

function runScenario(scenario, actions, audioKind) {
  const documentRef = new TestDocument();
  const root = documentRef.createElement('main');
  const timers = createTimerHarness();
  const audio = makeAudio(audioKind);
  const aiProvider = () => '';
  const engineCalls = [];
  const { transition } = makeTransition(scenario, engineCalls, aiProvider);
  const controller = mountPhoneUI(root, {
    transition,
    aiProvider,
    audio,
    clock: { now: () => 0 },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });

  try {
    seedScenario(controller, scenario);
    engineCalls.length = 0;
    if (audio.calls) {
      audio.calls.keyBeep = 0;
    }

    let acceptedCount = 0;
    const trace = [];

    for (const action of actions) {
      const outcome = performAction(controller, documentRef, action);
      if (outcome.accepted) {
        acceptedCount += 1;
      }

      if (audio.calls) {
        expect(audio.calls.keyBeep).toBe(acceptedCount);
      }

      trace.push({
        snapshot: controller.getSnapshot(),
        engineCalls: structuredClone(engineCalls),
        timers: timers.snapshot(),
        prevented: outcome.prevented,
      });
    }

    return {
      acceptedCount,
      keyBeeps: audio.calls?.keyBeep ?? null,
      trace,
    };
  } finally {
    controller.destroy();
  }
}

const scenarioArbitrary = fc.constantFrom(
  'idle',
  'active-main',
  'active-question',
  'active-main-full',
  'active-question-full',
  'loading',
  'end-pause',
);

const actionArbitrary = fc.oneof(
  fc.record({
    kind: fc.constant('keypad-character'),
    value: fc.constantFrom('1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'),
  }),
  fc.constant({ kind: 'keypad-call' }),
  fc.constant({ kind: 'keypad-clear' }),
  fc.record({
    kind: fc.constant('keyboard-printable'),
    value: fc.constantFrom('a', '7', ' ', '!', '*', '#'),
  }),
  fc.constant({ kind: 'keyboard-enter', value: 'Enter' }),
  fc.constant({ kind: 'keyboard-backspace', value: 'Backspace' }),
  fc.record({
    kind: fc.constant('keyboard-modified'),
    value: fc.constantFrom('a', '7', '!', '*'),
    modifier: fc.constantFrom('ctrl', 'alt', 'meta'),
  }),
  fc.record({
    kind: fc.constant('keyboard-unsupported'),
    value: fc.constantFrom('ArrowLeft', 'Escape', 'Tab', 'F1'),
  }),
);

const actionSequenceArbitrary = fc.array(actionArbitrary, { minLength: 1, maxLength: 24 });

const coverageExamples = [
  ['active-main', [
    { kind: 'keypad-character', value: '1' },
    { kind: 'keypad-clear' },
    { kind: 'keyboard-printable', value: '!' },
    { kind: 'keyboard-backspace', value: 'Backspace' },
    { kind: 'keypad-call' },
    { kind: 'keyboard-enter', value: 'Enter' },
  ]],
  ['active-question', [
    { kind: 'keypad-character', value: '2' },
    { kind: 'keypad-character', value: '2' },
    { kind: 'keypad-character', value: '3' },
  ]],
  ['active-main-full', [
    { kind: 'keypad-character', value: '1' },
    { kind: 'keyboard-printable', value: 'a' },
  ]],
  ['active-question-full', [
    { kind: 'keypad-character', value: '2' },
    { kind: 'keyboard-printable', value: '#' },
  ]],
  ['loading', [
    { kind: 'keypad-character', value: '1' },
    { kind: 'keypad-clear' },
    { kind: 'keypad-call' },
    { kind: 'keyboard-printable', value: 'a' },
    { kind: 'keyboard-enter', value: 'Enter' },
    { kind: 'keyboard-backspace', value: 'Backspace' },
  ]],
  ['end-pause', [
    { kind: 'keypad-character', value: '#' },
    { kind: 'keyboard-printable', value: '!' },
    { kind: 'keyboard-enter', value: 'Enter' },
  ]],
  ['active-main', [
    { kind: 'keyboard-modified', value: 'a', modifier: 'ctrl' },
    { kind: 'keyboard-modified', value: '!', modifier: 'alt' },
    { kind: 'keyboard-unsupported', value: 'ArrowLeft' },
  ]],
];

describe('Phone UI audio input property', () => {
  it('Feature: phone-ui, Property 9: Accepted Key Audio Is Gated and Isolated', () => {
    // **Validates: Requirements 1.5, 4.1, 4.3, 5.1, 5.2, 5.7, 6.5, 7.3**
    fc.assert(
      fc.property(scenarioArbitrary, actionSequenceArbitrary, (scenario, actions) => {
        const recording = runScenario(scenario, actions, 'recording');
        const disabled = runScenario(scenario, actions, 'noop');
        const failing = runScenario(scenario, actions, 'throwing');

        expect(recording.keyBeeps).toBe(recording.acceptedCount);
        expect(failing.keyBeeps).toBe(failing.acceptedCount);
        expect(disabled.acceptedCount).toBe(recording.acceptedCount);
        expect(failing.acceptedCount).toBe(recording.acceptedCount);
        expect(disabled.trace).toEqual(recording.trace);
        expect(failing.trace).toEqual(recording.trace);
      }),
      {
        numRuns: 150,
        examples: coverageExamples,
      },
    );
  });
});
