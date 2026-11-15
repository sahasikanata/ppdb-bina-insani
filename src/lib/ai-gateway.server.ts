// Server-only: Lovable AI Gateway provider (OpenAI Responses) for this app.
import { createOpenAI } from "@ai-sdk/openai";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1";
const LOVABLE_AIG_RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";
export const MODEL_PEMERIKSA = "openai/gpt-6-astra";

/** Resends a gateway-issued run id on follow-up calls and captures the minted one. Never mints ids. */
function createRunIdFetch(initialRunId?: string) {
  let runId = initialRunId?.trim() || undefined;
  return {
    getRunId: () => runId,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (runId && !headers.has(LOVABLE_AIG_RUN_ID_HEADER)) headers.set(LOVABLE_AIG_RUN_ID_HEADER, runId);
      const response = await fetch(input, { ...init, headers });
      runId ??= response.headers.get(LOVABLE_AIG_RUN_ID_HEADER)?.trim() || undefined;
      return response;
    },
  };
}

/** Create one per request. */
export function createGatewayProvider() {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("LOVABLE_API_KEY belum diatur.");
  const runIdFetch = createRunIdFetch();
  const provider = createOpenAI({
    baseURL: GATEWAY_URL,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });
  return { provider, getRunId: runIdFetch.getRunId };
}
