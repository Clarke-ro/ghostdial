# Requirements Document

## Introduction

GhostDial needs a browser-based retro phone interface for the existing USSD menu engine. The interface will use plain JavaScript, HTML, and CSS to present engine screens, collect keypad and physical-keyboard input, show asynchronous AI activity, and return completed calls to an idle state. This feature uses a local mock AI provider; connection to a real AI endpoint is outside this specification.

## Glossary

- **Phone_UI**: The browser-based retro phone interface specified by this document.
- **Plain_Web_Technologies**: Browser-native JavaScript, HTML, and CSS used without a user-interface framework.
- **User_Interface_Framework**: A third-party framework that supplies a component model or rendering runtime for a browser user interface.
- **Entry_Page**: The project-root `index.html` document that loads the Phone_UI.
- **UI_Module_Set**: The plain JavaScript, HTML-related, and CSS resources located under `src/ui/`.
- **USSD_Menu_Engine**: The existing browser-independent state-transition component exported from `src/engine/ussd.js`.
- **Engine_Transition**: The existing `next(state, input, aiProvider)` function exported by the USSD_Menu_Engine.
- **Engine_State**: The complete current session state value supplied to and returned by the Engine_Transition.
- **Engine_Result**: The value returned synchronously by the Engine_Transition or produced when an Engine_Promise fulfills, with the shape `{ state, screen: { type, text } }`.
- **Engine_Promise**: A Promise returned by the Engine_Transition for an asynchronous AI request.
- **Engine_Screen**: The `screen` value in an Engine_Result.
- **Screen_Text**: The complete `text` string of an Engine_Screen.
- **Screen_Type**: The `type` field of an Engine_Screen, with value `CON` or `END`.
- **LCD_Display**: The green phone display containing the Screen_Output_Region and Input_Line.
- **Screen_Output_Region**: The LCD_Display region used for Idle_Message, Loading_Message, Async_Failure_Message, or Screen_Text.
- **Input_Line**: The LCD_Display region that presents the current Input_Buffer.
- **Input_Buffer**: The ordered string of user-entered characters from the on-screen keypad or physical keyboard awaiting submission.
- **Idle_State**: The Phone_UI state with no active Engine_State and no pending Engine_Promise.
- **Idle_Message**: The exact text `Dial *266# to begin`.
- **Loading_State**: The Phone_UI state that exists while an Engine_Promise is pending.
- **Loading_Message**: The exact text `Contacting the spirits...`.
- **Recoverable_Error_State**: The Phone_UI state entered after an Engine_Promise rejects, in which the Engine_State from before the associated Engine_Transition remains active and user input is enabled.
- **Async_Failure_Message**: The exact text `Request failed. Try again.`.
- **Interactive_State**: An Idle_State, a state presenting an Engine_Screen with Screen_Type `CON`, or a Recoverable_Error_State, while neither the Loading_State nor the Ended_Pause_State is active.
- **Ended_Pause_State**: The Phone_UI state that temporarily presents an Engine_Screen whose Screen_Type is `END`.
- **Keypad**: The on-screen 3-column by 4-row grid containing keys `1` through `9`, `*`, `0`, and `#`.
- **Call_Key**: The on-screen control labeled `Call` that submits the complete Input_Buffer.
- **Clear_Key**: The on-screen control labeled `Clear` that empties the Input_Buffer.
- **Character_Key**: A Keypad key labeled with one digit, `*`, or `#`.
- **Enter_Key**: A physical keyboard key whose `KeyboardEvent.key` value is `Enter`.
- **Backspace_Key**: A physical keyboard key whose `KeyboardEvent.key` value is `Backspace`.
- **Submission_Action**: Activation of the Call_Key or Enter_Key while submission is enabled.
- **AI_Provider**: A function accepted by the Engine_Transition that receives an AI_Request and returns a string or a Promise that fulfills with a string.
- **AI_Request**: The object supplied by the USSD_Menu_Engine to an AI_Provider, containing a selected `mode` value and the complete `question` string.
- **Mock_AI_Provider**: A local, deterministic AI_Provider supplied to the Engine_Transition in place of a network-backed AI provider.
- **Network_Request**: An HTTP or other network operation that sends data from or retrieves data for the Phone_UI.
- **API_Module**: The optional network-backed AI module at `api/ask.js`, which is outside the scope of this specification.
- **Retro_Phone_Enclosure**: The unbranded visual container that groups the LCD_Display, Keypad, Call_Key, and Clear_Key as one phone.
- **Contrast_Ratio**: The relative-luminance ratio between text and its background, calculated according to the Web Content Accessibility Guidelines contrast formula.
- **Printable_Keyboard_Character**: A `KeyboardEvent.key` value representing exactly one printable Unicode character, including a letter, digit, U+0020 SPACE, punctuation mark, `*`, or `#`, and excluding named non-printable keys and Unicode control, format, surrogate, private-use, or unassigned characters.
- **Keyboard_Modifier**: Any of the Ctrl, Alt, or Meta modifier flags on a `KeyboardEvent`.
- **Input_Line_Maximum**: The maximum of 160 characters for the Input_Buffer and the displayed Input_Line.
- **Multi_Tap_Mapping**: The mapping `0 → U+0020 SPACE`, `2 → abc`, `3 → def`, `4 → ghi`, `5 → jkl`, `6 → mno`, `7 → pqrs`, `8 → tuv`, and `9 → wxyz`.
- **Pending_Multi_Tap_Character**: The final character currently shown in the Input_Buffer while a mapped digit remains eligible for cycling. The Pending_Multi_Tap_Character is part of the Input_Buffer and counts as one character toward the Input_Line_Maximum.
- **Multi_Tap_State**: The Phone_UI state containing a Pending_Multi_Tap_Character, its mapped digit, its position as the final Input_Buffer character, and the timestamp of the latest Multi_Tap_Activation.
- **Multi_Tap_Activation**: One detected activation of a mapped digit Character_Key, including each repeat activation delivered while the Character_Key is held.

