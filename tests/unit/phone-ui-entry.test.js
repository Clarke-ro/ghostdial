import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createPhoneControls, mountPhoneControls } from '../../src/ui/controls.js';
import { createRenderer, UI_COPY } from '../../src/ui/render.js';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
const entryPath = fileURLToPath(new URL('../../index.html', import.meta.url));
const mainPath = fileURLToPath(new URL('../../src/ui/main.js', import.meta.url));
const stylesPath = fileURLToPath(new URL('../../src/ui/styles.css', import.meta.url));
const uiDirectory = fileURLToPath(new URL('../../src/ui/', import.meta.url));

class TestElement {
  constructor(documentRef, tagName) {
    this.ownerDocument = documentRef;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.className = '';
    this.disabled = false;
    this._textContent = '';
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === 'string') {
        this._textContent += node;
        continue;
      }

      node.parentElement = this;
      this.children.push(node);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  click() {
    const event = { type: 'click', target: this, currentTarget: this };
    for (const listener of this.listeners.get('click') ?? []) {
      listener(event);
    }
  }
}

class TestDocument {
  createElement(tagName) {
    return new TestElement(this, tagName);
  }
}

function descendants(element) {
  return element.children.flatMap((child) => [child, ...descendants(child)]);
}

function elementsWithClass(element, className) {
  return descendants(element).filter((candidate) => (
    candidate.className.split(/\s+/).includes(className)
  ));
}

function elementsWithTag(element, tagName) {
  return descendants(element).filter((candidate) => candidate.tagName === tagName.toUpperCase());
}

