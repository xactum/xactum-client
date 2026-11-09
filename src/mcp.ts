#!/usr/bin/env node
/**
   * XACTUM MCP server (stdio). Exposes three tools to any MCP-capable agent:
   *   xactum_verify_price, xactum_verify_model, xactum_feedback.
   *
   * Configuration (environment):
   *   XACTUM_PAYER_PRIVATE_KEY  wallet that pays 0.03 USDC on Base per paid answer
   *   XACTUM_ACCEPT_TERMS=true  you accept https://api.xactum.com/terms as a business
   *   XACTUM_BUSINESS_USE=true  business use only
   *   XACTUM_VAT_ID             optional
   *   XACTUM_BASE_URL           optional (default https://api.xactum.com)
   */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { XactumClient } from "./index.js";

const key = process.env.XACTUM_PAYER_PRIVATE_KEY;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error("Set XACTUM_PAYER_PRIVATE_KEY (0x + 64 hex) for the wallet that pays XACTUM queries.");
    process.exit(1);
}
const client = new XactumClient({
    payerPrivateKey: key as `0x${string}`,
    acceptTerms: process.env.XACTUM_ACCEPT_TERMS === "true",
    businessUse: process.env.XACTUM_BUSINESS_USE === "true",
    vatId: process.env.XACTUM_VAT_ID,
    baseUrl: process.env.XACTUM_BASE_URL,
});

const server = new McpServer({ name: "xactum", version: "0.1.0" });
const asText = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

server.registerTool(
    "xactum_verify_price",
  {
        description:
                "Before paying for or committing to an LLM model/price: check whether a quoted or paid per-token price is competitive against an independent reference. Costs 0.03 USDC (x402, Base); inconclusive answers are free. XACTUM verifies, never routes, and takes no referral fees.",
        inputSchema: {
                modelId: z.string().describe("Model id, e.g. anthropic/claude-sonnet-5.5"),
                inputPerMTok: z.number().optional().describe("Quoted USD per million input tokens"),
                outputPerMTok: z.number().optional().describe("Quoted USD per million output tokens"),
                tier: z.string().optional(),
        },
  },
    async (q) => asText(await client.verifyPrice(q)),
  );

server.registerTool(
    "xactum_verify_model",
  {
        description:
                "After an LLM call: check whether the model actually served is consistent with the model claimed, using call metadata only (never prompts or outputs). Costs 0.03 USDC (x402, Base); inconclusive answers are free.",
        inputSchema: {
                modelId: z.string().describe("Model you asked and paid for"),
                gateway: z.string().describe("Provider or gateway that served the call"),
                observedAt: z.string().describe("ISO-8601 time of the call"),
                modelFieldReturned: z.string().optional().describe("The model field in the provider's response"),
                latencyMs: z.number().optional(),
        },
  },
    async (s) => asText(await client.verifyModel(s)),
  );

server.registerTool(
    "xactum_feedback",
  {
        description: "Free: rate a XACTUM answer with its queryId (structured, no free text). A valid review earns a small credit for the given wallet.",
        inputSchema: {
                queryId: z.string(),
                useful: z.enum(["yes", "partly", "no"]),
                outcome: z.enum(["acted_on_verdict", "used_as_input", "ignored", "verdict_seemed_wrong", "verdict_unclear"]).optional(),
                wallet: z.string().optional(),
        },
  },
    async (f) => asText(await client.feedback(f)),
  );

await server.connect(new StdioServerTransport());
