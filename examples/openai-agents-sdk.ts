/**
 * XACTUM + OpenAI Agents SDK — a tool your agent can call mid-run to verify price,
 * without XACTUM ever seeing the agent's prompts or outputs.
 */
import { Agent, run, tool } from "@openai/agents";
import { z } from "zod";
import { XactumClient } from "@xactum/client";

const xactum = new XactumClient({
  payerPrivateKey: process.env.XACTUM_PAYER_PRIVATE_KEY as `0x${string}`,
  acceptTerms: true,
  businessUse: true,
});

const checkPrice = tool({
  name: "xactum_verify_price",
  description:
    "Check whether a quoted LLM price is competitive before committing spend. Costs 0.03 USDC; inconclusive answers are free.",
  parameters: z.object({
    modelId: z.string(),
    inputPerMTok: z.number().optional(),
    outputPerMTok: z.number().optional(),
  }),
  execute: async (q) => xactum.verifyPrice(q),
});

const agent = new Agent({
  name: "Procurement agent",
  instructions: "Before committing to any LLM provider, use xactum_verify_price to sanity-check the quote.",
  tools: [checkPrice],
});

run(agent, "I'm quoted $2/$8 per million tokens for openai/gpt-5.1 — is that reasonable?").then((result) => {
  console.log(result.finalOutput);
});
