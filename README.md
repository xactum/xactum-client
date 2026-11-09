# XACTUM client & MCP server

**XACTUM verifies, it never routes.** Ask it, before or after you call an LLM provider, whether
the price is competitive and whether the model you got is the one you paid for.
No proxy, no referral fees: you keep calling your provider directly; XACTUM only answers.

- `verifyPrice` — is a quoted or paid per-token price competitive against an independent reference?
- `verifyModel` — is the served model consistent with the claimed one? (call metadata only — never prompts or outputs)
- `feedback` — free; rate an answer with its `queryId` and earn a small credit.

Paid answers cost **0.03 USDC on Base via [x402](https://x402.org)**, from your own wallet.
Inconclusive answers are free. Method and reference fingerprints are public:
[`/method`](https://api.xactum.com/method) · [`/reference`](https://api.xactum.com/reference) · [`/openapi.json`](https://api.xactum.com/openapi.json).

## Use it in code

```bash
npm install @xactum/client
```

```ts
import { XactumClient } from "@xactum/client";

const xactum = new XactumClient({
  payerPrivateKey: process.env.XACTUM_PAYER_PRIVATE_KEY as `0x${string}`,
    acceptTerms: true, // you accept https://api.xactum.com/terms as a business
      businessUse: true,
      });

      const a = await xactum.verifyPrice({ modelId: "anthropic/claude-sonnet-5.5", inputPerMTok: 3, outputPerMTok: 15 });
      console.log(a.result.verdict); // COMPETITIVE | FLAG_HIGH | FLAG_LOW | ... | INCONCLUSIVE
      ```

      ## Use it as an MCP server (Claude, Cursor, any MCP client)

      ```json
      {
        "mcpServers": {
            "xactum": {
                  "command": "npx",
                        "args": ["-y", "@xactum/client"],
                              "env": {
                                      "XACTUM_PAYER_PRIVATE_KEY": "0x…",
                                              "XACTUM_ACCEPT_TERMS": "true",
                                                      "XACTUM_BUSINESS_USE": "true"
                                                            }
                                                                }
                                                                  }
                                                                  }
                                                                  ```

                                                                  Tools: `xactum_verify_price`, `xactum_verify_model`, `xactum_feedback`.

                                                                  ## Rules we hold ourselves to

                                                                  1. Oracle, never proxy: XACTUM never forwards, resells or touches your model calls.
                                                                  2. Zero referral fees: revenue comes only from the per-query fee paid by the agent.
                                                                  3. Verdicts are advisory. Business use only. See the [terms](https://api.xactum.com/terms).

                                                                  MIT licensed. Contact: xactumoracle@proton.me
                                                                  
