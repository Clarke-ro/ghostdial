export const REAL_AI_TIMEOUT_MS = 15_000;

const API_PATH = '/api/ask';
const PROVIDER_TO_API_MODE = Object.freeze({
  oracle: 'oracle',
  eli5: 'explain-like-5',
  'exam-survival': 'exam-survival',
});

/**
 * Check and translate a request before any browser work begins.
 *
 * Questions are validated by their JavaScript string length and are not
 * trimmed or rewritten, so valid text reaches the API exactly as entered.
 *
 * @param {unknown} request
 * @returns {{ mode: string, question: string }}
 */
function validateProviderRequest(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('AI request must be an object.');
  }

  const { mode, question } = request;

  if (!Object.prototype.hasOwnProperty.call(PROVIDER_TO_API_MODE, mode)) {
    throw new TypeError('Unsupported AI mode.');
  }

  const apiMode = PROVIDER_TO_API_MODE[mode];

  if (typeof question !== 'string' || question.length === 0 || question.length > 160) {
    throw new TypeError('Question must contain between 1 and 160 characters.');
  }

  return { mode: apiMode, question };
}

/**
 * Create the browser provider used by the existing USSD engine.
 *
 * Dependencies are injectable so later tests can use fake requests, timers,
 * and abort controllers without contacting a network.
 *
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   AbortControllerCtor?: typeof AbortController,
 *   setTimeoutFn?: typeof setTimeout,
 *   clearTimeoutFn?: typeof clearTimeout,
 * }} [options]
 * @returns {(request: unknown) => Promise<string>}
 */
export function createRealAIProvider({
  fetchImpl = globalThis.fetch,
  AbortControllerCtor = globalThis.AbortController,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  return async function realAIProvider(request) {
    const body = validateProviderRequest(request);
    const controller = new AbortControllerCtor();
    let rejectTimeout;

    const timeoutPromise = new Promise((_resolve, reject) => {
      rejectTimeout = reject;
    });

    // Aborting asks fetch to stop. Rejecting the timeout promise also ensures
    // this provider settles even when an injected request ignores the signal.
    const timeoutId = setTimeoutFn(() => {
      controller.abort();
      rejectTimeout(new Error('AI request timed out.'));
    }, REAL_AI_TIMEOUT_MS);

    try {
      const requestPromise = (async () => {
        const response = await fetchImpl(API_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('AI request failed.');
        }

        const responseBody = await response.json();
        const hasExactAnswerShape =
          responseBody !== null &&
          typeof responseBody === 'object' &&
          !Array.isArray(responseBody) &&
          Object.keys(responseBody).length === 1 &&
          Object.prototype.hasOwnProperty.call(responseBody, 'answer') &&
          typeof responseBody.answer === 'string' &&
          responseBody.answer.length > 0;

        if (!hasExactAnswerShape) {
          throw new Error('AI response was invalid.');
        }

        return responseBody.answer;
      })();

      return await Promise.race([requestPromise, timeoutPromise]);
    } finally {
      // Every success and failure path cancels its timer so stale callbacks
      // cannot abort work after the request has already settled.
      clearTimeoutFn(timeoutId);
    }
  };
}
