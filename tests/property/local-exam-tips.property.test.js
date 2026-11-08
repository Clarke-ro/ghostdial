import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  INVALID_CHOICE_MESSAGE,
  LOCAL_TIPS,
  renderScreen,
} from '../../src/engine/menus.js';
import { next } from '../../src/engine/ussd.js';
import { createSuccessfulAIProvider } from '../support/mock-ai-providers.js';

const TIP_NON_FINAL_SUFFIX = '\n1.More 0.Back';
const TIP_FINAL_SUFFIX = '\n0.Back';

const TOPIC_ROUTES = Object.freeze([
  Object.freeze({ option: '1', topic: 'studyPlan' }),
  Object.freeze({ option: '2', topic: 'examDay' }),
  Object.freeze({ option: '3', topic: 'beatStress' }),
]);

const topicOrderArbitrary = fc.shuffledSubarray(TOPIC_ROUTES, {
  minLength: TOPIC_ROUTES.length,
  maxLength: TOPIC_ROUTES.length,
});

const supportedControlOrderArbitrary = fc.shuffledSubarray(
  ['1', '0', '00'],
  { minLength: 3, maxLength: 3 },
);

const unsupportedInputArbitrary = fc
  .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 16 })
  .map((codeUnits) => String.fromCharCode(...codeUnits))
  .filter((input) => !['1', '0', '00'].includes(input));

function expectLocalTransition(state, input, provider) {
  const result = next(state, input, provider);

  expect(result).not.toBeInstanceOf(Promise);
  expect(provider.callCount).toBe(0);
  expect(result.screen.text.length).toBeLessThanOrEqual(160);
  return result;
}

function enterTopic(route, provider) {
  const started = expectLocalTransition(null, '*266#', provider);
  const examMenu = expectLocalTransition(started.state, '3', provider);

  expect(examMenu.state.view).toEqual({ kind: 'exam-menu' });

  const tip = expectLocalTransition(examMenu.state, route.option, provider);
  expect(tip.state.view.topic).toBe(route.topic);
  expect(tip.state.view.pageIndex).toBe(0);

  return tip;
}

function expectLosslessPages(tipState, expectedContent) {
  const { pages } = tipState.view;

  expect(pages.length).toBeGreaterThan(0);

  const reconstructed = pages.map((page, pageIndex) => {
    const suffix = pageIndex < pages.length - 1
      ? TIP_NON_FINAL_SUFFIX
      : TIP_FINAL_SUFFIX;

    expect(page.length).toBeGreaterThan(0);
    expect(page.length).toBeLessThanOrEqual(160);
    expect(page.endsWith(suffix)).toBe(true);

    const pageState = {
      ...tipState,
      view: {
        ...tipState.view,
        pageIndex,
      },
    };
    const screen = renderScreen(pageState);
    expect(screen).toEqual({ type: 'CON', text: page });
    expect(screen.text.length).toBeLessThanOrEqual(160);

    return page.slice(0, -suffix.length);
  }).join('');

  expect(reconstructed).toBe(expectedContent);
}

describe('local Exam Survival tip properties', () => {
  it('Feature: ussd-menu-engine, Property 13: Exact Local Exam Tips Without AI', () => {
    // **Validates: Requirements 1.11, 2.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 10.1**
    fc.assert(
      fc.property(
        topicOrderArbitrary,
        supportedControlOrderArbitrary,
        unsupportedInputArbitrary,
        (topicRoutes, supportedControls, unsupportedInput) => {
          const provider = createSuccessfulAIProvider();

          for (const route of topicRoutes) {
            const tipResult = enterTopic(route, provider);
            expectLosslessPages(tipResult.state, LOCAL_TIPS[route.topic]);

            const { pages } = tipResult.state.view;
            for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
              const tipState = {
                ...tipResult.state,
                view: {
                  ...tipResult.state.view,
                  pageIndex,
                },
              };

              expect(renderScreen(tipState).text.length).toBeLessThanOrEqual(160);

              for (const control of supportedControls) {
                const result = expectLocalTransition(
                  tipState,
                  control,
                  provider,
                );

                if (control === '1') {
                  if (pageIndex < pages.length - 1) {
                    expect(result.state).toEqual({
                      ...tipState,
                      view: {
                        ...tipState.view,
                        pageIndex: pageIndex + 1,
                      },
                      notice: null,
                    });
                    expect(result.screen.text).toBe(pages[pageIndex + 1]);
                  } else {
                    expect(result.state).toEqual({
                      ...tipState,
                      notice: 'invalid',
                    });
                    expect(result.screen.text).toBe(
                      `${pages[pageIndex]}\n${INVALID_CHOICE_MESSAGE}`,
                    );
                  }
                } else if (control === '0') {
                  expect(result.state).toEqual({
                    ...tipState,
                    view: { kind: 'exam-menu' },
                    history: [{ view: { kind: 'main' } }],
                    notice: null,
                  });
                } else {
                  expect(result.state).toEqual({
                    ...tipState,
                    view: { kind: 'main' },
                    history: [],
                    notice: null,
                  });
                }
              }

              const unsupportedResult = expectLocalTransition(
                tipState,
                unsupportedInput,
                provider,
              );
              expect(unsupportedResult.state).toEqual({
                ...tipState,
                notice: 'invalid',
              });
              expect(unsupportedResult.screen.text).toBe(
                `${pages[pageIndex]}\n${INVALID_CHOICE_MESSAGE}`,
              );
            }
          }

          expect(provider.callCount).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
