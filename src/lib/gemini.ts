/** Direct calls to Google's Gemini API from the phone. No server in between. */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const GEMINI_MODEL = 'gemini-flash-lite-latest';

export class GeminiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

type GenerateOptions = {
  system?: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

export async function geminiGenerate(apiKey: string, options: GenerateOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);
  try {
    const response = await fetch(`${BASE}/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        ...(options.system
          ? { systemInstruction: { parts: [{ text: options.system }] } }
          : {}),
        contents: [{ role: 'user', parts: [{ text: options.user }] }],
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxTokens ?? 3072,
          ...(options.json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      let detail = raw.slice(0, 240);
      try {
        const parsed = JSON.parse(raw);
        detail = parsed?.error?.message ?? detail;
      } catch {
        /* keep the raw text */
      }
      throw new GeminiError(detail, response.status);
    }

    const data = JSON.parse(raw);
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((part: { text?: string }) => part.text ?? '').join('');
    if (!text) {
      const reason = data?.promptFeedback?.blockReason ?? 'empty response';
      throw new GeminiError(`Gemini returned nothing (${reason})`);
    }
    return text;
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    if ((error as Error).name === 'AbortError') {
      throw new GeminiError('The key is set but Gemini did not answer in time.');
    }
    throw new GeminiError('Could not reach Gemini. Check the connection and the key.');
  } finally {
    clearTimeout(timer);
  }
}

export async function testGeminiKey(apiKey: string): Promise<void> {
  const text = await geminiGenerate(apiKey, {
    user: 'Reply with the single word: ready',
    maxTokens: 20,
    temperature: 0,
    timeoutMs: 30_000,
  });
  if (!/ready/i.test(text)) {
    throw new GeminiError('The key answered, but not as expected. Try saving it again.');
  }
}

export function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new GeminiError('Gemini did not return JSON.');
  return JSON.parse(cleaned.slice(start, end + 1));
}
