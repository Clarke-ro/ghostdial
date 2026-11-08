import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { renderScreen } from '../../src/engine/menus.js';
import { next } from '../../src/engine/ussd.js';
import { createSuccessfulAIProvider } from '../support/mock-ai-providers.js';
import { buildAnswerState } from '../support/state-builders.js';

const AI_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const AI_FINAL_SUFFIX = '\n0.Back 00.Home';

const codeUnitStringArbitrary = fc
  .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 40 })
  .map((codeUnits) => String.fromCharCode(...codeUnits));

const onePageContentsArbitrary = codeUnitStringArbitrary.map((content) => [content]);
const multiPageContentsArbitrary = fc.array(codeUnitStringArbitrary, {
  minLength: 2,
  maxLength: 5,
});

const questionArbitrary = fc
  .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 30 })
  .map((codeUnits) => String.fromCharCode(...codeUnits));

const unsupportedInputArbitrary = fc
  .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 16 })
  .map((codeUnits) => String.fromCharCode(...codeUnits))
  .filter((input) => !['0', '00', '1'].includes(input));

function makePages(contents) {
  return contents.map((content, index) =>
    content + (index < contents.length - 1
      ? AI_NON_FINAL_SUFFIX
      : AI_FINAL_SUFFIX));
}

function runLocalTransition(state, input) {
  const provider = createSuccessfulAIProvider();
  const result = next(state, input, provider);

  expect(result).not.toBeInstanceOf(Promise);
  expect(provider.callCount).toBe(0);
  return result;
}

function expectRenderedState(result, expectedState) {
  expect(result.state).toEqual(expectedState);
  expect(result.screen).toEqual(renderScreen(expectedState));
}

describe('AI answer page control properties', () => {
  it('Feature: ussd-menu-engine, Property 7: AI Page-Control Semantics', () => {
    // **Validates: Requirements 5.7, 5.8, 5.9, 5.10, 5.11**
    fc.assert(
      fc.property(
        onePageContentsArbitrary,
        multiPageContentsArbitrary,
        questionArbitrary,
        unsupportedInputArbitrary,
        (onePageContents, multiPageContents, question, unsupportedInput) => {
          for (const contents of [onePageContents, multiPageContents]) {
            const pages = makePages(contents);

            for (const mode of ['oracle', 'eli5']) {
              for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
                const state = buildAnswerState({
                  mode,
                  question,
                  pages,
                  pageIndex,
                });

                const moreResult = runLocalTransition(state, '1');
                if (pageIndex < pages.length - 1) {
                  expectRenderedState(moreResult, {
                    ...state,
                    view: {
                      ...state.view,
                      pageIndex: pageIndex + 1,
                    },
                    notice: null,
                  });
                } else {
                  expectRenderedState(moreResult, {
                    ...state,
                    notice: 'invalid',
                  });
                }

                const backResult = runLocalTransition(state, '0');
                expectRenderedState(backResult, {
                  ...state,
                  view: { kind: 'question', mode },
                  notice: null,
                });

                const homeResult = runLocalTransition(state, '00');
                expectRenderedState(homeResult, {
                  ...state,
                  view: { kind: 'main' },
                  history: [],
                  notice: null,
                });

                const unsupportedResult = runLocalTransition(
                  state,
                  unsupportedInput,
                );
                expectRenderedState(unsupportedResult, {
                  ...state,
                  notice: 'invalid',
                });
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
