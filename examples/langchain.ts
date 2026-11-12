/**
 * XACTUM + LangChain — verify price before you spend, verify the model after you get an answer.
 *
 * Nothing here proxies your LLM call. You keep calling your provider exactly as before;
 * XACTUM only answers two independent questions, each a paid x402 query (free when inconclusive).
 */
import { ChatOpenAI } from "@langchain/openai";
import { XactumClient } from "@xactum/client";

const xactum = new XactumClient({
  payerPrivateKey: process.env.XACTUM_PAYER_PRIVATE_KEY as `0x${string}`,
  acceptTerms: true, // after reading https://api.xactum.com/terms
  businessUse: true,
});

const MODEL_ID = "openai/gpt-5.1";
const QUOTED = { inputPerMTok: 2, outputPerMTok: 8 }; // what your provider/gateway is charging you

async function askVerified(prompt: string) {
  // 1) Before spending: is the price your gateway quoted competitive?
  const price = await xactum.verifyPrice({ modelId: MODEL_ID, ...QUOTED });
  if (price.result.verdict.startsWith("FLAG_HIGH")) {
    console.warn(`XACTUM: ${MODEL_ID} price looks high (${price.result.reasons.join(", ")}) — continuing anyway, your call.`);
  }

  // 2) Call your provider exactly as you always do. XACTUM never sees this request.
  const startedAt = new Date().toISOString();
  const model = new ChatOpenAI({ model: "gpt-5.1" });
  const response = await model.invoke(prompt);

  // 3) After the call: is the model that actually answered the one you paid for?
  const check = await xactum.verifyModel({
    modelId: MODEL_ID,
    gateway: "openai-direct",
    observedAt: startedAt,
    modelFieldReturned: response.response_metadata?.model_name,
  });
  if (check.result.verdict === "MISMATCH") {
    console.warn(`XACTUM: served model does not match what you paid for — ${check.result.reasons.join(", ")}`);
  }

  return response;
}

askVerified("Summarize the risks of agentic commerce in two sentences.").then((r) => console.log(r.content));
