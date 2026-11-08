# Requirements Document

## Introduction

GhostDial needs a deterministic menu engine for a haunted study-help phone line. The engine covers session control, study questions, quizzes, local exam tips, answer pagination, and running score tracking. Browser rendering and other user-interface behavior are outside this feature.

## Glossary

- **USSD_Menu_Engine**: The browser-independent state-transition component specified by this document.
- **Engine_Package**: The plain JavaScript ES module collection that implements the USSD_Menu_Engine.
- **Session**: The interaction period that begins with the Dial_Code and ends with an END Screen.
- **Active_Session**: A Session whose current Screen has type `CON`.
- **Ended_Session**: A Session whose current Screen has type `END`.
- **Session_State**: The complete data value that describes one Session at one transition boundary.
- **Fresh_Session_State**: A Session_State with the Main_Menu active, no quiz progress, and a Haunt_Score of zero.
- **Deep_Immutability**: Preservation of the input Session_State and every nested value reachable from the input Session_State.
- **Transition**: One evaluation of `next(state, input, aiProvider)`.
- **Transition_Result**: The public result shape `{ state, screen: { type: 'CON' | 'END', text } }`, where `state` is the output Session_State.
- **Input**: The complete user-supplied JavaScript string for one Transition.
- **Navigation_Input**: An Input containing one or more characters drawn only from digits, `*`, and `#`.
- **Free_Form_Input**: An Input that may contain any text characters accepted by a JavaScript string.
- **Control_Input**: An exact Input reserved for navigation rather than study content.
- **Dial_Code**: The exact Input `*266#`.
- **Back_Control**: The exact Control_Input `0`.
- **Home_Control**: The exact Control_Input `00`.
- **Screen**: The object `{ type: 'CON' | 'END', text }` associated with a Session_State.
- **Screen_Type**: The Screen field `type`, whose value is `CON` while awaiting Input and `END` when the Session is closed.
- **Screen_Text**: The Screen field `text`, stored separately from Screen_Type and measured by JavaScript string `length`.
- **CON_Screen**: A Screen with Screen_Type `CON` that waits for another Input.
- **END_Screen**: A Screen with Screen_Type `END` that represents an Ended_Session.
- **Main_Menu**: The top-level CON_Screen containing `1 Ask the Oracle`, `2 Quiz Me`, `3 Exam Survival`, `4 Explain Like I'm 5`, `5 My Haunt Score`, and `0 Exit`.
- **Previous_Screen**: The CON_Screen and navigation context from which the current prompt, answer sequence, tip sequence, score display, or submenu was entered.
- **Same_Screen_Context**: The Screen content and navigation state that were active immediately before an invalid Input, apart from addition of the Invalid_Choice_Message.
- **Invalid_Choice_Message**: The exact text `Invalid choice. The spirits are confused.`
- **Exit_Message**: The exact text `The line goes dead... Goodbye.`
- **Question_Prompt**: The Ask the Oracle or Explain Like I'm 5 CON_Screen that collects a study question.
- **AI_Provider**: A caller-supplied function that accepts an AI_Request and returns a Promise for answer text.
- **AI_Request**: A value containing the selected question mode and the submitted Free_Form_Input.
- **AI_Transition**: A Transition that invokes the AI_Provider.
- **Non_AI_Transition**: A Transition that does not invoke the AI_Provider.
- **Answer_Page**: One ordered Screen_Text segment produced from AI answer text, including the applicable AI control suffix.
- **Final_Answer_Page**: The last Answer_Page in an ordered sequence, including a sequence containing one Answer_Page.
- **Non_Final_Answer_Page**: An Answer_Page followed by another Answer_Page.
- **AI_Non_Final_Suffix**: The exact suffix `\n1.More 0.Back`.
- **AI_Final_Suffix**: The exact suffix `\n0.Back 00.Home`.
- **Pagination_Limit**: The maximum JavaScript string length of a returned page, with a default value of 160.
- **Quiz_Category_Menu**: The CON_Screen containing `1 Maths 2 Physics 3 Programming 4 General`.
- **Quiz_Category**: One of Maths, Physics, Programming, or General.
- **Quiz_Question**: A local question assigned to exactly one Quiz_Category.
- **Accepted_Quiz_Answer**: The first answer Input evaluated while a specific Quiz_Question is active.
- **Quiz_Round**: An ordered sequence of exactly five answered Quiz_Questions from one Quiz_Category.
- **Quiz_Feedback_Screen**: The CON_Screen shown after an Accepted_Quiz_Answer for question 1 through question 4 and ending with `1.Next 0.Back`.
- **Quiz_Result_Screen**: The CON_Screen shown after the fifth Accepted_Quiz_Answer and containing `The spirits are pleased (X/5)`, where X is the number of correct answers in the completed Quiz_Round.
- **Haunt_Score**: The integer count of Accepted_Quiz_Answers evaluated as correct in the current Session, with each Accepted_Quiz_Answer counted at most once.
- **Haunt_Score_Screen**: The CON_Screen that displays the current Haunt_Score and ends with `0.Back 00.Home`.
- **Exam_Survival_Menu**: The CON_Screen containing `1 Study plan 2 Exam-day tips 3 Beat stress`.
- **Local_Tip_Content**: Study guidance stored in the Engine_Package and available without the AI_Provider.
- **Tip_Page**: One ordered Screen_Text segment of Local_Tip_Content, including the applicable local-tip control suffix.
- **Local_Tip_Non_Final_Suffix**: The exact suffix `\n1.More 0.Back`.
- **Local_Tip_Final_Suffix**: The exact suffix `\n0.Back`.
- **Vite**: The project build and development tool.
- **Vitest**: The project test runner.
- **fast-check**: The property-based testing library used with Vitest.

