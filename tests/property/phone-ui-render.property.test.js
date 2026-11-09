import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { mountPhoneUI } from '../../src/ui/phone-ui.js';
import { createRenderer } from '../../src/ui/render.js';

class StrictElement {
  constructor(documentRef, tagName = 'div') {
    this.ownerDocument = documentRef;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.disabled = false;
    this._textContent = '';
    this.unsafeMarkupWrites = 0;

    Object.defineProperty(this, 'innerHTML', {
      configurable: true,
      get: () => '',
      set: () => {
        this.unsafeMarkupWrites += 1;
        documentRef.executionAttempts += 1;
        throw new Error('screen text must never be assigned as HTML');
      },
    });
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  insertAdjacentHTML() {
    this.unsafeMarkupWrites += 1;
    this.ownerDocument.executionAttempts += 1;
    throw new Error('screen text must never be inserted as HTML');
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((item) => item !== listener));
  }
}

class StrictDocument {
  constructor() {
    this.createdElements = [];
    this.executionAttempts = 0;
    this.listeners = new Map();
  }

  createElement(tagName) {
    const element = new StrictElement(this, tagName);
    this.createdElements.push(element);
    return element;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(type, listeners.filter((item) => item !== listener));
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
    Object.freeze(value);
  }

  return value;
}

function expectExactStateAdoption(actual, returnedState) {
  if (returnedState !== null && typeof returnedState === 'object') {
    expect(actual).toBe(returnedState);
    return;
  }

  expect(Object.is(actual, returnedState)).toBe(true);
}

const codeUnitString = (maxLength) => fc
  .array(fc.integer({ min: 0, max: 0xffff }), { maxLength })
  .map((codeUnits) => String.fromCharCode(...codeUnits));

const markupLikeText = fc.constantFrom(
  `& < > " '`,
  `<script>globalThis.__ghostDialRenderExecuted=true</script>`,
  `<img src="missing" onerror='globalThis.__ghostDialRenderExecuted=true'>`,
  `<strong title="spirits & study">'literal text'</strong>`,
);

const screenTextArbitrary = fc
  .tuple(
    codeUnitString(20),
    fc.constantFrom('\r\n', '\n', '\r'),
    markupLikeText,
    codeUnitString(20),
  )
  .map(([before, lineBreak, markup, after]) => `${before}${lineBreak}${markup}${after}`);

const inputBufferArbitrary = codeUnitString(160);
const screenTypeArbitrary = fc.constantFrom('CON', 'END');

describe('Phone UI result rendering properties', () => {
  it('Feature: phone-ui, Property 5: Result State Adoption and Safe Text Projection', () => {
    // **Validates: Requirements 1.6, 3.4, 3.5, 3.7, 3.8**
    fc.assert(
      fc.property(
        fc.jsonValue(),
        screenTypeArbitrary,
        screenTextArbitrary,
        inputBufferArbitrary,
        (generatedState, screenType, screenText, inputBuffer) => {
          const stateBeforeAdoption = structuredClone(generatedState);
          const returnedState = deepFreeze(generatedState);
          const returnedScreen = Object.freeze({ type: screenType, text: screenText });
          const result = Object.freeze({ state: returnedState, screen: returnedScreen });
          const documentRef = new StrictDocument();
          const root = documentRef.createElement('main');
          const controller = mountPhoneUI(root, {
            transition: () => result,
            aiProvider: () => '',
            setTimeoutFn: () => 1,
            clearTimeoutFn: () => {},
          });

          try {
            const elementCountBeforeResult = documentRef.createdElements.length;

            expect(controller.dispatch({ type: 'call' })).toBe(true);

            const snapshot = controller.getSnapshot();
            expectExactStateAdoption(snapshot.engineState, returnedState);
            expect(snapshot.engineState).toEqual(stateBeforeAdoption);
            expect(snapshot.screen).toBe(returnedScreen);
            expect(snapshot.lifecycle).toBe(screenType === 'END' ? 'end-pause' : 'interactive');
            expect(controller.controls.screenOutput.textContent).toBe(screenText);
            expect(controller.controls.screenOutput.children).toHaveLength(0);
            expect(controller.controls.screenOutput.unsafeMarkupWrites).toBe(0);
            expect(documentRef.executionAttempts).toBe(0);
            expect(documentRef.createdElements).toHaveLength(elementCountBeforeResult);

            // Exercise the renderer with an arbitrary valid current buffer. The
            // projection must preserve every code unit and use only text sinks,
            // regardless of whether the associated engine screen is CON or END.
            const projectedOutput = new StrictElement(documentRef);
            const projectedInput = new StrictElement(documentRef);
            const renderer = createRenderer({
              lcdOutput: projectedOutput,
              inputLine: projectedInput,
            });

            const projection = renderer.render({
              lifecycle: screenType === 'END' ? 'end-pause' : 'interactive',
              screen: returnedScreen,
              inputBuffer,
            });

            expect(projection.screenText).toBe(screenText);
            expect(projection.inputText).toBe(inputBuffer);
            expect(projectedOutput.textContent).toBe(screenText);
            expect(projectedInput.textContent).toBe(inputBuffer);
            expect(projectedOutput.children).toHaveLength(0);
            expect(projectedInput.children).toHaveLength(0);
            expect(projectedOutput.unsafeMarkupWrites).toBe(0);
            expect(projectedInput.unsafeMarkupWrites).toBe(0);
            expect(documentRef.executionAttempts).toBe(0);
          } finally {
            controller.destroy();
          }
        },
      ),
      {
        numRuns: 150,
        examples: [
          [
            { view: { kind: 'main' }, nested: { score: 0 } },
            'CON',
            `first\r\n& < > " ' <script>globalThis.__ghostDialRenderExecuted=true</script>`,
            `  arbitrary *# input  `,
          ],
          [
            ['complete', { nested: true }],
            'END',
            `<img src="missing" onerror='globalThis.__ghostDialRenderExecuted=true'>\rlast`,
            '',
          ],
        ],
      },
    );
  });
});
