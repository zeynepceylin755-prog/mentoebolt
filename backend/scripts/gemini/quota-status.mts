/**
 * Phase 6 — provider quota / rate-limit status (non-generating).
 *
 * Reports only the status code and the provider's own message for a single
 * minimal request, so the difference between "rate limited" and "misconfigured"
 * is unambiguous. Used to decide whether a paced real run can proceed.
 *
 * Run: npx tsx scripts/gemini/quota-status.mts
 */
import { getQuestionUnderstandingConfig } from '../../src/infrastructure/ai/question-understanding/config/QuestionUnderstandingConfig.js';

const cfg = getQuestionUnderstandingConfig();
const response = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
  body: JSON.stringify({
    model: cfg.model,
    max_tokens: 16,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: 'Return JSON {"ok":true}' }],
  }),
});

const text = await response.text();
let message = text.slice(0, 900).split(/\s+/).join(' ');
try {
  message = JSON.parse(text)?.error?.message ?? message;
} catch {
  /* keep the truncated slice */
}

console.log('model:', cfg.model);
console.log('status:', response.status);
console.log('provider message:', message);
