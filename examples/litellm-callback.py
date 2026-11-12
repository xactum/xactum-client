"""
XACTUM + LiteLLM — verify price before you spend, verify the model after you get an answer.

Drop this file next to your LiteLLM proxy config and point `litellm_settings.callbacks`
at `xactum_callback_instance` (see the config.yaml snippet at the bottom of this file).

Nothing here proxies your LLM call. LiteLLM keeps routing to your provider exactly as
configured; XACTUM only answers two independent questions, each a paid x402 query on
Base (0.03 USDC, paid from your own wallet). Inconclusive answers are free, and every
XACTUM call is wrapped so that a slow or failed check never blocks or breaks production
traffic — it only logs a warning.

Install:  pip install 'x402[evm]' httpx eth-account

Env vars:
  XACTUM_PAYER_PRIVATE_KEY   0x-prefixed private key of the wallet that pays XACTUM
  XACTUM_BASE_URL            optional, defaults to https://api.xactum.com
"""

import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from eth_account import Account
from litellm.integrations.custom_logger import CustomLogger
from x402 import x402Client
from x402.http.clients import x402HttpxClient
from x402.mechanisms.evm import EthAccountSigner
from x402.mechanisms.evm.exact.register import register_exact_evm_client

logger = logging.getLogger("xactum")

DEFAULT_BASE_URL = "https://api.xactum.com"
MTOK = 1_000_000


class XactumClient:
    """Minimal Python port of @xactum/client, scoped to what this callback needs.

    XACTUM verifies; it never routes, never proxies and takes no referral fees from
    the providers it checks. You accept XACTUM's terms (read at `{base_url}/terms`)
    by setting XACTUM_PAYER_PRIVATE_KEY and using this client — it fetches the current
    terms id/hash itself and sends them with every query, as the API requires.
    """

    def __init__(self, payer_private_key: str, base_url: str = DEFAULT_BASE_URL, business_use: bool = True):
        self.base_url = base_url.rstrip("/")
        self.business_use = business_use
        account = Account.from_key(payer_private_key)
        signer = EthAccountSigner(account)
        self._payment_client = x402Client()
        register_exact_evm_client(self._payment_client, signer)
        self.address = account.address

    async def _terms(self) -> dict:
        # Terms id/hash come from the service root ("/"), which returns
        # {"terms": {"id", "sha256", "url"}} as JSON. "/terms" is the
        # human-readable legal text, not a machine-readable endpoint.
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as http:
            r = await http.get(f"{self.base_url}/")
            r.raise_for_status()
            info = r.json()
            return info["terms"]

    async def _post(self, path: str, body: dict) -> dict:
        terms = await self._terms()
        body = {
            **body,
            "acceptTerms": {"id": terms["id"], "sha256": terms["sha256"]},
            "businessUse": self.business_use,
        }
        async with x402HttpxClient(self._payment_client, timeout=15) as http:
            r = await http.post(f"{self.base_url}{path}", json=body)
            await r.aread()
            payload = r.json()
            if r.status_code >= 400:
                raise RuntimeError(f"XACTUM {path} -> HTTP {r.status_code}: {payload}")
            return payload

    async def verify_price(self, model_id: str, input_per_mtok: Optional[float] = None,
                            output_per_mtok: Optional[float] = None, tier: Optional[str] = None) -> dict:
        query = {"modelId": model_id}
        if input_per_mtok is not None:
            query["inputPerMTok"] = input_per_mtok
        if output_per_mtok is not None:
            query["outputPerMTok"] = output_per_mtok
        if tier is not None:
            query["tier"] = tier
        return await self._post("/v1/verify/price", {"query": query})

    async def verify_model(self, model_id: str, gateway: str, observed_at: str,
                            model_field_returned: Optional[str] = None, latency_ms: Optional[int] = None) -> dict:
        sample = {"modelId": model_id, "gateway": gateway, "observedAt": observed_at}
        if model_field_returned is not None:
            sample["modelFieldReturned"] = model_field_returned
        if latency_ms is not None:
            sample["latencyMs"] = latency_ms
        return await self._post("/v1/verify/model", {"sample": sample})


class XactumVerificationCallback(CustomLogger):
    """Pre-call price check + post-call served-model check, via XACTUM."""

    def __init__(self):
        super().__init__()
        self.enabled = bool(os.environ.get("XACTUM_PAYER_PRIVATE_KEY"))
        if not self.enabled:
            logger.warning("XACTUM_PAYER_PRIVATE_KEY not set — XactumVerificationCallback is a no-op.")
            return
        self.xactum = XactumClient(
            payer_private_key=os.environ["XACTUM_PAYER_PRIVATE_KEY"],
            base_url=os.environ.get("XACTUM_BASE_URL", DEFAULT_BASE_URL),
        )

    async def async_pre_call_hook(self, user_api_key_dict, cache, data: dict, call_type: str):
        if not self.enabled:
            return data
        model = data.get("model")
        try:
            import litellm  # local import: keep this file usable without litellm installed at module load

            cost = litellm.model_cost.get(model) or {}
            input_per_mtok = cost.get("input_cost_per_token", 0) * MTOK or None
            output_per_mtok = cost.get("output_cost_per_token", 0) * MTOK or None
            if not (input_per_mtok or output_per_mtok):
                return data  # no configured price to check against
            result = await self.xactum.verify_price(model, input_per_mtok, output_per_mtok)
            verdict = result.get("result", {}).get("verdict", "")
            if verdict.startswith("FLAG_HIGH"):
                reasons = ", ".join(result.get("result", {}).get("reasons", []))
                logger.warning("XACTUM: configured price for %s looks high (%s)", model, reasons)
            data.setdefault("metadata", {})["xactum_price_verdict"] = verdict
        except Exception as exc:  # fail open — never block production traffic on a verification hiccup
            logger.warning("XACTUM price check failed, continuing without it: %s", exc)
        return data

    async def async_log_success_event(self, kwargs: dict, response_obj: Any, start_time, end_time):
        if not self.enabled:
            return
        try:
            model = kwargs.get("model")
            served_model = getattr(response_obj, "model", None)
            observed_at = (
                start_time.replace(tzinfo=timezone.utc).isoformat()
                if hasattr(start_time, "replace")
                else datetime.now(timezone.utc).isoformat()
            )
            result = await self.xactum.verify_model(
                model_id=model,
                gateway="litellm",
                observed_at=observed_at,
                model_field_returned=served_model,
            )
            verdict = result.get("result", {}).get("verdict", "")
            if verdict == "MISMATCH":
                reasons = ", ".join(result.get("result", {}).get("reasons", []))
                logger.warning("XACTUM: served model mismatch for %s — %s", model, reasons)
        except Exception as exc:  # fail open
            logger.warning("XACTUM model check failed, continuing without it: %s", exc)


xactum_callback_instance = XactumVerificationCallback()

# config.yaml
# litellm_settings:
#   callbacks: xactum_callback.xactum_callback_instance
#
# environment_variables:
#   XACTUM_PAYER_PRIVATE_KEY: "os.environ/XACTUM_PAYER_PRIVATE_KEY"