## Requirements

### Requirement 1: Plain JavaScript UI Boundary

**User Story:** As a developer, I want the phone interface separated from the menu engine, so that presentation changes do not duplicate or alter engine behavior.

#### Acceptance Criteria

1. THE Phone_UI SHALL use only Plain_Web_Technologies for the user interface.
2. THE Phone_UI SHALL use zero User_Interface_Frameworks.
3. THE Entry_Page SHALL load the UI_Module_Set from `src/ui/`.
4. THE Phone_UI SHALL obtain every session transition and Engine_Screen exclusively through the Engine_Transition imported from `src/engine/ussd.js`.
5. WHEN a Submission_Action begins, THE Phone_UI SHALL invoke the Engine_Transition exactly once with the Engine_State active at the beginning of that Submission_Action, or with no active Engine_State during the Idle_State, the complete Input_Buffer value captured at that beginning, including printable-keyboard and multi-tap characters currently in the buffer and no more than 160 characters, without trimming, reordering, omitting, or replacing any character, and the Mock_AI_Provider.
6. WHEN an Engine_Result is received, THE Phone_UI SHALL replace the current Engine_State with the complete `state` value from that Engine_Result without modifying that value.
7. THE Phone_UI SHALL make zero routing, quiz, score, pagination, or Screen_Text decisions independently of the Engine_Transition.

### Requirement 2: Retro Phone Presentation

**User Story:** As a student, I want the study service presented as a retro phone, so that the interface feels recognizable and playful.

#### Acceptance Criteria

