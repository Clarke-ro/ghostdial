# Implementation Plan: Phone UI

## Overview

Implement the browser-based GhostDial phone interface as plain JavaScript, HTML, and CSS around the existing `next(state, input, aiProvider)` engine boundary. Build the work from the browser shell and rendering primitives through exact keyboard/multi-tap input, deterministic mock AI, the injectable presentation-only Web Audio layer, and the controller lifecycle. Finish by wiring the entry page and exercising the complete UI with unit, integration, and fast-check tests. No task changes `src/engine/`, calls `api/ask.js`, adds a UI framework, or introduces network/audio-file dependencies.

## Tasks

- [x] 1. Create the browser entry and phone control shell
  - [x] 1.1 Create the root entry page and UI module entry
    - Create `index.html` with one `main#app`, a document title, and one module script loading `src/ui/main.js`.
    - Create the initial `src/ui/main.js` module boundary with imports reserved for the injected engine transition, mock provider, audio service, and phone controller; keep the dependency direction browser-entry → UI controller → engine.
    - Keep the entry page free of engine menu copy, framework bootstraps, API imports, brands, logos, and manufacturer wording.
    - _Requirements: 1.1, 1.2, 1.3, 2.7, 8.1, 8.5, 8.6, 8.7_

  - [x] 1.2 Implement `src/ui/controls.js` and the semantic phone DOM
    - Build exactly one unbranded enclosure containing one LCD display, one 3-by-4 keypad, Call, Clear, Back, Home, and mute controls.
    - Create exactly twelve Character_Key buttons in DOM and visual order `1 2 3`, `4 5 6`, `7 8 9`, `* 0 #`; keep Call, Clear, Back, Home, and mute outside the keypad grid.
    - Normalize button activation to character, call, clear, back, home, and mute-toggle actions without letting controls mutate engine state directly.
    - Give Back and Home clear visible labels and keep both controls inside the enclosure but outside the keypad grid; their semantic actions must remain distinct from keypad `0` so question-state multi-tap can still produce U+0020 SPACE.
    - Give the mute control an accessible action label and `aria-pressed` state that can represent enabled and muted audio.
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 4.9, 4.10, 6.5, 7.3_

  - [x] 1.3 Add `src/ui/styles.css` for the retro phone presentation
    - Style one neutral, unbranded phone enclosure, green LCD, four keypad rows of three columns, and controls outside the keypad grid, including dedicated Back and Home controls.
    - Choose LCD foreground and background colors whose WCAG contrast ratio is at least 4.5:1, and use `white-space: pre-wrap` for literal screen line breaks.
    - Make disabled/loading and mute states understandable without relying on color alone; do not add product or manufacturer marks.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7, 3.6, 7.3_

  - [x] 1.4 Write entry-page and control-shell tests
    - Load the entry document or its UI construction seam and assert idle startup, exactly one enclosure/display/keypad, twelve keys in order, Call/Clear/Back/Home placement outside the keypad, mute placement, and absence of brand text or logos.
    - Calculate the declared LCD contrast colors and assert a ratio of at least 4.5:1.
    - Assert no UI framework or `api/ask.js` import is required when the API module is absent.
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.7, 8.5, 8.6_

  - [x] 1.5 Implement dedicated Back and Home control actions
    - Extend the control action contract described in the design's `controls.js` and `phone-ui.js` component sections with separate Back and Home actions and render both buttons inside the enclosure but outside all 12 keypad grid positions.
    - Keep Back and Home distinct from Character_Key `0`; do not route either action through keypad multi-tap handling or change the fixed keypad order.
    - Make the controller-facing actions carry no user-entered payload so the submission path can supply exact `0` and `00` values.
    - _Requirements: 2.1, 2.3, 2.4, 4.1, 4.2, 4.10, 4.11, 6.5, 7.3_

  - [ ] 1.6 Write Back/Home control-shell tests
    - Assert exactly one Back button and one Home button exist inside the single enclosure, both are outside the keypad grid, and neither is counted among the twelve Character_Key buttons.
    - Assert button activation normalizes to distinct Back and Home actions and that keypad `0` remains a Character_Key action.
    - _Requirements: 2.1, 2.3, 2.4, 4.1, 4.2, 4.10_

