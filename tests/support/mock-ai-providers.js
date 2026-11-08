function cloneRequest(request) {
  if (request === null || typeof request !== 'object') {
    return request;
  }

  return Object.fromEntries(
    Object.entries(request).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  );
}

function createProviderSpy(implementation) {
  const calls = [];

  const provider = (request) => {
    calls.push(cloneRequest(request));
    return implementation(request);
  };

  Object.defineProperties(provider, {
    calls: { value: calls, enumerable: true },
    callCount: { get: () => calls.length, enumerable: true },
    lastRequest: {
      get: () => calls.at(-1),
      enumerable: true,
    },
  });

  provider.reset = () => {
    calls.length = 0;
  };

  return provider;
}

/** Create a spy provider that returns a successful string synchronously. */
export function createSuccessfulAIProvider(answer = 'The spirits know this one.') {
  if (typeof answer !== 'string') {
    throw new TypeError('Successful AI provider answer must be a string.');
  }

  return createProviderSpy(() => answer);
}

/** Create a spy provider that throws synchronously. */
export function createThrowingAIProvider(
  error = new Error('Configured synchronous provider failure.'),
) {
  return createProviderSpy(() => {
    throw error;
  });
}

/** Create a spy provider that returns a rejected native Promise. */
export function createRejectingAIProvider(
  reason = new Error('Configured asynchronous provider failure.'),
) {
  return createProviderSpy(() => Promise.reject(reason));
}

/** Create a spy provider that returns a configured non-string value. */
export function createNonStringAIProvider(value = null) {
  if (typeof value === 'string') {
    throw new TypeError('Non-string AI provider value must not be a string.');
  }

  return createProviderSpy(() => value);
}

/**
 * Create a deterministic spy provider for pagination and transition tests.
 * Supply `answer` for exact output, or configure repeated `segment` content.
 */
export function createLongAnswerAIProvider({
  answer,
  segment = 'A patient ghost explains the lesson step by step.',
  repetitions = 8,
  separator = ' ',
} = {}) {
  if (answer !== undefined && typeof answer !== 'string') {
    throw new TypeError('Long AI provider answer must be a string.');
  }
  if (typeof segment !== 'string' || typeof separator !== 'string') {
    throw new TypeError('Long AI provider segment and separator must be strings.');
  }
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new RangeError('Long AI provider repetitions must be a positive integer.');
  }

  const configuredAnswer =
    answer ?? Array.from({ length: repetitions }, () => segment).join(separator);

  return createSuccessfulAIProvider(configuredAnswer);
}
