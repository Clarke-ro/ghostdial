# Requirements Document

## Introduction

The Real AI feature connects GhostDial's existing browser phone to Google Gemini through a Vercel serverless boundary. The browser sends only a study mode and question to the project endpoint. The endpoint keeps the Gemini API key on the server, asks `gemini-2.5-flash` for a concise plain-text tutoring answer, and returns the answer through the provider interface already accepted by the unchanged USSD menu engine.

## Glossary

- **Real_AI_Feature**: The server and browser additions specified by this document.
- **Ask_Function**: The Vercel serverless function exported from `api/ask.js`.
- **Browser_Provider**: The AI provider created by `src/ui/real-ai.js` for use by the existing USSD menu engine.
- **Mock_AI_Provider**: The existing deterministic provider created by `createMockAIProvider` in `src/ui/mock-ai.js`.
- **Phone_UI**: The existing browser phone mounted by `src/ui/main.js`.
- **Test_Suite**: New Vitest and fast-check test files added for the Real_AI_Feature.
- **Provider_Interface**: A function that accepts an object containing `mode` and `question` and returns a Promise that fulfills with an answer string.
- **Provider_Request**: The object supplied to the Browser_Provider through the Provider_Interface.
- **API_Request**: An HTTP request sent to the Ask_Function.
- **API_Response**: An HTTP response returned by the Ask_Function.
- **Valid_Request_Body**: A JSON object containing a Supported_API_Mode string in `mode` and a Question string in `question`; additional JSON fields do not affect processing.
- **Question**: A non-empty JavaScript string containing no more than 160 UTF-16 code units.
- **Supported_API_Mode**: One of the exact strings `oracle`, `explain-like-5`, or `exam-survival`.
- **Supported_Provider_Mode**: One of the exact strings `oracle`, `eli5`, or `exam-survival` accepted from the existing engine or another Provider_Interface caller.
- **Engine_ELI5_Mode**: The exact string `eli5` currently supplied by the unchanged USSD menu engine for Explain Like I'm 5 questions.
- **Gemini_Service**: Google's Gemini content-generation API.
- **Gemini_Model**: The exact model identifier `gemini-2.5-flash`.
- **Gemini_API_Key**: The secret value read from `process.env.GEMINI_API_KEY` by the Ask_Function.
- **Successful_Answer**: A non-empty Plain_Text JavaScript string containing no more than 480 UTF-16 code units.
- **Plain_Text**: Text without Markdown headings, list markers, emphasis delimiters, fenced or inline code delimiters, or Markdown link syntax.
- **Safe_Error_Response**: A JSON object with one public `error` string selected from a fixed allowlist; no response value is copied from a Gemini_API_Key, submitted Question, upstream response body, stack trace, or internal exception message.
- **Production_Mode**: A browser build for which Vite exposes `import.meta.env.PROD` as `true`.
- **Development_Mode**: A browser build for which Vite exposes `import.meta.env.PROD` as `false`.
- **Mock_Query_Override**: A page URL whose query parameters contain `mock=1` exactly.
- **Request_Timeout**: A period of exactly 15,000 milliseconds beginning when the Browser_Provider starts an API_Request.
- **Protocol_Error**: A non-success HTTP status, non-JSON API_Response, or API_Response body that does not contain exactly one non-empty string field named `answer`.
- **Existing_Failure_Path**: The Phone_UI behavior that displays exactly `Request failed. Try again.` when an asynchronous engine transition rejects.
- **Existing_Test_File**: A test source file present in the repository before implementation of the Real_AI_Feature.
- **Authorized_Mock_AI_Assertion**: The stale assertion in `tests/unit/mock-ai.test.js` that requires `api/ask.js` to be absent before the Real_AI_Feature exists.
- **Authorized_Phone_UI_Entry_Assertion**: The stale assertion in `tests/unit/phone-ui-entry.test.js` that requires `api/ask.js` to be absent before the Real_AI_Feature exists.
- **Authorized_Phone_UI_Boundary_Assertion**: The stale assertion in `tests/integration/phone-ui-boundary.test.js` that requires `api/ask.js` to be absent before the Real_AI_Feature exists.
- **Authorized_Existing_Test_Assertions**: Exactly the Authorized_Mock_AI_Assertion, the Authorized_Phone_UI_Entry_Assertion, and the Authorized_Phone_UI_Boundary_Assertion.

## Requirements

### Requirement 1: Serverless Request Contract

**User Story:** As a browser caller, I want one narrow project endpoint for study questions, so that browser code never contacts Gemini directly.

#### Acceptance Criteria

