import { describe, expect, it } from 'vitest';
import { next } from '../../src/engine/ussd.js';
import { INVALID_CHOICE_MESSAGE } from '../../src/engine/menus.js';
import { buildFreshState } from '../support/state-builders.js';
import { createLongAnswerAIProvider } from '../support/mock-ai-providers.js';

const AI_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const AI_FINAL_SUFFIX = '\n0.Back 00.Home';

function reconstructAnswer(pages) {
  return pages.map((page, index) => {
    const suffix = index === pages.length - 1
      ? AI_FINAL_SUFFIX
      : AI_NON_FINAL_SUFFIX;
    expect(page.endsWith(suffix)).toBe(true);
    return page.slice(0, -suffix.length);
  }).join('');
}

function expectSynchronous(result) {
  expect(result).not.toBeInstanceOf(Promise);
  return result;
}

describe('AI answer transition integration', () => {
  it('keeps configurable long-answer content ordered through paging and all page controls', async () => {
    const answer = Array.from(
      { length: 24 },
      (_, index) => `Step ${String(index + 1).padStart(2, '0')} follows the spectral lesson carefully.`,
    ).join(' ');
    const provider = createLongAnswerAIProvider({ answer });

    const prompt = expectSynchronous(next(buildFreshState(), '1', provider));
    expect(prompt.state.view).toEqual({ kind: 'question', mode: 'oracle' });
    expect(provider.callCount).toBe(0);

    const submitted = next(prompt.state, 'How should I study this chapter?', provider);
    expect(submitted).toBeInstanceOf(Promise);
    const firstPage = await submitted;

    expect(provider.callCount).toBe(1);
    expect(provider.calls).toEqual([{
      mode: 'oracle',
      question: 'How should I study this chapter?',
    }]);
    expect(firstPage.state.view.kind).toBe('answer');
    expect(firstPage.state.view.pages.length).toBeGreaterThan(2);
    expect(firstPage.state.view.pageIndex).toBe(0);
    expect(reconstructAnswer(firstPage.state.view.pages)).toBe(answer);
    expect(firstPage.state.view.pages.every((page) => page.length <= 160)).toBe(true);
    expect(firstPage.screen.text).toBe(firstPage.state.view.pages[0]);

    const backFromNonFinal = expectSynchronous(next(firstPage.state, '0', provider));
    expect(backFromNonFinal.state.view).toEqual({
      kind: 'question',
      mode: 'oracle',
    });
    const homeFromNonFinal = expectSynchronous(next(firstPage.state, '00', provider));
    expect(homeFromNonFinal.state.view).toEqual({ kind: 'main' });
    expect(homeFromNonFinal.state.history).toEqual([]);

    let current = firstPage;
    const displayedPages = [current.screen.text];
    while (current.state.view.pageIndex < current.state.view.pages.length - 1) {
      const previousIndex = current.state.view.pageIndex;
      current = expectSynchronous(next(current.state, '1', provider));
      expect(current.state.view.pageIndex).toBe(previousIndex + 1);
      displayedPages.push(current.screen.text);
    }

    expect(displayedPages).toEqual(firstPage.state.view.pages);
    expect(reconstructAnswer(displayedPages)).toBe(answer);
    expect(current.screen.text.endsWith(AI_FINAL_SUFFIX)).toBe(true);
    expect(provider.callCount).toBe(1);

    const backFromFinal = expectSynchronous(next(current.state, '0', provider));
    expect(backFromFinal.state.view).toEqual({
      kind: 'question',
      mode: 'oracle',
    });
    const homeFromFinal = expectSynchronous(next(current.state, '00', provider));
    expect(homeFromFinal.state.view).toEqual({ kind: 'main' });
    expect(homeFromFinal.state.history).toEqual([]);

    for (const unsupportedInput of ['1', '9']) {
      const invalid = expectSynchronous(next(current.state, unsupportedInput, provider));
      expect(invalid.state).toEqual({ ...current.state, notice: 'invalid' });
      expect(invalid.state.view.pageIndex).toBe(
        current.state.view.pages.length - 1,
      );
      expect(invalid.screen.text).toBe(
        `${current.screen.text}\n${INVALID_CHOICE_MESSAGE}`,
      );
      expect(invalid.screen.text.length).toBeLessThanOrEqual(160);
    }

    expect(provider.callCount).toBe(1);
  });
});
