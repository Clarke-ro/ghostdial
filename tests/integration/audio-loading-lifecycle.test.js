import { JSDOM } from 'jsdom';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { mountPhoneUI } from '../../src/ui/phone-ui.js';

const mounted = [];

function con(state, text = 'Ready') {
  return { state, screen: { type: 'CON', text } };
}

function end(state, text = 'The line goes dead... Goodbye.') {
  return { state, screen: { type: 'END', text } };
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

function createTrackedAudio({ throws = false } = {}) {
  const state = {
    activeConnectingTones: 0,
    destroyCalls: 0,
    keyBeepCalls: 0,
    maxActiveConnectingTones: 0,
    startCalls: 0,
    stopCalls: 0,
  };

  function maybeThrow() {
    if (throws) {
      throw new Error('audio unavailable');
    }
  }

  return {
    state,
    keyBeep() {
      state.keyBeepCalls += 1;
      maybeThrow();
    },
    startConnecting() {
      state.startCalls += 1;
      // Model an idempotent audio service so duplicate starts are observable:
      // maxActiveConnectingTones must never exceed one.
      state.activeConnectingTones = 1;
      state.maxActiveConnectingTones = Math.max(
        state.maxActiveConnectingTones,
        state.activeConnectingTones,
      );
      maybeThrow();
    },
    stopConnecting() {
      state.stopCalls += 1;
      state.activeConnectingTones = 0;
      maybeThrow();
    },
    setMuted() {
      maybeThrow();
    },
    isMuted() {
      maybeThrow();
      return false;
    },
    destroy() {
      state.destroyCalls += 1;
      state.activeConnectingTones = 0;
      maybeThrow();
    },
  };
}

function mount({ transition, aiProvider = vi.fn(), audio, endPauseMs = 1500 }) {
  const browser = new JSDOM('<main id="app"></main>', {
    url: 'http://ghostdial.test/',
  });
  const controller = mountPhoneUI(browser.window.document.querySelector('#app'), {
    transition,
    aiProvider,
    audio,
    clock: { now: () => Date.now() },
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
    endPauseMs,
  });

  mounted.push({ browser, controller });
  return { aiProvider, browser, controller };
}

function beginDeferredSubmission({ outcome, audio = createTrackedAudio() }) {
  const activeState = {
    view: { kind: 'question', mode: 'oracle' },
    marker: `before-${outcome}`,
  };
  const pending = deferred();
  const transition = vi.fn()
    .mockReturnValueOnce(con(activeState, 'Ask your question'))
    .mockReturnValueOnce(pending.promise);
  const aiProvider = vi.fn();
  const { controller } = mount({ transition, aiProvider, audio });

  expect(controller.dispatch({ type: 'call' })).toBe(true);
  transition.mockClear();
  audio.state.keyBeepCalls = 0;

  expect(controller.dispatch({ type: 'printable', value: 'exact question' })).toBe(true);
  expect(controller.dispatch({ type: 'call' })).toBe(true);

  return {
    activeState,
    aiProvider,
    audio,
    controller,
    pending,
    transition,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  for (const { browser, controller } of mounted.splice(0)) {
    controller.destroy();
    browser.window.close();
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('connecting-tone lifecycle integration', () => {
  it.each([
    ['CON fulfillment', 'fulfill'],
    ['rejection', 'reject'],
    ['END fulfillment', 'end'],
  ])('starts one tone while pending and stops it on %s', async (_label, outcome) => {
    // Validates: Requirements 6.2, 6.3, 6.7, 6.8, 6.9, 7.1, 7.5
    const scenario = beginDeferredSubmission({ outcome });
    const {
      activeState,
      aiProvider,
      audio,
      controller,
      pending,
      transition,
    } = scenario;

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(
      activeState,
      'exact question',
      aiProvider,
    );
    expect(controller.getSnapshot()).toMatchObject({
      engineState: activeState,
      lifecycle: 'loading',
      inputBuffer: '',
      multiTap: null,
    });
    expect(audio.state).toMatchObject({
      activeConnectingTones: 1,
      maxActiveConnectingTones: 1,
      startCalls: 1,
      stopCalls: 0,
    });
    expect(vi.getTimerCount()).toBe(0);

    // Loading gates further submissions, so a second tone cannot be started.
    expect(controller.dispatch({ type: 'call' })).toBe(false);
    expect(transition).toHaveBeenCalledTimes(1);
    expect(audio.state.startCalls).toBe(1);
    expect(audio.state.maxActiveConnectingTones).toBe(1);

    if (outcome === 'fulfill') {
      const returnedState = { view: { kind: 'answer' }, marker: 'fulfilled' };
      pending.resolve(con(returnedState, 'A delayed answer'));
      await settlePromise();

      expect(controller.getSnapshot()).toMatchObject({
        engineState: returnedState,
        lifecycle: 'interactive',
        inputBuffer: '',
      });
      expect(vi.getTimerCount()).toBe(0);
    } else if (outcome === 'reject') {
      pending.reject(new Error('private provider failure'));
      await settlePromise();

      expect(controller.getSnapshot()).toMatchObject({
        engineState: activeState,
        lifecycle: 'error',
        inputBuffer: '',
        multiTap: null,
        screen: null,
      });
      expect(controller.controls.screenOutput.textContent).toBe(
        'Request failed. Try again.',
      );
      expect(vi.getTimerCount()).toBe(0);
    } else {
      const endedState = { status: 'ended', marker: 'fulfilled-end' };
      pending.resolve(end(endedState, 'Final spirit message'));
      await settlePromise();

      expect(controller.getSnapshot()).toMatchObject({
        engineState: endedState,
        lifecycle: 'end-pause',
        inputBuffer: '',
      });
      expect(controller.controls.screenOutput.textContent).toBe(
        'Final spirit message',
      );
      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersByTime(1499);
      expect(controller.getSnapshot().lifecycle).toBe('end-pause');
      vi.advanceTimersByTime(1);
      expect(controller.getSnapshot()).toEqual({
        engineState: null,
        lifecycle: 'idle',
        inputBuffer: '',
        multiTap: null,
        screen: null,
      });
    }

    expect(audio.state).toMatchObject({
      activeConnectingTones: 0,
      maxActiveConnectingTones: 1,
      startCalls: 1,
      stopCalls: 1,
    });

    // Cleanup after a completed loading exit must not request another stop.
    controller.destroy();
    controller.destroy();
    expect(audio.state.stopCalls).toBe(1);
    expect(audio.state.destroyCalls).toBe(1);
  });

  it.each(['resolve', 'reject'])(
    'stops on destroy and defensively ignores a late Promise %s',
    async (lateOutcome) => {
      // Validates: Requirements 6.3, 6.8, 6.9, 7.5
      const pending = deferred();
      const transition = vi.fn(() => pending.promise);
      const audio = createTrackedAudio();
      const aiProvider = vi.fn();
      const { controller } = mount({ transition, aiProvider, audio });

      expect(controller.dispatch({ type: 'printable', value: 'kept snapshot' })).toBe(true);
      expect(controller.dispatch({ type: 'call' })).toBe(true);
      const loadingSnapshot = controller.getSnapshot();

      expect(transition).toHaveBeenCalledTimes(1);
      expect(transition).toHaveBeenCalledWith(null, 'kept snapshot', aiProvider);
      expect(audio.state.startCalls).toBe(1);
      expect(audio.state.activeConnectingTones).toBe(1);

      controller.destroy();
      controller.destroy();

      expect(audio.state).toMatchObject({
        activeConnectingTones: 0,
        destroyCalls: 1,
        maxActiveConnectingTones: 1,
        startCalls: 1,
        stopCalls: 1,
      });
      expect(vi.getTimerCount()).toBe(0);

      if (lateOutcome === 'resolve') {
        pending.resolve(con({ view: { kind: 'main' } }, 'Late result'));
      } else {
        pending.reject(new Error('late rejection'));
      }
      await settlePromise();

      expect(controller.getSnapshot()).toEqual(loadingSnapshot);
      expect(transition).toHaveBeenCalledTimes(1);
      expect(audio.state.startCalls).toBe(1);
      expect(audio.state.stopCalls).toBe(1);
      expect(audio.state.activeConnectingTones).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('keeps engine arguments, state, buffers, and END timing correct when audio methods throw', async () => {
    // Validates: Requirements 6.2, 6.3, 6.7, 7.1, 7.5
    const audio = createTrackedAudio({ throws: true });
    const scenario = beginDeferredSubmission({ outcome: 'throwing-audio', audio });
    const {
      activeState,
      aiProvider,
      controller,
      pending,
      transition,
    } = scenario;
    const endedState = { status: 'ended', marker: 'audio-independent' };

    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith(
      activeState,
      'exact question',
      aiProvider,
    );
    expect(controller.getSnapshot()).toMatchObject({
      engineState: activeState,
      lifecycle: 'loading',
      inputBuffer: '',
      multiTap: null,
    });
    expect(vi.getTimerCount()).toBe(0);

    pending.resolve(end(endedState, 'Audio cannot block this END screen'));
    await settlePromise();

    expect(controller.getSnapshot()).toMatchObject({
      engineState: endedState,
      lifecycle: 'end-pause',
      inputBuffer: '',
      multiTap: null,
    });
    expect(controller.controls.screenOutput.textContent).toBe(
      'Audio cannot block this END screen',
    );
    expect(audio.state).toMatchObject({
      activeConnectingTones: 0,
      maxActiveConnectingTones: 1,
      startCalls: 1,
      stopCalls: 1,
    });
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(1499);
    expect(controller.getSnapshot().lifecycle).toBe('end-pause');
    vi.advanceTimersByTime(1);
    expect(controller.getSnapshot()).toEqual({
      engineState: null,
      lifecycle: 'idle',
      inputBuffer: '',
      multiTap: null,
      screen: null,
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(() => controller.destroy()).not.toThrow();
    expect(audio.state.destroyCalls).toBe(1);
  });
});
