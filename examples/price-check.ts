import { XactumClient } from "@xactum/client";

const xactum = new XactumClient({
    payerPrivateKey: process.env.XACTUM_PAYER_PRIVATE_KEY as `0x${string}`,
    acceptTerms: true, // after reading https://api.xactum.com/terms
    businessUse: true,
});

// Before committing to a model at a quoted price:
const a = await xactum.verifyPrice({ modelId: "anthropic/claude-sonnet-5.5", inputPerMTok: 3, outputPerMTok: 15 });
console.log(a.result.verdict, a.charged ? "(paid 0.03 USDC)" : "(free)");

// Tell us if it helped (free):
if (a.queryId) await xactum.feedback({ queryId: a.queryId, useful: "yes", outcome: "acted_on_verdict" });
