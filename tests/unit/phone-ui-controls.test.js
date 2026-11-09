import { describe, expect, it } from 'vitest';

import { createPhoneControls, mountPhoneControls } from '../../src/ui/controls.js';

class TestElement {
  constructor(documentRef, tagName) {
    this.ownerDocument = documentRef;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
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
      node.parentElement = this;
      this.children.push(node);
    }
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

describe('Back and Home control shell', () => {
  it('contains exactly one Back and one Home button outside the keypad', () => {
    const documentRef = new TestDocument();
    const root = documentRef.createElement('main');
    const controls = mountPhoneControls(root, { document: documentRef });

    expect(elementsWithClass(root, 'retro-phone')).toHaveLength(1);
    expect(elementsWithClass(controls.enclosure, 'back-key')).toHaveLength(1);
    expect(elementsWithClass(controls.enclosure, 'home-key')).toHaveLength(1);
    expect(controls.characterKeys).toHaveLength(12);
    expect(controls.characterKeys).not.toContain(controls.backKey);
    expect(controls.characterKeys).not.toContain(controls.homeKey);
    expect(isDescendant(controls.backKey, controls.enclosure)).toBe(true);
    expect(isDescendant(controls.homeKey, controls.enclosure)).toBe(true);
    expect(isDescendant(controls.backKey, controls.keypad)).toBe(false);
    expect(isDescendant(controls.homeKey, controls.keypad)).toBe(false);
  });

  it('normalizes Back, Home, and keypad 0 into distinct controller actions', () => {
    const documentRef = new TestDocument();
    const actions = [];
    const controls = createPhoneControls({
      document: documentRef,
      onAction: (action) => actions.push(action),
    });

    controls.backKey.click();
    controls.homeKey.click();
    controls.characterKeys.find((button) => button.textContent === '0').click();

    expect(actions).toEqual([
      { type: 'back' },
      { type: 'home' },
      { type: 'character', label: '0' },
    ]);
    expect(actions[0]).not.toEqual(actions[1]);
    expect(actions[0]).not.toEqual(actions[2]);
    expect(actions[1]).not.toEqual(actions[2]);
    expect(actions[0]).not.toHaveProperty('label');
    expect(actions[1]).not.toHaveProperty('label');
  });
});