## Requirements

### Requirement 1: Engine Boundary and Transition Contract

**User Story:** As a developer, I want a small deterministic engine boundary, so that menu behavior can be tested without a browser or live AI service.

#### Acceptance Criteria

1. THE Engine_Package SHALL use plain JavaScript ES modules.
2. THE Engine_Package SHALL export `next(state, input, aiProvider)` as the public Transition function.
3. THE Engine_Package SHALL expose Session_State transition behavior independently of browser and user-interface rendering code.
4. WHEN a Non_AI_Transition is evaluated, THE USSD_Menu_Engine SHALL return a Transition_Result synchronously.
5. WHEN an AI_Transition is evaluated, THE USSD_Menu_Engine SHALL return a Promise that resolves to a Transition_Result.
6. WHEN a Transition_Result is produced, THE USSD_Menu_Engine SHALL use the shape `{ state, screen: { type: 'CON' | 'END', text } }`.
7. WHEN a Screen is produced, THE USSD_Menu_Engine SHALL store Screen_Type separately from Screen_Text.
8. WHEN a Transition is evaluated, THE USSD_Menu_Engine SHALL preserve Deep_Immutability of the input Session_State.
9. WHEN identical Session_State, Input, and deterministic AI_Provider results are supplied, THE USSD_Menu_Engine SHALL produce structurally equal Transition_Result values.
10. WHEN an AI_Transition requires answer text, THE USSD_Menu_Engine SHALL obtain the answer text from the injected AI_Provider.
11. WHEN a Non_AI_Transition is evaluated, THE USSD_Menu_Engine SHALL make zero calls to the AI_Provider.
12. THE Engine_Package SHALL support test execution with Vitest and property generation with fast-check under Vite.

### Requirement 2: Session Lifecycle and Main Menu

**User Story:** As a student, I want predictable session controls, so that I can start, leave, and restart the haunted phone line.

#### Acceptance Criteria

