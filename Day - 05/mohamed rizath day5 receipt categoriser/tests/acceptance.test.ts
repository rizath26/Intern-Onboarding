import { describe, expect, test } from "vitest";
import { handleCategorise, recordDecision } from "../src/categoriser.js";
import type { ParsedReceipt } from "../src/types.js";
import { fakeFlags, fakeLlm, fakeOcr, fakeTelemetry, jpeg, llmReply, pdf, png } from "./fakes.js";

const MEAL_RECEIPT: ParsedReceipt = {
  merchantName: "Colombo Kottu House",
  items: [{ description: "Chicken kottu x2" }, { description: "Lime juice x2" }],
};
const MIXED_RECEIPT: ParsedReceipt = {
  merchantName: "Galle Road Supermart",
  items: [{ description: "Chicken fried rice" }, { description: "A4 paper ream" }, { description: "Blue pens" }],
};
const TAXI_RECEIPT: ParsedReceipt = {
  merchantName: "PickMe",
  items: [{ description: "PickMe ride Colombo 03 to BIA" }],
};
const UNREADABLE: ParsedReceipt = { items: [] };

function setup(opts: {
  ocr?: ParsedReceipt | Error;
  llm?: Parameters<typeof fakeLlm>[0];
  flag?: boolean;
}) {
  const ocr = fakeOcr(opts.ocr ?? MEAL_RECEIPT);
  const llm = fakeLlm(opts.llm ?? llmReply("Meals", 0.92));
  const telemetry = fakeTelemetry();
  const deps = { ocr: ocr.client, llm: llm.client, telemetry: telemetry.client, flags: fakeFlags(opts.flag ?? true) };
  return { deps, ocr, llm, telemetry };
}

const suggested = <E extends { name: string }>(events: E[]): E[] => events.filter((e) => e.name === "categoriser.suggested");

