import type {Config} from "@netlify/functions";
import {createClient} from "@supabase/supabase-js";
import {hmpSender,hmpAlertRecipient} from "./_email-contact.mts";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export async function deliverCompletionAlerts(db: any, fetchFn=fetch) {
  const key=Netlify.env.get("RESEND_API_KEY"),from=hmpSender(),to=hmpAlertRecipient();
  if(!key || !from || !to) throw new Error("Completion alert email is not configured");
  const {data:rows,error}=await db.rpc("hmp_claim_completion_notifications",{p_from:from,p_to:to});
  if(error) throw new Error("Completion alerts could not be claimed");
  let accepted=0;
  for(const row of rows || []) {
    let emailError="", sent=false;
    try {
      const action=row.kind==="agreement_signed"?"signed an agreement":"completed a form";
      const response=await fetchFn("https://api.resend.com/emails",{
        method:"POST",signal:AbortSignal.timeout(4000),
        headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","Idempotency-Key":`hmp-completion/${row.id}`},
        body:JSON.stringify({from:row.email_from,to:[row.email_to],reply_to:row.email_to,
          subject:`HMP client ${action}`,
          html:`<div style="font-family:Georgia,serif;color:#5f3f41"><h2>Client ${action}</h2><p>${escape(row.client_name)} ${action}: <strong>${escape(row.title)}</strong>.</p><p><a href="https://hmpeds.com/admin?notifications=1">Open HMP Admin notifications</a></p><p>Sign in to review the completed document. No signatures or form answers are included in this email.</p></div>`})
      });
      sent=response.ok;
      if(!sent) emailError=`Email provider did not accept the alert (HTTP ${response.status}).`;
    } catch { emailError="Email delivery could not be confirmed."; }
    const {error:saveError}=await db.from("hmp_admin_notifications").update(sent
      ? {email_accepted_at:new Date().toISOString(),email_error:null}
      : {email_error:emailError}).eq("id",row.id).eq("attempts",row.attempts);
    if(saveError) throw new Error("Completion alert status could not be saved");
    if(sent) accepted++;
  }
  return {processed:rows?.length || 0,accepted};
}
export default async () => {
  const url=Netlify.env.get("SUPABASE_URL"),key=Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url || !key) throw new Error("Completion alert database is not configured");
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  console.log("Completion alerts",await deliverCompletionAlerts(db));
};
export const config:Config={schedule:"* * * * *"};