- [x] 2. Implement safe LCD rendering
  - [x] 2.1 Create `src/ui/render.js`
    - Render idle, loading, recoverable-error, and engine screen text through `textContent` only; never use `innerHTML` or parse screen text as markup.
    - Mirror the complete input buffer into the input line, including empty input, spaces, punctuation, and all characters without trimming or normalization.
    - Preserve CRLF, LF, and CR source sequences for CSS pre-wrap rendering as one visible line break and keep screen text literal.
    - Update disabled states, lifecycle attributes, and mute presentation through targeted DOM references rather than screen-text queries.
    - _Requirements: 1.6, 1.7, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 6.4, 7.1, 7.9_

  - [x] 2.2 Write renderer unit and safe-projection tests
    - Verify exact idle/loading/failure copy, exact engine screen text, input-line mirroring, empty input, and 160-code-unit display limits.
    - Use special characters including `&`, `<`, `>`, quotes, apostrophes, and markup-like strings; assert literal text, no created descendants, and no execution.
    - Cover CRLF, LF, and CR display behavior and disabled/loading/end-pause presentation.
    - _Requirements: 1.6, 1.7, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 6.4, 7.1, 7.3, 7.9_

- [x] 3. Implement exact input normalization and multi-tap behavior
  - [x] 3.1 Create `src/ui/multi-tap.js`
    - Export the fixed `MULTI_TAP_MAPPING` for `0`, `2` through `9`, including `0 → U+0020 SPACE`.
    - Track pending digit, mapping index, final buffer position, and activation timestamp while keeping the pending character inside the input buffer and counted toward 160 code units.
    - Implement the 800 ms less-than threshold, same-digit cycling and wraparound, different-key commit, timer-race protection, repeated/held-key activations, and capacity checks.
    - Select multi-tap only when `engineState?.view?.kind === 'question'`; treat mapped digits literally in all other views and treat `1`, `*`, and `#` literally in question views after committing pending output.
    - _Requirements: 3.9, 3.10, 3.11, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 3.2 Create `src/ui/keyboard.js`
    - Classify exactly one printable Unicode scalar, including letters, digits, spaces, punctuation, `*`, and `#`; reject named keys and control, format, surrogate, private-use, and unassigned characters.
    - Normalize unmodified printable, Enter, and Backspace events while preserving exact key text and JavaScript string-length capacity semantics.
    - Leave modified printable keys and unsupported named keys unchanged and uncancelled; call `preventDefault()` exactly once only for handled unmodified actions.
    - Apply action precedence for disabled lifecycle states, modifiers, Enter, Backspace, and printable input, including pending multi-tap commit and final-character removal.
    - _Requirements: 3.9, 3.10, 4.11, 4.12, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 7.3, 7.4_

  - [x] 3.3 Write multi-tap and keyboard unit tests
    - Cover every mapping, first-character insertion, 799/800/801 ms boundaries, final-character wraparound, different-key commits, repeated activations, pending-character reservation, and full-buffer rejection.
    - Cover printable spaces/punctuation/Unicode scalars, Ctrl/Alt/Meta combinations, Enter, Backspace with and without pending state, unsupported named keys, and `preventDefault()` call counts.
    - _Requirements: 3.9, 3.10, 3.11, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 4. Implement the deterministic local AI provider
  - [x] 4.1 Create `src/ui/mock-ai.js`
    - Export a configurable mock provider with a default exactly 1,200 ms timeout and deterministic answer generation from equal `mode` and complete `question` values.
    - Ensure the answer is long enough for the existing engine pagination behavior to produce at least two pages under the interactive limit.
    - Use only generated strings and injected timers; perform zero network requests and do not import or reference `api/ask.js`.
    - Preserve exact request text and mode while resolving a JavaScript string after the configured delay.
    - _Requirements: 1.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.7_

  - [x] 4.2 Write mock-provider unit and engine-boundary tests
    - Verify default and injected delay behavior, equal-request determinism, long-answer pagination through the real engine, zero network imports/requests, and string output.
    - Assert the provider can be supplied when `api/ask.js` is absent and that the UI entry still reaches idle startup.
    - _Requirements: 1.5, 1.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [x] 5. Implement the injectable presentation-only audio service
  - [x] 5.1 Create `src/ui/audio.js` with generated Web Audio tones and no-op seams
    - Export `createAudioService` and `createNoopAudioService` with `keyBeep`, `startConnecting`, `stopConnecting`, `setMuted`, `isMuted`, and `destroy` methods.
    - Generate short dial-tone key beeps and a bounded/repeating connecting tone with oscillators, gain envelopes, and no audio files, `<audio>` elements, network audio, or engine imports.
    - Lazily construct or resume `AudioContext` only from accepted user gestures; catch missing constructors, suspended/autoplay-blocked contexts, rejected resumes, oscillator failures, and all other audio errors without throwing into UI event handling.
    - Default to unmuted audio; make mute immediately suppress new sounds and connecting output, allow unmute to resume an active loading tone, and keep mute state outside controller and engine snapshots.
    - Make connecting-tone start/stop idempotent and ensure `destroy()` stops and releases all service-local audio resources without owning lifecycle timers or engine state.
    - _Requirements: 1.5, 2.1, 4.9, 6.2, 6.3, 6.4, 6.7, 6.9, 7.1, 7.3, 7.5, 8.5_

  - [x] 5.2 Write audio-service unit tests with fake and no-op audio seams
    - Use a fake `AudioContext`/oscillator/gain graph to verify generated oscillator/envelope calls, default enabled state, mute/unmute behavior, connecting-tone idempotence, and cleanup.
    - Exercise missing, suspended, blocked, throwing, and rejected audio contexts and service methods; assert no exception escapes and no UI-facing result is changed.
    - Verify no audio-file or network-audio path exists and that the no-op service implements the complete injectable contract without timers or browser audio.
    - _Requirements: 1.5, 4.9, 6.2, 6.3, 6.7, 6.9, 7.1, 7.3, 7.5, 8.5_

