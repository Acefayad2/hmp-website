import {createClient} from "@supabase/supabase-js";
import {getUser} from "./_admin-verification.mts";
import {ATTACHMENT_BUCKET} from "./_conversation-attachments.mts";

const key = "blog/settings";
const storyKey = (id:string) => `blog/story/${id}`;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const categoryIds = ["celebrations","guests","behind-scenes","inspiration"];
const defaults = {title:"Our Moments",subtitle:"A visual journal of events and the details that make them unforgettable.",categories:["Real Celebrations","Guest Experiences","Behind the Scenes","Event Inspiration"]};
const types:Record<string,string> = {"image/jpeg":"jpg","image/png":"png","image/webp":"webp","video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov"};
const respond = (data:unknown,status=200) => Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const tidy = (value:unknown,max:number) => typeof value === "string" ? value.trim().slice(0,max+1) : "";
const db = () => createClient(Netlify.env.get("SUPABASE_URL")!,Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});

export function createBlogHandler({getUserFn=getUser,databaseFactory=db}={}) {
  return async (request:Request) => {
    if (!["GET","POST"].includes(request.method)) return respond({error:"Method not allowed."},405);
    const url = new URL(request.url);
    const admin = url.searchParams.get("admin") === "1" || request.method === "POST";
    if (request.method === "POST" && request.headers.get("origin") !== url.origin) return respond({error:"Invalid request origin."},403);
    if (admin) {
      const user = await getUserFn(request);
      const allowed = (Netlify.env.get("HMP_ADMIN_EMAILS") || "").toLowerCase().split(",").map(x=>x.trim());
      if (!user?.email || !allowed.includes(user.email.toLowerCase())) return respond({error:"Admin sign-in required."},401);
    }
    const client = databaseFactory();
    try {
      if (request.method === "GET") {
        const [settingsResult,storiesResult] = await Promise.all([
          client.from("hmp_seating_records").select("value").eq("key",key).maybeSingle(),
          client.from("hmp_seating_records").select("value").like("key","blog/story/%").limit(200),
        ]);
        if (settingsResult.error || storiesResult.error) return respond({error:"The journal is temporarily unavailable."},503);
        const stories = (storiesResult.data || []).map((row:{value:any})=>row.value).filter((story:any)=>admin || story.status === "published");
        const withMedia = await Promise.all(stories.map(async (story:any)=> {
          const paths=Array.isArray(story.mediaPaths)?story.mediaPaths:story.mediaPath?[story.mediaPath]:[];
          const media=await Promise.all(paths.map(async (path:string)=>{
            const {data}=await client.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path,3600);
            return {path,type:path.split(".").at(-1),url:data?.signedUrl||""};
          }));
          return {...story,media};
        }));
        return respond({settings:{...defaults,...settingsResult.data?.value},stories:withMedia.sort((a:any,b:any)=>String(b.publishedAt||b.updatedAt).localeCompare(String(a.publishedAt||a.updatedAt)))});
      }
      const body = await request.json().catch(()=>null);
      if (!body || typeof body !== "object") return respond({error:"Check the blog details."},400);
      if (body.action === "settings") {
        const title=tidy(body.title,120),subtitle=tidy(body.subtitle,400);
        const categories=Array.isArray(body.categories) ? body.categories.map((x:unknown)=>tidy(x,60)) : [];
        if (!title || title.length>120 || subtitle.length>400 || categories.length!==4 || categories.some((x:string)=>!x||x.length>60)) return respond({error:"Enter the page title and all four section titles."},400);
        const value={title,subtitle,categories};
        const {error}=await client.from("hmp_seating_records").upsert({key,value,updated_at:new Date().toISOString()},{onConflict:"key"});
        return error?respond({error:"Section titles could not be saved."},503):respond({settings:value});
      }
      if (body.action === "prepare-media") {
        const type=tidy(body.type,80).toLowerCase(),size=Number(body.size);
        if (!types[type] || !Number.isFinite(size) || size<1 || size>50*1024*1024) return respond({error:"Choose a JPG, PNG, WebP, MP4, WebM, or MOV file under 50 MB."},400);
        const path=`blog/${crypto.randomUUID()}.${types[type]}`;
        const {data,error}=await client.storage.from(ATTACHMENT_BUCKET).createSignedUploadUrl(path);
        return error||!data?.signedUrl?respond({error:"Media upload is unavailable."},503):respond({path,signedUrl:data.signedUrl});
      }
      if (body.action === "save-story") {
        const id=body.id && uuid.test(body.id) ? body.id : crypto.randomUUID();
        const title=tidy(body.title,160),summary=tidy(body.summary,500),content=tidy(body.content,16000);
        const category=tidy(body.category,30);
        const mediaPaths=Array.isArray(body.mediaPaths)?body.mediaPaths.map((x:unknown)=>tidy(x,150)):body.mediaPath?[tidy(body.mediaPath,150)]:[];
        const status=body.status === "published" ? "published" : "draft";
        if (!title || title.length>160 || summary.length>500 || content.length>16000 || !categoryIds.includes(category)) return respond({error:"Add a story title and choose one of the four sections."},400);
        if (status === "published" && !summary && !content) return respond({error:"Add a summary or story text before publishing."},400);
        if (mediaPaths.length>10 || new Set(mediaPaths).size!==mediaPaths.length) return respond({error:"Use up to 10 different photos or videos per story."},400);
        for (const mediaPath of mediaPaths) {
          if (!/^blog\/[\da-f-]+\.(jpg|png|webp|mp4|webm|mov)$/i.test(mediaPath)) return respond({error:"Upload each photo or video from Blog Hub first."},400);
          const name=mediaPath.slice(5);
          const {data,error}=await client.storage.from(ATTACHMENT_BUCKET).list("blog",{limit:100,search:name});
          if (error || !data?.some((file:{name:string})=>file.name===name)) return respond({error:"A photo or video upload has not finished."},400);
        }
        const {data:existing,error:readError}=await client.from("hmp_seating_records").select("value").eq("key",storyKey(id)).maybeSingle();
        if (readError) return respond({error:"Story could not be checked."},503);
        const now=new Date().toISOString();
        const story={id,title,summary,content,category,mediaPaths,status,featured:body.featured===true,createdAt:existing?.value?.createdAt||now,updatedAt:now,publishedAt:status==="published"?(existing?.value?.publishedAt||now):null};
        const {error}=await client.from("hmp_seating_records").upsert({key:storyKey(id),value:story,updated_at:now},{onConflict:"key"});
        if (error) return respond({error:"Story could not be saved."},503);
        const oldPaths=Array.isArray(existing?.value?.mediaPaths)?existing.value.mediaPaths:existing?.value?.mediaPath?[existing.value.mediaPath]:[];
        const removed=oldPaths.filter((path:string)=>!mediaPaths.includes(path));
        if (removed.length) await client.storage.from(ATTACHMENT_BUCKET).remove(removed);
        return respond({story});
      }
      if (body.action === "delete-story") {
        if (!uuid.test(body.id)) return respond({error:"Choose a story."},400);
        const {error}=await client.from("hmp_seating_records").delete().eq("key",storyKey(body.id));
        return error?respond({error:"Story could not be deleted."},503):respond({deleted:true});
      }
      return respond({error:"Choose a Blog Hub action."},400);
    } catch { return respond({error:"Blog Hub is temporarily unavailable."},503); }
  };
}

export default createBlogHandler();
export const config={path:"/api/hmp-blog"};
