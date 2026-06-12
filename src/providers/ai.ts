import OpenAI from 'openai';
import { SYSTEM_ANALYST } from '../prompts.js';

// ─── AI provider router ───────────────────────────────────────────────────────
// Primary: Groq (LLaMA 3.3-70B) — fastest inference via LPU hardware
// Fallback: NVIDIA NIM (Mistral/Nemotron) — when Groq is rate-limited
// Both use the OpenAI-compatible API format.

const groqKey = process.env.GROQ_API_KEY ?? '';
const nvidiaKey = process.env.NVIDIA_API_KEY ?? '';
const groqModel = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
const nvidiaModel = process.env.NVIDIA_MODEL ?? 'mistralai/mistral-7b-instruct-v0.3';

// Lazy-init clients only if keys are present
let groqClient: OpenAI | null = null;
let nvidiaClient: OpenAI | null = null;

function getGroqClient(): OpenAI {
  if (!groqKey) throw new Error('GROQ_API_KEY not set. Get a free key at console.groq.com');
  if (!groqClient) {
    groqClient = new OpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey: groqKey });
  }
  return groqClient;
}

function getNvidiaClient(): OpenAI {
  if (!nvidiaKey) throw new Error('NVIDIA_API_KEY not set. Get a free key at build.nvidia.com');
  if (!nvidiaClient) {
    nvidiaClient = new OpenAI({ baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: nvidiaKey });
  }
  return nvidiaClient;
}

// ─── Core AI call with Groq → NVIDIA fallback ────────────────────────────────

export async function callAI(userPrompt: string): Promise<{ result: string; model: string }> {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_ANALYST },
    { role: 'user', content: userPrompt },
  ];

  // Try Groq first
  if (groqKey) {
    try {
      const completion = await getGroqClient().chat.completions.create({
        model: groqModel,
        messages,
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
      });
      const result = completion.choices[0]?.message?.content ?? '{}';
      return { result, model: `Groq/${groqModel}` };
    } catch (err) {
      const msg = (err as Error).message ?? '';
      const isRateLimit = msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit');
      if (!isRateLimit || !nvidiaKey) {
        console.error('[AI] Groq error:', msg);
        if (!nvidiaKey) throw err;
      }
      console.error('[AI] Groq rate limited, falling back to NVIDIA NIM');
    }
  }

  // NVIDIA NIM fallback
  if (nvidiaKey) {
    try {
      const completion = await getNvidiaClient().chat.completions.create({
        model: nvidiaModel,
        messages,
        temperature: 0.1,
        max_tokens: 1024,
      });
      const result = completion.choices[0]?.message?.content ?? '{}';
      return { result, model: `NVIDIA NIM/${nvidiaModel}` };
    } catch (err) {
      console.error('[AI] NVIDIA NIM error:', (err as Error).message);
      throw err;
    }
  }

  throw new Error('No AI provider configured. Set GROQ_API_KEY and/or NVIDIA_API_KEY in your .env file.');
}

// ─── Parse AI JSON response safely ───────────────────────────────────────────

export function parseAIJson<T>(raw: string, fallback: T): T {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    console.error('[AI] Failed to parse JSON response:', raw.slice(0, 200));
    return fallback;
  }
}

// ─── AI available check ───────────────────────────────────────────────────────

export function isAIAvailable(): boolean {
  return !!(groqKey || nvidiaKey);
}

export function getAIStatus(): string {
  const engines = [];
  if (groqKey) engines.push(`Groq (${groqModel})`);
  if (nvidiaKey) engines.push(`NVIDIA NIM (${nvidiaModel})`);
  return engines.length > 0 ? `Available: ${engines.join(' → ')}` : 'No AI keys configured';
}
