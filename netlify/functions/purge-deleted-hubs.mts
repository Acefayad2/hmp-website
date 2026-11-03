import type {Config} from "@netlify/functions";
import {createClient} from "@supabase/supabase-js";
import {ATTACHMENT_BUCKET} from "./_conversation-attachments.mts";

export const createHubPurgeHandler = ({databaseFactory=()=>createClient(Netlify.env.get("SUPABASE_URL")!,Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}}),now=()=>Date.now()}={}) => async()=>{
  const client=databaseFactory(),cutoff=new Date(now()-30*86400000).toISOString();
  const {data:rows,error}=await client.from("hmp_client_conversations").select("id").lte("deleted_at",cutoff).order("deleted_at").limit(50);
  if(error)throw new Error("Deleted hub lookup failed");
  let purged=0;
  for(const row of rows||[]){
    // A conditional write locks out restore before file removal. Retries resume safely.
    const {data:claimed,error:claimError}=await client.from("hmp_client_conversations").update({purge_started_at:new Date(now()).toISOString()}).eq("id",row.id).lte("deleted_at",cutoff).select("id").maybeSingle();
    if(claimError)throw new Error("Deleted hub cleanup could not start");
    if(!claimed)continue;
    // Paginate: a hub can contain more uploads than the API's default row limit.
    let offset=0;
    for(;;){
      const {data:uploads,error:readError}=await client.from("hmp_conversation_attachment_uploads").select("path").eq("conversation_id",row.id).order("path").range(offset,offset+99);
      if(readError)throw new Error("Deleted hub attachments could not be read");
      const paths=(uploads||[]).map(item=>item.path).filter(Boolean);
      if(paths.length){const {error:removeError}=await client.storage.from(ATTACHMENT_BUCKET).remove(paths);if(removeError)throw new Error("Deleted hub attachment cleanup will retry");}
      if((uploads||[]).length<100)break;
      offset+=100;
    }
    // Only conversation-owned messages/uploads cascade. Financial and signed tables
    // have no cascade FK to this table; the inquiry and standalone documents remain.
    const {error:deleteError}=await client.from("hmp_client_conversations").delete().eq("id",row.id).lte("deleted_at",cutoff).not("purge_started_at","is",null);
    if(deleteError)throw new Error("Deleted hub cleanup will retry");
    purged++;
  }
  return Response.json({purged});
};
export default createHubPurgeHandler();
export const config:Config={schedule:"45 7 * * *"};
