/**
 * Diagnostic: call the Interactions API directly with an image and print only
 * STRUCTURAL information about the response — never the content itself.
 *
 * Reports: finish reason, usage/output token counts, response length, and whether
 * the text is well-formed JSON. No question text, no image bytes, no key.
 *
 * Run: npx tsx scripts/gemini/diag-image-response.mts <path-to-image>
 */
import { readFile } from 'node:fs/promises';
import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY not set');
  process.exit(1);
}

const imagePath = process.argv[2];
if (!imagePath) {
  console.error('usage: diag-image-response.mts <path-to-image>');
  process.exit(1);
}

const bytes = await readFile(imagePath);
const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const ai = new GoogleGenAI({ apiKey });

const interaction = await ai.interactions.create({
  model,
  input: [
    { type: 'text', text: 'Transcribe the math question in this image into the "extractedText" field. Return only JSON: {"extractedText": string}' },
    { type: 'image', data: bytes.toString('base64'), mime_type: 'image/png' },
  ],
  generation_config: { max_output_tokens: 4096 },
  response_format: { type: 'text', mime_type: 'application/json' },
  store: false,
} as any);

const text = (interaction as any)?.output_text ?? '';
console.log('status:', (interaction as any)?.status);
console.log('output_text type:', typeof text);
console.log('output_text length:', text.length);
console.log('ends with }:', text.trimEnd().endsWith('}'));
console.log('contains newline:', text.includes('\n'));
console.log('contains unescaped quote pair:', /"\s*"/.test(text));

try {
  const parsed = JSON.parse(text);
  console.log('JSON.parse: OK, keys =', Object.keys(parsed));
  console.log('extractedText length:', String(parsed.extractedText ?? '').length);
} catch (e) {
  console.log('JSON.parse: FAILED ->', e instanceof Error ? e.message : String(e));
  // Show ONLY the structural neighbourhood of the failure, with letters/digits
  // masked, so no content is leaked.
  const m = /position (\d+)/.exec(e instanceof Error ? e.message : '');
  if (m) {
    const pos = Number(m[1]);
    const masked = text
      .slice(Math.max(0, pos - 60), pos + 60)
      .replace(/[A-Za-z0-9]/g, 'x');
    console.log('masked neighbourhood around failure:', JSON.stringify(masked));
  }
}

// Usage / finish information, if present.
console.log('usage:', JSON.stringify((interaction as any)?.usage ?? null));
