import type { Config, Context } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { documentGroupId, nextRevision } from "./_document-revisions.mts";

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});

const allowedEmails = () => (Netlify.env.get("HMP_ADMIN_EMAILS") || "")
  .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);

let database: SupabaseClient | null = null;
const getDatabase = () => {
  if (database) return database;
  const url = Netlify.env.get("SUPABASE_URL");
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return null;
  database = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return database;
};

const text = (value: unknown, maxLength = 500) => typeof value === "string" ? value.trim().slice(0, maxLength) : "";
const number = (value: unknown) => {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? Math.round(Math.max(0, candidate) * 100) / 100 : 0;
};
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeContract = (record: Record<string, unknown>) => ({
  id: record.id || "",
  contractNumber: record.contract_number || "",
  status: record.status || "Draft",
  effectiveDate: record.effective_date || "",
  clientName: record.client_name || "",
  clientEmail: record.client_email || "",
  clientPhone: record.client_phone || "",
  clientAddress: record.client_address || "",
  eventName: record.event_name || "",
  eventDate: record.event_date || "",
  eventLocation: record.event_location || "",
  services: record.services || "",
  scopeOfWork: record.scope_of_work || "",
  totalAmount: Number(record.total_amount) || 0,
  retainerAmount: Number(record.retainer_amount) || 0,
  paymentTerms: record.payment_terms || "",
  cancellationTerms: record.cancellation_terms || "",
  additionalTerms: record.additional_terms || "",
  hmpSignatureName: record.hmp_signature_name || "",
  hmpSignedAt: record.hmp_signed_at || "",
  clientSignatureName: record.client_signature_name || "",
  clientSignedAt: record.client_signed_at || "",
  inquiryId: record.inquiry_id || "",
  sentAt: record.sent_at || "",
  sentTo: record.sent_to || "",
  createdBy: record.created_by || "",
  createdAt: record.created_at || "",
  updatedAt: record.updated_at || "",
  revisionGroupId: documentGroupId(record as {id:string;revision_group_id?:string|null}),
  revisionNumber: Number(record.revision_number) || 1,
});

const cleanPayload = (body: Record<string, unknown>) => {
  const clientName = text(body.clientName, 200);
  const clientEmail = text(body.clientEmail, 320).toLowerCase();
  const effectiveDate = text(body.effectiveDate, 10);
  const eventDate = text(body.eventDate, 10);
  const services = text(body.services, 1000);
  const scopeOfWork = text(body.scopeOfWork, 10000);
  if (!clientName) throw new Error("Client name is required");
  if (!emailPattern.test(clientEmail)) throw new Error("A valid client email is required");
  if (!datePattern.test(effectiveDate)) throw new Error("A valid effective date is required");
  if (eventDate && !datePattern.test(eventDate)) throw new Error("Event date is invalid");
  if (!services) throw new Error("Selected services are required");
  if (!scopeOfWork) throw new Error("Scope of services is required");
  const totalAmount = number(body.totalAmount);
  const retainerAmount = number(body.retainerAmount);
  if (retainerAmount > totalAmount && totalAmount > 0) throw new Error("Retainer cannot exceed the agreement value");
  const statusValue = text(body.status, 12);
  const status = ["Draft", "Sent", "Signed", "Void"].includes(statusValue) ? statusValue : "Draft";
  const inquiryId = text(body.inquiryId, 36);
  const optionalDate = (value: unknown) => {
    const candidate = text(value, 10);
    return candidate && datePattern.test(candidate) ? candidate : null;
  };
  return {
    status,
    effective_date: effectiveDate,
    client_name: clientName,
    client_email: clientEmail,
    client_phone: text(body.clientPhone, 60) || null,
    client_address: text(body.clientAddress, 1000) || null,
    event_name: text(body.eventName, 250) || null,
    event_date: eventDate || null,
    event_location: text(body.eventLocation, 500) || null,
    services,
    scope_of_work: scopeOfWork,
    total_amount: totalAmount,
    retainer_amount: retainerAmount,
    payment_terms: text(body.paymentTerms, 5000) || null,
    cancellation_terms: text(body.cancellationTerms, 5000) || null,
    additional_terms: text(body.additionalTerms, 10000) || null,
    hmp_signature_name: text(body.hmpSignatureName, 200) || null,
    hmp_signed_at: optionalDate(body.hmpSignedAt),
    client_signature_name: text(body.clientSignatureName, 200) || null,
    client_signed_at: optionalDate(body.clientSignedAt),
    inquiry_id: inquiryId && uuidPattern.test(inquiryId) ? inquiryId : null,
    updated_at: new Date().toISOString(),
  };
};