- [ ] 6. Implement the phone controller and lifecycle state machine
  - [-] 6.1 Create `src/ui/phone-ui.js`
    - Implement the Back/Home routing and lifecycle gates in line with the design's `phone-ui.js` submission flow and Audio event contract; mount the controls, LCD renderer, keyboard listener, injected transition, mock provider, clock/timer seam, and injected audio service while keeping engine state opaque except for the required question-view check.
    - Initialize idle state with no engine state and an empty buffer; enforce a 160-code-unit input maximum before every append or multi-tap output.
    - Accept on-screen characters, Clear, Call, Back, Home, printable keyboard input, Enter, and Backspace only in interactive states; require an active `CON` screen for Back/Home; commit pending multi-tap before keyboard or submission actions and preserve exact spaces/order/content in submission snapshots.
    - While an active `CON` screen is shown, route Back and Home through the same submission function as Call/Enter with captured input exactly `0` and `00`, respectively; clear the existing input buffer and pending multi-tap state before invoking the transition so stale input can never reach the engine.
    - Keep Back/Home disabled in Idle, Loading_State, and Ended_Pause_State, with no transition invocation or key beep; do not reinterpret keypad `0`, which must continue to use question-state multi-tap and append U+0020 SPACE.
    - Invoke the injected `transition` exactly once per accepted submission with the state at submission start, exact captured buffer, and the same provider; clear input and pending state immediately after capture.
    - Adopt returned state by reference and render synchronous CON results without loading; enter Loading_State before Promise settlement; disable input while pending; preserve the pre-transition state, show fixed failure text, and re-enable interaction after rejection.
    - Start connecting audio exactly once on Loading_State entry and stop it on fulfillment, rejection, END handling, cancellation, destroy, and every defensive loading exit; swallow audio failures without changing controller behavior.
    - Enter Ended_Pause_State for END screens, preserve exact END text and input/multi-tap state while blocked for 1,500 ms, then reset engine state, buffer, pending state, and LCD to idle.
    - Keep mute-toggle handling inside the enclosure but outside the controller action reducer so it changes only audio presentation and accessible mute state; expose deterministic `getSnapshot`, `dispatch`, and `destroy` seams for tests.
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 2.1, 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 3.9, 3.10, 3.11, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 8.1, 8.7_

  - [~] 6.2 Write controller unit tests for input, lifecycle, and audio event gating
    - Test idle startup, exact submission arguments and single invocation, synchronous CON adoption, Promise loading, fulfillment, rejection preservation, Clear, Back/Home submissions from an active CON screen, keyboard actions, 160-character capacity, multi-tap timing, END pause, 1,500 ms reset, and destroy cleanup.
    - Seed stale input and pending multi-tap state before Back/Home, then assert each action clears that state before invoking the transition and passes exactly `0` or `00` with the same provider.
    - Assert Back/Home are ignored without transition calls or beeps in Idle, Loading_State, and Ended_Pause_State, while keypad `0` in a question prompt still emits the mapped U+0020 SPACE input and Back/Home remain exact navigation submissions.
    - Inject recording, no-op, and throwing audio services and assert accepted Character_Key, Call, Clear, printable, Enter, and Backspace actions produce one beep while ignored, disabled, modified, unsupported, or capacity-rejected actions produce none.
    - Assert connecting tone start/stop counts for Promise entry and every loading exit, and prove mute toggles do not alter engine state, transition arguments, input, lifecycle, or timers.
    - _Requirements: 1.4, 1.5, 1.6, 3.1, 3.2, 3.3, 3.4, 3.8, 3.9, 3.10, 3.11, 4.9, 4.10, 4.11, 4.12, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 8.1, 8.7_