1. WHEN the Dial_Code is received without an existing Session, THE USSD_Menu_Engine SHALL create a Fresh_Session_State and display the Main_Menu.
2. WHEN the Back_Control is received on the Main_Menu, THE USSD_Menu_Engine SHALL display an END_Screen whose Screen_Text equals the Exit_Message.
3. WHILE an Ended_Session is active, WHEN the Dial_Code is received, THE USSD_Menu_Engine SHALL replace the ended state with a Fresh_Session_State and display the Main_Menu.
4. WHILE an Ended_Session is active, WHEN an Input other than the Dial_Code is received, THE USSD_Menu_Engine SHALL preserve the complete ended Session_State and END_Screen.
5. WHEN the Home_Control is received during an Active_Session outside a Question_Prompt, THE USSD_Menu_Engine SHALL display the Main_Menu.
6. WHEN the Back_Control is received on a CON_Screen with an available Previous_Screen, THE USSD_Menu_Engine SHALL display the Previous_Screen.
7. WHEN a Fresh_Session_State is created, THE USSD_Menu_Engine SHALL discard quiz progress and Haunt_Score from every earlier Session.

### Requirement 3: Menu Input and Exact Main Menu Routing

**User Story:** As a student, I want consistent menu input and routing rules, so that every numbered menu behaves predictably.

#### Acceptance Criteria

1. WHILE a menu Screen is active, THE USSD_Menu_Engine SHALL accept Navigation_Input for menu evaluation.
2. WHILE a menu Screen is active, WHEN an Input contains a character outside digits, `*`, and `#`, THE USSD_Menu_Engine SHALL display the Invalid_Choice_Message and preserve the Same_Screen_Context.
3. WHILE a menu Screen is active, WHEN a Navigation_Input identifies neither a displayed option nor an applicable Control_Input, THE USSD_Menu_Engine SHALL display the Invalid_Choice_Message and preserve the Same_Screen_Context.
4. WHEN Main_Menu option `1` is received, THE USSD_Menu_Engine SHALL display the Ask the Oracle Question_Prompt.
5. WHEN Main_Menu option `2` is received, THE USSD_Menu_Engine SHALL display the Quiz_Category_Menu.
6. WHEN Main_Menu option `3` is received, THE USSD_Menu_Engine SHALL display the Exam_Survival_Menu.
7. WHEN Main_Menu option `4` is received, THE USSD_Menu_Engine SHALL display the Explain Like I'm 5 Question_Prompt.
8. WHEN Main_Menu option `5` is received, THE USSD_Menu_Engine SHALL display the Haunt_Score_Screen containing the current Haunt_Score.
9. WHEN the Back_Control is received on the Main_Menu, THE USSD_Menu_Engine SHALL display the END_Screen specified for Session exit.

### Requirement 4: Question Prompt Controls and AI Requests

**User Story:** As a student, I want to type natural-language questions while retaining exact navigation controls, so that asking for study help remains simple.

#### Acceptance Criteria

1. WHILE a Question_Prompt is active, THE USSD_Menu_Engine SHALL accept Free_Form_Input.
2. WHILE a Question_Prompt is active, WHEN the exact Back_Control is received, THE USSD_Menu_Engine SHALL display the Previous_Screen and make zero calls to the AI_Provider.
3. WHILE a Question_Prompt is active, WHEN the exact Home_Control is received, THE USSD_Menu_Engine SHALL display the Main_Menu and make zero calls to the AI_Provider.
4. WHILE a Question_Prompt is active, WHEN a Free_Form_Input differs from the exact Back_Control and exact Home_Control, THE USSD_Menu_Engine SHALL pass the complete unchanged Free_Form_Input to the AI_Provider as the question in one AI_Request.
5. WHEN the Ask the Oracle Question_Prompt submits an AI_Request, THE USSD_Menu_Engine SHALL identify the Ask the Oracle mode in the AI_Request.
6. WHEN the Explain Like I'm 5 Question_Prompt submits an AI_Request, THE USSD_Menu_Engine SHALL identify the Explain Like I'm 5 mode in the AI_Request.

### Requirement 5: Lossless AI Answer Pagination and Controls

