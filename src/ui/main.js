import { next } from '../engine/ussd.js';
import { createMockAIProvider } from './mock-ai.js';
import { createAudioService } from './audio.js';
import { mountPhoneUI } from './phone-ui.js';

function mount() {
  const root = document.querySelector('#app');
  if (!root) {
    return;
  }

  const mockAIProvider = createMockAIProvider();
  const audio = createAudioService();
  mountPhoneUI(root, {
    transition: next,
    aiProvider: mockAIProvider,
    audio,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