const newContractNumber = () => `HMP-C-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

export const createContractHandler = ({ getUserFn = getUser, databaseFactory = getDatabase } = {}) => async (request: Request, _context?: Context) => {
  const user = await getUserFn();
  const email = user?.email?.toLowerCase();
  if (!email || !allowedEmails().includes(email)) return json({ error: "Unauthorized" }, 401);
  const client = databaseFactory();
  if (!client) return json({ error: "Contract data is unavailable" }, 503);

  if (request.method === "GET") {
    const { data, error } = await client.from("hmp_admin_contracts").select("*")
      .order("created_at", { ascending: false }).limit(500);
    if (error) {
      console.error("Supabase contract read failed", error.code);
      return json({ error: "Contract data is unavailable" }, 502);
    }
    return json({
      contracts: (data || []).map((record) => normalizeContract(record)),
      emailConfigured: Boolean(Netlify.env.get("RESEND_API_KEY") && (Netlify.env.get("HMP_CONTRACT_FROM_EMAIL") || Netlify.env.get("HMP_INVOICE_FROM_EMAIL"))),
      updatedAt: new Date().toISOString(),
    });
  }

  if (request.method !== "POST" && request.method !== "PATCH") return json({ error: "Method not allowed" }, 405);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  if (request.method === "PATCH" && body.action === "mark-signed") {
    const id = text(body.id, 36);
    const name = text(body.clientSignatureName, 200);
    const signedAt = text(body.clientSignedAt, 10);
    if (!uuidPattern.test(id) || !name || !datePattern.test(signedAt)) return json({ error: "Enter the signing name and date" }, 400);
    const { data, error } = await client.from("hmp_admin_contracts")
      .update({ status: "Signed", client_signature_name: name, client_signed_at: signedAt, updated_at: new Date().toISOString() })
      .eq("id", id).eq("status", "Sent").select("*").maybeSingle();
    if (error) return json({ error: "Contract could not be marked signed" }, 502);
    if (!data) return json({ error: "Only a sent contract can be marked signed" }, 409);
    return json({ ok: true, contract: normalizeContract(data) });
  }
  if (request.method === "POST" && body.action === "revise") {
    const sourceId = text(body.id, 36);
    if (!uuidPattern.test(sourceId)) return json({ error: "Invalid contract" }, 400);
    const { data: source, error: sourceError } = await client.from("hmp_admin_contracts")
      .select("*").eq("id", sourceId).maybeSingle();
    if (sourceError) return json({ error: "Contract could not be loaded" }, 502);
    if (!source) return json({ error: "Contract not found" }, 404);
    if (source.status === "Void") return json({ error: "Void contracts cannot be revised" }, 409);
    try {
      const revision = await nextRevision(client, "hmp_admin_contracts", source);
      const copy = cleanPayload({ ...normalizeContract(source), status: "Draft",
        clientSignatureName: "", clientSignedAt: "", hmpSignedAt: "" });
      const { data, error } = await client.from("hmp_admin_contracts")
        .insert({ ...copy, status: "Draft", contract_number: newContractNumber(),
          revision_group_id: revision.groupId, revision_number: revision.number,
          created_by: user?.email || email }).select("*").single();
      if (error) return json({ error: error.code === "23505" ? "A newer version was created. Refresh and try again." : "Contract revision could not be created" }, error.code === "23505" ? 409 : 502);
      return json({ ok: true, contract: normalizeContract(data) }, 201);
    } catch { return json({ error: "Version history is unavailable" }, 502); }
  }
  let payload: ReturnType<typeof cleanPayload>;
  try { payload = cleanPayload(body); payload.status = "Draft"; } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Contract details are invalid" }, 400);
  }

  if (request.method === "POST") {
    const { data, error } = await client.from("hmp_admin_contracts")
      .insert({ ...payload, contract_number: newContractNumber(), created_by: user?.email || email })
      .select("*").single();
    if (error) {
      console.error("Supabase contract create failed", error.code);
      return json({ error: "Contract could not be created" }, 502);
    }
    return json({ ok: true, contract: normalizeContract(data) }, 201);
  }

  const id = text(body.id, 36);
  if (!uuidPattern.test(id)) return json({ error: "Invalid contract" }, 400);
  const { data: current, error: currentError } = await client.from("hmp_admin_contracts")
    .select("status").eq("id", id).maybeSingle();
  if (currentError) return json({ error: "Contract could not be loaded" }, 502);
  if (!current) return json({ error: "Contract not found" }, 404);
  if (current.status !== "Draft") return json({ error: "This contract is locked. Create a revision to edit and resend it." }, 409);
  const { data, error } = await client.from("hmp_admin_contracts").update(payload)
    .eq("id", id).eq("status", "Draft").select("*").single();
  if (error || !data) {
    console.error("Supabase contract update failed", error?.code);
    return json({ error: error?.code === "PGRST116" ? "Contract not found" : "Contract could not be saved" }, error?.code === "PGRST116" ? 404 : 502);
  }
  return json({ ok: true, contract: normalizeContract(data) });
};

export default createContractHandler();

export const config: Config = { path: "/api/hmp-contracts" };