**User Story:** As a student, I want long answers split into ordered pages with consistent controls, so that every answer fits the phone screen without losing content.

#### Acceptance Criteria

1. THE Engine_Package SHALL export `paginate(text, limit = 160)` with Pagination_Limit defaulting to 160.
2. WHEN `paginate(text, limit)` is called with a Pagination_Limit capable of containing an applicable control suffix, THE Engine_Package SHALL return an ordered array containing one or more non-empty Answer_Page strings.
3. WHEN `paginate(text, limit)` returns an Answer_Page, THE Engine_Package SHALL limit the complete Answer_Page length to the Pagination_Limit including the applicable control suffix.
4. WHEN `paginate(text, limit)` returns multiple Answer_Pages, THE Engine_Package SHALL append the AI_Non_Final_Suffix to every Non_Final_Answer_Page.
5. WHEN `paginate(text, limit)` returns one or more Answer_Pages, THE Engine_Package SHALL append the AI_Final_Suffix to the Final_Answer_Page.
6. WHEN the applicable suffix is removed from every Answer_Page and the remaining page content is concatenated in returned order, THE Engine_Package SHALL reconstruct the input `text` exactly.
7. WHILE a Non_Final_Answer_Page is active, WHEN option `1` is received, THE USSD_Menu_Engine SHALL display the next Answer_Page in sequence.
8. WHILE an Answer_Page is active, WHEN the exact Back_Control is received, THE USSD_Menu_Engine SHALL display the originating Question_Prompt.
9. WHILE an Answer_Page is active, WHEN the exact Home_Control is received, THE USSD_Menu_Engine SHALL display the Main_Menu.
10. WHILE a Final_Answer_Page is active, WHEN option `1` is received, THE USSD_Menu_Engine SHALL display the Invalid_Choice_Message and preserve the Same_Screen_Context.
11. WHILE an Answer_Page is active, WHEN an Input identifies neither a displayed option nor an applicable Control_Input, THE USSD_Menu_Engine SHALL display the Invalid_Choice_Message and preserve the Same_Screen_Context.

### Requirement 6: Quiz Category and Round Construction

**User Story:** As a student, I want category-based five-question quizzes, so that I can practise one subject at a time.

#### Acceptance Criteria

1. WHEN Main_Menu option `2` is received, THE USSD_Menu_Engine SHALL display the Quiz_Category_Menu before displaying a Quiz_Question.
2. WHEN Quiz_Category_Menu option `1` is received, THE USSD_Menu_Engine SHALL begin a Maths Quiz_Round.
3. WHEN Quiz_Category_Menu option `2` is received, THE USSD_Menu_Engine SHALL begin a Physics Quiz_Round.
4. WHEN Quiz_Category_Menu option `3` is received, THE USSD_Menu_Engine SHALL begin a Programming Quiz_Round.
5. WHEN Quiz_Category_Menu option `4` is received, THE USSD_Menu_Engine SHALL begin a General Quiz_Round.
6. WHEN a Quiz_Round begins, THE USSD_Menu_Engine SHALL set the current question number to 1.
7. WHEN a Quiz_Round begins, THE USSD_Menu_Engine SHALL set the current round correct-answer count to 0.
8. WHILE a Quiz_Round is active, THE USSD_Menu_Engine SHALL select Quiz_Questions only from the chosen Quiz_Category.
9. THE USSD_Menu_Engine SHALL limit each Quiz_Round to exactly five Accepted_Quiz_Answers.
10. WHILE a Quiz_Round is active, THE USSD_Menu_Engine SHALL keep the current question number within the inclusive integer range 1 through 5.
11. WHILE a Quiz_Round is active, THE USSD_Menu_Engine SHALL keep the current round correct-answer count within the inclusive integer range 0 through the number of Accepted_Quiz_Answers in the Quiz_Round.
12. WHEN a repeated Quiz_Round begins, THE USSD_Menu_Engine SHALL preserve the previously chosen Quiz_Category.

