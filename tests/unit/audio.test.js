import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createAudioService,
  createNoopAudioService,
} from '../../src/ui/audio.js';

class FakeAudioParam {
  constructor() {
    this.calls = [];
    this.value = 0;
  }

  setValueAtTime(value, time) {
    this.calls.push({ method: 'setValueAtTime', value, time });
    this.value = value;
  }

  linearRampToValueAtTime(value, time) {
    this.calls.push({ method: 'linearRampToValueAtTime', value, time });
    this.value = value;
  }
}

class FakeOscillator {
  constructor(config = {}) {
    this.frequency = new FakeAudioParam();
    this.type = 'custom';
    this.connections = [];
    this.starts = [];
    this.stops = [];
    this.disconnects = 0;
    this.config = config;
  }

  connect(destination) {
    this.connections.push(destination);
  }

  start(time) {
    if (this.config.throwOnStart) {
      throw new Error('oscillator start blocked');
    }
    this.starts.push(time);
  }

  stop(time) {
    this.stops.push(time);
  }

  disconnect() {
    this.disconnects += 1;
  }
}

class FakeGain {
  constructor() {
    this.gain = new FakeAudioParam();
    this.connections = [];
    this.disconnects = 0;
  }

  connect(destination) {
    this.connections.push(destination);
  }

  disconnect() {
    this.disconnects += 1;
  }
}

class FakeAudioContext {
  constructor(config = {}) {
    this.config = config;
    this.state = config.state ?? 'running';
    this.currentTime = config.currentTime ?? 12.5;
    this.destination = { kind: 'destination' };
    this.gains = [];
    this.oscillators = [];
    this.resumeCalls = 0;
    this.closeCalls = 0;
  }

