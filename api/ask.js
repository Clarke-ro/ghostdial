const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SUPPORTED_MODES = new Set([
  'oracle',
  'explain-like-5',
  'exam-survival',
]);

export const PUBLIC_ERRORS = Object.freeze({
  method: 'Method not allowed.',
  invalidRequest: 'Invalid request.',
  configuration: 'Server configuration error.',
  upstream: 'AI service unavailable.',
});

const MODE_INSTRUCTIONS = Object.freeze({
  oracle:
    'Answer the study question directly as a spooky but friendly and helpful tutor. Use plain, simple English. Return plain text only, with no Markdown, and no more than 480 UTF-16 code units. Do not add a preamble about being an AI.',
  'explain-like-5':
    'Explain the subject in child-friendly plain English with a spooky but reassuring voice. Use one concrete analogy when useful. Return plain text only, with no Markdown, and no more than 480 UTF-16 code units. Do not add a preamble about being an AI.',
  'exam-survival':
    'Give practical revision or exam preparation steps in plain English with a spooky but encouraging voice. Return plain text only, with no Markdown, and no more than 480 UTF-16 code units. Do not add a preamble about being an AI.',
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Accept the body shape Vercel normally supplies, while also supporting a raw
 * JSON string or byte array for focused tests and other Node HTTP adapters.
 */
export function parseRequestBody(body) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  if (body instanceof Uint8Array) {
    try {
      return JSON.parse(new TextDecoder().decode(body));
    } catch {
      return null;
    }
  }

  return body;
}

/**
 * Return a small copied request model. Extra JSON fields never reach Gemini.
 */
export function validateRequestBody(body) {
  if (!isPlainObject(body)) {
    return null;
  }

  const { mode, question } = body;
  if (
    !SUPPORTED_MODES.has(mode) ||
    typeof question !== 'string' ||
    question.length === 0 ||
    question.length > 160
  ) {
    return null;
  }

  return { mode, question };
}

export function buildSystemInstruction(mode) {
  return MODE_INSTRUCTIONS[mode] ?? null;
}

/**
 * Gemini may divide text across parts or candidates. Only actual text fields
 * are accepted; objects, numbers, and other values are never stringified.
 */
export function extractCandidateText(payload) {
  if (!Array.isArray(payload?.candidates)) {
    return null;
  }

  const textParts = [];
  for (const candidate of payload.candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text.length > 0) {
        textParts.push(part.text);
      }
    }
  }

  return textParts.length > 0 ? textParts.join('') : null;
}

function removeMarkdownSyntax(text) {
  let current = text;
  let previous;

  // Repeat until stable so nested or adjacent Markdown cannot expose a new
  // marker that would survive a second normalization pass.
  do {
    previous = current;
    current = current
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`+/g, '')
      .split('\n')
      .map((line) => {
        let plainLine = line;
        let beforeMarkerRemoval;
        do {
          beforeMarkerRemoval = plainLine;
          plainLine = plainLine.replace(
            /^\s*(?:#{1,6}(?:\s+|$)|>\s*|[-+*]\s+|\d+[.)]\s+)/,
            '',
          );
        } while (plainLine !== beforeMarkerRemoval);
        return plainLine;
      })
      .join('\n')
      .replace(/[*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  } while (current !== previous);

  return current;
}

/**
 * Convert model output to compact display-safe text. JavaScript string length
 * counts UTF-16 code units, which is the limit used by the API contract.
 */
export function normalizeAnswer(candidateText) {
  if (typeof candidateText !== 'string') {
    return null;
  }

  const plainText = removeMarkdownSyntax(
    candidateText.replace(/\r\n?/g, '\n'),
  );
  if (plainText.length === 0) {
    return null;
  }

  let limit = 480;

  // Avoid returning half of a surrogate pair at the truncation boundary.
  const lastIncluded = plainText.charCodeAt(limit - 1);
  const firstExcluded = plainText.charCodeAt(limit);
  if (
    plainText.length > limit &&
    lastIncluded >= 0xd800 &&
    lastIncluded <= 0xdbff &&
    firstExcluded >= 0xdc00 &&
    firstExcluded <= 0xdfff
  ) {
    limit -= 1;
  }

  const answer = plainText.slice(0, limit).trimEnd();
  return answer.length > 0 ? answer : null;
}

export function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (typeof response.status === 'function') {
    response.status(statusCode);
  }
  if (typeof response.json === 'function') {
    return response.json(payload);
  }

  return response.end(JSON.stringify(payload));
}

function buildGeminiBody({ mode, question }) {
  return {
    systemInstruction: {
      parts: [{ text: buildSystemInstruction(mode) }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: question }],
      },
    ],
    generationConfig: {
      maxOutputTokens: 256,
    },
  };
}

/**
 * Injection keeps tests offline. In production, the defaults are the server's
 * fetch and environment. Browser code must never import this module because it
 * is the only place that reads GEMINI_API_KEY.
 */
export function createAskHandler({
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  return async function ask(request, response) {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return sendJson(response, 405, { error: PUBLIC_ERRORS.method });
    }

    const requestBody = validateRequestBody(parseRequestBody(request.body));
    if (requestBody === null) {
      return sendJson(response, 400, {
        error: PUBLIC_ERRORS.invalidRequest,
      });
    }

    const apiKey = env.GEMINI_API_KEY;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      return sendJson(response, 500, {
        error: PUBLIC_ERRORS.configuration,
      });
    }

    let upstreamResponse;
    try {
      upstreamResponse = await fetchImpl(GEMINI_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(buildGeminiBody(requestBody)),
      });
    } catch {
      return sendJson(response, 502, { error: PUBLIC_ERRORS.upstream });
    }

    if (!upstreamResponse?.ok) {
      return sendJson(response, 502, { error: PUBLIC_ERRORS.upstream });
    }

    let upstreamPayload;
    try {
      upstreamPayload = await upstreamResponse.json();
    } catch {
      return sendJson(response, 502, { error: PUBLIC_ERRORS.upstream });
    }

    const answer = normalizeAnswer(extractCandidateText(upstreamPayload));
    if (answer === null) {
      return sendJson(response, 502, { error: PUBLIC_ERRORS.upstream });
    }

    return sendJson(response, 200, { answer });
  };
}

export default createAskHandler();