- [ ] 7. Complete entry wiring and browser integration
  - [~] 7.1 Wire `src/ui/main.js` to the real engine, mock provider, audio service, and mounted controller
    - Import only `next` from `src/engine/ussd.js`, `createMockAIProvider`, `createAudioService`, and `mountPhoneUI`.
    - Mount once under `#app` after the document is ready, start idle without calling the engine or creating `AudioContext`, and pass the injectable audio service into the controller.
    - Ensure no `api/ask.js`, network endpoint, framework runtime, or duplicated menu/screen logic enters the module graph.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7, 2.1, 3.1, 8.1, 8.5, 8.6, 8.7_

  - [~] 7.2 Write browser-bound integration tests for the complete UI boundary
    - Load `index.html` with the API module absent and assert idle startup, exact DOM structure, keyboard and keypad interaction, safe text rendering, and engine invocation arguments.
    - Use deferred transitions to verify loading is visible before settlement, controls are disabled, Back/Home are disabled without beeps or submissions, fulfillment adopts results, rejection preserves state with fixed failure copy, and no duplicate submissions occur.
    - Use an active question prompt with stale input and pending keypad-`0` multi-tap state to verify keypad `0` still produces U+0020 SPACE, while Back and Home submit exactly `0` and `00` through the existing transition path and invoke it once each.
    - Use fake timers and the real mock provider/engine to verify the 1,200 ms delay range, at least two answer pages, END text through 1,499 ms, reset at 1,500 ms, and no input during disabled states.
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 2.1, 3.1, 3.3, 3.5, 3.6, 3.7, 4.10, 4.11, 4.12, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9, 6.10, 6.11, 6.12, 6.13, 7.1, 7.2, 7.3, 7.6, 7.7, 7.8, 7.9, 8.2, 8.3, 8.6, 8.7_

