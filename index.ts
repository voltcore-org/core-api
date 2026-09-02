export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENROUTER_API_KEY?: string;
}

const REMEDIATE_WINDOW_MS = 60_000;
const REMEDIATE_MAX = 6;
const PAYLOAD_CAP = 8 * 1024;
const OR_TIMEOUT_MS = 20_000;
const buckets = new Map<string, number[]>();

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders() },
  });
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
}

function rateAllow(ip: string): boolean {
  const now = Date.now();
  const hits = (buckets.get(ip) || []).filter((t) => now - t < REMEDIATE_WINDOW_MS);
  if (hits.length >= REMEDIATE_MAX) {
    buckets.set(ip, hits);
    return false;
  }
  hits.push(now);
  buckets.set(ip, hits);
  return true;
}

function requireSupabase(env: Env): Response | null {
  if (!env.SUPABASE_URL) {
    return json(
      { error: "Config missing", detail: "SUPABASE_URL environment variable is required but not set" },
      503,
    );
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(
      { error: "Config missing", detail: "SUPABASE_SERVICE_ROLE_KEY is required but not set" },
      503,
    );
  }
  return null;
}

function supabaseHeaders(env: Env, extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

async function tenantId(env: Env): Promise<string | null> {
  const tenantRes = await fetch(`${env.SUPABASE_URL}/rest/v1/tenants?select=id&limit=1`, {
    headers: supabaseHeaders(env),
  });
  const tenantData = (await tenantRes.json()) as Array<{ id?: string }>;
  return tenantData[0]?.id || null;
}

async function insertEvent(
  env: Env,
  row: { source: string; event_type: string; severity: string; payload: unknown },
): Promise<void> {
  if (requireSupabase(env)) return;
  const id = await tenantId(env);
  if (!id) return;
  await fetch(`${env.SUPABASE_URL}/rest/v1/events`, {
    method: "POST",
    headers: supabaseHeaders(env, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ tenant_id: id, ...row }),
  });
}

function truncatePayload(value: unknown): unknown {
  try {
    const raw = JSON.stringify(value);
    if (raw.length <= PAYLOAD_CAP) return value;
    return { truncated: true, preview: raw.slice(0, PAYLOAD_CAP) };
  } catch {
    return { truncated: true, preview: String(value).slice(0, PAYLOAD_CAP) };
  }
}

