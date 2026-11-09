import {createClient} from "@supabase/supabase-js";
import QRCode from "qrcode";
import {getUser} from "./_admin-verification.mts";
import {ATTACHMENT_BUCKET} from "./_conversation-attachments.mts";
import {photoDeadline,photosExpired} from "./_inventory-photo-retention.mts";

const uuid=/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const eventKey=(id:string)=>`inventory/event/${id}`;
const itemKey=(eventId:string,itemId:string)=>`inventory/${eventId}/item/${itemId}`;
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
const clean=(value:unknown,max:number)=>typeof value==="string"?value.trim().slice(0,max+1):"";
const validDate=(value:unknown)=>value===""||typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T12:00:00Z`));
const validEnd=(value:unknown)=>typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value));
const photoTypes:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/heic":"heic","image/heif":"heif"};
const maxPhotoBytes=10*1024*1024;
const photoFolder=(eventId:string,itemId:string)=>`inventory/${eventId}/${itemId}`;

export function createInventoryHandler({getUserFn=getUser,databaseFactory=()=>createClient(Netlify.env.get("SUPABASE_URL")!,Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}})}={}){
  return async function handler(request:Request){
    const user=await getUserFn(request);
    const email=user?.email?.toLowerCase();
    const allowed=(Netlify.env.get("HMP_ADMIN_EMAILS")||"").toLowerCase().split(",").map(value=>value.trim());
    if(!email||!allowed.includes(email))return reply({error:"Admin sign-in required."},401);
    if(!["GET","POST","PATCH"].includes(request.method))return reply({error:"Method not allowed."},405);
    if(request.method!=="GET"&&request.headers.get("origin")!==new URL(request.url).origin)return reply({error:"Invalid request origin."},403);
    const db=databaseFactory(),params=new URL(request.url).searchParams;
    try{
      if(request.method==="GET"){
        const eventId=params.get("event"),itemId=params.get("item");
        if(params.has("qr")){
          if(!eventId||!itemId||!uuid.test(eventId)||!uuid.test(itemId))return reply({error:"Choose an inventory item."},400);
          const {data,error}=await db.from("hmp_seating_records").select("value").eq("key",itemKey(eventId,itemId)).maybeSingle();
          if(error)return reply({error:"Inventory is unavailable."},503);
          if(!data)return reply({error:"Item not found."},404);
          const target=`https://hmpeds.com/admin?view=inventory&event=${eventId}&item=${itemId}`;
          const svg=await QRCode.toString(target,{type:"svg",width:240,margin:1,errorCorrectionLevel:"M"});
          return new Response(svg,{headers:{"Content-Type":"image/svg+xml; charset=utf-8","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
        }
        if(eventId){
          if(!uuid.test(eventId))return reply({error:"Choose a valid event."},400);
          const {data:event,error:eventError}=await db.from("hmp_seating_records").select("value").eq("key",eventKey(eventId)).maybeSingle();
          if(eventError)return reply({error:"Inventory is unavailable."},503);
          if(!event)return reply({error:"Event not found."},404);
          const {data:items,error}=await db.from("hmp_seating_records").select("value").like("key",`inventory/${eventId}/item/%`).limit(1000);
          if(error)return reply({error:"Items could not be loaded."},503);
          const expired=photosExpired(event.value);
          const signed=await Promise.all((items||[]).map(async row=>{
            const item=row.value;
            if(!item.photo?.path||expired)return {...item,photo:undefined};
            const {data}=await db.storage.from(ATTACHMENT_BUCKET).createSignedUrl(item.photo.path,3600);
            return {...item,photo:{...item.photo,url:data?.signedUrl||""}};
          }));
          return reply({event:{...event.value,photoDeleteAt:photoDeadline(event.value)?new Date(photoDeadline(event.value)!).toISOString():null},items:signed});
        }
        const {data,error}=await db.from("hmp_seating_records").select("value").like("key","inventory/event/%").limit(500);
        return error?reply({error:"Events could not be loaded."},503):reply({events:(data||[]).map(row=>row.value)});
      }
      const body=await request.json().catch(()=>null);
      if(!body||typeof body!=="object")return reply({error:"Check the inventory details."},400);
      if(request.method==="POST"&&body.action==="create-event"){
        const name=clean(body.name,120),endAt=body.endAt,date=body.date;
        if(!name||name.length>120||!validEnd(endAt)||!validDate(date)||!date)return reply({error:"Enter an event name and a valid event end date and time."},400);
        const event={id:crypto.randomUUID(),name,date,endAt,createdAt:new Date().toISOString()};
        const {error}=await db.from("hmp_seating_records").insert({key:eventKey(event.id),value:event});
        return error?reply({error:"Event could not be saved."},503):reply({event},201);
      }
      if(request.method==="PATCH"&&body.action==="set-event-end"){
        const eventId=body.eventId,endAt=body.endAt,date=body.date;
        if(typeof eventId!=="string"||!uuid.test(eventId)||!validEnd(endAt)||!validDate(date)||!date)return reply({error:"Choose a valid event end date and time."},400);
        const key=eventKey(eventId);
        const {data,error}=await db.from("hmp_seating_records").select("value").eq("key",key).maybeSingle();
        if(error)return reply({error:"Event could not be loaded."},503);
        if(!data)return reply({error:"Event not found."},404);
        const event={...data.value,date,endAt,updatedAt:new Date().toISOString()};
        delete event.photosPurgedAt;
        const result=await db.from("hmp_seating_records").update({value:event,updated_at:event.updatedAt}).eq("key",key);
        return result.error?reply({error:"Event end time could not be saved."},503):reply({event:{...event,photoDeleteAt:new Date(photoDeadline(event)!).toISOString()}});
      }
      if(request.method==="POST"&&body.action==="add-items"){
        const eventId=body.eventId;
        if(typeof eventId!=="string"||!uuid.test(eventId)||!Array.isArray(body.items)||body.items.length<1||body.items.length>100)return reply({error:"Choose an event and add up to 100 items at once."},400);
        const items=body.items.map((item:{name?:unknown;label?:unknown})=>({name:clean(item?.name,120),label:clean(item?.label,120)}));
        if(items.some((item:{name:string;label:string})=>!item.name||item.name.length>120||item.label.length>120))return reply({error:"Each item needs a name of 120 characters or less."},400);
        const {data:event,error:eventError}=await db.from("hmp_seating_records").select("key").eq("key",eventKey(eventId)).maybeSingle();
        if(eventError)return reply({error:"Event could not be checked."},503);
        if(!event)return reply({error:"Event not found."},404);
        const now=new Date().toISOString();
        const rows=items.map((item:{name:string;label:string})=>{const id=crypto.randomUUID();return {key:itemKey(eventId,id),value:{id,eventId,name:item.name,label:item.label||item.name,status:"in",history:[],version:crypto.randomUUID(),createdAt:now,updatedAt:now}};});
        const {error}=await db.from("hmp_seating_records").insert(rows);
        return error?reply({error:"Items could not be saved."},503):reply({items:rows.map(row=>row.value)},201);
      }
      if(request.method==="POST"&&body.action==="prepare-photo"){
        const {eventId,itemId}=body;
        const type=clean(body.type,80).toLowerCase(),size=Number(body.size);
        if(typeof eventId!=="string"||!uuid.test(eventId)||typeof itemId!=="string"||!uuid.test(itemId)||!photoTypes[type]||!Number.isFinite(size)||size<1||size>maxPhotoBytes)return reply({error:"Choose a JPG, PNG, WebP, or HEIC image up to 10 MB."},400);
        const {data:event,error:eventError}=await db.from("hmp_seating_records").select("value").eq("key",eventKey(eventId)).maybeSingle();
        if(eventError)return reply({error:"Event could not be checked."},503);
        if(!event)return reply({error:"Event not found."},404);
        const deadline=photoDeadline(event.value);
        if(!deadline)return reply({error:"Set the event end date and time before adding photos."},400);
        if(Date.now()>=deadline-2*60*60*1000)return reply({error:"Photo uploads close two hours before automatic deletion. Inventory details remain available."},400);
        const {data:item,error}=await db.from("hmp_seating_records").select("key").eq("key",itemKey(eventId,itemId)).maybeSingle();
        if(error)return reply({error:"Item could not be checked."},503);
        if(!item)return reply({error:"Item not found."},404);
        const path=`${photoFolder(eventId,itemId)}/${crypto.randomUUID()}.${photoTypes[type]}`;
        const {data,error:uploadError}=await db.storage.from(ATTACHMENT_BUCKET).createSignedUploadUrl(path);
        return uploadError||!data?.signedUrl?reply({error:"Photo upload is unavailable."},503):reply({path,signedUrl:data.signedUrl});
      }
      if(request.method==="PATCH"&&["check-in","check-out","rename","update-details","attach-photo","remove-photo"].includes(body.action)){
        const {eventId,itemId,expectedVersion}=body;
        if(typeof eventId!=="string"||!uuid.test(eventId)||typeof itemId!=="string"||!uuid.test(itemId)||typeof expectedVersion!=="string"||!uuid.test(expectedVersion))return reply({error:"Reopen the item and try again."},400);
        const key=itemKey(eventId,itemId);
        const {data,error}=await db.from("hmp_seating_records").select("value").eq("key",key).maybeSingle();
        if(error)return reply({error:"Item could not be loaded."},503);
        if(!data)return reply({error:"Item not found."},404);
        const previous=data.value;
        if(previous.version!==expectedVersion)return reply({error:"This item changed on another device. Refresh it before saving."},409);
        if(body.action==="attach-photo"){
          const {data:event,error:eventError}=await db.from("hmp_seating_records").select("value").eq("key",eventKey(eventId)).maybeSingle();
          if(eventError)return reply({error:"Event could not be checked."},503);
          if(!event||!photoDeadline(event.value)||photosExpired(event.value))return reply({error:"The event photo period has ended. Refresh the inventory."},400);
        }
        const next={...previous,photo:previous.photo?.path?{path:previous.photo.path}:undefined,version:crypto.randomUUID(),updatedAt:new Date().toISOString()};
        if(body.action==="rename"){
          const name=clean(body.name,120),label=clean(body.label,120);
          if(!name||name.length>120||label.length>120)return reply({error:"Enter a valid item name and QR label."},400);
          next.name=name;next.label=label||name;
        }else if(body.action==="update-details"){
          const details=clean(body.details,2000);
          if(details.length>2000)return reply({error:"Keep item details under 2,000 characters."},400);
          next.details=details;
        }else if(body.action==="attach-photo"){
          const path=clean(body.path,300);
          const prefix=`${photoFolder(eventId,itemId)}/`;
          if(!path.startsWith(prefix)||!/^inventory\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\.(jpg|png|webp|heic|heif)$/i.test(path))return reply({error:"Upload the photo for this item first."},400);
          const filename=path.slice(prefix.length);
          const {data:uploaded,error:storageError}=await db.storage.from(ATTACHMENT_BUCKET).list(photoFolder(eventId,itemId),{limit:100,search:filename});
          if(storageError||!uploaded?.some((file:{name:string})=>file.name===filename))return reply({error:"Photo upload has not finished. Try again."},400);
          next.photo={path};
        }else if(body.action==="remove-photo"){
          delete next.photo;
        }else{
          const status=body.action==="check-in"?"in":"out";
          if(previous.status===status)return reply({error:`Item is already checked ${status}. Refresh to see the latest status.`},409);
          next.status=status;
          next.history=[...(Array.isArray(previous.history)?previous.history:[]),{action:body.action,at:next.updatedAt,by:email}];
        }
        const result=await db.from("hmp_seating_records").update({value:next,updated_at:next.updatedAt}).eq("key",key).eq("value->>version",expectedVersion).select("key").maybeSingle();
        if(result.error)return reply({error:"Item could not be saved."},503);
        if(!result.data)return reply({error:"This item changed on another device. Refresh it before saving."},409);
        if(previous.photo?.path&&previous.photo.path!==next.photo?.path)await db.storage.from(ATTACHMENT_BUCKET).remove([previous.photo.path]);
        if(next.photo?.path){const {data:signed}=await db.storage.from(ATTACHMENT_BUCKET).createSignedUrl(next.photo.path,3600);next.photo={...next.photo,url:signed?.signedUrl||""};}
        return reply({item:next});
      }
      return reply({error:"Choose an inventory action."},400);
    }catch{return reply({error:"Inventory is temporarily unavailable. Try again."},503);}
  };
}

export default createInventoryHandler();
export const config={path:"/api/hmp-inventory"};