1. THE Phone_UI SHALL present exactly one Retro_Phone_Enclosure containing exactly one LCD_Display, one Keypad, one Call_Key, and one Clear_Key.
2. THE LCD_Display SHALL use a green display background and a text color with a Contrast_Ratio against the green display background of at least 4.5:1.
3. THE Phone_UI SHALL arrange exactly 12 Character_Keys in a 3-column by 4-row Keypad, ordered from left to right and top to bottom as `1 2 3`, `4 5 6`, `7 8 9`, and `* 0 #`.
4. THE Phone_UI SHALL present the Call_Key and Clear_Key within the Retro_Phone_Enclosure and outside the 12 Keypad grid positions.
5. THE Phone_UI SHALL identify the Call_Key with the visible text `Call`.
6. THE Phone_UI SHALL identify the Clear_Key with the visible text `Clear`.
7. THE Retro_Phone_Enclosure SHALL display zero product brand names, manufacturer brand names, trademarked logos, or manufacturer logos.

### Requirement 3: LCD Output and Idle State

**User Story:** As a caller, I want a clear idle prompt and readable engine output, so that I know how to begin and can follow each menu.

#### Acceptance Criteria

1. WHEN the Entry_Page finishes loading, THE Phone_UI SHALL enter the Idle_State.
2. WHEN the Entry_Page finishes loading, THE Phone_UI SHALL set the Input_Buffer to a string containing zero characters.
3. WHILE the Idle_State is active, THE Screen_Output_Region SHALL display exactly the Idle_Message.
4. WHILE the Idle_State is active, THE Input_Line SHALL display the same character sequence as the complete Input_Buffer, including when the Input_Buffer contains zero characters.
5. WHEN an Engine_Result with Screen_Type `CON` is received, THE Phone_UI SHALL replace the previous Screen_Output_Region content with exactly the complete Screen_Text.
6. WHEN Screen_Text contains a `\r\n`, lone `\n`, or lone `\r` line-break sequence, THE Screen_Output_Region SHALL render that sequence as exactly one visible line break.
7. WHEN Screen_Text contains `&`, `<`, `>`, `"`, or `'`, THE Screen_Output_Region SHALL render every character in the complete Screen_Text as literal text and SHALL neither create document markup nor execute any content from Screen_Text.
8. WHILE an Engine_Screen is displayed and the Loading_State is inactive, THE Input_Line SHALL display the same character sequence as the complete Input_Buffer, including when the Input_Buffer contains zero characters.
9. THE Phone_UI SHALL ensure that the Input_Buffer and the Input_Line contain no more than 160 characters.
10. WHEN accepting a printable character, Character_Key label, or Multi_Tap output would cause the Input_Buffer to exceed 160 characters, THE Phone_UI SHALL ignore that appended character or output and SHALL preserve the existing Input_Buffer unchanged.
11. WHILE a Pending_Multi_Tap_Character exists, THE Phone_UI SHALL count that character as one of the maximum 160 input characters and SHALL reserve its one-character position when accepting additional input.

### Requirement 4: On-Screen Input Controls

**User Story:** As a caller, I want phone-style controls, so that I can use phone-style input to respond to menus and answer prompts.

#### Acceptance Criteria

