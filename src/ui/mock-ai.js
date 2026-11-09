/**
 * Default delay used by the local AI substitute.
 *
 * Keeping this value in one place makes the provider's timing contract explicit
 * while still allowing tests to inject a shorter delay or a fake timer.
 */
export const MOCK_AI_DELAY_MS = 1200;

const MOCK_ANSWER_BODY = [
  'The spirits suggest starting with the central idea before collecting details.',
  'Break the lesson into small steps, explain each step in your own words, and check where your explanation becomes uncertain.',
  'Use a short practice example after each section instead of waiting until the end to discover a gap.',
  'When an answer is difficult, write down what you know, name the missing link, and test one possible connection at a time.',
  'Return to the parts that still feel unclear on a later pass, because spaced review makes the important ideas easier to recall.',
  'A brief self-test without notes is more useful than rereading the same paragraph repeatedly.',
  'Keep the process practical: choose one next action, complete it carefully, and then decide what deserves attention next.',
  'That is the complete spectral study note. May your questions become clearer with every careful attempt.',
].join(' ');

/**
 * Build the deterministic answer returned for one AI request.
 *
 * The request context is included verbatim so complete question text and mode
 * remain visible to callers. The fixed explanatory body is deliberately longer
 * than one engine page, which exercises the engine's existing pagination.
 *
 * @param {string} mode
 * @param {string} question
 * @returns {string}
 */
export function buildMockAnswer(mode, question) {
  return [
    `Mode: ${mode}`,
    `Question: ${question}`,
    MOCK_ANSWER_BODY,
  ].join('\n');
}

/**
 * Create a local, deterministic AI provider for the USSD engine.
 *
 * @param {{ delayMs?: number, setTimeoutFn?: Function }} [options]
 * @returns {(request: { mode: string, question: string }) => Promise<string>}
 */
export function createMockAIProvider({
  delayMs = MOCK_AI_DELAY_MS,
  setTimeoutFn = globalThis.setTimeout,
} = {}) {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError('delayMs must be a non-negative finite number.');
  }
  if (typeof setTimeoutFn !== 'function') {
    throw new TypeError('setTimeoutFn must be a function.');
  }

  return function mockAIProvider({ mode, question }) {
    return new Promise((resolve) => {
      setTimeoutFn(
        () => resolve(buildMockAnswer(mode, question)),
        delayMs,
      );
    });
  };
}
