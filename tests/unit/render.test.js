import { describe, expect, it } from 'vitest';
import {
  INPUT_LINE_MAXIMUM,
  UI_COPY,
  createRenderer,
  renderInput,
  renderLifecycle,
  renderOutput,
} from '../../src/ui/render.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.disabled = false;
    this.textContent = '';
    this.innerHTMLWrites = 0;

    Object.defineProperty(this, 'innerHTML', {
      configurable: true,
      get: () => '',
      set: () => {
        this.innerHTMLWrites += 1;
        throw new Error('renderer must not assign innerHTML');
      },
    });
  }

  append(...children) {
    this.children.push(...children);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name);
  }
}

function createFixture() {
  const output = new FakeElement();
  const input = new FakeElement();
  const enclosure = new FakeElement('section');
  const characterKeys = Array.from({ length: 12 }, () => new FakeElement('button'));
  const callButton = new FakeElement('button');
  const clearButton = new FakeElement('button');
  const backButton = new FakeElement('button');
  const homeButton = new FakeElement('button');
  const muteButton = new FakeElement('button');

  return {
    output,
    input,
    enclosure,
    characterKeys,
    callButton,
    clearButton,
    backButton,
    homeButton,
    muteButton,
    renderer: createRenderer({
      lcdOutput: output,
      inputLine: input,
      lifecycleTarget: enclosure,
      enclosure,
      characterKeys,
      callButton,
      clearButton,
      backButton,
      homeButton,
      muteButton,
    }),
  };
}

function expectInputControlsDisabled(fixture, disabled) {
  for (const control of [
    ...fixture.characterKeys,
    fixture.callButton,
    fixture.clearButton,
    fixture.backButton,
    fixture.homeButton,
  ]) {
    expect(control.disabled).toBe(disabled);
    expect(control.getAttribute('aria-disabled')).toBe(String(disabled));
  }
}

describe('renderer copy and input projection', () => {
  it('renders the exact idle, loading, and recoverable-error copy', () => {
    const fixture = createFixture();

    expect(fixture.renderer.render({ lifecycle: 'idle', inputBuffer: '' })).toMatchObject({
      lifecycle: 'idle',
      screenText: UI_COPY.idle,
      inputText: '',
      disabled: false,
    });
    expect(fixture.output.textContent).toBe('Dial *266# to begin');

    fixture.renderer.render({ lifecycle: 'loading', inputBuffer: '' });
    expect(fixture.output.textContent).toBe('Contacting the spirits...');

    fixture.renderer.render({ lifecycle: 'error', inputBuffer: '' });
    expect(fixture.output.textContent).toBe('Request failed. Try again.');
  });

  it('renders complete engine screen text without changing its copy', () => {
    const fixture = createFixture();
    const screenText = 'GhostDial Main Menu\n1 Ask the Oracle\n0 Exit';

    fixture.renderer.render({
      lifecycle: 'interactive',
      screen: { type: 'CON', text: screenText },
      inputBuffer: '',
    });

    expect(fixture.output.textContent).toBe(screenText);
    expect(fixture.output.children).toHaveLength(0);
  });

  it('mirrors empty, exact, and bounded 160-code-unit input', () => {
    const fixture = createFixture();

    renderInput(fixture.input, '');
    expect(fixture.input.textContent).toBe('');

    const exactInput = '  12, *#?  ';
    renderInput(fixture.input, exactInput);
    expect(fixture.input.textContent).toBe(exactInput);

    const overLimit = `${'a'.repeat(INPUT_LINE_MAXIMUM - 1)}😀!`;
    expect(overLimit.length).toBe(INPUT_LINE_MAXIMUM + 2);
    renderInput(fixture.input, overLimit);
    expect(fixture.input.textContent).toBe(overLimit.slice(0, INPUT_LINE_MAXIMUM));
    expect(fixture.input.textContent.length).toBe(INPUT_LINE_MAXIMUM);
    expect(fixture.renderer.render({ lifecycle: 'interactive', inputBuffer: overLimit }).inputText)
      .toBe(overLimit.slice(0, INPUT_LINE_MAXIMUM));
  });

  it('projects special characters as literal text without markup or execution', () => {
    const fixture = createFixture();
    const literalText = `& < > " ' <span data-run=\"true\">markup</span><script>throw new Error('run')</script>`;

    renderOutput(fixture.output, literalText);

    expect(fixture.output.textContent).toBe(literalText);
    expect(fixture.output.children).toHaveLength(0);
    expect(fixture.output.innerHTMLWrites).toBe(0);
  });

  it.each([
    ['CRLF', 'first\r\nsecond'],
    ['LF', 'first\nsecond'],
    ['CR', 'first\rsecond'],
  ])('preserves the %s line-break sequence for pre-wrapped display', (_name, text) => {
    const fixture = createFixture();

    renderOutput(fixture.output, text);

    expect(fixture.output.textContent).toBe(text);
    expect(fixture.output.textContent).toContain(text.slice(5));
    expect(fixture.output.children).toHaveLength(0);
  });
});

describe('renderer lifecycle presentation', () => {
  it('shows loading copy and disables every session input control', () => {
    const fixture = createFixture();

    const result = fixture.renderer.render({
      lifecycle: 'loading',
      inputBuffer: 'stale input',
    });

    expect(result).toMatchObject({
      lifecycle: 'loading',
      screenText: UI_COPY.loading,
      inputText: 'stale input',
      disabled: true,
    });
    expectInputControlsDisabled(fixture, true);
    expect(fixture.muteButton.disabled).toBe(false);
    expect(fixture.enclosure.dataset.lifecycle).toBe('loading');
    expect(fixture.enclosure.getAttribute('data-lifecycle')).toBe('loading');
    expect(fixture.enclosure.getAttribute('aria-busy')).toBe('true');
    expect(fixture.enclosure.getAttribute('data-input-disabled')).toBe('true');
  });

  it('shows exact END text and disables input during the end pause', () => {
    const fixture = createFixture();
    const endText = `Goodbye & thanks.\r\n${'<'}`;

    fixture.renderer.render({
      lifecycle: 'end-pause',
      screen: { type: 'END', text: endText },
      inputBuffer: 'preserved',
    });

    expect(fixture.output.textContent).toBe(endText);
    expect(fixture.input.textContent).toBe('preserved');
    expectInputControlsDisabled(fixture, true);
    expect(fixture.enclosure.dataset.lifecycle).toBe('end-pause');
    expect(fixture.enclosure.getAttribute('aria-busy')).toBe('false');
    expect(fixture.enclosure.getAttribute('data-input-disabled')).toBe('true');
    expect(fixture.output.children).toHaveLength(0);
  });

  it('re-enables input for idle and recoverable-error presentation', () => {
    const fixture = createFixture();

    fixture.renderer.render({ lifecycle: 'error', inputBuffer: '' });
    expectInputControlsDisabled(fixture, false);
    expect(fixture.enclosure.getAttribute('aria-busy')).toBe('false');

    fixture.renderer.render({ lifecycle: 'idle', inputBuffer: '' });
    expectInputControlsDisabled(fixture, false);
    expect(fixture.output.textContent).toBe(UI_COPY.idle);
    expect(fixture.enclosure.dataset.lifecycle).toBe('idle');
  });
});