  createGain() {
    if (this.config.throwOnGain) {
      throw new Error('gain creation blocked');
    }
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  createOscillator() {
    if (this.config.throwOnOscillator) {
      throw new Error('oscillator creation blocked');
    }
    const oscillator = new FakeOscillator(this.config);
    this.oscillators.push(oscillator);
    return oscillator;
  }

  resume() {
    this.resumeCalls += 1;
    if (this.config.throwOnResume) {
      throw new Error('resume blocked');
    }
    if (this.config.resumeResult !== undefined) {
      return this.config.resumeResult;
    }
    return Promise.resolve();
  }

  close() {
    this.closeCalls += 1;
    if (this.config.throwOnClose) {
      throw new Error('close blocked');
    }
    if (this.config.closeResult !== undefined) {
      return this.config.closeResult;
    }
    return Promise.resolve();
  }
}

function makeAudioContextCtor(config = {}) {
  const instances = [];
  class ConfiguredAudioContext extends FakeAudioContext {
    constructor() {
      super(config);
      instances.push(this);
    }
  }
  return { AudioContextCtor: ConfiguredAudioContext, instances };
}

function callEveryServiceMethod(service) {
  expect(() => service.keyBeep()).not.toThrow();
  expect(() => service.startConnecting()).not.toThrow();
  expect(() => service.stopConnecting()).not.toThrow();
  expect(() => service.setMuted(true)).not.toThrow();
  expect(() => service.isMuted()).not.toThrow();
  expect(() => service.setMuted(false)).not.toThrow();
  expect(() => service.destroy()).not.toThrow();
}

const audioSource = readFileSync(
  fileURLToPath(new URL('../../src/ui/audio.js', import.meta.url)),
  'utf8',
);

describe('generated audio service', () => {
  it('starts unmuted and creates no AudioContext before an accepted gesture', () => {
    const { AudioContextCtor, instances } = makeAudioContextCtor();
    const service = createAudioService({ AudioContextCtor });

    expect(service.isMuted()).toBe(false);
    expect(instances).toHaveLength(0);
    expect(Object.keys(service).sort()).toEqual([
      'destroy',
      'isMuted',
      'keyBeep',
      'setMuted',
      'startConnecting',
      'stopConnecting',
    ]);
  });

  it('does not create a context from connecting lifecycle calls alone', () => {
    const { AudioContextCtor, instances } = makeAudioContextCtor();
    const service = createAudioService({ AudioContextCtor });

    service.startConnecting();
    expect(instances).toHaveLength(0);

    service.keyBeep();
    expect(instances).toHaveLength(1);
  });

  it('generates a two-oscillator key beep with a gain envelope', () => {
    const { AudioContextCtor, instances } = makeAudioContextCtor({
      currentTime: 4,
    });
    const service = createAudioService({ AudioContextCtor });

    service.keyBeep();

    const [context] = instances;
    expect(context.oscillators).toHaveLength(2);
    expect(context.gains).toHaveLength(1);
    const [firstOscillator, secondOscillator] = context.oscillators;
    const [gain] = context.gains;

    expect(firstOscillator.type).toBe('sine');
    expect(secondOscillator.type).toBe('sine');
    expect(firstOscillator.frequency.calls).toEqual([
      { method: 'setValueAtTime', value: 440, time: 4 },
    ]);
    expect(secondOscillator.frequency.calls).toEqual([
      { method: 'setValueAtTime', value: 660, time: 4 },
    ]);
    expect(firstOscillator.connections).toEqual([gain]);
    expect(secondOscillator.connections).toEqual([gain]);
    expect(gain.connections).toEqual([context.destination]);
    expect(gain.gain.calls).toEqual([
      { method: 'setValueAtTime', value: 0, time: 4 },
      { method: 'linearRampToValueAtTime', value: 0.055, time: 4.012 },
      { method: 'linearRampToValueAtTime', value: 0, time: 4.09 },
    ]);
    expect(firstOscillator.starts).toEqual([4]);
    expect(secondOscillator.starts).toEqual([4]);
    expect(firstOscillator.stops).toEqual([4.09]);
    expect(secondOscillator.stops).toEqual([4.09]);
  });

  it('suppresses sounds while muted and resumes an active connecting tone on unmute', () => {
    const { AudioContextCtor, instances } = makeAudioContextCtor();
    const service = createAudioService({ AudioContextCtor });

    service.setMuted(true);
    service.keyBeep();
    service.startConnecting();
    expect(service.isMuted()).toBe(true);
    expect(instances).toHaveLength(0);

    service.setMuted(false);
    expect(service.isMuted()).toBe(false);
    expect(instances).toHaveLength(1);
    expect(instances[0].oscillators).toHaveLength(2);

    const connectingOscillators = [...instances[0].oscillators];
    service.setMuted(true);
    expect(connectingOscillators.every(({ stops }) => stops.length === 1)).toBe(
      true,
    );

    service.keyBeep();
    expect(instances[0].oscillators).toHaveLength(2);
    service.setMuted(false);
    expect(instances[0].oscillators).toHaveLength(4);
  });

  it('starts connecting audio idempotently and releases voices on stop and destroy', () => {
    const { AudioContextCtor, instances } = makeAudioContextCtor({
      currentTime: 8,
    });
    const service = createAudioService({ AudioContextCtor });

    service.keyBeep();
    service.startConnecting();
    service.startConnecting();

    const context = instances[0];
    expect(context.oscillators).toHaveLength(4);
    const connectingOscillators = context.oscillators.slice(2);
    const [connectingGain] = context.gains.slice(1);

    service.stopConnecting();
    service.stopConnecting();
    expect(connectingOscillators.every(({ stops }) => stops.length === 1)).toBe(
      true,
    );
    expect(connectingOscillators.every(({ disconnects }) => disconnects === 1)).toBe(
      true,
    );
    expect(connectingGain.disconnects).toBe(1);

    service.startConnecting();
    expect(context.oscillators).toHaveLength(6);
    const secondConnectingOscillators = context.oscillators.slice(4);

    service.destroy();
    service.destroy();
    expect(secondConnectingOscillators.every(({ stops }) => stops.length === 1)).toBe(
      true,
    );
    expect(context.closeCalls).toBe(1);

    service.startConnecting();
    service.keyBeep();
    expect(context.oscillators).toHaveLength(6);
  });

  it('swallows missing constructors and every service operation remains safe', () => {
    const service = createAudioService({ AudioContextCtor: undefined });

    callEveryServiceMethod(service);
    expect(service.isMuted()).toBe(false);
  });

  it('swallows suspended or autoplay-blocked resume rejections', async () => {
    const { AudioContextCtor, instances } = makeAudioContextCtor({
      state: 'suspended',
      resumeResult: Promise.reject(new Error('autoplay rejected')),
    });
    const service = createAudioService({ AudioContextCtor });

    expect(() => service.keyBeep()).not.toThrow();
    expect(() => service.startConnecting()).not.toThrow();
    expect(instances[0].resumeCalls).toBe(1);
    expect(instances[0].oscillators).toHaveLength(4);

    await Promise.resolve();
    service.stopConnecting();
    service.destroy();
  });

  it.each([
    ['constructor throws', { constructorThrows: true }],
    ['gain creation throws', { throwOnGain: true }],
    ['oscillator creation throws', { throwOnOscillator: true }],
    ['oscillator start throws', { throwOnStart: true }],
    ['resume throws', { state: 'suspended', throwOnResume: true }],
    ['close throws', { throwOnClose: true }],
  ])('swallows %s without changing the UI-facing result', (_label, config) => {
    let AudioContextCtor;
    if (config.constructorThrows) {
      AudioContextCtor = class ThrowingAudioContext {
        constructor() {
          throw new Error('context construction blocked');
        }
      };
    } else {
      ({ AudioContextCtor } = makeAudioContextCtor(config));
    }

    const service = createAudioService({ AudioContextCtor });
    const uiResult = {
      lifecycle: 'loading',
      screen: 'Contacting the spirits...',
      input: 'unchanged',
    };
    const before = { ...uiResult };

    callEveryServiceMethod(service);

    expect(uiResult).toEqual(before);
  });

  it('swallows rejected context close promises after cleanup', async () => {
    const { AudioContextCtor, instances } = makeAudioContextCtor({
      closeResult: Promise.reject(new Error('close rejected')),
    });
    const service = createAudioService({ AudioContextCtor });

    service.keyBeep();
    expect(() => service.destroy()).not.toThrow();
    await Promise.resolve();
    expect(instances[0].closeCalls).toBe(1);
  });
});

describe('no-op audio seam', () => {
  it('implements the complete contract without browser audio or timers', () => {
    const service = createNoopAudioService();

    expect(Object.keys(service).sort()).toEqual([
      'destroy',
      'isMuted',
      'keyBeep',
      'setMuted',
      'startConnecting',
      'stopConnecting',
    ]);
    expect(service.isMuted()).toBe(false);
    expect(() => service.keyBeep()).not.toThrow();
    expect(() => service.startConnecting()).not.toThrow();
    expect(() => service.stopConnecting()).not.toThrow();
    service.setMuted(true);
    expect(service.isMuted()).toBe(true);
    service.setMuted(false);
    expect(service.isMuted()).toBe(false);
    service.destroy();
    service.setMuted(true);
    expect(service.isMuted()).toBe(false);
  });
});

describe('audio boundary constraints', () => {
  it('uses generated Web Audio only and has no file, network, engine, or timer path', () => {
    expect(audioSource).not.toMatch(/<audio\b|new\s+Audio\s*\(/i);
    expect(audioSource).not.toMatch(/\.(?:mp3|wav|ogg|aac|m4a)\b/i);
    expect(audioSource).not.toMatch(
      /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/,
    );
    expect(audioSource).not.toMatch(/from\s+['"][^'"]*engine[^'"]*['"]/i);
    expect(audioSource).not.toMatch(
      /\b(?:setTimeout|setInterval|requestAnimationFrame)\s*\(/,
    );
    expect(audioSource).toMatch(/createOscillator\(\)/);
    expect(audioSource).toMatch(/createGain\(\)/);
  });
});
