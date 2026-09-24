import type { Config } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient } from "@supabase/supabase-js";
import { validateAnswers } from "../../agreement-schema.mjs";
import { agreementToken, cleanContact, completionPayload, hash, nonce, privateLink, publicAgreement, signingConsent, snapshotFor, uuidPattern } from "./_agreement-forms.mts";
import { isSameOriginMutation, validBearerToken } from "./_conversation-security.mts";

const json = (body: unknown, status = 200) => Response.json(body, {status, headers:{"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"}});
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[c]!);
const table = "hmp_client_agreements";

// Dependency injection keeps authorization and persistence paths testable without real emails/data.
export function createAgreementHandler({getUserFn = getUser, databaseFactory = createClient, fetchFn = fetch} = {}) {
  return async (request: Request) => {
    const clientRoute = new URL(request.url).pathname === "/api/hmp-agreement";
    if (!["GET", "POST", "PATCH"].includes(request.method)) return json({error:"Method not allowed"}, 405);
    if (request.method !== "GET" && !isSameOriginMutation(request)) return json({error:"Invalid request origin"}, 403);
    let adminEmail = "";
    let token = "";
    if (clientRoute) {
      token = validBearerToken(request);
      if (!token) return json({error:"This private link is invalid."}, 401);
      if (request.method === "PATCH") return json({error:"Method not allowed"}, 405);
    } else {
      const user = await getUserFn();
      adminEmail = user?.email?.toLowerCase() || "";
      const allowed = (Netlify.env.get("HMP_ADMIN_EMAILS") || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
      if (!adminEmail || !allowed.includes(adminEmail)) return json({error:"Unauthorized"}, 401);
    }
    const url = Netlify.env.get("SUPABASE_URL"), key = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({error:"Client forms are unavailable."}, 503);
    const db = databaseFactory(url, key, {auth:{persistSession:false, autoRefreshToken:false}});
    try {
      let body: any = {};
      if (request.method !== "GET") {
        const raw = await request.text();
        if (raw.length > 100000) return json({error:"Form is too large."}, 413);
        try { body = JSON.parse(raw); } catch { return json({error:"Invalid request"}, 400); }
        if (!body || Array.isArray(body) || typeof body !== "object") return json({error:"Invalid request"}, 400);
      }
      if (clientRoute) {
        const {data: row, error} = await db.from(table).select("*").eq("token_hash", hash(token)).maybeSingle();
        if (error) return json({error:"Client form could not be loaded."}, 502);
        if (!row || !["Sent", "Completed"].includes(row.status) || !row.expires_at || Date.parse(row.expires_at) <= Date.now()) return json({error:"This link has expired or is no longer available. Please contact HMP for help."}, 410);
        if (request.method === "GET" || row.status === "Completed") return json({agreement:publicAgreement(row), signingConsent:row.snapshot.signingConsent});
        const payload = completionPayload(row, body, request.headers.get("user-agent") || "");
        const {data: saved, error: saveError} = await db.from(table).update(payload).eq("id", row.id).eq("status", "Sent").gt("expires_at", new Date().toISOString()).select("*").maybeSingle();
        if (saveError) return json({error:"Your form could not be saved. Please try again."}, 502);
        if (!saved) return json({error:"This form changed or was already completed. Reload to review its current status."}, 409);
        return json({agreement:publicAgreement(saved), signingConsent:row.snapshot.signingConsent});
      }
      const requestUrl = new URL(request.url);
      if (request.method === "GET") {
        const id = requestUrl.searchParams.get("id");
        if (id) {
          if (!uuidPattern.test(id)) return json({error:"Invalid agreement"}, 400);
          const {data, error} = await db.from(table).select("*").eq("id", id).maybeSingle();
          if (error) return json({error:"Agreement could not be loaded."}, 502);
          if (!data) return json({error:"Agreement not found."}, 404);
          return json({agreement:publicAgreement(data), link:["Sent","Completed"].includes(data.status) ? privateLink(data) : "", signingConsent});
        }
        const {data, error} = await db.from(table).select("id,template_id,client_name,client_email,status,created_at,completed_at,email_delivered_at").order("created_at", {ascending:false}).limit(500);
        if (error) return json({error:"Client forms are unavailable. The agreement database migration may still be pending."}, 502);
        return json({agreements:data || []});
      }
      if (request.method === "POST") {
        const snapshot = snapshotFor(body.templateId);
        const contact = cleanContact(body);
        const id = crypto.randomUUID(), seed = nonce();
        const {data, error} = await db.from(table).insert({id, ...contact, template_id:snapshot.id, snapshot,
          admin_answers:validateAnswers(snapshot.adminFields, body.answers, false), token_nonce:seed,
          token_hash:hash(agreementToken(id, seed)), created_by:adminEmail}).select("*").single();
        if (error) return json({error:"Form could not be created."}, 502);
        return json({agreement:publicAgreement(data)}, 201);
      }
      if (!uuidPattern.test(body.id || "")) return json({error:"Invalid agreement"}, 400);
      const {data: row, error: readError} = await db.from(table).select("*").eq("id", body.id).maybeSingle();
      if (readError) return json({error:"Agreement could not be loaded."}, 502);
      if (!row) return json({error:"Agreement not found."}, 404);
      if (row.status === "Completed" || row.status === "Void") return json({error:"This agreement is locked. Create a new form for any changes."}, 409);
      if (body.action === "void") {
        const {data, error} = await db.from(table).update({status:"Void", updated_at:new Date().toISOString()}).eq("id", row.id).in("status", ["Draft", "Sent"]).select("*").maybeSingle();
        if (error || !data) return json({error:"Agreement could not be voided; reload its status."}, 409);
        return json({agreement:publicAgreement(data)});
      }
      if (body.action === "save") {
        if (row.status !== "Draft") return json({error:"Sent agreements cannot be edited. Void this form and create a new one."}, 409);
        const {data, error} = await db.from(table).update({...cleanContact(body), admin_answers:validateAnswers(row.snapshot.adminFields, body.answers, false), updated_at:new Date().toISOString()})
          .eq("id", row.id).eq("status", "Draft").eq("updated_at", body.updatedAt || "").select("*").maybeSingle();
        if (error || !data) return json({error:"The draft changed elsewhere. Close and reopen it before saving."}, 409);
        return json({agreement:publicAgreement(data)});
      }
      if (body.action !== "send") return json({error:"Invalid action"}, 400);
      const resendKey = Netlify.env.get("RESEND_API_KEY");
      const from = Netlify.env.get("HMP_CONTRACT_FROM_EMAIL") || Netlify.env.get("HMP_INVOICE_FROM_EMAIL");
      if (!resendKey || !from) return json({error:"Save the draft first. A verified HMP email sender is required before sending."}, 503);
      let issued = row;
      if (row.status === "Draft") {
        validateAnswers(row.snapshot.adminFields, row.admin_answers);
        if (body.hmpConsent !== true) return json({error:"The HMP representative must authorize their electronic signature."}, 400);
        const now = new Date().toISOString();
        const {data, error} = await db.from(table).update({status:"Sent", sent_at:now, updated_at:now,
          expires_at:new Date(Date.now() + 90 * 86400000).toISOString(),
          admin_answers:{...row.admin_answers, hmpSignedAt:now, hmpConsent:"I authorize my typed name as my electronic signature for HMP on this agreement."}})
          .eq("id", row.id).eq("status", "Draft").eq("updated_at", body.updatedAt || "").select("*").maybeSingle();
        if (error || !data) return json({error:"The draft changed. Close and reopen it before sending."}, 409);
        issued = data;
      }
      if (Date.parse(issued.expires_at) <= Date.now()) return json({error:"This form has expired. Void it and create a new form."}, 409);
      const link = privateLink(issued);
      if (issued.email_delivered_at) return json({agreement:publicAgreement(issued), link, warning:"This form was already emailed. Copy the private link if the client needs it again."});
      // A stable key prevents duplicate email if a network request is retried.
      const response = await fetchFn("https://api.resend.com/emails", {method:"POST", headers:{Authorization:`Bearer ${resendKey}`, "Content-Type":"application/json", "Idempotency-Key":`hmp-agreement/${issued.id}`},
        body:JSON.stringify({from, to:[issued.client_email], reply_to:"info@hmpeds.com", subject:`Complete your ${issued.snapshot.title} — HMP`,
          html:`<div style="font-family:Georgia,serif;background:#fff8f1;color:#5f3f41;padding:32px"><h1>Ready for your review</h1><p>Hello ${escape(issued.client_name)},</p><p>Please review, complete, and sign your ${escape(issued.snapshot.title)} online.</p><p><a style="display:inline-block;padding:16px 24px;background:#5f3f41;color:#fff8f1;border-radius:28px" href="${escape(link)}">Complete and sign form</a></p><p>This private link expires in 90 days. Please do not forward it. You can save or print your completed form.</p><p>Questions? Reply to connect with an event specialist.</p></div>`})});
      if (!response.ok) return json({error:"The form is ready, but email delivery failed. Reopen it to retry or copy its private link.", agreement:publicAgreement(issued), link}, 502);
      const {error: emailUpdateError} = await db.from(table).update({email_delivered_at:new Date().toISOString()}).eq("id", issued.id).eq("status", "Sent");
      return json({agreement:publicAgreement(issued), link, ...(emailUpdateError ? {warning:"Email sent; delivery status could not be recorded."} : {})});
    } catch (error) {
      return json({error:error instanceof Error ? error.message : "The request could not be completed."}, 400);
    }
  };
}
export default createAgreementHandler();
export const config: Config = {path:["/api/hmp-agreement-forms", "/api/hmp-agreement"]};
