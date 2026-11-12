// Stand-ins for Azure services so the acceptance criteria can run offline.
import type { FeatureFlags, LlmClient, OcrClient, ParsedReceipt, Telemetry } from "../src/types.js";

export function jpeg(size = 1024): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
}

export function png(size = 1024): Uint8Array {
  const b = new Uint8Array(size);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return b;
}

export function pdf(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.7\n% fake receipt\n");
}

export function fakeOcr(result: ParsedReceipt | Error) {
  const calls: Uint8Array[] = [];
  const client: OcrClient = {
    async analyse(image) {
      calls.push(image);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { client, calls };
}

type LlmBehaviour =
  | { reply: string }
  | { status: number }
  | { delayMs: number; reply: string };

export function fakeLlm(behaviour: LlmBehaviour) {
  const prompts: { system: string; user: string }[] = [];
  const client: LlmClient = {
    complete(prompt, { signal }) {
      prompts.push(prompt);
      if ("status" in behaviour) {
        return Promise.reject(Object.assign(new Error(`Azure OpenAI ${behaviour.status}`), { status: behaviour.status }));
      }
      if ("delayMs" in behaviour) {
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(behaviour.reply), behaviour.delayMs);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          });
        });
      }
      return Promise.resolve(behaviour.reply);
    },
  };
  return { client, prompts };
}

export function fakeTelemetry() {
  const events: { name: string; properties: Record<string, string | number | boolean> }[] = [];
  const client: Telemetry = { trackEvent: (name, properties) => events.push({ name, properties }) };
  return { client, events };
}

export function fakeFlags(enabled: boolean): FeatureFlags {
  return { isEnabled: async () => enabled };
}

export function llmReply(category: string, confidence: number): { reply: string } {
  return { reply: JSON.stringify({ category, confidence }) };
}