function splitPatch(content: string): { summary: string; patch: string } {
  const fence = content.match(/```(?:diff|patch|ts|tsx|js|javascript|json)?\n([\s\S]*?)```/);
  const patch = (fence ? fence[1] : content).trim();
  const summary = content.replace(/```[\s\S]*?```/g, "").trim().slice(0, 600) || "Patch generated.";
  return { summary, patch };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "OPTIONS" && (path === "/api/v1/events" || path === "/api/v1/remediate")) {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (path === "/api/v1/events") {
      const cfg = requireSupabase(env);
      if (cfg) return cfg;

      if (request.method === "GET") {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100) || 100));
        const source = (url.searchParams.get("source") || "").trim();
        let qs = `select=id,created_at,source,event_type,severity,payload&order=created_at.desc&limit=${limit}`;
        if (source) {
          const parts = source.split(",").map((s) => s.trim()).filter(Boolean);
          if (parts.length === 1) qs += `&source=eq.${encodeURIComponent(parts[0])}`;
          else if (parts.length > 1) qs += `&source=in.(${parts.map(encodeURIComponent).join(",")})`;
        }
        try {
          const dbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/events?${qs}`, {
            headers: supabaseHeaders(env),
          });
          if (!dbRes.ok) {
            const errText = await dbRes.text();
            return json({ error: "Query failed", detail: errText }, 500);
          }
          const events = await dbRes.json();
          return json({ status: "ok", events, fetched_at: new Date().toISOString() }, 200);
        } catch (err: any) {
          return json({ error: "Query failed", detail: err.message }, 500);
        }
      }

      if (request.method === "POST") {
        try {
          const payload = (await request.json()) as Record<string, any>;
          const id = await tenantId(env);
          if (!id) return json({ error: "Tenant missing" }, 500);
          const dbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/events`, {
            method: "POST",
            headers: supabaseHeaders(env, { "Content-Type": "application/json", Prefer: "return=minimal" }),
            body: JSON.stringify({
              tenant_id: id,
              source: payload.source || "github",
              event_type: payload.type || "deployment.event",
              severity: payload.severity || "info",
              payload: payload.payload || payload,
            }),
          });
          if (!dbRes.ok) {
            const errText = await dbRes.text();
            return json({ error: "Ingestion failed", detail: errText }, 500);
          }
          return json({ status: "acknowledged", accepted: true }, 202);
        } catch (err: any) {
          return json({ error: "Malformed payload", detail: err.message }, 400);
        }
      }
    }

    if (request.method === "POST" && path === "/api/v1/remediate") {
      const ip = clientIp(request);
      if (!rateAllow(ip)) return json({ error: "Rate limited", detail: "6 remediations per minute" }, 429);
      if (!env.OPENROUTER_API_KEY) {
        return json({ error: "OpenRouter key missing", detail: "Bind OPENROUTER_API_KEY on core-api" }, 503);
      }
      try {
        const body = (await request.json()) as Record<string, any>;
        const ev = body.event || body;
        const source = String(ev.source || "unknown");
        const eventType = String(ev.event_type || ev.type || "event");
        const severity = String(ev.severity || "high");
        const clipped = truncatePayload(ev.payload);
        const userMsg = [
          `Source: ${source}`,
          `Event: ${eventType}`,
          `Severity: ${severity}`,
          `Payload: ${JSON.stringify(clipped)}`,
        ].join("\n");

        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), OR_TIMEOUT_MS);
        let orRes: Response;
        try {
          orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            signal: ac.signal,
            headers: {
              Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://voltcore-org.github.io/voltcore-command-center/",
              "X-Title": "VOLTCORE Command Center",
            },
            body: JSON.stringify({
              model: "poolside/laguna-s-2.1:free",
              models: ["cohere/north-mini-code:free", "openrouter/free"],
              temperature: 0.1,
              max_tokens: 1800,
              messages: [
                {
                  role: "system",
                  content:
                    "You are VOLTCORE repair. Given a production telemetry anomaly, return a short summary then a unified diff or code patch. No secrets. No markdown chatter outside the patch fence. Prefer the smallest safe fix.",
                },
                { role: "user", content: userMsg },
              ],
            }),
          });
        } finally {
          clearTimeout(timer);
        }

        const orText = await orRes.text();
        let orJson: any = null;
        try {
          orJson = orText ? JSON.parse(orText) : null;
        } catch {
          orJson = { raw: orText };
        }
        if (!orRes.ok) {
          await insertEvent(env, {
            source: "command_center.remediate",
            event_type: "command_center.remediate",
            severity: "error",
            payload: { source, event_type: eventType, http: orRes.status, detail: orText.slice(0, 500) },
          });
          return json({ error: "OpenRouter failed", detail: orText.slice(0, 800), status: orRes.status }, 502);
        }
        const content = String(orJson?.choices?.[0]?.message?.content || "");
        const model = String(orJson?.model || "poolside/laguna-s-2.1:free");
        const { summary, patch } = splitPatch(content);
        await insertEvent(env, {
          source: "command_center.remediate",
          event_type: "command_center.remediate",
          severity: "info",
          payload: { source, event_type: eventType, severity, model },
        });
        return json({ status: "ok", model, summary, patch }, 200);
      } catch (err: any) {
        const aborted = err?.name === "AbortError";
        return json(
          { error: aborted ? "OpenRouter timeout" : "Remediate failed", detail: err.message },
          aborted ? 504 : 400,
        );
      }
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  },
};
