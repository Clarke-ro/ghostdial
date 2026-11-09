import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAudioService } from '../../src/ui/audio.js';
import { mountPhoneUI } from '../../src/ui/phone-ui.js';

const audioPath = fileURLToPath(new URL('../../src/ui/audio.js', import.meta.url));
const audioSource = readFileSync(audioPath, 'utf8');
const mounted = [];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function con(state, text = 'Menu') {
  return { state, screen: { type: 'CON', text } };
}

function end(state, text = 'The line goes dead... Goodbye.') {
  return { state, screen: { type: 'END', text } };
}

function mountBrowser({ transition, audio }) {
  const browser = new JSDOM('<main id="app"></main>', {
    url: 'http://ghostdial.test/',
  });
  const root = browser.window.document.querySelector('#app');
  const controller = mountPhoneUI(root, {
    transition,
    aiProvider: vi.fn(),
    audio,
  });

  mounted.push({ browser, controller });
  return { browser, controller, document: browser.window.document };
}

async function settlePromise() {
  await Promise.resolve();
  await Promise.resolve();
}

class BlockedAudioContext {
  static instances = [];

  constructor() {
    this.state = 'suspended';
    this.currentTime = 1;
    this.destination = {};
    this.resumeCalls = 0;
    this.oscillatorCount = 0;
    BlockedAudioContext.instances.push(this);
  }

  resume() {
    this.resumeCalls += 1;
    return Promise.reject(new Error('autoplay blocked'));
  }

  createGain() {
    return {
      gain: {
        setValueAtTime() {},
        linearRampToValueAtTime() {},
      },
      connect() {},
      disconnect() {},
    };
  }

  createOscillator() {
    this.oscillatorCount += 1;
    return {
      frequency: { setValueAtTime() {} },
      connect() {},
      disconnect() {},
      start() {},
      stop() {},
    };
  }

  close() {
    return Promise.resolve();
  }
}

afterEach(() => {
  for (const { browser, controller } of mounted.splice(0)) {
    controller.destroy();
    browser.window.close();
  }
  BlockedAudioContext.instances.length = 0;
  vi.restoreAllMocks();
});

describe('browser audio boundary smoke checks', () => {
  it('contains only generated oscillator/envelope audio with no external or engine boundary', () => {
    expect(audioSource).toMatch(/createOscillator\(\)/);
    expect(audioSource).toMatch(/createGain\(\)/);
    expect(audioSource).toMatch(/linearRampToValueAtTime/);

    expect(audioSource).not.toMatch(/<audio\b|HTMLAudioElement|new\s+Audio\s*\(/i);
    expect(audioSource).not.toMatch(/\.(?:mp3|wav|ogg|aac|m4a|flac|webm)\b/i);
    expect(audioSource).not.toMatch(
      /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\b|navigator\.mediaDevices/i,
    );
    expect(audioSource).not.toMatch(/createMedia(?:Element|Stream)Source/i);
    expect(audioSource).not.toMatch(/api[\\/]ask\.js|from\s+['"][^'"]*api[^'"]*['"]/i);
    expect(audioSource).not.toMatch(/from\s+['"][^'"]*engine[^'"]*['"]|\bengineState\b|\bEngine_State\b/i);
  });

  it('keeps the accessible mute control operable and isolated without AudioContext', async () => {
    const pending = deferred();
    const transition = vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(end({ status: 'ended' }));
    const audio = createAudioService({ AudioContextCtor: null });
    const { controller, document } = mountBrowser({ transition, audio });
    const enclosure = document.querySelector('.retro-phone');
    const keypad = document.querySelector('.keypad');
    const mute = document.querySelector('.mute-key');

    expect(document.querySelectorAll('.retro-phone')).toHaveLength(1);
    expect(enclosure.contains(mute)).toBe(true);
    expect(keypad.contains(mute)).toBe(false);
    expect(mute.disabled).toBe(false);
    expect(mute.textContent).toBe('Mute audio');
    expect(mute.getAttribute('aria-label')).toBe('Mute audio');
    expect(mute.getAttribute('aria-pressed')).toBe('false');
    expect(audio.isMuted()).toBe(false);
    expect(enclosure.textContent).not.toMatch(/nokia|samsung|motorola|apple|iphone/i);

    expect(() => document.querySelector('.call-key').click()).not.toThrow();
    expect(controller.getSnapshot().lifecycle).toBe('loading');
    expect(mute.disabled).toBe(false);
    const loadingSnapshot = controller.getSnapshot();

    expect(() => mute.click()).not.toThrow();
    expect(audio.isMuted()).toBe(true);
    expect(mute.textContent).toBe('Unmute audio');
    expect(mute.getAttribute('aria-label')).toBe('Unmute audio');
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    expect(controller.getSnapshot()).toEqual(loadingSnapshot);

    mute.click();
    expect(audio.isMuted()).toBe(false);
    expect(mute.getAttribute('aria-pressed')).toBe('false');
    expect(controller.getSnapshot()).toEqual(loadingSnapshot);

    pending.resolve(con({ view: { kind: 'main' } }));
    await settlePromise();
    document.querySelector('.call-key').click();
    expect(controller.getSnapshot().lifecycle).toBe('end-pause');
    expect(mute.disabled).toBe(false);
    const endedSnapshot = controller.getSnapshot();

    mute.click();
    expect(audio.isMuted()).toBe(true);
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    expect(controller.getSnapshot()).toEqual(endedSnapshot);
  });

  it('preserves browser interaction when autoplay resume is rejected', async () => {
    const pending = deferred();
    const transition = vi.fn(() => pending.promise);
    const audio = createAudioService({ AudioContextCtor: BlockedAudioContext });
    const { controller, document } = mountBrowser({ transition, audio });

    expect(() => document.querySelector('.character-key').click()).not.toThrow();
    expect(controller.getSnapshot().inputBuffer).toBe('1');
    expect(BlockedAudioContext.instances).toHaveLength(1);

    expect(() => document.querySelector('.call-key').click()).not.toThrow();
    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: 'loading',
      inputBuffer: '',
    });
    expect(transition).toHaveBeenCalledTimes(1);
    expect(BlockedAudioContext.instances[0].resumeCalls).toBeGreaterThan(0);
    expect(BlockedAudioContext.instances[0].oscillatorCount).toBeGreaterThan(0);

    const beforeMute = controller.getSnapshot();
    expect(() => document.querySelector('.mute-key').click()).not.toThrow();
    expect(controller.getSnapshot()).toEqual(beforeMute);

    pending.resolve(con({ view: { kind: 'answer' } }, 'Spirit answer'));
    await settlePromise();
    expect(controller.getSnapshot()).toMatchObject({
      lifecycle: 'interactive',
      inputBuffer: '',
    });
    expect(document.querySelector('.screen-output').textContent).toBe('Spirit answer');
  });
});