1. WHEN the Ask_Function receives a `POST` API_Request with a Valid_Request_Body, THE Ask_Function SHALL process the Valid_Request_Body as one tutoring request.
2. WHEN the Ask_Function completes a valid tutoring request, THE Ask_Function SHALL return an API_Response with HTTP status `200`, JSON content type, and body `{ "answer": Successful_Answer }`.
3. IF the Ask_Function receives an API_Request whose method is not `POST`, THEN THE Ask_Function SHALL return HTTP status `405`, an `Allow: POST` header, and a Safe_Error_Response.
4. IF the Ask_Function receives malformed JSON or a body that is not a JSON object, THEN THE Ask_Function SHALL return HTTP status `400` and a Safe_Error_Response.
5. IF the Ask_Function receives a JSON object whose `mode` is not a Supported_API_Mode, THEN THE Ask_Function SHALL return HTTP status `400` and a Safe_Error_Response.
6. IF the Ask_Function receives a JSON object whose `question` is not a Question, THEN THE Ask_Function SHALL return HTTP status `400` and a Safe_Error_Response.
7. WHEN the Ask_Function returns a non-success API_Response, THE Ask_Function SHALL return JSON content type and a Safe_Error_Response.

### Requirement 2: Gemini Server Boundary

**User Story:** As a project owner, I want Gemini access confined to the serverless function, so that the API key is not exposed in browser assets or requests.

#### Acceptance Criteria

1. WHEN the Ask_Function starts a valid tutoring request, THE Ask_Function SHALL read the Gemini_API_Key only from `process.env.GEMINI_API_KEY`.
2. WHEN the Ask_Function calls the Gemini_Service, THE Ask_Function SHALL request content from the Gemini_Model exactly once for the associated API_Request.
3. WHEN the Ask_Function calls the Gemini_Service, THE Ask_Function SHALL authenticate the server-to-server request with the Gemini_API_Key in the `x-goog-api-key` request header.
4. THE Real_AI_Feature SHALL include zero Gemini_API_Key values in browser source, browser bundles, API_Request URLs, API_Request headers, and API_Request bodies.
5. IF the Gemini_API_Key is absent or an empty string, THEN THE Ask_Function SHALL return HTTP status `500` with a Safe_Error_Response and make zero Gemini_Service requests.
6. IF the Gemini_Service request rejects or returns a non-success HTTP status, THEN THE Ask_Function SHALL return HTTP status `502` with a Safe_Error_Response.
7. IF the Gemini_Service returns malformed JSON or no non-empty candidate text, THEN THE Ask_Function SHALL return HTTP status `502` with a Safe_Error_Response.

### Requirement 3: Tutor Answer Contract

**User Story:** As a student using a small phone display, I want short, clear tutoring answers, so that I can study through a few USSD pages.

#### Acceptance Criteria

1. WHEN the Ask_Function constructs a Gemini_Service request, THE Ask_Function SHALL instruct the Gemini_Model to return Plain_Text containing no more than 480 UTF-16 code units.
2. WHEN the Ask_Function receives non-empty candidate text from the Gemini_Service, THE Ask_Function SHALL convert the candidate text into one Successful_Answer before returning the API_Response.
3. WHEN the Supported_API_Mode is `oracle`, THE Ask_Function SHALL instruct the Gemini_Model to answer as a spooky but helpful tutor using plain, simple English.
4. WHEN the Supported_API_Mode is `explain-like-5`, THE Ask_Function SHALL instruct the Gemini_Model to explain the subject in child-friendly plain English with a spooky but reassuring voice.
5. WHEN the Supported_API_Mode is `exam-survival`, THE Ask_Function SHALL instruct the Gemini_Model to provide practical exam preparation guidance in plain English with a spooky but encouraging voice.
6. WHEN a Successful_Answer is passed to the existing USSD paginator, THE Real_AI_Feature SHALL allow every resulting screen, including menu controls, to remain at most 160 characters.

### Requirement 4: Browser Provider

**User Story:** As the Phone_UI, I want a network-backed provider matching the existing provider contract, so that the menu engine requires no changes.

#### Acceptance Criteria

