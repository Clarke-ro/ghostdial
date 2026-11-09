import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createNoopAudioService } from '../../src/ui/audio.js';
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
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settlePromise() {
  await Promise.resolve();
  await Promise.resolve();
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
      return [...active.values()]
        .map(({ delay }) => delay)
        .sort((left, right) => left - right);
    },
  };
}

function createRecordingAudio({ throws = false } = {}) {
  const calls = {
    keyBeep: 0,
    startConnecting: 0,
    stopConnecting: 0,
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
    setMuted: () => {},
    isMuted: () => false,
    destroy: method('destroy'),
  };
}

function createAudio(kind) {
  if (kind === 'recording') {
    return createRecordingAudio();
  }
  if (kind === 'throwing') {
    return createRecordingAudio({ throws: true });
  }
  return createNoopAudioService();
}

function con(state, text) {
  return { state, screen: { type: 'CON', text } };
}

function end(state, text) {
  return { state, screen: { type: 'END', text } };
}

function copySnapshot(snapshot) {
  return structuredClone(snapshot);
}

async function runScenario({ outcome, activeState, input, endPauseMs }, audioKind) {
  const documentRef = new TestDocument();
  const root = documentRef.createElement('main');
  const timers = createTimerHarness();
  const audio = createAudio(audioKind);
  const aiProvider = () => 'unused';
  const engineCalls = [];
  const pending = outcome === 'synchronous' ? null : deferred();
  const returnedState = {
    id: `returned-${activeState.id}`,
    view: { kind: 'answer' },
  };
  const endedState = { status: 'ended', id: activeState.id };
  let invocation = 0;

  function transition(state, submittedInput, provider) {
    engineCalls.push({
      state: structuredClone(state),
      submittedInput,
      providerMatches: provider === aiProvider,
    });
    invocation += 1;

    // Establish a serializable active Engine_State before exercising the
    // generated lifecycle outcome.
    if (invocation === 1) {
      return con(activeState, 'Ready');
    }
    if (outcome === 'synchronous') {
      return con(returnedState, 'Immediate answer');
    }
    return pending.promise;
  }

  const controller = mountPhoneUI(root, {
    transition,
    aiProvider,
    audio,
    clock: { now: () => 0 },
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
    endPauseMs,
  });

  // The setup transition is synchronous, so it must not start or stop the
  // connecting tone.
  expect(controller.dispatch({ type: 'call' })).toBe(true);
  expect(controller.getSnapshot().engineState).toBe(activeState);
  engineCalls.length = 0;

  for (const character of input) {
    expect(controller.dispatch({ type: 'printable', value: character })).toBe(true);
  }

  expect(controller.dispatch({ type: 'call' })).toBe(true);
  expect(engineCalls).toEqual([{
    state: structuredClone(activeState),
    submittedInput: input,
    providerMatches: true,
  }]);

  const enteredSnapshot = copySnapshot(controller.getSnapshot());
  const timersOnEntry = timers.snapshot();
  let disabledCallAccepted = null;

  if (outcome !== 'synchronous') {
    expect(enteredSnapshot.lifecycle).toBe('loading');
    expect(enteredSnapshot.inputBuffer).toBe('');
    expect(timersOnEntry).toEqual([]);

    // Pending work cannot cause another engine invocation.
    disabledCallAccepted = controller.dispatch({ type: 'call' });
    expect(disabledCallAccepted).toBe(false);
    expect(engineCalls).toHaveLength(1);
  }

  if (outcome === 'fulfilling') {
    pending.resolve(con(returnedState, 'Delayed answer'));
    await settlePromise();
  } else if (outcome === 'rejecting') {
    pending.reject(new Error('provider failed'));
    await settlePromise();
  } else if (outcome === 'end-producing') {
    pending.resolve(end(endedState, 'The line goes dead... Goodbye.'));
    await settlePromise();
    expect(controller.dispatch({ type: 'call' })).toBe(false);
    expect(engineCalls).toHaveLength(1);
  } else if (outcome === 'cancelled') {
    // Destruction invalidates the pending token. A late fulfillment is a
    // defensively cancelled result and must not re-enter the controller.
    controller.destroy();
    pending.resolve(con(returnedState, 'Late answer'));
    await settlePromise();
  } else if (outcome === 'destroyed') {
    // Repeated cleanup while loading must stop at most once. The pending
    // rejection remains handled and cannot change the destroyed controller.
    controller.destroy();
    controller.destroy();
    pending.reject(new Error('late rejection'));
    await settlePromise();
  }

  const outcomeSnapshot = copySnapshot(controller.getSnapshot());
  const timersAfterOutcome = timers.snapshot();

  if (outcome === 'synchronous' || outcome === 'fulfilling') {
    expect(outcomeSnapshot.lifecycle).toBe('interactive');
    expect(outcomeSnapshot.engineState).toEqual(returnedState);
  } else if (outcome === 'rejecting') {
    expect(outcomeSnapshot.lifecycle).toBe('error');
    expect(outcomeSnapshot.engineState).toEqual(activeState);
    expect(outcomeSnapshot.inputBuffer).toBe('');
  } else if (outcome === 'end-producing') {
    expect(outcomeSnapshot.lifecycle).toBe('end-pause');
    expect(outcomeSnapshot.engineState).toEqual(endedState);
    expect(timersAfterOutcome).toEqual([endPauseMs]);
  } else {
    expect(outcomeSnapshot).toEqual(enteredSnapshot);
  }

  // Cleanup is deliberately repeated for every outcome. A loading stop and
  // audio destruction must both be idempotent at the controller boundary.
  controller.destroy();
  controller.destroy();

  const semanticTrace = {
    enteredSnapshot,
    outcomeSnapshot,
    engineCalls: structuredClone(engineCalls),
    timersOnEntry,
    timersAfterOutcome,
    timersAfterDestroy: timers.snapshot(),
    disabledCallAccepted,
  };

  return {
    semanticTrace,
    audioCalls: audio.calls ? { ...audio.calls } : null,
  };
}

