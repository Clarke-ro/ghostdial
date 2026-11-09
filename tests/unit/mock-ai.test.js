import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { next } from '../../src/engine/ussd.js';
import { createPhoneControls } from '../../src/ui/controls.js';
import {
  buildMockAnswer,
  createMockAIProvider,
  MOCK_AI_DELAY_MS,
} from '../../src/ui/mock-ai.js';
import { createRenderer, UI_COPY } from '../../src/ui/render.js';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
const apiPath = fileURLToPath(new URL('../../api/ask.js', import.meta.url));
const mockSourcePath = fileURLToPath(new URL('../../src/ui/mock-ai.js', import.meta.url));
const mainSourcePath = fileURLToPath(new URL('../../src/ui/main.js', import.meta.url));
const entryPath = fileURLToPath(new URL('../../index.html', import.meta.url));
const uiDirectory = fileURLToPath(new URL('../../src/ui/', import.meta.url));

function reconstructEngineAnswer(pages) {
  const nonFinalSuffix = '\n1.More 0.Back';
  const finalSuffix = '\n0.Back 00.Home';

  return pages.map((page, index) => {
    const suffix = index === pages.length - 1
      ? finalSuffix
      : nonFinalSuffix;
    expect(page.endsWith(suffix)).toBe(true);
    expect(page.length).toBeLessThanOrEqual(160);
    return page.slice(0, -suffix.length);
  }).join('');
}

function makeIdlePresentation() {
  const documentRef = {
    createElement(tagName) {
      return {
        tagName,
        children: [],
        dataset: {},
        attributes: new Map(),
        append(...nodes) {
          this.children.push(...nodes);
        },
        setAttribute(name, value) {
          this.attributes.set(name, String(value));
        },
        addEventListener() {},
        set textContent(value) {
          this._textContent = String(value);
          this.children = [];
        },
        get textContent() {
          return this._textContent ?? '';
        },
      };
    },
  };
  const root = documentRef.createElement('main');
  const controls = createPhoneControls({ document: documentRef });
  root.append(controls.enclosure);
  const renderer = createRenderer({
    ...controls,
    lcdOutput: controls.screenOutput,
    inputLine: controls.inputLine,
    callButton: controls.callKey,
    clearButton: controls.clearKey,
    backButton: controls.backKey,
    homeButton: controls.homeKey,
    muteButton: controls.muteKey,
  });

  return renderer.render({ lifecycle: 'idle', inputBuffer: '' });
}

describe('local mock AI provider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses the exact 1200 ms default delay and resolves a string', async () => {
    const provider = createMockAIProvider();
    const request = { mode: 'oracle', question: 'How do I revise?' };
    let settled = false;
    const answerPromise = provider(request).then((answer) => {
      settled = true;
      return answer;
    });

    expect(MOCK_AI_DELAY_MS).toBe(1200);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(MOCK_AI_DELAY_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const answer = await answerPromise;

    expect(settled).toBe(true);
    expect(typeof answer).toBe('string');
    expect(answer).toBe(buildMockAnswer(request.mode, request.question));
  });

  it('honors an injected delay and timer function without changing the answer contract', async () => {
    const timer = vi.fn(globalThis.setTimeout);
    const provider = createMockAIProvider({
      delayMs: 275,
      setTimeoutFn: timer,
    });
    const request = { mode: 'eli5', question: 'Explain gravity plainly.' };
    const answerPromise = provider(request);

    expect(timer).toHaveBeenCalledOnce();
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 275);

    await vi.advanceTimersByTimeAsync(274);
    let settled = false;
    answerPromise.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(await answerPromise).toBe(buildMockAnswer(request.mode, request.question));
    expect(settled).toBe(true);
  });

  it('returns exactly equal answers for equal mode and complete question requests after equal delays', async () => {
    const provider = createMockAIProvider();
    const request = { mode: 'oracle', question: '  Keep every space.  ' };
    let firstSettled = false;
    let secondSettled = false;
    const first = provider(request).then((answer) => {
      firstSettled = true;
      return answer;
    });
    const second = provider({ ...request }).then((answer) => {
      secondSettled = true;
      return answer;
    });

    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(MOCK_AI_DELAY_MS - 1);
    expect(firstSettled).toBe(false);
    expect(secondSettled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    expect(await first).toBe(await second);
    expect(firstSettled).toBe(true);
    expect(secondSettled).toBe(true);
  });

  it('produces multiple pages when the real engine processes its answer', async () => {
    const provider = createMockAIProvider();
    const started = next(null, '*266#', provider);
    const prompt = next(started.state, '1', provider);
    const question = 'How should I prepare for this chapter?';
    const pending = next(prompt.state, question, provider);

    expect(pending).toBeInstanceOf(Promise);
    // The engine creates its provider call on a Promise microtask. Flush that
    // microtask before advancing fake time so the 1200 ms timer is observable.
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(MOCK_AI_DELAY_MS - 1);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(result.state.view.kind).toBe('answer');
    expect(result.state.view.pages.length).toBeGreaterThanOrEqual(2);
    expect(result.state.view.pages).toEqual(expect.arrayContaining([
      expect.stringContaining('Mode: oracle'),
      expect.stringContaining('Question: How should I prepare for this chapter?'),
    ]));
    expect(reconstructEngineAnswer(result.state.view.pages)).toBe(
      buildMockAnswer('oracle', question),
    );
    expect(result.screen).toEqual({
      type: 'CON',
      text: result.state.view.pages[0],
    });
  });

  it('performs no network request and has no API-module dependency', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const provider = createMockAIProvider();
    const answerPromise = provider({ mode: 'oracle', question: 'No network.' });

    await vi.advanceTimersByTimeAsync(MOCK_AI_DELAY_MS);
    await answerPromise;

    const source = readFileSync(mockSourcePath, 'utf8');
    const uiSources = readdirSync(uiDirectory)
      .filter((fileName) => fileName.endsWith('.js'))
      .map((fileName) => readFileSync(`${uiDirectory}/${fileName}`, 'utf8'))
      .join('\n');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(source).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
    expect(source).not.toMatch(/api[\\/]ask\.js|api\/ask\.js/);
    expect(uiSources).not.toMatch(/api[\\/]ask\.js|api\/ask\.js/);
    expect(existsSync(apiPath)).toBe(false);
    expect(existsSync(workspaceRoot)).toBe(true);
  });

  it('keeps the API-free entry boundary and reaches the exact idle presentation', () => {
    const entry = readFileSync(entryPath, 'utf8');
    const main = readFileSync(mainSourcePath, 'utf8');

    expect(entry).toContain('<main id="app"></main>');
    expect(entry).toContain('src="/src/ui/main.js"');
    expect(main).toContain("import { createMockAIProvider } from './mock-ai.js';");
    expect(main).toContain("mountPhoneUI(root, {");
    expect(main).not.toMatch(/api[\\/]ask\.js|api\/ask\.js/);
    expect(existsSync(apiPath)).toBe(false);
    expect(makeIdlePresentation()).toMatchObject({
      lifecycle: 'idle',
      screenText: UI_COPY.idle,
      inputText: '',
      disabled: false,
    });
  });
});
