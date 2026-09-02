export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/v1/events" && request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
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
          return new Response(JSON.stringify({ error: "Tenant missing" }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders() } });
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
          return new Response(JSON.stringify({ error: "Ingestion failed", detail: errText }), { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders() } });
        }
        return new Response(JSON.stringify({ status: "acknowledged", accepted: true }), { status: 202, headers: { "Content-Type": "application/json", ...corsHeaders() } });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: "Malformed payload", detail: err.message }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders() } });
      }
    }
    return new Response("Not Found", { status: 404, headers: corsHeaders() });
  }
};
