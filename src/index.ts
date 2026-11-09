/**
 * @xactum/client — call XACTUM from any agent.
 *
 * XACTUM verifies; it never routes, never proxies and takes no referral fees.
 * You keep calling your model provider directly. Before or after that call,
 * ask XACTUM whether the price is competitive or whether the model you got is
 * the one you paid for. Each paid answer costs 0.03 USDC on Base via x402,
 * paid from YOUR wallet. Inconclusive answers are free.
 */
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";

export const DEFAULT_BASE_URL = "https://api.xactum.com";
const BASE_MAINNET = "eip155:8453";

export type XactumClientOptions = {
    /** Private key (0x...) of the wallet that pays the x402 quote. Keep it in your secrets manager. */
    payerPrivateKey: `0x${string}`;
    /**
     * Must be true: you, as a business, accept XACTUM's current terms (read them at
     * `${baseUrl}/terms`). The client fetches the terms id and hash and sends them
     * with every query; it never accepts on your behalf if this is false.
     */
    acceptTerms: boolean;
    /** Must be true: XACTUM is for business use only. */
    businessUse: boolean;
    /** Optional VAT id with country prefix (e.g. ES12345678Z), for invoicing. */
    vatId?: string;
    baseUrl?: string;
    /** Optional fetch implementation (defaults to globalThis.fetch). */
    fetch?: typeof fetch;
};

export type PriceQuery = { modelId: string; inputPerMTok?: number; outputPerMTok?: number; tier?: string };
export type ModelSample = {
    modelId: string;
    gateway: string;
    observedAt: string;
    modelFieldReturned?: string;
    latencyMs?: number;
    [k: string]: unknown;
};
export type Feedback = {
    queryId: string;
    useful: "yes" | "partly" | "no";
    outcome?: "acted_on_verdict" | "used_as_input" | "ignored" | "verdict_seemed_wrong" | "verdict_unclear";
    /** Optional wallet to receive the review credit. */
    wallet?: string;
};

/** The answer envelope returned by both verify routes (see /openapi.json). */
export type XactumAnswer<R> = {
    result: R;
    charged: boolean;
    chargeReason?: string;
    queryId: string | null;
    reference: { kind: string; setId: string; sha256: string } | null;
    feedback?: string;
    terms: { id: string; sha256: string; url: string };
    advisory: string;
};
export type PriceResult = {
    verdict: "COMPETITIVE" | "FLAG_HIGH" | "FLAG_LOW" | "FLAG_HIGH_STRONG" | "FLAG_LOW_STRONG" | "INCONCLUSIVE";
    confidence: "low" | "medium" | "high";
    reasons: string[];
    methodVersion: string;
    snapshotId: string;
    [k: string]: unknown;
};
export type ModelResult = {
    verdict: "CONSISTENT" | "MISMATCH" | "INCONCLUSIVE";
    confidence: "low" | "medium" | "high";
    reasons: string[];
    methodVersion: string;
    baselineSetId: string;
    [k: string]: unknown;
};

export class XactumError extends Error {
    constructor(public status: number, public code: string, message: string) {
          super(message);
    }
}

export class XactumClient {
    private readonly baseUrl: string;
    private readonly payFetch: typeof fetch;
    private readonly plainFetch: typeof fetch;
    private terms?: { id: string; sha256: string; url: string };

  constructor(private readonly opts: XactumClientOptions) {
        if (opts.acceptTerms !== true) throw new Error("XACTUM: set acceptTerms: true after reading the terms at https://api.xactum.com/terms");
        if (opts.businessUse !== true) throw new Error("XACTUM: the service is for business use only; set businessUse: true");
        this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
        this.plainFetch = opts.fetch ?? globalThis.fetch;
        const account = privateKeyToAccount(opts.payerPrivateKey);
        this.payFetch = wrapFetchWithPaymentFromConfig(this.plainFetch, {
                schemes: [{ network: BASE_MAINNET, client: new ExactEvmScheme(account) }],
        }) as typeof fetch;
  }

  /** Current terms id, hash and URL (read from the service, cached per client). */
  async currentTerms() {
        if (!this.terms) {
                const r = await this.plainFetch(`${this.baseUrl}/`);
                if (!r.ok) throw new XactumError(r.status, "SERVICE_INFO_UNAVAILABLE", "Could not read service info");
                const info = (await r.json()) as { terms: { id: string; sha256: string; url: string } };
                this.terms = { id: info.terms.id, sha256: info.terms.sha256, url: info.terms.url };
        }
        return this.terms;
  }

  private async post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
        const t = await this.currentTerms();
        const body = {
                acceptTerms: { id: t.id, sha256: t.sha256 },
                businessUse: true,
                ...(this.opts.vatId ? { vatId: this.opts.vatId } : {}),
                ...payload,
        };
        const r = await this.payFetch(`${this.baseUrl}${path}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
        });
        const json = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
        if (!r.ok) {
                if (json.error === "TERMS_NOT_ACCEPTED") this.terms = undefined; // terms changed: re-read next time
          throw new XactumError(r.status, json.error ?? "HTTP_ERROR", json.detail ?? `HTTP ${r.status}`);
        }
        return json as T;
  }

  /** Is a quoted or paid LLM price competitive against an independent reference? Call before committing spend. */
  verifyPrice(query: PriceQuery) {
        return this.post<XactumAnswer<PriceResult>>("/v1/verify/price", { query });
  }

  /** Is the model actually served consistent with the model claimed? Send call metadata only — never prompts or outputs. */
  verifyModel(sample: ModelSample) {
        return this.post<XactumAnswer<ModelResult>>("/v1/verify/model", { sample });
  }

  /** Free: rate an answer with its queryId. Structured fields only. */
  async feedback(f: Feedback) {
        const r = await this.plainFetch(`${this.baseUrl}/v1/feedback`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(f),
        });
        const json = (await r.json().catch(() => ({}))) as { error?: string; detail?: string };
        if (!r.ok) throw new XactumError(r.status, json.error ?? "HTTP_ERROR", json.detail ?? `HTTP ${r.status}`);
        return json;
  }
}
