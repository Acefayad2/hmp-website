import type { Config } from "@netlify/functions";
import {getUser} from "@netlify/identity";
import {createClient} from "@supabase/supabase-js";
import {agreementToken,hash,nonce,uuidPattern} from "./_agreement-forms.mts";
import {isSameOriginMutation} from "./_conversation-security.mts";
import {normalizeInvoice} from "./hmp-invoices.mts";
import {normalizeContract} from "./hmp-contracts.mts";

const tables: Record<string,string>={invoice:"hmp_admin_invoices",contract:"hmp_admin_contracts",form:"hmp_client_agreements",proposal:"hmp_admin_proposal_drafts"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export const createDocumentVersionsHandler=({getUserFn=getUser,databaseFactory=createClient}={})=>async(request:Request)=>{
  const email=(await getUserFn())?.email?.toLowerCase()||"";
  const allowed=(Netlify.env.get("HMP_ADMIN_EMAILS")||"").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean);
  if(!email||!allowed.includes(email))return json({error:"Unauthorized"},401);
  if(!["GET","POST"].includes(request.method))return json({error:"Method not allowed"},405);
  if(request.method==="POST"&&!isSameOriginMutation(request))return json({error:"Invalid request origin"},403);
  const url=Netlify.env.get("SUPABASE_URL"),key=Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({error:"Document history is unavailable"},503);
  const db=databaseFactory(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try{
    const query=new URL(request.url).searchParams;
    let body:any={};
    if(request.method==="POST"){
      const raw=await request.text();
      if(raw.length>2000)return json({error:"Request too large"},413);
      try{body=JSON.parse(raw);}catch{return json({error:"Invalid request"},400);}
    }
    const kind=request.method==="GET"?query.get("kind"):body?.kind;
    let id=request.method==="GET"?query.get("id"):body?.id;
    if(typeof kind!=="string"||!Object.hasOwn(tables,kind)||!uuidPattern.test(id||""))return json({error:"Choose a valid document"},400);
    if(kind==="proposal"){
      const {data,error}=await db.from(tables.proposal).select("id").eq("sent_message_id",id).maybeSingle();
      if(error)throw new Error("Proposal history could not be loaded");
      if(data)id=data.id;
    }
    if(request.method==="POST"){
      if(!uuidPattern.test(body.requestId||""))return json({error:"A revision request ID is required"},400);
      const seed=nonce();
      const {data,error}=await db.rpc("hmp_create_document_revision",{p_kind:kind,p_source:id,p_new_id:body.requestId,p_nonce:seed,p_token_hash:hash(agreementToken(body.requestId,seed)),p_actor:email});
      if(error)return json({error:error.code==="P0001"?error.message:"The revision could not be created. Please retry."},409);
      return json({id:data,kind},201);
    }
    const {data:entry,error:entryError}=await db.from("hmp_document_versions").select("root_id").eq("kind",kind).eq("document_id",id).maybeSingle();
    if(entryError)throw new Error("Document history is unavailable");
    const root=entry?.root_id||id;
    const offset=Math.trunc(Math.max(0,Math.min(100000,Number(query.get("offset"))||0)));
    const {data:versions,error:versionsError}=await db.from("hmp_document_versions").select("document_id,version,created_at,created_by").eq("kind",kind).eq("root_id",root).order("version",{ascending:false}).range(offset,offset+5);
    if(versionsError)throw new Error("Document history is unavailable");
    const entries=versions?.length?versions.slice(0,5):offset?[]:[{document_id:id,version:1}];
    const records=await Promise.all(entries.map(async(entry:any)=>{
      let {data:row,error}=await db.from(tables[kind]).select("*").eq("id",entry.document_id).maybeSingle();
      if(error)throw new Error("A document version could not be loaded");
      if(!row&&kind==="proposal"){
        const {data:message,error:messageError}=await db.from("hmp_client_messages").select("id,conversation_id,body,created_at").eq("id",entry.document_id).eq("sender","admin").is("deleted_at",null).maybeSingle();
        if(messageError)throw new Error("Proposal history could not be loaded");
        if(message?.body?.startsWith("HMP_PROPOSAL_V1:"))row={id:message.id,payload:JSON.parse(message.body.slice(16)),conversation_id:message.conversation_id,sent_at:message.created_at};
      }
      if(!row)return null;
      return {id:row.id,version:entry.version,status:kind==="proposal"?(row.sent_at?"Sent":"Draft"):row.status,
        title:row.invoice_number||row.contract_number||row.snapshot?.title||row.payload?.title||"Document",
        createdAt:row.created_at||entry.created_at,canRevise:row.status!=="Void"&&!row.deleted_at&&!row.archived_at,
        // An admin-only history view; credentials and access tokens are never returned.
        record:kind==="proposal"?{id:row.id,conversationId:row.conversation_id,payload:row.payload}:kind==="invoice"?normalizeInvoice(row):kind==="contract"?normalizeContract(row):undefined};
    }));
    return json({rootId:root,versions:records.filter(Boolean),hasMore:(versions?.length||0)>5,offset});
  }catch{return json({error:"Document history could not be loaded. Please try again."},502);}
};
export default createDocumentVersionsHandler();
export const config:Config={path:"/api/hmp-document-versions"};
