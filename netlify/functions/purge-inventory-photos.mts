import type {Config} from "@netlify/functions";
import {createClient} from "@supabase/supabase-js";
import {ATTACHMENT_BUCKET} from "./_conversation-attachments.mts";
import {photosExpired} from "./_inventory-photo-retention.mts";

const database=()=>createClient(Netlify.env.get("SUPABASE_URL")!,Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const uuid=/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;

export function createPurgeInventoryPhotos({databaseFactory=database,now=()=>Date.now()}={}){
  return async () => {
    const db=databaseFactory(),storage=db.storage.from(ATTACHMENT_BUCKET);
    const events:any[]=[];
    for(let offset=0;;offset+=500){
      const {data,error}=await db.from("hmp_seating_records").select("key,value")
        .like("key","inventory/event/%").filter("value->>photosPurgedAt","is","null")
        .order("key",{ascending:true}).range(offset,offset+499);
      if(error)throw new Error(`Inventory event lookup failed: ${error.code}`);
      events.push(...(data||[]));
      if(!data||data.length<500)break;
    }
    let purged=0;
    for(const row of events){
      const event=row.value;
      if(!uuid.test(event?.id)||!photosExpired(event,now()))continue;
      const root=`inventory/${event.id}`;
      const items:any[]=[];
      for(let offset=0;;offset+=500){
        const {data,error:itemError}=await db.from("hmp_seating_records").select("key,value")
          .like("key",`inventory/${event.id}/item/%`).order("key",{ascending:true}).range(offset,offset+499);
        if(itemError)throw new Error(`Inventory item lookup failed: ${itemError.code}`);
        items.push(...(data||[]));
        if(!data||data.length<500)break;
      }
      const listAll=async (folder:string) => {
        const found:any[]=[];
        for(let offset=0;;offset+=100){
          const {data,error:listError}=await storage.list(folder,{limit:100,offset});
          if(listError)throw new Error(`Inventory photo listing failed: ${listError.message}`);
          found.push(...(data||[]));
          if(!data||data.length<100)break;
        }
        return found;
      };
      const folders=await listAll(root);
      const paths=new Set<string>(items.map(item=>item.value?.photo?.path).filter((path):path is string=>typeof path==="string"&&path.startsWith(`${root}/`)));
      for(const folder of folders){
        if(!uuid.test(folder.name)||folder.id)continue;
        for(const file of await listAll(`${root}/${folder.name}`)){
          if(/^[\da-f-]+\.(jpg|png|webp|heic|heif)$/i.test(file.name))paths.add(`${root}/${folder.name}/${file.name}`);
        }
      }
      const pathList=[...paths];
      for(let index=0;index<pathList.length;index+=100){
        const {error:removeError}=await storage.remove(pathList.slice(index,index+100));
        if(removeError)throw new Error(`Inventory photo removal failed: ${removeError.message}`);
      }
      for(const item of items){
        if(!item.value?.photo?.path)continue;
        const value={...item.value,updatedAt:new Date(now()).toISOString()};
        delete value.photo;
        const {data:updated,error:updateError}=await db.from("hmp_seating_records")
          .update({value,updated_at:value.updatedAt}).eq("key",item.key)
          .eq("value->>version",item.value.version).select("key").maybeSingle();
        if(updateError||!updated)throw new Error(`Inventory photo reference cleanup failed: ${updateError?.code||"conflict"}`);
      }
      const {data:current,error:currentError}=await db.from("hmp_seating_records").select("value").eq("key",row.key).maybeSingle();
      if(currentError||!current||current.value.endAt!==event.endAt||current.value.date!==event.date)throw new Error("Inventory event changed during photo cleanup; retry later.");
      const updatedEvent={...current.value,photosPurgedAt:new Date(now()).toISOString()};
      const {error:markError}=await db.from("hmp_seating_records").update({value:updatedEvent,updated_at:updatedEvent.photosPurgedAt}).eq("key",row.key);
      if(markError)throw new Error(`Inventory cleanup marker failed: ${markError.code}`);
      purged+=paths.size;
    }
    return Response.json({purged});
  };
}

export default createPurgeInventoryPhotos();
export const config:Config={schedule:"20 * * * *"};
