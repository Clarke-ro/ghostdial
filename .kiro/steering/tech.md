# Tech
- Vite + plain JavaScript (ES modules). No frameworks.
- Tests: Vitest + fast-check (property-based tests).
- The AI is called ONLY from api/ask.js (a Vercel serverless function) using the GEMINI_API_KEY environment variable. Never call it from the browser or commit keys.
- The menu engine is pure functions with the AI provider passed in, so tests use a mock.
- Keep code simple and well commented. The developer is a beginner.