1. WHILE neither the Loading_State nor the Ended_Pause_State is active, WHEN a Character_Key is activated and `Engine_State.view.kind` is not exactly `'question'`, THE Phone_UI SHALL append exactly one copy of the Character_Key label to the end of the Input_Buffer when the resulting length is at most 160 characters; when the Input_Buffer already contains 160 characters, THE Phone_UI SHALL leave the Input_Buffer unchanged.
2. WHILE neither the Loading_State nor the Ended_Pause_State is active, WHEN a Character_Key labeled `1`, `*`, or `#` is activated and `Engine_State.view.kind` is exactly `'question'`, THE Phone_UI SHALL commit any Pending_Multi_Tap_Character and append exactly one copy of the activated Character_Key label to the end of the Input_Buffer when the resulting length is at most 160 characters; when the Input_Buffer already contains 160 characters, THE Phone_UI SHALL leave the Input_Buffer unchanged.
3. WHILE neither the Loading_State nor the Ended_Pause_State is active, WHEN a Character_Key labeled `0`, `2`, `3`, `4`, `5`, `6`, `7`, `8`, or `9` is activated, `Engine_State.view.kind` is exactly `'question'`, and no eligible Pending_Multi_Tap_Character exists, THE Phone_UI SHALL append the first character of the corresponding Multi_Tap_Mapping as the Pending_Multi_Tap_Character when the resulting Input_Buffer length is at most 160 characters; the Multi_Tap_Mapping SHALL be `0 → U+0020 SPACE`, `2 → abc`, `3 → def`, `4 → ghi`, `5 → jkl`, `6 → mno`, `7 → pqrs`, `8 → tuv`, and `9 → wxyz`; when the Input_Buffer already contains 160 characters, THE Phone_UI SHALL leave the Input_Buffer and Pending_Multi_Tap_Character unchanged.
4. WHILE neither the Loading_State nor the Ended_Pause_State is active, WHEN the same mapped digit Character_Key is activated before 800 milliseconds have elapsed since the latest Multi_Tap_Activation and an eligible Pending_Multi_Tap_Character for that digit exists, THE Phone_UI SHALL replace the final Pending_Multi_Tap_Character in the Input_Buffer with the next character in that digit's Multi_Tap_Mapping without changing the Input_Buffer length.
5. WHEN repeated Multi_Tap_Activations for one mapped digit reach the final character in that digit's Multi_Tap_Mapping, THE Phone_UI SHALL use the first character in that mapping for the next same-digit activation that occurs before 800 milliseconds have elapsed since the latest Multi_Tap_Activation.
6. WHILE neither the Loading_State nor the Ended_Pause_State is active, WHEN a different Character_Key is activated while a Pending_Multi_Tap_Character exists, THE Phone_UI SHALL commit the Pending_Multi_Tap_Character before processing the different Character_Key, and SHALL process that Character_Key using the rule for its label and the value of `Engine_State.view.kind` at that activation.
7. WHEN at least 800 milliseconds have elapsed since the latest Multi_Tap_Activation, THE Phone_UI SHALL commit the Pending_Multi_Tap_Character and SHALL clear its pending status without changing the committed Input_Buffer text.
8. WHEN a Character_Key is held and the browser or Phone_UI detects a repeat activation, THE Phone_UI SHALL treat each detected repeat as exactly one Multi_Tap_Activation and SHALL apply the same 800-millisecond timing, replacement, wraparound, commit, and 160-character maximum rules as for separate activations.
9. WHILE neither the Loading_State nor the Ended_Pause_State is active, WHEN the Clear_Key is activated, THE Phone_UI SHALL replace the Input_Buffer with an empty string, clear any Pending_Multi_Tap_Character, and perform zero Submission_Actions.
10. WHILE neither the Loading_State nor the Ended_Pause_State is active, WHEN the Call_Key is activated, THE Phone_UI SHALL perform exactly one Submission_Action.
11. WHEN a Submission_Action begins, THE Phone_UI SHALL commit any Pending_Multi_Tap_Character and submit exactly the complete Input_Buffer value that existed immediately before the Submission_Action began, preserving every character, its order, and any U+0020 SPACE characters without trimming, omitting, or replacing them.
12. WHEN a Submission_Action begins, THE Phone_UI SHALL replace the Input_Buffer with an empty string and clear any Pending_Multi_Tap_Character.

### Requirement 5: Physical Keyboard Input

**User Story:** As a keyboard user, I want common physical keys to operate the phone, so that I can use the interface without clicking every control.

#### Acceptance Criteria

