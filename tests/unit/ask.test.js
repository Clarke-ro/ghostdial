import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PUBLIC_ERRORS,
  buildSystemInstruction,
  createAskHandler,
  extractCandidateText,
  normalizeAnswer,
  parseRequestBody,
  validateRequestBody,
} from '../../api/ask.js';

const VALID_BODY = { mode: 'oracle', question: 'Why do eclipses happen?' };
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function createResponse() {
  return {
    statusCode: undefined,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function successfulGeminiResponse(text = 'A clear answer from the fog.') {
  return {
    ok: true,
    async json() {
      return {
        candidates: [{ content: { parts: [{ text }] } }],
      };
    },
  };
}

async function runHandler(options = {}) {
  const {
    body = VALID_BODY,
    fetchImpl = vi.fn(async () => successfulGeminiResponse()),
  } = options;
  const method = Object.hasOwn(options, 'method') ? options.method : 'POST';
  const apiKey = Object.hasOwn(options, 'apiKey')
    ? options.apiKey
    : 'SERVER_KEY';
  const response = createResponse();
  const handler = createAskHandler({
    fetchImpl,
    env: apiKey === undefined ? {} : { GEMINI_API_KEY: apiKey },
  });

  await handler({ method, body }, response);
  return { response, fetchImpl };
}

function expectJson(response, statusCode, body) {
  expect(response.statusCode).toBe(statusCode);
  expect(response.headers['content-type']).toBe(
    'application/json; charset=utf-8',
  );
  expect(response.body).toEqual(body);
}

describe('server request validation helpers', () => {
  it('accepts only supported modes and questions from 1 to 160 code units', () => {
    expect(validateRequestBody({
      mode: 'oracle',
      question: 'x',
      ignored: 'not sent upstream',
    })).toEqual({ mode: 'oracle', question: 'x' });
    expect(validateRequestBody({
      mode: 'explain-like-5',
      question: 'x'.repeat(160),
    })).toEqual({ mode: 'explain-like-5', question: 'x'.repeat(160) });
    expect(validateRequestBody({
      mode: 'exam-survival',
      question: 'Revise?',
    })).toEqual({ mode: 'exam-survival', question: 'Revise?' });

    for (const body of [
      null,
      [],
      'text',
      4,
      {},
      { mode: 'eli5', question: 'Explain this' },
      { mode: 'oracle', question: '' },
      { mode: 'oracle', question: 'x'.repeat(161) },
      { mode: 'oracle', question: 42 },
    ]) {
      expect(validateRequestBody(body)).toBeNull();
    }
  });

  it('parses JSON strings and bytes and reports malformed JSON', () => {
    expect(parseRequestBody(JSON.stringify(VALID_BODY))).toEqual(VALID_BODY);
    expect(parseRequestBody(new TextEncoder().encode(JSON.stringify(VALID_BODY))))
      .toEqual(VALID_BODY);
    expect(parseRequestBody('{bad json')).toBeNull();
    expect(parseRequestBody(new TextEncoder().encode('{bad json'))).toBeNull();
  });
});

describe('Gemini prompt and response helpers', () => {
  it.each([
    ['oracle', ['spooky', 'friendly', 'helpful tutor']],
    ['explain-like-5', ['child-friendly', 'reassuring', 'analogy']],
    ['exam-survival', ['practical', 'exam preparation', 'encouraging']],
  ])('builds the fixed %s tutoring instruction', (mode, phrases) => {
    const instruction = buildSystemInstruction(mode);

    for (const phrase of phrases) {
      expect(instruction).toContain(phrase);
    }
    expect(instruction).toContain('plain text only');
    expect(instruction).toContain('480 UTF-16 code units');
    expect(instruction).toContain('no Markdown');
  });

  it('extracts ordered string text parts without coercing other values', () => {
    expect(extractCandidateText({
      candidates: [
        { content: { parts: [{ text: 'First ' }, { text: 7 }] } },
        { content: { parts: [{ text: '' }, { text: 'second.' }] } },
      ],
    })).toBe('First second.');
    expect(extractCandidateText({ candidates: [{ content: { parts: [{ text: 7 }] } }] }))
      .toBeNull();
    expect(extractCandidateText({ unexpected: true })).toBeNull();
  });

  it('normalizes Markdown-like text, whitespace, and line markers', () => {
    const candidate = [
      '# **Moon** notes',
      '> Visit [the visible lesson](https://example.test).',
      '- Use `plain code` here.',
      '1. Stay calm.',
    ].join('\r\n');

    expect(normalizeAnswer(candidate)).toBe(
      'Moon notes Visit the visible lesson. Use plain code here. Stay calm.',
    );
    expect(normalizeAnswer('***')).toBeNull();
    expect(normalizeAnswer(' \r\n\t ')).toBeNull();
  });

  it('limits answers to 480 code units without splitting a surrogate pair', () => {
    expect(normalizeAnswer('x'.repeat(600))).toBe('x'.repeat(480));
    expect(normalizeAnswer(`${'x'.repeat(479)}👻tail`)).toBe('x'.repeat(479));
  });
});

describe('Vercel ask handler', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('A real network request was attempted');
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns one normalized answer and calls the exact Gemini endpoint once', async () => {
    const fetchImpl = vi.fn(async () => successfulGeminiResponse('**Gravity** pulls.'));
    const { response } = await runHandler({
      body: {
        mode: 'oracle',
        question: '  Explain gravity 👻  ',
        ignored: 'discard me',
      },
      apiKey: 'SECRET_HEADER_KEY',
      fetchImpl,
    });

    expectJson(response, 200, { answer: 'Gravity pulls.' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(GEMINI_URL);
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      'Content-Type': 'application/json',
      'x-goog-api-key': 'SECRET_HEADER_KEY',
    });
    const requestBody = JSON.parse(options.body);
    expect(requestBody).toEqual({
      systemInstruction: {
        parts: [{ text: buildSystemInstruction('oracle') }],
      },
      contents: [{
        role: 'user',
        parts: [{ text: '  Explain gravity 👻  ' }],
      }],
      generationConfig: { maxOutputTokens: 256 },
    });
    expect(options.body).not.toContain('ignored');
    expect(options.body).not.toContain('SECRET_HEADER_KEY');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', 405],
    ['PUT', 405],
    [undefined, 405],
  ])('rejects non-POST method %j without calling Gemini', async (method, status) => {
    const { response, fetchImpl } = await runHandler({ method });

    expectJson(response, status, { error: PUBLIC_ERRORS.method });
    expect(response.headers.allow).toBe('POST');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{bad'],
    ['array', []],
    ['null', null],
    ['primitive', 4],
    ['unsupported mode', { mode: 'eli5', question: 'Why?' }],
    ['missing mode', { question: 'Why?' }],
    ['empty question', { mode: 'oracle', question: '' }],
    ['non-string question', { mode: 'oracle', question: 7 }],
    ['overlong question', { mode: 'oracle', question: 'x'.repeat(161) }],
  ])('returns 400 for %s with no Gemini request', async (_label, body) => {
    const { response, fetchImpl } = await runHandler({ body });

    expectJson(response, 400, { error: PUBLIC_ERRORS.invalidRequest });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['x', 'x'.repeat(160)])(
    'accepts question boundary length %s',
    async (question) => {
      const { response, fetchImpl } = await runHandler({
        body: { mode: 'oracle', question },
      });

      expect(response.statusCode).toBe(200);
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it.each([undefined, ''])(
    'returns a safe 500 for missing or empty server configuration',
    async (apiKey) => {
      const { response, fetchImpl } = await runHandler({ apiKey });

      expectJson(response, 500, { error: PUBLIC_ERRORS.configuration });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it('returns a safe 502 when the Gemini request rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('PRIVATE_INTERNAL_FAILURE');
    });
    const { response } = await runHandler({ fetchImpl });

    expectJson(response, 502, { error: PUBLIC_ERRORS.upstream });
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_INTERNAL_FAILURE');
  });

  it('returns a safe 502 for a non-success Gemini status without reading its body', async () => {
    const json = vi.fn(async () => ({ secret: 'UPSTREAM_BODY' }));
    const { response } = await runHandler({
      fetchImpl: vi.fn(async () => ({ ok: false, status: 429, json })),
    });

    expectJson(response, 502, { error: PUBLIC_ERRORS.upstream });
    expect(json).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', { ok: true, json: async () => { throw new Error('BAD_JSON'); } }],
    ['missing candidates', { ok: true, json: async () => ({}) }],
    ['missing text', { ok: true, json: async () => ({ candidates: [{ content: { parts: [{}] } }] }) }],
    ['empty normalized text', successfulGeminiResponse('***')],
  ])('returns a safe 502 for %s upstream content', async (_label, upstream) => {
    const { response } = await runHandler({
      fetchImpl: vi.fn(async () => upstream),
    });

    expectJson(response, 502, { error: PUBLIC_ERRORS.upstream });
  });
});
