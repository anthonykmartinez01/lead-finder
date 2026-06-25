import type { Context, Config } from "@netlify/functions";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const PIPELINE_NAME = "Cold Calling Pipeline Local";
const STAGE_NAME = "New Lead";

// Look up pipeline + stage IDs by name so the user never deals with raw IDs.
async function resolvePipelineStage(token: string, locationId: string): Promise<{ pipelineId: string; stageId: string } | { error: string }> {
  const res = await fetch(`${GHL_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    return { error: `Couldn't load pipelines (${res.status}). Check the GHL token scopes.` };
  }
  const data = await res.json();
  const pipelines: any[] = data.pipelines ?? [];
  const pipeline = pipelines.find(
    (p) => (p.name ?? "").trim().toLowerCase() === PIPELINE_NAME.toLowerCase()
  );
  if (!pipeline) {
    return { error: `Pipeline "${PIPELINE_NAME}" not found in GHL.` };
  }
  const stage = (pipeline.stages ?? []).find(
    (s: any) => (s.name ?? "").trim().toLowerCase() === STAGE_NAME.toLowerCase()
  );
  if (!stage) {
    return { error: `Stage "${STAGE_NAME}" not found in that pipeline.` };
  }
  return { pipelineId: pipeline.id, stageId: stage.id };
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  const token = Netlify.env.get("GHL_API_TOKEN");
  const locationId = Netlify.env.get("GHL_LOCATION_ID");

  if (!token) {
    return new Response(
      JSON.stringify({ error: "Server is missing GHL_API_TOKEN. Add it in Netlify env vars." }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
  if (!locationId) {
    return new Response(
      JSON.stringify({ error: "Server is missing GHL_LOCATION_ID. Add it in Netlify env vars." }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const name: string = (body.name ?? "").toString().trim();
  const phone: string = (body.phone ?? "").toString().trim();
  const address: string = (body.address ?? "").toString().trim();
  const website: string = (body.website ?? "").toString().trim();
  if (!name) {
    return new Response(JSON.stringify({ error: "Missing business name" }), { status: 400 });
  }

  try {
    // 1. Resolve pipeline + stage IDs from their names.
    const resolved = await resolvePipelineStage(token, locationId);
    if ("error" in resolved) {
      return new Response(JSON.stringify({ error: resolved.error }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }

    // 2. Create (or upsert) the contact.
    const contactRes = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        locationId,
        name,
        companyName: name,
        phone: phone || undefined,
        address1: address || undefined,
        website: website || undefined,
        source: "Lead Finder",
      }),
    });

    if (!contactRes.ok) {
      const t = await contactRes.text();
      return new Response(
        JSON.stringify({ error: "Couldn't create contact in GHL", detail: t.slice(0, 200) }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }
    const contactData = await contactRes.json();
    const contactId = contactData.contact?.id ?? contactData.id;

    // 3. Create the opportunity in the chosen pipeline + stage.
    const oppRes = await fetch(`${GHL_BASE}/opportunities/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        locationId,
        pipelineId: resolved.pipelineId,
        pipelineStageId: resolved.stageId,
        name,
        status: "open",
        contactId,
      }),
    });

    if (!oppRes.ok) {
      const t = await oppRes.text();
      return new Response(
        JSON.stringify({ error: "Contact created, but opportunity failed", detail: t.slice(0, 200) }),
        { status: 502, headers: { "content-type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, contactId }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: "Request failed", detail: String(e?.message ?? e) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};

export const config: Config = {
  path: "/api/send-to-ghl",
};
