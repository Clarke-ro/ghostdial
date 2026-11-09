# Implementation Plan: Real AI

## Overview

Add the real AI boundary in incremental plain-JavaScript steps. First build the isolated Vercel handler and browser provider, then wire environment-based selection into `main.js`, and finally add mocked unit, property, integration, and security-boundary tests. The implementation keeps Gemini access inside `api/ask.js`, keeps the existing engine unchanged, changes only the three approved stale assertions in `tests/unit/mock-ai.test.js`, `tests/unit/phone-ui-entry.test.js`, and `tests/integration/phone-ui-boundary.test.js`, and performs no real network access during tests.

## Tasks

- [x] 1. Implement the server-only Gemini boundary
  - [x] 1.1 Create `api/ask.js`
    - Export the Vercel handler and injectable handler factory described in the design.
    - Add pure request validation, fixed prompt selection, candidate extraction, Plain_Text normalization, 480-code-unit enforcement, and safe JSON response helpers.
    - Accept only valid `POST { mode, question }` requests and return the specified 200, 400, 405, 500, and 502 outcomes.
    - Read the key only from the server environment, call the exact `gemini-2.5-flash` REST endpoint once, and keep secrets, questions, upstream bodies, and internal errors out of error responses.
    - Add beginner-focused comments around the server secret boundary and injected request seam.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 6.8_

  - [x]* 1.2 Write server handler unit tests
    - Create `tests/unit/ask.test.js` with injected environment and mocked fetch operations only.
    - Cover exact success shape, all statuses, `Allow: POST`, malformed/non-object bodies, question boundaries, all mode prompts, exact Gemini URL/headers/body, one-call behavior, missing key, upstream failures, malformed payloads, normalization examples, and safe errors.
    - Stub the global request operation to throw so accidental real network access fails the test.
    - _Requirements: 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 6.3, 6.4, 6.7_

  - [x]* 1.3 Write Property 1: Server Request Validation Is an Exact Allowlist
    - Create `tests/property/ask-validation.property.test.js` with at least 100 generated JSON values and valid/invalid boundary strings.
    - Assert exact validation and zero Gemini requests for every rejected value.
    - Tag the test `Feature: real-ai, Property 1: Server Request Validation Is an Exact Allowlist`.
    - **Property 1: Server Request Validation Is an Exact Allowlist**
    - **Validates: Requirements 1.1, 1.5, 1.6**

  - [x]* 1.4 Write Property 2: Error Responses Are Safe
    - Create `tests/property/ask-errors.property.test.js` with at least 100 generated unique sentinel values for secrets, questions, upstream bodies, and internal errors across handler failure categories.
    - Assert the fixed allowlisted JSON error shape and verify that no sentinel value is copied into a response.
    - Tag the test `Feature: real-ai, Property 2: Error Responses Are Safe`.
    - **Property 2: Error Responses Are Safe**
    - **Validates: Requirements 1.7, 2.5, 2.6, 2.7**

  - [x]* 1.5 Write Property 3: Candidate Extraction Accepts Only Text Parts
    - Create `tests/property/ask-extraction.property.test.js` with at least 100 generated Gemini-like and arbitrary JSON payloads.
    - Assert ordered string-part extraction without value coercion and explicit failure when no usable text exists.
    - Tag the test `Feature: real-ai, Property 3: Candidate Extraction Accepts Only Text Parts`.
    - **Property 3: Candidate Extraction Accepts Only Text Parts**
    - **Validates: Requirements 2.7, 3.2**

  - [x]* 1.6 Write Property 4: Answer Normalization Enforces the Plain-Text Contract
    - Create `tests/property/answer-normalization.property.test.js` with at least 100 generated Unicode, whitespace, Markdown-like, and long strings.
    - Assert idempotence, plain-text marker removal, trimming, the 1-to-480-code-unit invariant, and failure for content with no remaining visible text.
    - Tag the test `Feature: real-ai, Property 4: Answer Normalization Enforces the Plain-Text Contract`.
    - **Property 4: Answer Normalization Enforces the Plain-Text Contract**
    - **Validates: Requirements 3.1, 3.2**