1. WHILE the Interactive_State is active, WHEN a `KeyboardEvent` has a `key` value that is a Printable_Keyboard_Character and no Keyboard_Modifier is held, THE Phone_UI SHALL append exactly that `KeyboardEvent.key` value, including a letter, digit, space, punctuation mark, `*`, or `#`, to the end of the Input_Buffer after committing any Pending_Multi_Tap_Character and subject to the Input_Line_Maximum.
2. WHILE the Interactive_State is active, IF a `KeyboardEvent` has a `key` value that is a Printable_Keyboard_Character and any Ctrl, Alt, or Meta modifier flag is true, THEN THE Phone_UI SHALL make zero changes to the Input_Buffer, preserve any Pending_Multi_Tap_Character state, and leave the browser default behavior unchanged.
3. WHILE the Interactive_State is active, WHEN a `KeyboardEvent` has a `key` value equal to the Enter_Key, THE Phone_UI SHALL perform exactly one Submission_Action.
4. WHILE the Interactive_State is active and the Input_Buffer contains at least one character, WHEN a `KeyboardEvent` has a `key` value equal to the Backspace_Key, THE Phone_UI SHALL remove exactly the final character from the Input_Buffer; if a Pending_Multi_Tap_Character existed, THE Phone_UI SHALL clear that pending state, and otherwise THE Phone_UI SHALL preserve the absence of pending state.
5. WHILE the Interactive_State is active and the Input_Buffer contains zero characters, WHEN a `KeyboardEvent` has a `key` value equal to the Backspace_Key, THE Phone_UI SHALL preserve the empty Input_Buffer and perform zero Input_Buffer changes.
6. WHEN the Phone_UI handles a Printable_Keyboard_Character without a Keyboard_Modifier, Enter_Key, or Backspace_Key under criteria 1, 3, 4, or 5, THE Phone_UI SHALL cancel the browser default behavior for that key event.
7. WHEN a `KeyboardEvent` has a named unsupported key or a Printable_Keyboard_Character with a Keyboard_Modifier, THE Phone_UI SHALL perform zero Input_Buffer changes and SHALL not cancel the browser default behavior.

### Requirement 6: Synchronous and Asynchronous Engine Results

**User Story:** As a caller, I want the phone to react correctly to both immediate menu choices and delayed AI answers, so that interaction remains predictable.

#### Acceptance Criteria

1. WHEN the Engine_Transition returns an Engine_Result synchronously, THE Phone_UI SHALL present the Engine_Screen without entering the Loading_State.
2. WHEN the Engine_Transition returns an Engine_Promise, THE Phone_UI SHALL enter the Loading_State before processing fulfillment or rejection of the Engine_Promise.
3. WHILE the Engine_Promise returned by an Engine_Transition is pending, including during the Mock_AI_Provider delay of 1,100 through 1,300 milliseconds, THE Phone_UI SHALL remain in the Loading_State.
4. WHILE the Loading_State is active, THE Screen_Output_Region SHALL display exactly the Loading_Message.
5. WHILE the Loading_State is active, THE Phone_UI SHALL disable character entry.
6. WHILE the Loading_State is active, THE Phone_UI SHALL disable Submission_Actions.
7. WHEN an Engine_Promise fulfills with an Engine_Result, THE Phone_UI SHALL leave the Loading_State before presenting the resulting Engine_Screen.
8. WHILE the Engine_Promise returned by an Engine_Transition is pending, THE Phone_UI SHALL invoke the Engine_Transition zero additional times.
9. IF the Engine_Promise returned by an Engine_Transition invocation rejects, THEN THE Phone_UI SHALL leave the Loading_State and enter the Recoverable_Error_State.
10. WHEN the Phone_UI enters the Recoverable_Error_State after rejection of an Engine_Promise, THE Phone_UI SHALL preserve the Engine_State that was active immediately before the associated Engine_Transition invocation.
11. WHEN the Phone_UI enters the Recoverable_Error_State after rejection of an Engine_Promise, THE Phone_UI SHALL keep the Input_Buffer empty.
12. WHEN the Phone_UI enters the Recoverable_Error_State after rejection of an Engine_Promise, THE Screen_Output_Region SHALL display exactly the Async_Failure_Message.
13. WHILE the Recoverable_Error_State is active, THE Phone_UI SHALL enable character entry and Submission_Actions.

