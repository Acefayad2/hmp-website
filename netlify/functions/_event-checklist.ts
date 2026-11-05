import type {SupabaseClient} from "@supabase/supabase-js";
export const starterItems=["3 money trays","Client’s packages","2 LED screens"];
export type Checklist={items:{text:string;done:boolean}[];notes:string;version:string|null};
export async function checklistRequest(db:SupabaseClient,scope:string,request:Request,readonly=false){
 const key="staff-checklist/"+scope;
 const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"private, no-store"}});
 if(request.method==="GET"){
  const {data,error}=await db.from("hmp_seating_records").select("value").eq("key",key).maybeSingle();
  return error?reply({error:"Could not load the checklist."},503):reply({...data?.value??{items:starterItems.map(text=>({text,done:false})),notes:"",version:null},scope});
 }
 if(request.method!=="POST"||readonly)return reply({error:"This checklist is read-only."},405);
 if(request.headers.get("origin")!==new URL(request.url).origin)return reply({error:"Invalid request origin."},403);
 const b=await request.json().catch(()=>null);
 if(!b||b.scope!==scope||!Array.isArray(b.items)||b.items.length>80||!b.items.every((i:{text?:unknown;done?:unknown})=>i&&typeof i.text==="string"&&i.text.trim()&&i.text.length<=160&&typeof i.done==="boolean")||typeof b.notes!=="string"||b.notes.length>2000||!(b.version===null||typeof b.version==="string"))return reply({error:"Check the event, item labels and notes before saving."},400);
 const value={items:b.items.map((i:{text:string;done:boolean})=>({text:i.text.trim(),done:i.done})),notes:b.notes,version:crypto.randomUUID()};
 const table=db.from("hmp_seating_records");
 const result=await (b.version===null?table.insert({key,value}):table.update({value}).eq("key",key).eq("value->>version",b.version)).select("key").maybeSingle();
 return result.error||!result.data?reply({error:"The checklist changed elsewhere. Reopen it before saving."},409):reply({...value,scope});
}
