import type { Config } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient } from "@supabase/supabase-js";
import { createHash, createHmac } from "node:crypto";
import { isSameOriginMutation, validBearerToken } from "./_conversation-security.mts";
import { reviewContact, reviewSubmission, reviewConsent } from "../../review-request-schema.mjs";

const table = "hmp_review_requests";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, {status, headers:{"Cache-Control":"no-store", "X-Content-Type-Options":"nosniff"}});
export const reviewToken = (id: string, secret: string) => createHmac("sha256",secret).update(`hmp-review:v1:${id}`).digest("base64url");
export const reviewHash = (token: string) => createHash("sha256").update(token).digest("hex");
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export function createReviewRequestHandler({getUserFn=getUser, databaseFactory=createClient, fetchFn=fetch}={}) {
  return async (request: Request) => {
    if (!["GET","POST"].includes(request.method)) return json({error:"Method not allowed"},405);
    if (request.method !== "GET" && !isSameOriginMutation(request)) return json({error:"Invalid request origin"},403);
    const clientRoute = new URL(request.url).pathname === "/api/hmp-client-review";
    let adminEmail = "", token = "";
    if (clientRoute) {
      token=validBearerToken(request);
      if (!token) return json({error:"This private review link is invalid."},401);
    } else {
      const user=await getUserFn();
      adminEmail=user?.email?.toLowerCase() || "";
      const allowed=(Netlify.env.get("HMP_ADMIN_EMAILS") || "").split(",").map(v=>v.trim().toLowerCase());
      if (!adminEmail || !allowed.includes(adminEmail)) return json({error:"Unauthorized"},401);
    }
    const url=Netlify.env.get("SUPABASE_URL"), key=Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return json({error:"Review requests are unavailable."},503);
    const db=databaseFactory(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    try {
      let body: any={};
      if (request.method === "POST") {
        const raw=await request.text();
        if(raw.length>12000) return json({error:"Request is too large."},413);
        try {body=JSON.parse(raw);} catch {return json({error:"Invalid request"},400);}
        if(!body || Array.isArray(body) || typeof body!=="object") return json({error:"Invalid request"},400);
      }
      if(clientRoute) {
        const {data:row,error}=await db.from(table).select("client_name,expires_at,submitted_at").eq("token_hash",reviewHash(token)).maybeSingle();
        if(error) return json({error:"Review form is unavailable."},502);
        if(!row || Date.parse(row.expires_at)<=Date.now()) return json({error:"This link has expired or is unavailable. Please contact HMP for a new request."},410);
        if(request.method==="GET") return json({clientName:row.client_name,submitted:Boolean(row.submitted_at)});
        if(row.submitted_at) return json({submitted:true});
        const review=reviewSubmission(body);
        const {error:saveError}=await db.rpc("hmp_submit_requested_review",{p_token_hash:reviewHash(token),p_review:review,p_consent:reviewConsent});
        if(saveError) return json({error:"Your review could not be saved. Please try again or contact HMP."},502);
        return json({submitted:true},201);
      }
      if(request.method==="GET") {
        const {data,error}=await db.from(table).select("id,client_name,client_email,created_at,expires_at,email_delivered_at,submitted_at").order("created_at",{ascending:false}).limit(500);
        return error ? json({error:"Review requests are unavailable. The database update may still be pending."},502) : json({requests:data || []});
      }
      if(!uuid.test(body.id || "")) return json({error:"Invalid request ID"},400);
      const contact=reviewContact(body);
      const resendKey=Netlify.env.get("RESEND_API_KEY");
      const from=Netlify.env.get("HMP_CONTRACT_FROM_EMAIL") || Netlify.env.get("HMP_INVOICE_FROM_EMAIL");
      if(!resendKey || !from) return json({error:"A verified HMP email sender is required before requesting reviews."},503);
      // Browser keeps the ID when retrying. Never overwrite an existing invitation/contact.
      const {error:insertError}=await db.from(table).upsert({id:body.id,...contact,token_hash:reviewHash(reviewToken(body.id,key)),created_by:adminEmail},{onConflict:"id",ignoreDuplicates:true});
      if(insertError) return json({error:"Review request could not be created."},502);
      const {data:row,error}=await db.from(table).select("*").eq("id",body.id).single();
      if(error || !row) return json({error:"Review request could not be loaded."},502);
      if(row.client_email!==contact.client_email || row.client_name!==contact.client_name) return json({error:"This request belongs to different client details. Close and start a new request."},409);
      if(row.submitted_at || row.email_delivered_at) return json({sent:true,alreadySent:true});
      if(Date.parse(row.expires_at)<=Date.now()) return json({error:"This request expired. Start a new request."},409);
      const link=`https://hmpeds.com/review#token=${reviewToken(row.id,key)}`;
      const response=await fetchFn("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resendKey}`,"Content-Type":"application/json","Idempotency-Key":`hmp-review/${row.id}`},body:JSON.stringify({from,to:[row.client_email],reply_to:"info@hmpeds.com",subject:"Share your HMP experience",
        html:`<div style="font-family:Georgia,serif;background:#fff8f1;color:#5f3f41;padding:32px"><h1>How was your HMP experience?</h1><p>Hello ${escape(row.client_name)},</p><p>We welcome your honest feedback about your event services.</p><p><a href="${escape(link)}" style="display:inline-block;padding:16px 24px;background:#5f3f41;color:#fff8f1;border-radius:28px">Write a review</a></p><p>Your review will be checked by an HMP administrator before it appears on our website. Your email address will remain private.</p><p>This private link expires on ${escape(new Date(row.expires_at).toISOString().slice(0,10))}. Please do not forward it.</p><p>Questions? Reply to connect with an event specialist.</p></div>`})});
      if(!response.ok) return json({error:"Email delivery failed. Retry this request; your client details are saved."},502);
      const {error:recordError}=await db.from(table).update({email_delivered_at:new Date().toISOString()}).eq("id",row.id);
      return json({sent:true,...(recordError ? {warning:"Email sent, but delivery status could not be saved. Refresh before retrying."} : {})});
    } catch(error) {
      return json({error:error instanceof Error ? error.message : "Review request could not be completed."},400);
    }
  };
}
export default createReviewRequestHandler();
export const config: Config = {path:["/api/hmp-review-requests","/api/hmp-client-review"]};