### Requirement 7: Quiz Feedback and Round Completion

**User Story:** As a student, I want feedback between quiz questions and a clear result after question five, so that I can review each answer before continuing.

#### Acceptance Criteria

1. WHEN an Accepted_Quiz_Answer for Quiz_Question 1 through Quiz_Question 4 is received, THE USSD_Menu_Engine SHALL display a Quiz_Feedback_Screen before displaying another Quiz_Question.
2. WHEN a correct Accepted_Quiz_Answer is received, THE USSD_Menu_Engine SHALL identify the answer as correct on the Quiz_Feedback_Screen.
3. WHEN an incorrect Accepted_Quiz_Answer is received, THE USSD_Menu_Engine SHALL identify the answer as incorrect and display the correct answer on the Quiz_Feedback_Screen.
4. WHILE a Quiz_Feedback_Screen is active, WHEN option `1` is received, THE USSD_Menu_Engine SHALL display the next numbered Quiz_Question in the active Quiz_Round.
5. WHILE a Quiz_Feedback_Screen is active, WHEN an Input other than option `1` or the Back_Control is received, THE USSD_Menu_Engine SHALL display the Invalid_Choice_Message and preserve the Same_Screen_Context.
6. WHEN an Accepted_Quiz_Answer for Quiz_Question 5 is received, THE USSD_Menu_Engine SHALL display a Quiz_Result_Screen instead of a Quiz_Feedback_Screen.
7. WHEN a Quiz_Result_Screen is displayed, THE USSD_Menu_Engine SHALL substitute X with an integer in the inclusive range 0 through 5 equal to the completed Quiz_Round correct-answer count.
8. THE Quiz_Result_Screen SHALL end exactly with `1.Again 0.Back`.
9. WHILE a Quiz_Result_Screen is active, WHEN option `1` is received, THE USSD_Menu_Engine SHALL begin another Quiz_Round in the same Quiz_Category.
10. WHILE a Quiz_Result_Screen is active, WHEN the exact Back_Control is received, THE USSD_Menu_Engine SHALL display the Quiz_Category_Menu.
11. WHILE a Quiz_Feedback_Screen or Quiz_Result_Screen is active, WHEN an Input is received, THE USSD_Menu_Engine SHALL preserve the recorded correctness of every previously accepted answer.

### Requirement 8: Running Haunt Score and Score Screen

**User Story:** As a student, I want a running session score with predictable navigation, so that I can track correct answers across repeated quiz rounds.

#### Acceptance Criteria

1. WHEN a Fresh_Session_State is created, THE USSD_Menu_Engine SHALL set the Haunt_Score to integer 0.
2. WHEN a correct Accepted_Quiz_Answer is received, THE USSD_Menu_Engine SHALL increase the Haunt_Score by exactly 1 once for that Accepted_Quiz_Answer.
3. WHEN an incorrect Accepted_Quiz_Answer is received, THE USSD_Menu_Engine SHALL preserve the Haunt_Score.
4. WHILE a Quiz_Feedback_Screen or Quiz_Result_Screen is active, WHEN an Input is received, THE USSD_Menu_Engine SHALL preserve the Haunt_Score recorded before that Input.
5. WHEN a new Quiz_Round begins in any Quiz_Category, THE USSD_Menu_Engine SHALL preserve the Haunt_Score accumulated earlier in the Session.
6. WHILE an Active_Session exists, THE USSD_Menu_Engine SHALL keep the Haunt_Score equal to the integer count of correct Accepted_Quiz_Answers in the Session.
7. WHILE an Active_Session exists, THE USSD_Menu_Engine SHALL keep the Haunt_Score within the inclusive integer range 0 through the number of Accepted_Quiz_Answers in the Session.
8. WHEN the Haunt_Score_Screen is displayed, THE USSD_Menu_Engine SHALL include the current Haunt_Score in the Screen_Text.
9. THE Haunt_Score_Screen SHALL end exactly with `0.Back 00.Home`.
10. WHILE the Haunt_Score_Screen is active, WHEN the exact Back_Control is received, THE USSD_Menu_Engine SHALL display the Previous_Screen.
11. WHILE the Haunt_Score_Screen is active, WHEN the exact Home_Control is received, THE USSD_Menu_Engine SHALL display the Main_Menu.
12. WHILE the Haunt_Score_Screen entered from the Main_Menu is active, WHEN the exact Back_Control is received, THE USSD_Menu_Engine SHALL display the Main_Menu.
13. WHILE the Haunt_Score_Screen is active, WHEN an Input differs from the exact Back_Control and exact Home_Control, THE USSD_Menu_Engine SHALL display the Invalid_Choice_Message and preserve the Same_Screen_Context.

