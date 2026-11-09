import { next } from '../engine/ussd.js';
import { createMockAIProvider } from './mock-ai.js';
import { createRealAIProvider } from './real-ai.js';
import { createAudioService } from './audio.js';
import { mountPhoneUI } from './phone-ui.js';

/**
 * Choose an AI provider without calling it or starting network work.
 *
 * URLSearchParams.get reads the first matching value, so only the exact first
 * `mock=1` query parameter enables the production mock override.
 */
export function selectAIProvider({
  isProduction,
  search,
  realProvider,
  mockProvider,
}) {
  const params = new URLSearchParams(search);
  if (params.get('mock') === '1') return mockProvider;
  if (params.get('real') === '1') return realProvider;
  return isProduction ? realProvider : mockProvider;
}

function mount() {
  const root = document.querySelector('#app');
  if (!root) {
    return;
  }

  const mockAIProvider = createMockAIProvider();
  const realAIProvider = createRealAIProvider();
  const aiProvider = selectAIProvider({
    isProduction: import.meta.env.PROD,
    search: globalThis.location?.search ?? '',
    realProvider: realAIProvider,
    mockProvider: mockAIProvider,
  });
  const audio = createAudioService();
  mountPhoneUI(root, {
    transition: next,
    aiProvider,
    audio,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
