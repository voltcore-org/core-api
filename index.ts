export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/v1/events" && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === "GET" && url.pathname === "/api/v1/events") {
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100) || 100));
      const qs = `select=id,created_at,source,event_type,severity,payload&order=created_at.desc&limit=${limit}`;
      try {
        const dbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/events?${qs}`, {
          headers: {
            "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
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

    if (request.method === "POST" && url.pathname === "/api/v1/events") {
      try {
        const payload = await request.json() as Record<string, any>;
        const tenantRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/tenants?select=id&limit=1`,
          {
            headers: {
              "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
              "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
            }
          }
        );
        const tenantData = await tenantRes.json() as Array<{ id?: string }>;
        const tenantId = tenantData[0]?.id;
        if (!tenantId) {
          return json({ error: "Tenant missing" }, 500);
        }
        const dbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/events`, {
          method: "POST",
          headers: {
            "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({
            tenant_id: tenantId,
            source: payload.source || "github",
            event_type: payload.type || "deployment.event",
            severity: payload.severity || "info",
            payload: payload.payload || payload
          })
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
    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  }
};