### Requirement 9: Exam Survival Local Tips

**User Story:** As a student without data access, I want local exam guidance, so that Exam Survival works without an AI service.

#### Acceptance Criteria

1. WHEN Main_Menu option `3` is received, THE USSD_Menu_Engine SHALL display the Exam_Survival_Menu and make zero calls to the AI_Provider.
2. WHEN Exam_Survival_Menu option `1` is received, THE USSD_Menu_Engine SHALL display Study plan Local_Tip_Content and make zero calls to the AI_Provider.
3. WHEN Exam_Survival_Menu option `2` is received, THE USSD_Menu_Engine SHALL display Exam-day tips Local_Tip_Content and make zero calls to the AI_Provider.
4. WHEN Exam_Survival_Menu option `3` is received, THE USSD_Menu_Engine SHALL display Beat stress Local_Tip_Content and make zero calls to the AI_Provider.
5. WHEN Local_Tip_Content exceeds one Tip_Page, THE USSD_Menu_Engine SHALL divide the Local_Tip_Content into an ordered sequence of Tip_Pages.
6. WHEN Local_Tip_Content produces a Tip_Page, THE USSD_Menu_Engine SHALL limit the complete Tip_Page length to 160 including the applicable local-tip control suffix.
7. WHEN Local_Tip_Content requires multiple Tip_Pages, THE USSD_Menu_Engine SHALL append the Local_Tip_Non_Final_Suffix to every non-final Tip_Page.
8. WHEN Local_Tip_Content produces one or more Tip_Pages, THE USSD_Menu_Engine SHALL append the Local_Tip_Final_Suffix to the final Tip_Page.
9. WHEN the applicable suffix is removed from every Tip_Page and the remaining page content is concatenated in displayed order, THE USSD_Menu_Engine SHALL reconstruct the Local_Tip_Content exactly.
10. WHILE a non-final Tip_Page is active, WHEN option `1` is received, THE USSD_Menu_Engine SHALL display the next Tip_Page in sequence.
11. WHILE a Tip_Page is active, WHEN the exact Back_Control is received, THE USSD_Menu_Engine SHALL display the Exam_Survival_Menu.

### Requirement 10: Screen Limits and Product Language

**User Story:** As a student using a phone-style menu, I want compact and recognizable screens, so that the study line remains readable and consistent.

#### Acceptance Criteria

1. WHEN a Screen is produced, THE USSD_Menu_Engine SHALL limit the complete Screen_Text to 160 JavaScript string characters or fewer.
2. WHEN a Screen expects another Input, THE USSD_Menu_Engine SHALL set Screen_Type to `CON`.
3. WHEN a Screen closes a Session, THE USSD_Menu_Engine SHALL set Screen_Type to `END`.
4. THE Main_Menu SHALL contain the options `1 Ask the Oracle`, `2 Quiz Me`, `3 Exam Survival`, `4 Explain Like I'm 5`, `5 My Haunt Score`, and `0 Exit`.
5. THE USSD_Menu_Engine SHALL use friendly haunted-phone wording written in plain, simple English for user-facing study and navigation text.
6. WHEN an invalid menu choice is received, THE USSD_Menu_Engine SHALL include the Invalid_Choice_Message in the resulting Screen_Text.
7. WHEN the Back_Control is received on the Main_Menu, THE USSD_Menu_Engine SHALL set Screen_Type to `END` and Screen_Text to the Exit_Message.