- [x] 2. Implement the browser real-AI provider
  - [x] 2.1 Create `src/ui/real-ai.js`
    - Export `REAL_AI_TIMEOUT_MS` as 15,000 and a `createRealAIProvider` factory matching the existing mock provider's callable interface.
    - Validate provider requests, map `eli5` to `explain-like-5`, preserve questions exactly, and send one JSON `POST` to relative path `/api/ask`.
    - Abort and reject at 15 seconds, clear the timeout in every settlement path, and reject all request, status, JSON, and response-shape failures without a mock fallback.
    - Keep Gemini origins, server imports, environment variables, and secrets out of the browser module; comment the abort and cleanup sequence for a beginner.
    - _Requirements: 2.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 6.8_

  - [ ]* 2.2 Write browser provider unit tests
    - Create `tests/unit/real-ai.test.js` with mocked fetch, fake timers, and a recording AbortController.
    - Cover exact request serialization, all three mode mappings, exact answer extraction, invalid inputs, each Protocol_Error class, request rejection, 14,999/15,000 ms boundaries, abort, and early timer cleanup.
    - Install a throwing global request guard and assert every test has zero real network access and no mock-answer fallback.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 6.5, 6.7_

  - [ ]* 2.3 Write Property 5: Browser Requests Preserve Questions and Map Modes
    - Create `tests/property/real-ai-request.property.test.js` with at least 100 generated valid questions and all Supported_Provider_Mode values.
    - Assert one relative-path POST, exact question preservation, and mapping against the design table.
    - Tag the test `Feature: real-ai, Property 5: Browser Requests Preserve Questions and Map Modes`.
    - **Property 5: Browser Requests Preserve Questions and Map Modes**
    - **Validates: Requirements 4.2, 4.3, 4.4**

  - [ ]* 2.4 Write Property 6: Successful Provider Responses Preserve Answers
    - Create `tests/property/real-ai-answer.property.test.js` with at least 100 generated Successful_Answer strings.
    - Assert exact fulfillment without trimming, normalization, or replacement.
    - Tag the test `Feature: real-ai, Property 6: Successful Provider Responses Preserve Answers`.
    - **Property 6: Successful Provider Responses Preserve Answers**
    - **Validates: Requirements 4.5**

  - [ ]* 2.5 Write Property 7: Invalid Provider Inputs Start No Work
    - Create `tests/property/real-ai-invalid.property.test.js` with at least 100 generated invalid modes, body shapes, question types, and question lengths.
    - Assert rejection with zero request, timer, and AbortController work.
    - Tag the test `Feature: real-ai, Property 7: Invalid Provider Inputs Start No Work`.
    - **Property 7: Invalid Provider Inputs Start No Work**
    - **Validates: Requirements 4.9**

- [x] 3. Wire deterministic provider selection
  - [x] 3.1 Update `src/ui/main.js`
    - Import `createRealAIProvider` while preserving the existing engine, mock provider, audio service, DOM-ready handling, and Phone UI mount.
    - Export the pure provider selector described in the design and choose mock in development or for the exact first `mock=1` query value; choose real in production otherwise.
    - Construct providers without invoking requests and pass only the selected provider to `mountPhoneUI`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 3.2 Write provider-selection unit and entry-wiring tests
    - Create `tests/unit/provider-selection.test.js` with representative production, development, exact override, repeated parameter, and near-miss query examples.
    - Mock provider factories and `mountPhoneUI`; assert selection starts no request and preserves `next`, audio, root, and provider injection.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.6_

  - [ ]* 3.3 Write Property 8: Provider Selection Matches the Environment Model
    - Create `tests/property/provider-selection.property.test.js` with at least 100 generated environment flags and URL query strings.
    - Compare selection with the design's reference truth table, including exact and nonmatching mock values.
    - Tag the test `Feature: real-ai, Property 8: Provider Selection Matches the Environment Model`.
    - **Property 8: Provider Selection Matches the Environment Model**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 6.6**