function isDescendant(element, ancestor) {
  let current = element.parentElement;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function cssColor(css, variableName) {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escapedName}\\s*:\\s*(#[0-9a-f]{6})\\b`, 'i'));
  expect(match, `missing CSS variable ${variableName}`).not.toBeNull();
  return match[1];
}

function relativeLuminance(hexColor) {
  const channels = [0, 2, 4].map((offset) => Number.parseInt(
    hexColor.slice(offset + 1, offset + 3),
    16,
  ) / 255);

  const linear = channels.map((channel) => (
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));

  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(firstColor, secondColor) {
  const first = relativeLuminance(firstColor);
  const second = relativeLuminance(secondColor);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('entry page and phone control shell', () => {
  it('declares one plain module entry mount without API or framework bootstrapping', () => {
    const entry = readFileSync(entryPath, 'utf8');
    const mainModule = readFileSync(mainPath, 'utf8');
    const uiSources = readdirSync(uiDirectory)
      .filter((fileName) => fileName.endsWith('.js'))
      .map((fileName) => readFileSync(`${uiDirectory}/${fileName}`, 'utf8'))
      .join('\n');

    expect((entry.match(/<main\b/gi) ?? [])).toHaveLength(1);
    expect(entry).toMatch(/<main\s+id=["']app["']\s*><\/main>/i);
    expect(entry).toMatch(/<script\s+type=["']module["']\s+src=["']\/src\/ui\/main\.js["']\s*><\/script>/i);
    expect(entry).toMatch(/<title>[^<]+<\/title>/i);
    expect(mainModule).toContain("from './mock-ai.js'");
    expect(mainModule).toContain("from './audio.js'");
    expect(mainModule).toContain("from './phone-ui.js'");
    expect(uiSources).not.toMatch(/api[\\/]ask\.js|api\/ask\.js/);
    expect(uiSources).not.toMatch(/from\s+['"](?:react|vue|svelte|angular|preact|lit|jquery)['"]/i);
    expect(uiSources).not.toMatch(/api[\\/]ask\.js|api\/ask\.js/);
  });

  it('starts with the exact idle presentation and an empty input line', () => {
    const documentRef = new TestDocument();
    const root = documentRef.createElement('main');
    const controls = mountPhoneControls(root, { document: documentRef });
    const renderer = createRenderer({
      enclosure: controls.enclosure,
      lcdOutput: controls.screenOutput,
      inputLine: controls.inputLine,
      characterKeys: controls.characterKeys,
      callButton: controls.callKey,
      clearButton: controls.clearKey,
      backButton: controls.backKey,
      homeButton: controls.homeKey,
      muteButton: controls.muteKey,
    });

    const presentation = renderer.render({ lifecycle: 'idle', inputBuffer: '' });

    expect(presentation).toMatchObject({
      lifecycle: 'idle',
      screenText: UI_COPY.idle,
      inputText: '',
      disabled: false,
      muted: false,
    });
    expect(controls.screenOutput.textContent).toBe('Dial *266# to begin');
    expect(controls.inputLine.textContent).toBe('');
    expect(controls.enclosure.getAttribute('data-lifecycle')).toBe('idle');
  });

  it('contains exactly one enclosure, display, keypad, and the ordered twelve-key grid', () => {
    const documentRef = new TestDocument();
    const root = documentRef.createElement('main');
    const controls = mountPhoneControls(root, { document: documentRef });

    expect(root.children).toHaveLength(1);
    expect(elementsWithClass(root, 'retro-phone')).toHaveLength(1);
    expect(elementsWithClass(root, 'lcd-display')).toHaveLength(1);
    expect(elementsWithClass(root, 'keypad')).toHaveLength(1);
    expect(elementsWithClass(root, 'screen-output')).toHaveLength(1);
    expect(elementsWithClass(root, 'input-line')).toHaveLength(1);
    expect(elementsWithClass(root, 'keypad')[0].getAttribute('role')).toBe('group');
    expect(controls.characterKeys).toHaveLength(12);
    expect(controls.characterKeys.map((button) => button.textContent)).toEqual([
      '1', '2', '3',
      '4', '5', '6',
      '7', '8', '9',
      '*', '0', '#',
    ]);
    expect(elementsWithTag(controls.keypad, 'button')).toHaveLength(12);
    expect(controls.characterKeys.every((button) => isDescendant(button, controls.keypad))).toBe(true);
  });

  it('places Call, Clear, Back, Home, and mute inside the enclosure outside the keypad', () => {
    const documentRef = new TestDocument();
    const root = documentRef.createElement('main');
    const controls = mountPhoneControls(root, { document: documentRef });
    const outsideControls = [
      controls.callKey,
      controls.clearKey,
      controls.backKey,
      controls.homeKey,
      controls.muteKey,
    ];

    expect(elementsWithClass(root, 'phone-actions')).toHaveLength(1);
    expect(elementsWithTag(controls.phoneActions, 'button')).toHaveLength(5);
    expect(outsideControls.map((button) => button.textContent)).toEqual([
      'Call', 'Clear', 'Back', 'Home', 'Mute audio',
    ]);
    for (const button of outsideControls) {
      expect(isDescendant(button, controls.enclosure)).toBe(true);
      expect(isDescendant(button, controls.keypad)).toBe(false);
    }
    expect(controls.muteKey.getAttribute('aria-pressed')).toBe('false');
    controls.setMuteState(true);
    expect(controls.muteKey.textContent).toBe('Unmute audio');
    expect(controls.muteKey.getAttribute('aria-pressed')).toBe('true');
  });

  it('declares an accessible LCD contrast ratio of at least 4.5:1', () => {
    const styles = readFileSync(stylesPath, 'utf8');
    const background = cssColor(styles, '--lcd-background');
    const foreground = cssColor(styles, '--lcd-foreground');

    expect(contrastRatio(background, foreground)).toBeGreaterThanOrEqual(4.5);
    expect(styles).toMatch(/\.screen-output[^{]*\{[^}]*white-space:\s*pre-wrap/i);
    expect(styles).toMatch(/\.input-line[^{]*\{[^}]*white-space:\s*pre-wrap/i);
  });

  it('keeps the rendered shell free of brand names, logos, and manufacturer marks', () => {
    const documentRef = new TestDocument();
    const root = documentRef.createElement('main');
    const controls = createPhoneControls({ document: documentRef });
    root.append(controls.enclosure);
    const shellText = root.textContent;

    expect(shellText).not.toMatch(/ghostdial|apple|samsung|nokia|motorola|iphone/i);
    expect(elementsWithTag(root, 'img')).toHaveLength(0);
    expect(elementsWithTag(root, 'svg')).toHaveLength(0);
    expect(descendants(root).some((element) => (
      [...element.attributes.values()].some((value) => /logo|manufacturer|brand/i.test(value))
    ))).toBe(false);
  });
});