- [ ] 8. Add fast-check properties aligned one-to-one with the design
  - [~] 8.1 Write Property 1: Bounded, Exact Input Buffer
    - Create `tests/property/phone-ui-input.property.test.js` with at least 100 runs over buffers from empty through 160 JavaScript code units, accepted character actions, spaces, punctuation, `*`, `#`, and valid Unicode scalars.
    - Assert exact append-or-no-op behavior, no trimming/reordering/replacement, input-line equality, and pending-character reservation at capacity.
    - **Property 1: Bounded, Exact Input Buffer**
    - **Validates: Requirements 3.4, 3.8, 3.9, 3.10, 4.1, 4.2, 4.3, 5.1**

  - [~] 8.2 Write Property 2: Question-State Multi-Tap Sequence
    - Create `tests/property/phone-ui-multi-tap.property.test.js` with mapped digits, repeat counts, different labels, held-key repeats, and elapsed times below, at, and above 800 ms.
    - Assert mapping order, wraparound, commit-before-different-input, threshold behavior, pending-state correctness, and the 160-code-unit invariant.
    - **Property 2: Question-State Multi-Tap Sequence**
    - **Validates: Requirements 3.11, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8**

  - [~] 8.3 Write Property 3: Keyboard Classification and Default Behavior
    - Create `tests/property/phone-ui-keyboard.property.test.js` over printable keys, modifier combinations, Enter, Backspace, unsupported named keys, and empty/non-empty buffers.
    - Assert exact input changes, preservation of pending state for modified keys, zero changes for unsupported keys, and exactly-once default cancellation for handled actions.
    - **Property 3: Keyboard Classification and Default Behavior**
    - **Validates: Requirements 5.1, 5.2, 5.4, 5.5, 5.6, 5.7**

  - [~] 8.4 Write Property 4: Submission Snapshot and Single Invocation
    - Create `tests/property/phone-ui-submission.property.test.js` over idle/interactive states, complete buffers, question pending output, and serializable engine states.
    - Assert one exact transition call with the beginning state, captured complete input, and stable provider, followed by empty input and cleared pending metadata.
    - **Property 4: Submission Snapshot and Single Invocation**
    - **Validates: Requirements 1.5, 4.10, 4.11, 4.12**

  - [~] 8.5 Write Property 5: Result State Adoption and Safe Text Projection
    - Create `tests/property/phone-ui-render.property.test.js` over serializable returned states, screen types, line breaks, markup-like text, and arbitrary input buffers.
    - Assert complete state adoption by reference/value contract, literal text projection without DOM creation or execution, and input-line equality.
    - **Property 5: Result State Adoption and Safe Text Projection**
    - **Validates: Requirements 1.6, 3.4, 3.5, 3.7, 3.8**

  - [~] 8.6 Write Property 6: Disabled-State Action Invariance
    - Create `tests/property/phone-ui-disabled.property.test.js` over Loading_State and Ended_Pause_State action sequences for keypad, Clear, Call, printable, Enter, and Backspace.
    - Assert zero engine calls and preservation of input and multi-tap state for every disabled action sequence.
    - **Property 6: Disabled-State Action Invariance**
    - **Validates: Requirements 6.5, 6.6, 6.8, 7.3, 7.4, 7.5**

  - [~] 8.7 Write Property 7: Recoverable Rejection Preservation
    - Create `tests/property/phone-ui-rejection.property.test.js` over serializable pre-transition engine states and deferred rejection outcomes.
    - Assert Loading_State exit, exact prior state preservation, empty input, fixed failure message, and re-enabled input/submission after rejection.
    - **Property 7: Recoverable Rejection Preservation**
    - **Validates: Requirements 6.9, 6.10, 6.11, 6.12, 6.13**

  - [~] 8.8 Write Property 8: Mock Provider Determinism
    - Create `tests/property/mock-ai.property.test.js` over arbitrary modes and complete question strings, using injected deterministic timers.
    - Assert equal requests resolve to equal strings after equal configured delays and that the real engine produces at least two pagination pages from the answer.
    - **Property 8: Mock Provider Determinism**
    - **Validates: Requirements 8.2, 8.3, 8.4**

  - [~] 8.9 Write Property 9: Accepted Key Audio Is Gated and Isolated
    - Create `tests/property/phone-ui-audio-input.property.test.js` with recording and no-op/throwing audio services over accepted, disabled, modified, unsupported, and capacity-rejected keypad/keyboard actions.
    - Assert exactly one beep per accepted action, no beep for rejected actions, and identical engine calls, buffers, lifecycle transitions, and timers with audio enabled, disabled, or failing.
    - **Property 9: Accepted Key Audio Is Gated and Isolated**
    - **Validates: Requirements 1.5, 4.1, 4.3, 5.1, 5.2, 5.7, 6.5, 7.3**

  - [~] 8.10 Write Property 10: Loading Tone Follows Promise Lifecycle
    - Create `tests/property/phone-ui-audio-loading.property.test.js` over synchronous, fulfilling, rejecting, END-producing, cancelled, and destroyed loading outcomes.
    - Assert one connecting start only on Promise Loading_State entry, stop on every loading exit, idempotent stop behavior, and unchanged controller/engine/timer behavior with no-op or throwing audio.
    - **Property 10: Loading Tone Follows Promise Lifecycle**
    - **Validates: Requirements 1.5, 6.1, 6.2, 6.7, 6.8, 6.9, 7.1, 7.3, 7.5**

  - [~] 8.11 Write Property 11: Mute Changes Audio Only
    - Create `tests/property/phone-ui-mute.property.test.js` over lifecycle states and arbitrary mute-toggle sequences, including loading and END pause.
    - Assert only audio mute presentation and accessible state change; engine state, input, pending multi-tap, lifecycle, transition arguments/count, and timers must remain unchanged, while later accepted input follows identical rules.
    - **Property 11: Mute Changes Audio Only**
    - **Validates: Requirements 1.5, 4.9, 6.5, 6.6, 7.3, 7.5**

  - [~] 8.12 Write property coverage for Back/Home submission invariants
    - Create `tests/property/phone-ui-navigation-buttons.property.test.js` with at least 100 runs over active CON states, arbitrary stale buffers, pending question-state keypad-`0` output, and lifecycle states including Idle, Loading_State, and Ended_Pause_State.
    - Assert Back and Home clear stale input and pending metadata before exactly one transition call with exact input `0` or `00`, preserve the supplied provider and submission-start state, and never submit keypad `0` as a navigation action.
    - Assert disabled Back/Home actions produce no transition call, no buffer change, no pending-state change, and no key beep; in question views, independent keypad `0` actions remain U+0020 SPACE multi-tap input.
    - **Property 4: Submission Snapshot and Single Invocation; Property 6: Disabled-State Action Invariance; Property 9: Accepted Key Audio Is Gated and Isolated**
    - **Validates: Requirements 1.5, 4.1, 4.2, 4.10, 4.11, 4.12, 6.5, 6.6, 6.8, 7.3, 7.4, 7.5**