describe("Receipt Categoriser acceptance criteria", () => {
  test("AC-01 happy path: clear meal receipt", async () => {
    const { deps, telemetry } = setup({ ocr: MEAL_RECEIPT, llm: llmReply("Meals", 0.92) });
    const res = await handleCategorise({ claimId: "CLM-1001", receipt: jpeg() }, deps);

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.category).toBe("Meals");
    expect(res.body.confidence).toBeGreaterThanOrEqual(0.7);
    expect(res.body.source).toBe("llm");
    expect(res.body.needsReview).toBe(false);
    expect(res.body.notice).toBeNull();

    const events = suggested(telemetry.events);
    expect(events).toHaveLength(1);
    expect(events[0]!.properties.fallbackReason).toBe("none");
    expect(events[0]!.properties.suggestionId).toBe(res.body.suggestionId);
  });

  test("AC-02 ambiguous receipt below 0.6 needs review", async () => {
    const { deps } = setup({ ocr: MIXED_RECEIPT, llm: llmReply("Meals", 0.55) });
    const res = await handleCategorise({ claimId: "CLM-1002", receipt: jpeg() }, deps);

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.category).toBe("Meals");
    expect(res.body.confidence).toBe(0.55);
    expect(res.body.needsReview).toBe(true);
  });

  test("AC-02 boundary: confidence exactly 0.6 does not need review", async () => {
    const { deps } = setup({ ocr: MIXED_RECEIPT, llm: llmReply("Meals", 0.6) });
    const res = await handleCategorise({ claimId: "CLM-1002", receipt: jpeg() }, deps);

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.needsReview).toBe(false);
  });

  test("AC-03 LLM unavailable (503) falls back to rule-based", async () => {
    const { deps, telemetry } = setup({ ocr: TAXI_RECEIPT, llm: { status: 503 } });
    const res = await handleCategorise({ claimId: "CLM-1003", receipt: jpeg() }, deps);

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.source).toBe("rule-based");
    expect(res.body.category).toBe("Travel");
    expect(res.body.confidence).toBeLessThanOrEqual(0.5);
    expect(res.body.needsReview).toBe(true);
    expect(suggested(telemetry.events)[0]!.properties.fallbackReason).toBe("llm_unavailable");
  });

  test("AC-04 OCR cannot read the receipt", async () => {
    const { deps, llm, telemetry } = setup({ ocr: UNREADABLE });
    const res = await handleCategorise({ claimId: "CLM-1004", receipt: png() }, deps);

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body).toMatchObject({
      category: "Other",
      confidence: 0,
      source: "rule-based",
      needsReview: true,
      notice: "We couldn't read this receipt. Please choose a category yourself.",
    });
    expect(llm.prompts).toHaveLength(0);
    expect(suggested(telemetry.events)[0]!.properties.fallbackReason).toBe("ocr_unreadable");
  });

  test("AC-05 oversized payload (10 MB + 1 byte) is rejected with 413", async () => {
    const { deps, ocr, llm, telemetry } = setup({});
    const res = await handleCategorise({ claimId: "CLM-1005", receipt: png(10_485_761) }, deps);

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: "RECEIPT_TOO_LARGE" });
    expect(ocr.calls).toHaveLength(0);
    expect(llm.prompts).toHaveLength(0);
    expect(telemetry.events).toHaveLength(0);
  });

  test("AC-05 boundary: exactly 10 MB is accepted", async () => {
    const { deps } = setup({});
    const res = await handleCategorise({ claimId: "CLM-1005", receipt: jpeg(10_485_760) }, deps);
    expect(res.status).toBe(200);
  });

  test("AC-06 PII never reaches telemetry; card numbers never reach the LLM", async () => {
    const receipt: ParsedReceipt = {
      merchantName: "Colombo Kottu House",
      items: [
        { description: "Chicken kottu x2" },
        { description: "Customer: Nimal Perera" },
        { description: "Paid by card 4111 1111 1111 1111" },
        { description: "Card XXXX-XXXX-XXXX-1234" },
      ],
    };
    const { deps, llm, telemetry } = setup({ ocr: receipt, llm: llmReply("Meals", 0.9) });
    const res = await handleCategorise({ claimId: "CLM-1006", receipt: jpeg() }, deps);
    expect(res.status).toBe(200);

    const eventText = JSON.stringify(suggested(telemetry.events));
    for (const secret of ["Nimal", "Perera", "4111", "1234"]) expect(eventText).not.toContain(secret);

    const sentToLlm = llm.prompts.map((p) => p.system + "\n" + p.user).join("\n");
    expect(sentToLlm.replace(/[ -]/g, "")).not.toMatch(/\d{12,}/);
    expect(sentToLlm).not.toContain("1234");
  });

  test("AC-07 LLM slower than 2.5 s falls back and responds in under 4 s", async () => {
    const { deps, telemetry } = setup({ ocr: TAXI_RECEIPT, llm: { delayMs: 3000, reply: '{"category":"Travel","confidence":0.9}' } });
    const started = Date.now();
    const res = await handleCategorise({ claimId: "CLM-1007", receipt: jpeg() }, deps);
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.source).toBe("rule-based");
    expect(res.body.confidence).toBeLessThanOrEqual(0.5);
    expect(elapsed).toBeLessThan(4000);
    expect(suggested(telemetry.events)[0]!.properties.fallbackReason).toBe("llm_timeout");
  }, 6000);

  test.each([
    ["category outside the enum", '{"category":"Entertainment","confidence":0.9}'],
    ["text that is not JSON", "I think this is probably a meal receipt."],
    ["confidence out of range", '{"category":"Meals","confidence":1.7}'],
  ])("AC-08 invalid LLM output (%s) falls back", async (_label, reply) => {
    const { deps, telemetry } = setup({ ocr: MEAL_RECEIPT, llm: { reply } });
    const res = await handleCategorise({ claimId: "CLM-1008", receipt: jpeg() }, deps);

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(res.body.source).toBe("rule-based");
    expect(["Meals", "Travel", "Lodging", "Office Supplies", "Other"]).toContain(res.body.category);
    expect(suggested(telemetry.events)[0]!.properties.fallbackReason).toBe("llm_invalid_output");
  });

  test("AC-09 PDF is rejected even if named .jpg; empty file is invalid", async () => {
    const { deps, telemetry } = setup({});
    const asPdf = await handleCategorise({ claimId: "CLM-1009", receipt: pdf() }, deps);
    expect(asPdf.status).toBe(400);
    expect(asPdf.body).toMatchObject({ error: "UNSUPPORTED_FILE_TYPE" });

    const empty = await handleCategorise({ claimId: "CLM-1009", receipt: new Uint8Array(0) }, deps);
    expect(empty.status).toBe(400);
    expect(empty.body).toMatchObject({ error: "INVALID_INPUT" });

    expect(telemetry.events).toHaveLength(0);
  });

  test("AC-10 Document Intelligence unavailable returns 502 with no event", async () => {
    const { deps, telemetry } = setup({ ocr: new Error("Document Intelligence 503") });
    const res = await handleCategorise({ claimId: "CLM-1010", receipt: jpeg() }, deps);

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "OCR_UNAVAILABLE" });
    expect(suggested(telemetry.events)).toHaveLength(0);
  });

  test("AC-11 feature flag off returns 404 and calls nothing", async () => {
    const { deps, ocr, llm, telemetry } = setup({ flag: false });
    const res = await handleCategorise({ claimId: "CLM-1011", receipt: jpeg() }, deps);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "FEATURE_DISABLED" });
    expect(ocr.calls).toHaveLength(0);
    expect(llm.prompts).toHaveLength(0);
    expect(telemetry.events).toHaveLength(0);
  });

  test("AC-12 accepted and overridden decisions are logged", async () => {
    const { deps, telemetry } = setup({});
    const base = { suggestionId: "S-1", claimId: "CLM-1012", suggestedCategory: "Meals" as const };

    expect(await recordDecision({ ...base, finalCategory: "Meals" }, deps)).toBe("accepted");
    expect(await recordDecision({ ...base, finalCategory: "Travel" }, deps)).toBe("overridden");

    const decided = telemetry.events.filter((e) => e.name === "categoriser.decided");
    expect(decided).toHaveLength(2);
    expect(decided[0]!.properties).toMatchObject({ suggestionId: "S-1", suggestedCategory: "Meals", finalCategory: "Meals", outcome: "accepted" });
    expect(decided[1]!.properties).toMatchObject({ finalCategory: "Travel", outcome: "overridden" });
  });
});