const outcomeArbitrary = fc.constantFrom(
  'synchronous',
  'fulfilling',
  'rejecting',
  'end-producing',
  'cancelled',
  'destroyed',
);

const activeStateArbitrary = fc.record({
  id: fc.integer(),
  view: fc.constant({ kind: 'main' }),
  marker: fc.string({ maxLength: 16 }),
});

const inputArbitrary = fc
  .array(fc.constantFrom('a', '7', ' ', '!', '*', '#'), { maxLength: 24 })
  .map((characters) => characters.join(''));

const scenarioArbitrary = fc.record({
  outcome: outcomeArbitrary,
  activeState: activeStateArbitrary,
  input: inputArbitrary,
  endPauseMs: fc.integer({ min: 0, max: 5000 }),
});

const coverageExamples = [
  'synchronous',
  'fulfilling',
  'rejecting',
  'end-producing',
  'cancelled',
  'destroyed',
].map((outcome, index) => [{
  outcome,
  activeState: { id: index, view: { kind: 'main' }, marker: outcome },
  input: index % 2 === 0 ? 'notes #1' : '',
  endPauseMs: 1500,
}]);

describe('Phone UI loading audio property', () => {
  it('Feature: phone-ui, Property 10: Loading Tone Follows Promise Lifecycle', async () => {
    // **Validates: Requirements 1.5, 6.1, 6.2, 6.7, 6.8, 6.9, 7.1, 7.3, 7.5**
    await fc.assert(
      fc.asyncProperty(scenarioArbitrary, async (scenario) => {
        const recording = await runScenario(scenario, 'recording');
        const noAudio = await runScenario(scenario, 'noop');
        const throwing = await runScenario(scenario, 'throwing');
        const entersLoading = scenario.outcome !== 'synchronous';

        expect(recording.audioCalls.startConnecting).toBe(entersLoading ? 1 : 0);
        expect(recording.audioCalls.stopConnecting).toBe(entersLoading ? 1 : 0);
        expect(recording.audioCalls.destroy).toBe(1);

        // Throwing audio observes the same attempted event contract, while all
        // controller, engine-argument, and timer behavior stays unchanged.
        expect(throwing.audioCalls.startConnecting).toBe(entersLoading ? 1 : 0);
        expect(throwing.audioCalls.stopConnecting).toBe(entersLoading ? 1 : 0);
        expect(throwing.audioCalls.destroy).toBe(1);
        expect(noAudio.semanticTrace).toEqual(recording.semanticTrace);
        expect(throwing.semanticTrace).toEqual(recording.semanticTrace);
      }),
      {
        numRuns: 150,
        examples: coverageExamples,
      },
    );
  });
});