- [ ] 4. Verify unchanged-engine integration and security boundaries
  - [ ]* 4.1 Add real-provider integration tests
    - Create `tests/integration/real-ai-engine.test.js` using the real engine with mocked provider transport and zero real network access.
    - Verify fulfilled answers enter existing pagination, rejected provider calls reach the existing failure screen with no mock fallback, and `oracle` plus engine `eli5` requests cross the provider boundary correctly.
    - Keep Exam Survival route behavior unchanged while testing direct provider support for `exam-survival` at the provider/API boundary.
    - _Requirements: 3.6, 4.3, 4.4, 4.11, 5.5, 6.1, 6.5_

  - [ ]* 4.2 Write Property 9: Real Answers Preserve the USSD Screen Limit
    - Create `tests/property/real-ai-pagination.property.test.js` with at least 100 generated Successful_Answer strings and a mocked provider transport.
    - Pass each answer through the existing engine and assert every answer screen, including controls, remains at most 160 UTF-16 code units.
    - Tag the test `Feature: real-ai, Property 9: Real Answers Preserve the USSD Screen Limit`.
    - **Property 9: Real Answers Preserve the USSD Screen Limit**
    - **Validates: Requirements 3.6**

  - [ ]* 4.3 Update the three approved assertions and add automated server/browser boundary checks
    - In `tests/unit/mock-ai.test.js`, replace only the stale assertion that requires `api/ask.js` to be absent with one check that `src/ui/main.js` and `src/ui/mock-ai.js` never import `api/ask.js`; leave every other line unchanged.
    - In `tests/unit/phone-ui-entry.test.js`, replace only the stale assertion that requires `api/ask.js` to be absent with one check that browser modules under `src/ui/` never import `api/ask.js`; leave every other line unchanged.
    - In `tests/integration/phone-ui-boundary.test.js`, replace only the stale assertion that requires `api/ask.js` to be absent with one check that browser modules under `src/ui/` never import `api/ask.js`; leave every other line unchanged.
    - Create `tests/integration/real-ai-boundary.test.js` to verify browser source has no Gemini key access, Gemini origin, server import, or key-bearing request field.
    - Verify only `api/ask.js` contains the Gemini request origin and environment-key access, and use throwing global request guards to prove all new tests rely on injected mocks.
    - Check the implementation diff for zero changes under `src/engine/`, exactly the three authorized assertion replacements in `tests/unit/mock-ai.test.js`, `tests/unit/phone-ui-entry.test.js`, and `tests/integration/phone-ui-boundary.test.js`, and zero edits to any other line in those files or any other Existing_Test_File.
    - _Requirements: 2.1, 2.4, 6.1, 6.2, 6.3, 6.5, 6.8, 6.9, 6.10, 6.11_

- [x] 5. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Run the new test files and the complete suite with one-shot Vitest commands.
  - Confirm all three stale `api/ask.js` absence assertions were replaced by the approved no-import checks and that no other existing-test content changed.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster implementation, although the requested zero-network verification depends on completing them.
- Every request operation in tests is mocked or injected. Tests must not read a real `GEMINI_API_KEY` or contact Gemini, Vercel, or `/api/ask` over a network.
- No task modifies `src/engine/`, `src/ui/mock-ai.js`, or `src/ui/phone-ui.js`. The only authorized Existing_Test_File edits are replacing the stale `api/ask.js` absence assertions in `tests/unit/mock-ai.test.js`, `tests/unit/phone-ui-entry.test.js`, and `tests/integration/phone-ui-boundary.test.js`; all other lines in those files and all other existing-test content remain unchanged.
- `exam-survival` is implemented at the API and provider boundaries only. The existing local Exam Survival engine route remains unchanged.
- The three approved assertion replacements allow `api/ask.js` to exist while the existing tests verify that browser UI modules do not import the server function.
- Checkpoints and top-level parent tasks are excluded from the dependency graph. Every incomplete decimal task appears exactly once.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "1.6", "2.2", "2.3", "2.4", "2.5", "3.1"] },
    { "id": 2, "tasks": ["3.2", "3.3"] },
    { "id": 3, "tasks": ["4.1", "4.2", "4.3"] }
  ]
}
```