- [ ] 9. Verify audio integration and complete regression coverage
  - [~] 9.1 Add audio-focused controller integration tests
    - Inject a recording audio fake into a real mounted controller and verify accepted on-screen Character_Key, Call, Clear, printable, Enter, and Backspace actions beep once.
    - Verify ignored/disabled/modified/unsupported/capacity-rejected actions produce no beep; verify mute is operable inside the enclosure during Loading_State without changing engine behavior.
    - _Requirements: 4.9, 4.10, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 6.5, 6.6, 7.3, 7.4, 7.5_

  - [~] 9.2 Add connecting-tone lifecycle integration tests
    - Use deferred Promise transitions and fake timers to assert connecting tone starts on Loading_State entry and stops on fulfillment, rejection, END handling, destroy, and defensive loading exit.
    - Assert at most one active connecting tone, repeated stops are harmless, and audio service errors cannot alter transition arguments, state, buffers, or timer behavior.
    - _Requirements: 6.2, 6.3, 6.7, 6.8, 6.9, 7.1, 7.5_

  - [~] 9.3 Add browser smoke/static checks for the audio boundary
    - Confirm `audio.js` uses generated oscillator/envelope tones only, has no audio files, `<audio>` elements, network audio, API imports, or engine-state access.
    - Verify default unmuted accessible mute state, inside-enclosure placement, mute toggle behavior, and safe operation when `AudioContext` is absent or autoplay-blocked.
    - _Requirements: 2.1, 2.7, 4.9, 6.2, 6.3, 7.3, 7.5, 8.5_

  - [~] 9.5 Add Back/Home navigation integration tests
    - Mount the real phone controller with a recording audio fake, following the design's `phone-ui.js` submission flow and Audio event contract, and an active CON question result; seed stale text plus pending keypad-`0` multi-tap state, and verify Back submits exactly `0` and Home submits exactly `00` through the same transition path with one invocation each.
    - Verify keypad `0` in the question prompt remains a U+0020 SPACE input action, while Back/Home produce no stale-buffer characters and each accepted navigation action produces exactly one key beep.
    - Exercise Idle, Loading_State, and Ended_Pause_State and assert Back/Home are disabled, preserve input and pending state, invoke the engine zero times, and produce no beep; verify the existing Promise/END lifecycle and audio stop behavior remain unchanged.
    - _Requirements: 1.5, 2.1, 4.1, 4.2, 4.9, 4.10, 4.11, 4.12, 6.5, 6.6, 6.8, 7.3, 7.4, 7.5_

- [~] 10. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each correctness property from the design has one dedicated fast-check task with at least 100 generated runs and explicit requirement traceability.
- Audio is presentation-only. The controller owns lifecycle and transition behavior; the injected audio service must never mutate or appear in Engine_State, transition arguments, correctness snapshots, or timer decisions.
- Audio implementation must use generated Web Audio oscillator/envelope tones only. It must not ship audio files, use an `<audio>` element, make network audio requests, import `api/ask.js`, or require an available/unblocked AudioContext for interaction.
- The mock provider remains local and deterministic with a configured 1,200 ms delay. The UI must continue to start idle when `api/ask.js` is absent.
- Back and Home are dedicated controls outside the keypad grid. They are enabled only for an active CON screen, submit exact `0` and `00` through the existing single-invocation path, clear stale input and pending multi-tap state first, and never change keypad `0` question-state space behavior.
- Testing tasks use Vitest/fast-check and browser-capable seams already described by the design. Use one-shot test commands, not watch mode.
- Checkpoints and top-level parent tasks are excluded from the dependency graph; every decimal leaf task appears exactly once below.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.1", "3.2", "4.1", "5.1"] },
    { "id": 2, "tasks": ["1.3", "1.5", "2.2", "3.3", "4.2", "5.2"] },
    { "id": 3, "tasks": ["1.4", "6.1"] },
    { "id": 4, "tasks": ["1.6", "6.2"] },
    { "id": 5, "tasks": ["7.1"] },
    { "id": 6, "tasks": ["7.2", "8.1", "8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "8.10", "8.11", "8.12"] },
    { "id": 7, "tasks": ["9.1", "9.2", "9.3", "9.5"] }
  ]
}
```
