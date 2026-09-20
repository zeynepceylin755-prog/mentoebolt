/**
 * Phase 6 — model-name probe.
 *
 * Distinguishes "model name is wrong" (404) from "key is not entitled" (401/403)
 * using NON-GENERATING HTTP methods only (GET on the retrieval endpoints, and a
 * POST with an empty body). No prompt is ever sent and no completion is
 * generated, so this probe cannot consume the 3 real-generation-call budget.
 *
 * The API key is loaded from the application's own configuration getter and is
 * never printed. Only status codes and model-name verdicts are reported.
 *
 * Run: npx tsx scripts/gemini/probe-models.mts
 */
import { getQuestionUnderstandingConfig } from '../../src/infrastructure/ai/question-understanding/config/QuestionUnderstandingConfig.js';

const cfg = getQuestionUnderstandingConfig();
if (!cfg.apiKey || cfg.apiKey.trim().length === 0) {
  console.error('BLOCKED: OPENAI_API_KEY is NOT_CONFIGURED');
  process.exit(1);
}

const base = cfg.baseUrl.replace(/\/+$/, '');
const headers = { Authorization: `Bearer ${cfg.apiKey}` };

const CANDIDATES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'gemini-3.7-flash',
      'gemini-3.5-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-flash-latest',
    ];

async function status(method: string, url: string, body?: string): Promise<number> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body,
      signal: AbortSignal.timeout(15000),
    });
    return res.status;
  } catch {
    return -1;
  }
}

console.log('base:', base);
console.log('credential check (GET /models):', await status('GET', `${base}/models`));

/**
 * Reproduce the provider's exact request shape and surface the provider's own
 * error message. The provider never exposes it, so without this the reason for a
 * 4xx (retired model, missing entitlement) is invisible. Sentinels are used as
 * message text; the body is truncated and contains no student data.
 */
async function shapeProbe(model: string): Promise<void> {
  const body = JSON.stringify({
    model,
    temperature: 0,
    max_tokens: 256,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Return ONLY valid JSON: {"ok": true}' },
      { role: 'user', content: 'reply' },
    ],
  });
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body,
  });
  const text = await res.text();
  let envelope: any;
  try {
    envelope = JSON.parse(text);
  } catch {
    console.log(`shape probe ${model} -> ${res.status} :: non-JSON envelope`);
    return;
  }
  const choice = envelope?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;
  console.log(
    `shape probe ${model} -> ${res.status} :: envelopeKeys=[${Object.keys(envelope).join(',')}]` +
      ` choiceKeys=[${choice ? Object.keys(choice).join(',') : 'none'}]` +
      ` messageKeys=[${message ? Object.keys(message).join(',') : 'none'}]` +
      ` contentType=${typeof content}` +
      ` contentLength=${typeof content === 'string' ? content.length : 'n/a'}` +
      (message && typeof message.reasoning_content === 'string'
        ? ` reasoningContentLength=${message.reasoning_content.length}`
        : '') +
      (message && message.refusal ? ' HAS_REFUSAL' : '')
  );
}

await shapeProbe(cfg.model);

async function explain(model: string): Promise<void> {
  const body = JSON.stringify({
    model,
    temperature: 0,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'x' },
      { role: 'user', content: 'x' },
    ],
  });
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body,
  });
  const text = await res.text();
  let message = text.slice(0, 300).split(/\s+/).join(' ');
  try {
    message = JSON.parse(text)?.error?.message ?? message;
  } catch {
    /* keep the truncated raw slice */
  }
  console.log(`provider-shape POST ${model} -> ${res.status} :: ${message}`);
}

await explain(cfg.model);
console.log('');

for (const model of CANDIDATES) {
  const emptyBody = JSON.stringify({ model, messages: [] });
  const code = await status('POST', `${base}/chat/completions`, emptyBody);
  const verdict =
    code === 404
      ? 'MODEL_NOT_FOUND'
      : code === 401 || code === 403
        ? 'KEY_NOT_ENTITLED'
        : code === 400
          ? 'MODEL_EXISTS (rejected only for empty messages)'
          : code === 429
            ? 'RATE_LIMITED (model exists)'
            : code === 503
              ? 'MODEL_OVERLOADED (model exists)'
              : `status ${code}`;
  console.log(`${model.padEnd(24)} POST -> ${String(code).padEnd(4)} ${verdict}`);
}
