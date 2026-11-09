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

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
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

function createScheduler() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();

  function setTimeoutFn(callback, delay) {
    const id = ++nextId;
    timers.set(id, { callback, dueAt: now + delay });
    return id;
  }

  function clearTimeoutFn(id) {
    timers.delete(id);
  }

  function advanceBy(milliseconds) {
    const target = now + milliseconds;

    while (true) {
      const nextTimer = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];

      if (!nextTimer) {
        break;
      }

      const [id, timer] = nextTimer;
      timers.delete(id);
      now = timer.dueAt;
      timer.callback();
    }

    now = target;
  }

  return {
    clock: { now: () => now },
    setTimeoutFn,
    clearTimeoutFn,
    advanceBy,
    snapshot: () => [...timers.entries()]
      .map(([id, timer]) => ({ id, dueAt: timer.dueAt }))
      .sort((left, right) => left.id - right.id),
  };
}

function createRecordingAudio() {
  let muted = false;
  const calls = {
    keyBeep: 0,
    startConnecting: 0,
    stopConnecting: 0,
    setMuted: [],
  };

  return {
    calls,
    keyBeep() {
      calls.keyBeep += 1;
    },
    startConnecting() {
      calls.startConnecting += 1;
    },
    stopConnecting() {
      calls.stopConnecting += 1;
    },
    setMuted(value) {
      muted = Boolean(value);
      calls.setMuted.push(muted);
    },
    isMuted() {
      return muted;
    },
    destroy() {},
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function con(state, text = 'Ready') {
  return { state, screen: { type: 'CON', text } };
}

function end(state) {
  return {
    state,
    screen: { type: 'END', text: 'The line goes dead... Goodbye.' },
  };
}

const lifecycleArbitrary = fc.constantFrom(
  'idle',
  'interactive',
  'error',
  'loading',
  'end-pause',
);
const inputCharacterArbitrary = fc.constantFrom('a', 'z', ' ', '!', '*', '#');
const prefixArbitrary = fc
  .array(inputCharacterArbitrary, { maxLength: 12 })
  .map((characters) => characters.join(''));
const pendingDigitArbitrary = fc.option(
  fc.constantFrom('0', '2', '3', '4', '5', '6', '7', '8', '9'),
  { nil: null },
);
const muteSequenceArbitrary = fc.array(fc.constant('mute-toggle'), {
  minLength: 1,
  maxLength: 24,
});

function makeTransitionPlan(lifecycle, shared) {
  const calls = [];
  const pending = lifecycle === 'loading' ? deferred() : null;
  let invocation = 0;

  function transition(...args) {
    calls.push(args);
    invocation += 1;

    if (lifecycle === 'interactive' && invocation === 1) {
      return con(shared.questionState, 'Question');
    }
    if (lifecycle === 'error' && invocation === 1) {
      return con(shared.questionState, 'Question');
    }
    if (lifecycle === 'error' && invocation === 2) {
      throw new Error('expected transition failure');
    }
    if (lifecycle === 'loading' && invocation === 1) {
      return pending.promise;
    }
    if (lifecycle === 'end-pause' && invocation === 1) {
      return end(shared.endedState);
    }

    return con(shared.afterState, 'Next screen');
  }

  return { calls, pending, transition };
}

function mountHarness(lifecycle, shared) {
  const documentRef = new TestDocument();
  const root = documentRef.createElement('main');
  const scheduler = createScheduler();
  const audio = createRecordingAudio();
  const plan = makeTransitionPlan(lifecycle, shared);
  const controller = mountPhoneUI(root, {
    transition: plan.transition,
    aiProvider: shared.aiProvider,
    audio,
    clock: scheduler.clock,
    setTimeoutFn: scheduler.setTimeoutFn,
    clearTimeoutFn: scheduler.clearTimeoutFn,
  });

  return { audio, controller, plan, scheduler };
}

function enterLifecycle(harness, lifecycle, prefix, pendingDigit) {
  const { controller } = harness;

  if (lifecycle === 'interactive') {
    expect(controller.dispatch({ type: 'call' })).toBe(true);
  } else if (lifecycle === 'error') {
    expect(controller.dispatch({ type: 'call' })).toBe(true);
    expect(controller.dispatch({ type: 'call' })).toBe(true);
  } else if (lifecycle === 'loading' || lifecycle === 'end-pause') {
    appendPrefix(controller, prefix);
    expect(controller.dispatch({ type: 'call' })).toBe(true);
    return;
  }

  appendPrefix(controller, prefix);

  if ((lifecycle === 'interactive' || lifecycle === 'error') && pendingDigit !== null) {
    expect(controller.dispatch({ type: 'character', label: pendingDigit })).toBe(true);
  }
}

function appendPrefix(controller, prefix) {
  for (const character of prefix) {
    expect(controller.dispatch({ type: 'printable', value: character })).toBe(true);
  }
}

function nonMutePresentation(controller) {
  const { controls } = controller;
  return {
    output: controls.screenOutput.textContent,
    input: controls.inputLine.textContent,
    lifecycle: controls.enclosure.getAttribute('data-lifecycle'),
    busy: controls.enclosure.getAttribute('aria-busy'),
    inputDisabled: controls.enclosure.getAttribute('data-input-disabled'),
    disabled: [
      ...controls.characterKeys,
      controls.callKey,
      controls.clearKey,
      controls.backKey,
      controls.homeKey,
    ].map((control) => control.disabled),
  };
}

async function makeInteractiveAfterPause(harness, lifecycle, shared) {
  if (lifecycle === 'loading') {
    harness.plan.pending.resolve(con(shared.questionState, 'Question'));
    await Promise.resolve();
    await Promise.resolve();
  } else if (lifecycle === 'end-pause') {
    harness.scheduler.advanceBy(1500);
  }
}

function expectAccessibleMuteState(harness, expectedMuted) {
  const muteKey = harness.controller.controls.muteKey;
  expect(harness.audio.isMuted()).toBe(expectedMuted);
  expect(muteKey.getAttribute('aria-pressed')).toBe(String(expectedMuted));
  expect(muteKey.getAttribute('aria-label')).toBe(
    expectedMuted ? 'Unmute audio' : 'Mute audio',
  );
  expect(muteKey.textContent).toBe(expectedMuted ? 'Unmute audio' : 'Mute audio');
  expect(muteKey.dataset.muted).toBe(String(expectedMuted));
}

describe('Phone UI mute properties', () => {
  it('Feature: phone-ui, Property 11: Mute Changes Audio Only', async () => {
    // **Validates: Requirements 1.5, 4.9, 6.5, 6.6, 7.3, 7.5**
    await fc.assert(
      fc.asyncProperty(
        lifecycleArbitrary,
        prefixArbitrary,
        pendingDigitArbitrary,
        muteSequenceArbitrary,
        inputCharacterArbitrary,
        async (lifecycle, prefix, pendingDigit, muteSequence, laterCharacter) => {
          const shared = {
            questionState: { view: { kind: 'question' }, marker: 'question' },
            endedState: { status: 'ended', marker: 'ended' },
            afterState: { view: { kind: 'main' }, marker: 'after' },
            aiProvider: () => '',
          };
          const mutedHarness = mountHarness(lifecycle, shared);
          const controlHarness = mountHarness(lifecycle, shared);

          try {
            enterLifecycle(mutedHarness, lifecycle, prefix, pendingDigit);
            enterLifecycle(controlHarness, lifecycle, prefix, pendingDigit);

            expect(mutedHarness.controller.getSnapshot().lifecycle).toBe(lifecycle);
            expect(controlHarness.controller.getSnapshot()).toEqual(
              mutedHarness.controller.getSnapshot(),
            );

            const snapshotBeforeMute = mutedHarness.controller.getSnapshot();
            const engineStateBeforeMute = snapshotBeforeMute.engineState;
            const timersBeforeMute = mutedHarness.scheduler.snapshot();
            const callsBeforeMute = mutedHarness.plan.calls.map((call) => [...call]);
            const presentationBeforeMute = nonMutePresentation(mutedHarness.controller);

            for (let index = 0; index < muteSequence.length; index += 1) {
              expect(mutedHarness.controller.dispatch({ type: muteSequence[index] })).toBe(true);

              const expectedMuted = index % 2 === 0;
              expectAccessibleMuteState(mutedHarness, expectedMuted);
              expect(mutedHarness.controller.getSnapshot()).toEqual(snapshotBeforeMute);
              expect(mutedHarness.controller.getSnapshot().engineState).toBe(engineStateBeforeMute);
              expect(mutedHarness.scheduler.snapshot()).toEqual(timersBeforeMute);
              expect(mutedHarness.plan.calls).toEqual(callsBeforeMute);
              expect(nonMutePresentation(mutedHarness.controller)).toEqual(presentationBeforeMute);
            }

            expect(mutedHarness.audio.calls.setMuted).toEqual(
              muteSequence.map((_, index) => index % 2 === 0),
            );
            expect(mutedHarness.audio.calls.keyBeep).toBe(
              controlHarness.audio.calls.keyBeep,
            );

            await makeInteractiveAfterPause(mutedHarness, lifecycle, shared);
            await makeInteractiveAfterPause(controlHarness, lifecycle, shared);

            const mutedAccepted = mutedHarness.controller.dispatch({
              type: 'printable',
              value: laterCharacter,
            });
            const controlAccepted = controlHarness.controller.dispatch({
              type: 'printable',
              value: laterCharacter,
            });

            expect(mutedAccepted).toBe(true);
            expect(mutedAccepted).toBe(controlAccepted);
            expect(mutedHarness.controller.getSnapshot()).toEqual(
              controlHarness.controller.getSnapshot(),
            );
            expect(mutedHarness.scheduler.snapshot()).toEqual(
              controlHarness.scheduler.snapshot(),
            );

            const stateAtSubmission = mutedHarness.controller.getSnapshot().engineState;
            const inputAtSubmission = mutedHarness.controller.getSnapshot().inputBuffer;
            const callCountBeforeSubmission = mutedHarness.plan.calls.length;

            expect(mutedHarness.controller.dispatch({ type: 'call' })).toBe(true);
            expect(controlHarness.controller.dispatch({ type: 'call' })).toBe(true);

            expect(mutedHarness.plan.calls).toEqual(controlHarness.plan.calls);
            expect(mutedHarness.plan.calls).toHaveLength(callCountBeforeSubmission + 1);
            expect(mutedHarness.plan.calls.at(-1)).toEqual([
              stateAtSubmission,
              inputAtSubmission,
              shared.aiProvider,
            ]);
            expect(mutedHarness.controller.getSnapshot()).toEqual(
              controlHarness.controller.getSnapshot(),
            );
            expect(mutedHarness.scheduler.snapshot()).toEqual(
              controlHarness.scheduler.snapshot(),
            );
          } finally {
            mutedHarness.controller.destroy();
            controlHarness.controller.destroy();
          }
        },
      ),
      {
        numRuns: 150,
        examples: [
          ['idle', '', null, ['mute-toggle'], 'a'],
          ['interactive', 'ask', '2', ['mute-toggle', 'mute-toggle'], '!'],
          ['error', 'retry', '9', ['mute-toggle'], '#'],
          ['loading', 'wait', null, ['mute-toggle', 'mute-toggle', 'mute-toggle'], 'z'],
          ['end-pause', 'bye', null, ['mute-toggle'], ' '],
        ],
      },
    );
  });
});