## Correctness Properties

### Property 1: Public Contract, Deep Immutability, and Determinism

For every generated Session_State and Input, `next(state, input, aiProvider)` preserves the input Session_State and every nested value. A Non_AI_Transition returns `{ state, screen: { type, text } }` synchronously with zero AI_Provider calls. An AI_Transition returns a Promise resolving to the same shape and obtains answer text only from the injected AI_Provider. Repeated transitions with equal inputs and deterministic provider results produce structurally equal Transition_Result values without browser or user-interface dependencies.

**Covers:** Requirement 1, Acceptance Criteria 1-12.

### Property 2: Exact Session Start and Restart Isolation

For every absent or ended Session_State and generated Input, exact Dial_Code `*266#` creates a Fresh_Session_State showing Main_Menu. Every other Input against an Ended_Session preserves the complete ended state and Screen. Every new or restarted Session has Haunt_Score 0 and no quiz progress from an earlier Session.

**Covers:** Requirement 2, Acceptance Criteria 1-4 and 7; Requirement 8, Acceptance Criterion 1.

### Property 3: Menu Input Alphabet and Invalid-Choice Stability

For every active menu and generated string, strings containing only digits, `*`, and `#` enter menu evaluation. Strings containing another character produce the Invalid_Choice_Message and preserve the same menu navigation context. Navigation_Input values absent from displayed options and applicable controls produce the same result.

**Covers:** Requirement 3, Acceptance Criteria 1-3; Requirement 10, Acceptance Criterion 6.

### Property 4: Exact Main Menu Routing

For each exact Main_Menu option from `1` through `5`, the resulting Screen is respectively the Ask the Oracle Question_Prompt, Quiz_Category_Menu, Exam_Survival_Menu, Explain Like I'm 5 Question_Prompt, or Haunt_Score_Screen containing the current running Haunt_Score. Exact Back_Control `0` produces Screen_Type `END` and Screen_Text equal to the Exit_Message.

**Covers:** Requirement 2, Acceptance Criterion 2; Requirement 3, Acceptance Criteria 4-9; Requirement 10, Acceptance Criteria 4 and 7.

### Property 5: Question Prompt Control Precedence

For either Question_Prompt, exact Input `0` performs Back_Control behavior and exact Input `00` performs Home_Control behavior with zero AI_Provider calls. Every other generated JavaScript string, including strings containing `0` or `00` as a non-exact substring, is passed unchanged as the question in exactly one mode-correct AI_Request.

**Covers:** Requirement 4, Acceptance Criteria 1-6.

### Property 6: Lossless Ordered AI Pagination

For every generated JavaScript string and Pagination_Limit capable of containing the applicable suffix, `paginate(text, limit)` returns one or more non-empty pages in order. Every page length is at most the supplied limit including controls. Every Non_Final_Answer_Page ends with `1.More 0.Back`, every Final_Answer_Page ends with `0.Back 00.Home`, and removing the applicable suffixes before concatenating page content in order reconstructs the input text exactly.

**Covers:** Requirement 5, Acceptance Criteria 1-6; Requirement 10, Acceptance Criterion 1.

### Property 7: AI Page-Control Semantics

For every one-page or multi-page AI answer, exact Home_Control `00` returns from every Answer_Page to Main_Menu, including every Non_Final_Answer_Page. Exact Back_Control `0` returns from every Answer_Page to the originating Question_Prompt. Option `1` advances exactly one page only from a Non_Final_Answer_Page. Unsupported Inputs preserve the current answer-page context and display the Invalid_Choice_Message.

**Covers:** Requirement 5, Acceptance Criteria 7-11.

### Property 8: Quiz Category Preservation and Five-Question Bounds