### Requirement 7: END Screen Pause and Idle Reset

**User Story:** As a caller, I want a completed call to show its closing message before the phone resets, so that I can read the outcome and start another call.

#### Acceptance Criteria

1. WHEN an Engine_Result with Screen_Type `END` is received, THE Phone_UI SHALL enter the Ended_Pause_State and display exactly the Screen_Text from that Engine_Result.
2. WHILE fewer than 1,500 milliseconds have elapsed since the `END` Engine_Result was presented, THE Phone_UI SHALL remain in the Ended_Pause_State and continue to display exactly the Screen_Text from that Engine_Result.
3. WHILE the Ended_Pause_State is active, THE Phone_UI SHALL disable input from the Character_Keys, Clear_Key, Printable_Keyboard_Character events, Backspace_Key, Call_Key, and Enter_Key.
4. WHILE the Ended_Pause_State is active, WHEN a Character_Key or Clear_Key is activated, a Printable_Keyboard_Character event is received, or the Backspace_Key, Call_Key, or Enter_Key is activated, THE Phone_UI SHALL preserve the Input_Buffer and any active Multi_Tap_State.
5. WHILE the Ended_Pause_State is active, WHEN a Character_Key or Clear_Key is activated, a Printable_Keyboard_Character event is received, or the Backspace_Key, Call_Key, or Enter_Key is activated, THE Phone_UI SHALL make zero Engine_Transition invocations.
6. WHEN 1,500 milliseconds have elapsed since the `END` Engine_Result was presented, THE Phone_UI SHALL enter the Idle_State.
7. WHEN the Phone_UI enters the Idle_State after the Ended_Pause_State, THE Phone_UI SHALL replace the current Engine_State with no active Engine_State.
8. WHEN the Phone_UI enters the Idle_State after the Ended_Pause_State, THE Phone_UI SHALL replace the Input_Buffer with an empty string and clear any Multi_Tap_State.
9. WHEN the Phone_UI enters the Idle_State after the Ended_Pause_State, THE Screen_Output_Region SHALL display exactly the Idle_Message.
10. WHILE the Idle_State is active, THE Phone_UI SHALL enable character entry and Submission_Actions.

### Requirement 8: Local Mock AI Provider

**User Story:** As a developer, I want a local AI substitute, so that the phone interface can be developed and tested before the real AI feature exists.

#### Acceptance Criteria

1. THE UI_Module_Set SHALL expose the Mock_AI_Provider as an AI_Provider that can be supplied to the Engine_Transition without requiring the API_Module.
2. WHEN the Mock_AI_Provider receives an AI_Request, THE Mock_AI_Provider SHALL return a Promise that fulfills with a JavaScript string after a deterministic configured delay of exactly 1,200 milliseconds; an observed elapsed delay from 1,100 through 1,300 milliseconds, inclusive, SHALL conform to this requirement.
3. WHEN the Mock_AI_Provider fulfills an AI_Request, THE answer string SHALL be deterministic and, when processed by the Engine_Transition's existing pagination behavior under the existing interactive page limit, SHALL produce at least two engine pagination pages.
4. WHEN two AI_Requests contain equal selected modes and equal complete question strings, THE Mock_AI_Provider SHALL fulfill both Promises with exactly equal string answers using the same configured 1,200-millisecond delay.
5. WHEN the Mock_AI_Provider receives an AI_Request, THE Mock_AI_Provider SHALL perform zero Network_Requests.
6. WHEN the Entry_Page finishes loading while the API_Module is absent, THE Entry_Page SHALL enter the Idle_State.
7. WHILE the API_Module is absent, WHEN an Engine_Transition requires an AI_Provider, THE Phone_UI SHALL supply the Mock_AI_Provider and complete the Engine_Transition.