1. THE Real_AI_Feature SHALL export a Browser_Provider factory from `src/ui/real-ai.js` that implements the Provider_Interface.
2. WHEN the Browser_Provider receives a Provider_Request with mode `oracle`, THE Browser_Provider SHALL send one `POST` API_Request to `/api/ask` with JSON body `{ "mode": "oracle", "question": Question }`.
3. WHEN the Browser_Provider receives a Provider_Request with Engine_ELI5_Mode, THE Browser_Provider SHALL send one `POST` API_Request to `/api/ask` with JSON body `{ "mode": "explain-like-5", "question": Question }`.
4. WHEN the Browser_Provider receives a Provider_Request with mode `exam-survival`, THE Browser_Provider SHALL send one `POST` API_Request to `/api/ask` with JSON body `{ "mode": "exam-survival", "question": Question }`.
5. WHEN the Browser_Provider receives a successful API_Response containing `{ "answer": Successful_Answer }`, THE Browser_Provider SHALL fulfill with exactly the Successful_Answer string.
6. WHILE an API_Request is pending, WHEN the Request_Timeout elapses, THE Browser_Provider SHALL abort the API_Request and reject the Provider_Interface Promise.
7. IF the browser request operation rejects, THEN THE Browser_Provider SHALL reject the Provider_Interface Promise.
8. IF the API_Response contains a Protocol_Error, THEN THE Browser_Provider SHALL reject the Provider_Interface Promise.
9. IF the Browser_Provider receives a Provider_Request whose mode is not a Supported_Provider_Mode or whose question is not a Question, THEN THE Browser_Provider SHALL reject the Provider_Interface Promise and make zero API_Requests.
10. WHEN an API_Request settles before the Request_Timeout, THE Browser_Provider SHALL cancel the associated timeout.
11. WHEN the Browser_Provider rejects, THE Browser_Provider SHALL allow the Existing_Failure_Path to handle the rejection without replacing the rejection with a mock answer.

### Requirement 5: Provider Selection

**User Story:** As a developer, I want deterministic environment-based provider selection, so that local work remains offline while production uses Gemini.

#### Acceptance Criteria

1. WHEN `src/ui/main.js` initializes in Production_Mode without a Mock_Query_Override, THE Phone_UI SHALL receive the Browser_Provider.
2. WHEN `src/ui/main.js` initializes in Development_Mode, THE Phone_UI SHALL receive the Mock_AI_Provider.
3. WHILE Production_Mode is active, WHEN `src/ui/main.js` initializes with a Mock_Query_Override, THE Phone_UI SHALL receive the Mock_AI_Provider.
4. WHEN the page URL contains `mock` with a value other than exact `1`, THE Real_AI_Feature SHALL select the provider according to Production_Mode or Development_Mode without applying the Mock_Query_Override.
5. WHEN `src/ui/main.js` supplies either provider to the Phone_UI, THE Real_AI_Feature SHALL preserve the existing Phone_UI mount, audio, and engine-transition dependencies.

### Requirement 6: Compatibility and Automated Verification

**User Story:** As a maintainer, I want isolated automated coverage for the server and browser boundaries, so that the real integration can be changed without network-dependent tests.

#### Acceptance Criteria

1. THE Real_AI_Feature SHALL make zero changes to files under `src/engine/`.
2. THE Real_AI_Feature SHALL make zero changes to every Existing_Test_File except the Authorized_Existing_Test_Assertions.
3. WHEN the Test_Suite exercises the Ask_Function, THE Test_Suite SHALL replace the Gemini_Service request operation with a mock and make zero real network requests.
4. WHEN the Test_Suite exercises the Ask_Function, THE Test_Suite SHALL cover valid requests, each invalid request class, a missing Gemini_API_Key, Gemini_Service rejection, Gemini_Service non-success responses, malformed Gemini_Service payloads, Plain_Text normalization, and Successful_Answer length enforcement.
5. WHEN the Test_Suite exercises the Browser_Provider, THE Test_Suite SHALL use mocked request and timer operations to cover request serialization, Engine_ELI5_Mode mapping, successful answer extraction, early timeout cancellation, timeout abortion, request rejection, and every Protocol_Error class without real network requests.
6. WHEN the Test_Suite exercises provider selection, THE Test_Suite SHALL cover Production_Mode, Development_Mode, exact Mock_Query_Override, and non-matching `mock` query values without mounting a real network dependency.
7. THE Test_Suite SHALL use Vitest for example-based tests and fast-check for universal properties of pure normalization, validation, request mapping, and provider-selection logic.
8. THE Real_AI_Feature SHALL keep newly added production and test code in plain JavaScript ES modules with comments that explain server security and asynchronous cleanup decisions for beginner developers.
9. WHEN implementation replaces the Authorized_Mock_AI_Assertion, THE Test_Suite SHALL verify that `src/ui/main.js` and `src/ui/mock-ai.js` contain zero imports of `api/ask.js`.
10. WHEN implementation replaces the Authorized_Phone_UI_Entry_Assertion, THE Test_Suite SHALL verify that browser modules under `src/ui/` contain zero imports of `api/ask.js`.
11. WHEN implementation replaces the Authorized_Phone_UI_Boundary_Assertion, THE Test_Suite SHALL verify that browser modules under `src/ui/` contain zero imports of `api/ask.js`.