For every selected Quiz_Category and every reachable Quiz_Round state, all Quiz_Questions belong to the selected Quiz_Category. The question number remains an integer from 1 through 5, and the round correct-answer count remains an integer from 0 through the number of Accepted_Quiz_Answers. Every new round starts at question 1 with round count 0, every completed round has exactly five Accepted_Quiz_Answers, and every repeated round retains the same Quiz_Category.

**Covers:** Requirement 6, Acceptance Criteria 1-12; Requirement 7, Acceptance Criterion 9.

### Property 9: Quiz Feedback Gates Progress

For each Accepted_Quiz_Answer to questions 1 through 4, the next state is a Quiz_Feedback_Screen ending with `1.Next 0.Back`. No next Quiz_Question appears until option `1` is received. Invalid feedback input preserves the feedback context and recorded answer correctness. Correct and incorrect answers produce corresponding feedback, with the correct answer included after an incorrect answer.

**Covers:** Requirement 7, Acceptance Criteria 1-5 and 11.

### Property 10: Quiz Completion and Repeat Semantics

For every sequence of five Accepted_Quiz_Answers, question 5 produces a Quiz_Result_Screen ending with `1.Again 0.Back`. Result text contains `The spirits are pleased (X/5)` with X equal to the completed round correct-answer count from 0 through 5. Option `1` starts another five-question round in the same Quiz_Category, and exact Back_Control `0` returns to Quiz_Category_Menu.

**Covers:** Requirement 7, Acceptance Criteria 6-11.

### Property 11: Integer Session Score and Duplicate Prevention

For every generated sequence of quiz answers and navigation Inputs in one Session, Haunt_Score equals the integer count of correct Accepted_Quiz_Answers. Each correct Accepted_Quiz_Answer increases Haunt_Score exactly once, each incorrect Accepted_Quiz_Answer preserves Haunt_Score, and Inputs on Quiz_Feedback_Screen or Quiz_Result_Screen cannot count a previously accepted answer again. Starting another round preserves the running Haunt_Score.

**Covers:** Requirement 8, Acceptance Criteria 1-7; Requirement 7, Acceptance Criterion 11.

### Property 12: Haunt Score Display and Controls

For every Active_Session, Main_Menu option `5` displays a Haunt_Score_Screen containing the current running session Haunt_Score and ending exactly with `0.Back 00.Home`. Exact Back_Control `0` returns one level to Previous_Screen, which is Main_Menu when the score screen was entered from Main_Menu. Exact Home_Control `00` returns to Main_Menu. Every other Input preserves the score-screen context and displays the Invalid_Choice_Message.

**Covers:** Requirement 3, Acceptance Criterion 8; Requirement 8, Acceptance Criteria 8-13.

### Property 13: Exact Local Exam Tips Without AI

For exact Exam_Survival_Menu selections `1`, `2`, and `3`, the engine returns Study plan, Exam-day tips, and Beat stress Local_Tip_Content respectively with zero AI_Provider calls. Tip_Pages preserve content and order, remain at most 160 characters including controls, use `1.More 0.Back` only on non-final pages, use `0.Back` on single and final pages, advance one page for option `1`, and return to Exam_Survival_Menu for exact Back_Control `0`.

**Covers:** Requirement 9, Acceptance Criteria 1-11; Requirement 10, Acceptance Criterion 1.

### Property 14: Universal Screen Protocol

For every reachable Session_State, Screen_Type is stored separately from Screen_Text, Screen_Text length is at most 160 JavaScript string characters, Screens awaiting Input use Screen_Type `CON`, and closed Sessions use Screen_Type `END`. Main_Menu and exit output retain the specified options and exact Exit_Message, while other user-facing wording remains friendly, haunted-phone themed, plain, and simple without requiring a fixed keyword on each Screen.

**Covers:** Requirement 1, Acceptance Criterion 7; Requirement 10, Acceptance Criteria 1-7.
