/**
 * XACTUM + Vercel AI SDK — same pattern, wrapped around `generateText`.
 * XACTUM verifies; it never routes or proxies your call to the model provider.
 */
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { XactumClient } from "@xactum/client";

const xactum = new XactumClient({
  payerPrivateKey: process.env.XACTUM_PAYER_PRIVATE_KEY as `0x${string}`,
  acceptTerms: true,
  businessUse: true,
});

async function generateVerified(prompt: string) {
  const modelId = "openai/gpt-5.1";

  const price = await xactum.verifyPrice({ modelId, inputPerMTok: 2, outputPerMTok: 8 });
  console.log("XACTUM price verdict:", price.result.verdict);

  const startedAt = new Date().toISOString();
  const { text, response } = await generateText({ model: openai("gpt-5.1"), prompt });

  const check = await xactum.verifyModel({
    modelId,
    gateway: "vercel-ai-sdk/openai",
    observedAt: startedAt,
    modelFieldReturned: response.modelId,
  });
  console.log("XACTUM model verdict:", check.result.verdict);

  return text;
}

generateVerified("What's one way agentic commerce differs from e-commerce?").then(console.log);
