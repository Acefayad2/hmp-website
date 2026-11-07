const labels = ["Real Celebrations","Guest Experiences","Behind the Scenes","Event Inspiration"];
const ids = ["celebrations","guests","behind-scenes","inspiration"];
const escape = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
const endpoint = "/api/hmp-blog?admin=1";

export function mountBlogHub({root,onAuthRequired=()=>{}}){
  let stories=[],settings=null,selected=null,mediaPaths=[];
  root.innerHTML=`<div class="blog-admin-layout">
    <section class="blog-admin-card"><h3>Page and section titles</h3><p>These titles appear on the public journal.</p>
      <form id="blog-settings-form" class="blog-admin-form">
        <label>Page title <input name="title" maxlength="120" required></label>
        <label>Page introduction <textarea name="subtitle" maxlength="400" rows="2"></textarea></label>
        ${labels.map((label,i)=>`<label>Section ${i+1} <input name="category${i}" maxlength="60" required placeholder="${escape(label)}"></label>`).join("")}
        <button class="primary-button" type="submit">Save page titles</button>
      </form>
    </section>
    <section class="blog-admin-card"><div class="blog-admin-heading"><h3>Stories</h3><button class="agreement-button secondary" type="button" id="blog-new">New story</button></div>
      <div id="blog-story-list"></div>
    </section>
    <section class="blog-admin-card"><h3 id="blog-editor-heading">New story</h3><p>Save a draft until the story is ready for the public website.</p>
      <form id="blog-story-form" class="blog-admin-form">
        <label>Story title <input name="title" maxlength="160" required></label>
        <label>Section <select name="category" required>${ids.map((id,i)=>`<option value="${id}">${labels[i]}</option>`).join("")}</select></label>
        <label>Short introduction <textarea name="summary" maxlength="500" rows="3"></textarea></label>
        <label>Story text <textarea name="content" maxlength="16000" rows="9"></textarea></label>
        <label>Photos and short videos (up to 10 files, 50 MB each) <input name="media" type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,.mov"></label>
        <div id="blog-media-preview"></div>
        <label class="blog-admin-check"><input name="featured" type="checkbox"> Feature on the public journal</label>
        <div class="blog-admin-actions"><button class="agreement-button secondary" type="button" data-save="draft">Save draft</button><button class="primary-button" type="button" data-save="published">Publish story</button><button class="agreement-button secondary" type="button" data-save="unpublish" hidden>Unpublish</button></div>
      </form>
    </section>
  </div><p id="blog-admin-status" role="status" aria-live="polite"></p>`;
  const $=selector=>root.querySelector(selector);
  const status=(message,good=false)=>{$("#blog-admin-status").textContent=message;$("#blog-admin-status").classList.toggle("success",good);};
  async function api(payload){
    const response=await fetch(endpoint,{method:payload?"POST":"GET",credentials:"same-origin",cache:"no-store",...(payload?{headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)}:{})});
    if(response.status===401){onAuthRequired();throw Error("Admin verification expired. Sign in again.");}
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||"Blog Hub is unavailable.");
    return data;
  }
  function renderList(){
    const list=$("#blog-story-list");
    list.innerHTML=stories.length?stories.map(story=>`<button class="blog-story-row" data-id="${escape(story.id)}" type="button"><strong>${escape(story.title)}</strong><span>${escape(settings?.categories?.[ids.indexOf(story.category)]||labels[ids.indexOf(story.category)]||"")} · ${escape(story.status)}</span></button>`).join(""):`<p>No stories yet. Create one below.</p>`;
  }
  function renderForm(){
    const form=$("#blog-story-form"),story=stories.find(x=>x.id===selected);
    $("#blog-editor-heading").textContent=story?"Edit story":"New story";
    form.elements.title.value=story?.title||"";
    form.elements.category.value=story?.category||ids[0];
    form.elements.summary.value=story?.summary||"";
    form.elements.content.value=story?.content||"";
    form.elements.featured.checked=Boolean(story?.featured);
    form.elements.media.value="";
    mediaPaths=Array.isArray(story?.mediaPaths)?[...story.mediaPaths]:story?.mediaPath?[story.mediaPath]:[];
    renderMedia();
    form.querySelector('[data-save="unpublish"]').hidden=story?.status!=="published";
  }
  function renderMedia(){
    const story=stories.find(x=>x.id===selected);
    const media=story?.media||[];
    $("#blog-media-preview").innerHTML=mediaPaths.length?`<p>Current media (${mediaPaths.length}/10). The first file is the story cover.</p><div class="blog-admin-media-grid">${mediaPaths.map((path,i)=>{
      const item=media.find(x=>x.path===path),url=item?.url||"",type=path.split(".").at(-1);
      return `<div class="blog-admin-media-item">${url?(["mp4","mov","webm"].includes(type)?`<video controls preload="metadata" src="${escape(url)}"></video>`:`<img src="${escape(url)}" alt="Story media ${i+1}">`):`<span>New upload ${i+1}</span>`}<button type="button" data-remove-media="${i}" aria-label="Remove media ${i+1}">Remove</button></div>`;
    }).join("")}</div>`:"";
  }
  async function load(){
    status("Loading Blog Hub…");
    try{const data=await api();settings=data.settings;stories=data.stories||[];
      const form=$("#blog-settings-form");form.elements.title.value=settings.title;form.elements.subtitle.value=settings.subtitle;
      settings.categories.forEach((value,i)=>{form.elements[`category${i}`].value=value;});
      renderList();renderForm();status("");
    }catch(error){status(error.message);}
  }
  $("#blog-settings-form").addEventListener("submit",async event=>{
    event.preventDefault();const form=event.currentTarget;
    try{const data=await api({action:"settings",title:form.elements.title.value,subtitle:form.elements.subtitle.value,categories:ids.map((_,i)=>form.elements[`category${i}`].value)});settings=data.settings;renderList();status("Public page titles saved.",true);}catch(error){status(error.message);}
  });
  $("#blog-new").addEventListener("click",()=>{selected=null;renderForm();$("#blog-story-form").scrollIntoView({block:"start"});});
  $("#blog-story-list").addEventListener("click",event=>{const row=event.target.closest("[data-id]");if(!row)return;selected=row.dataset.id;renderForm();$("#blog-story-form").scrollIntoView({block:"start"});});
  $("#blog-media-preview").addEventListener("click",event=>{const button=event.target.closest("[data-remove-media]");if(!button)return;mediaPaths.splice(Number(button.dataset.removeMedia),1);renderMedia();});
  $("#blog-story-form").addEventListener("click",async event=>{
    const button=event.target.closest("[data-save]");if(!button)return;
    const form=$("#blog-story-form"),intent=button.dataset.save;
    if(!form.reportValidity())return;
    const files=[...(form.elements.media.files||[])];
    if(mediaPaths.length+files.length>10){status("A story can have up to 10 photos and videos.");return;}
    if(files.some(file=>file.size>50*1024*1024)){status("Each photo or video must be under 50 MB.");return;}
    button.disabled=true;
    try{
      for(const [i,file] of files.entries()){status(`Uploading file ${i+1} of ${files.length}…`);
        const prepared=await api({action:"prepare-media",type:file.type,size:file.size});
        const upload=new FormData();upload.append("cacheControl","3600");upload.append("",file,file.name);
        const result=await fetch(prepared.signedUrl,{method:"PUT",headers:{"x-upsert":"false"},body:upload});
        if(!result.ok)throw Error(`File ${i+1} did not upload. Try again.`);
        mediaPaths.push(prepared.path);
      }
      form.elements.media.value="";
      renderMedia();
      const data=await api({action:"save-story",id:selected,title:form.elements.title.value,category:form.elements.category.value,summary:form.elements.summary.value,content:form.elements.content.value,featured:form.elements.featured.checked,mediaPaths,status:intent==="published"?"published":"draft"});
      selected=data.story.id;await load();status(intent==="published"?"Story published on the website.":intent==="unpublish"?"Story unpublished and saved privately.":"Draft saved privately.",true);
    }catch(error){form.elements.media.value="";renderMedia();status(error.message);}finally{button.disabled=false;}
  });
  return{load};
}
