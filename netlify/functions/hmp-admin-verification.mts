import type { Config } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { createClient } from "@supabase/supabase-js";
import { randomInt, randomUUID } from "node:crypto";
import { isSameOriginMutation } from "./_conversation-security.mts";
import { hmpSender } from "./_email-contact.mts";
import { challengeCookie, verificationCookie, verificationLifetime, readCookie, codeHash, issueVerification, hasAdminVerification, cookieHeader } from "./_admin-verification.mts";

const json = (body: unknown, status=200) => Response.json(body,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
export const createAdminVerificationHandler = ({getUserFn=getUser,databaseFactory=createClient,fetchFn=fetch,now=Date.now,randomCode=()=>String(randomInt(100000,1000000))}={}) => async(request: Request) => {
  try {
    if (!["GET","POST","DELETE"].includes(request.method)) return json({error:"Method not allowed"},405);
    if (request.method!=="GET" && !isSameOriginMutation(request)) return json({error:"Invalid request origin"},403);
    if (request.method==="DELETE") {
      const response=json({ok:true});
      for(const name of [verificationCookie,challengeCookie,"hmp_admin_sso"]) response.headers.append("Set-Cookie",cookieHeader(request,name,"",0));
      return response;
    }
    const user=await getUserFn();
    const email=user?.email?.trim().toLowerCase();
    const allowed=(Netlify.env.get("HMP_ADMIN_EMAILS")||"").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean);
    if (!user?.id || !email || !allowed.includes(email)) return json({error:"Sign in with an authorized HMP Admin account first."},401);
    if (request.method==="GET") return json({verified:hasAdminVerification(request,user),email});
    const url=Netlify.env.get("SUPABASE_URL"),secret=Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!secret) return json({error:"Login verification is temporarily unavailable."},503);
    const raw=await request.text();
    if(raw.length>1000)return json({error:"Invalid verification request."},400);
    let body;try{body=JSON.parse(raw)}catch{return json({error:"Invalid verification request."},400)}
    if(!["send","verify"].includes(body?.action))return json({error:"Invalid verification action."},400);
    const db=databaseFactory(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const limit=async(kind:string,count:number,window:number)=>{
      const result=await db.rpc("hmp_take_seating_rate_limit",{p_key:`rate-limits/admin-login/${kind}/${user.id}`,p_limit:count,p_window_ms:window});
      if(result.error||!Number.isSafeInteger(result.data))throw new Error("Rate limiting unavailable");
      return result.data;
    };
    let nonce=readCookie(request,challengeCookie);
    if(!/^[0-9a-f-]{36}$/.test(nonce))nonce=randomUUID();
    const key=`admin-login-challenge/${user.id}/${nonce}`;
    if(body.action==="send") {
      const resendKey=Netlify.env.get("RESEND_API_KEY");
      const from=hmpSender();
      if(!resendKey||!from)return json({error:"Verification email delivery is unavailable. Please contact HMP."},503);
      const cooldown=await limit("resend",1,60_000);
      if(cooldown){const response=json({error:`Wait ${cooldown} seconds before requesting another code.`},429);response.headers.set("Retry-After",String(cooldown));return response;}
      if(await limit("send",5,3600_000))return json({error:"Too many code requests. Please try again in an hour."},429);
      const code=randomCode(),hash=codeHash(secret,user,nonce,code),expires=now()+600_000;
      const saved=await db.from("hmp_seating_records").upsert({key,value:{codeHash:hash,expires},updated_at:new Date(now()).toISOString()});
      if(saved.error)throw new Error("Challenge storage unavailable");
      const delivered=await fetchFn("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resendKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[email],subject:"Your HMP Admin sign-in code",text:`Your HMP Admin verification code is ${code}.\n\nIt expires in 10 minutes and can only be used once. Do not share this code. If you did not try to sign in, reset your HMP Admin password and contact HMP.`}),signal:AbortSignal.timeout(10000)});
      if(!delivered.ok){await db.from("hmp_seating_records").delete().eq("key",key).eq("value->>codeHash",hash);return json({error:"We could not send your code. Please try again shortly."},502);}
      const response=json({ok:true,email,expiresIn:600});
      response.headers.append("Set-Cookie",cookieHeader(request,challengeCookie,nonce,600));
      return response;
    }
    if(await limit("verify",5,600_000))return json({error:"Too many attempts. Wait 10 minutes before trying again."},429);
    if(typeof body.code!=="string"||!/^\d{6}$/.test(body.code))return json({error:"Enter the 6-digit code from your email."},400);
    // Conditional deletion atomically consumes the challenge; concurrent/replayed codes cannot succeed twice.
    const consumed=await db.from("hmp_seating_records").delete().eq("key",key).eq("value->>codeHash",codeHash(secret,user,nonce,body.code)).gt("value->expires",now()).select("key");
    if(consumed.error)throw new Error("Verification storage unavailable");
    if(consumed.data?.length!==1)return json({error:"That code is incorrect, expired, or already used. Use the newest code or request another."},401);
    const response=json({ok:true,verified:true});
    response.headers.append("Set-Cookie",cookieHeader(request,verificationCookie,issueVerification(user,secret,now()),verificationLifetime));
    response.headers.append("Set-Cookie",cookieHeader(request,challengeCookie,"",0));
    return response;
  } catch { return json({error:"Login verification is temporarily unavailable. Please try again."},503); }
};
export default createAdminVerificationHandler();
export const config:Config={path:"/api/hmp-admin-verification"};
