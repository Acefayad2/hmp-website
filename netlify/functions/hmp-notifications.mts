import type {Config} from "@netlify/functions";
import {getUser} from "./_admin-verification.mts";
import {createClient} from "@supabase/supabase-js";
import {isSameOriginMutation} from "./_conversation-security.mts";
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export function createNotificationsHandler({getUserFn=getUser,databaseFactory=createClient}={}) {
  return async(request:Request)=>{
    const email=(await getUserFn(request))?.email?.toLowerCase();
    const allowed=(Netlify.env.get("HMP_ADMIN_EMAILS")||"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
    if(!email || !allowed.includes(email)) return json({error:"Unauthorized"},401);
    if(!["GET","POST"].includes(request.method)) return json({error:"Method not allowed"},405);
    if(request.method==="POST" && !isSameOriginMutation(request)) return json({error:"Invalid request origin"},403);
    const url=Netlify.env.get("SUPABASE_URL"),key=Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url || !key) return json({error:"Notifications unavailable"},503);
    const db=databaseFactory(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    if(request.method==="POST") {
      const body=await request.json().catch(()=>null);
      if(body?.action!=="read" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body?.id||"")) return json({error:"Invalid notification"},400);
      const {error}=await db.rpc("hmp_read_completion_notification",{p_id:body.id,p_email:email});
      return error?json({error:"Notification could not be marked read"},502):json({ok:true});
    }
    const {data,error}=await db.from("hmp_admin_notifications")
      .select("id,agreement_id,client_name,title,kind,created_at,read_by,email_accepted_at,email_error,attempts,first_attempt_at")
      .order("created_at",{ascending:false}).limit(100);
    if(error) return json({error:"Notifications could not be loaded"},502);
    return json({notifications:(data||[]).map(row=>({id:row.id,agreementId:row.agreement_id,clientName:row.client_name,title:row.title,kind:row.kind,createdAt:row.created_at,
      read:(row.read_by||[]).includes(email),emailStatus:row.email_accepted_at?"Email accepted by provider":row.attempts>=5 || (row.first_attempt_at && Date.parse(row.first_attempt_at)<Date.now()-23*3600000)?"Email needs attention — automatic retries stopped":row.email_error?"Email pending retry":"Email queued"}))});
  };
}
export default createNotificationsHandler();
export const config:Config={path:"/api/hmp-notifications"};
