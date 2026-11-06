import type {SupabaseClient} from "@supabase/supabase-js";

export const starterItems=["3 money trays","Client’s packages","2 LED screens"];
type Item={text:string;done:boolean};
type SavedChecklist={id:string;title:string;items:Item[];notes:string;createdAt:string};
type ChecklistRecord={checklists:SavedChecklist[];version:string|null};
const idPattern=/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const validItem=(item:Item)=>item && typeof item.text==="string" && item.text.trim().length>0 && item.text.length<=160 && typeof item.done==="boolean";
const validChecklist=(entry:SavedChecklist)=>entry && typeof entry.id==="string" && idPattern.test(entry.id) && typeof entry.title==="string" && entry.title.trim().length>0 && entry.title.length<=120 && Array.isArray(entry.items) && entry.items.length>0 && entry.items.length<=80 && entry.items.every(validItem) && typeof entry.notes==="string" && entry.notes.length<=2000 && typeof entry.createdAt==="string" && Number.isFinite(Date.parse(entry.createdAt));
const normalize=(value:Record<string,unknown>|null):ChecklistRecord=>{
  if(value && Array.isArray(value.checklists))return {checklists:value.checklists as SavedChecklist[],version:typeof value.version==="string"?value.version:null};
  if(value && Array.isArray(value.items))return {checklists:[{id:crypto.randomUUID(),title:"Earlier checklist",items:value.items as Item[],notes:typeof value.notes==="string"?value.notes:"",createdAt:"1970-01-01T00:00:00.000Z"}],version:typeof value.version==="string"?value.version:null};
  return {checklists:[],version:null};
};

export async function checklistRequest(db:SupabaseClient,scope:string,request:Request,readonly=false){
  const key="staff-checklist/"+scope;
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"private, no-store"}});
  if(request.method==="GET"){
    const {data,error}=await db.from("hmp_seating_records").select("value").eq("key",key).maybeSingle();
    return error?reply({error:"Could not load the checklists."},503):reply({...normalize(data?.value ?? null),scope,starterItems});
  }
  if(request.method!=="POST"||readonly)return reply({error:"This checklist is read-only."},405);
  if(request.headers.get("origin")!==new URL(request.url).origin)return reply({error:"Invalid request origin."},403);
  const body=await request.json().catch(()=>null);
  if(!body||body.scope!==scope||!Array.isArray(body.checklists)||body.checklists.length>30||!body.checklists.every(validChecklist)||new Set(body.checklists.map((entry:SavedChecklist)=>entry.id)).size!==body.checklists.length||!(body.version===null||typeof body.version==="string"))return reply({error:"Check the checklist titles, items, and notes before saving."},400);
  const value:ChecklistRecord={checklists:body.checklists.map((entry:SavedChecklist)=>({id:entry.id,title:entry.title.trim(),items:entry.items.map(item=>({text:item.text.trim(),done:item.done})),notes:entry.notes,createdAt:entry.createdAt})),version:crypto.randomUUID()};
  const table=db.from("hmp_seating_records");
  const result=await (body.version===null?table.insert({key,value}):table.update({value}).eq("key",key).eq("value->>version",body.version)).select("key").maybeSingle();
  return result.error||!result.data?reply({error:"The checklists changed elsewhere. Reopen them before saving."},409):reply({...value,scope,starterItems});
}
