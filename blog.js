const ids=["celebrations","guests","behind-scenes","inspiration"];
const defaults=["Real Celebrations","Guest Experiences","Behind the Scenes","Event Inspiration"];
const categoryMedia=[
  {image:"/assets/gallery-details-v2.webp",description:"Weddings, galas, birthdays, and more."},
  {image:"/assets/guest-check-in-kiosks.webp",description:"Thoughtful ways to welcome every guest."},
  {image:"/assets/modern-money-table.webp",description:"Planning, preparation, and purposeful details."},
  {image:"/assets/gallery-reception-v2.webp",description:"Ideas and elevated touches for your event."}
];
const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
let stories=[],categories=defaults,active="all";
const grid=document.querySelector("#blog-grid");
function media(story,item=story.media?.[0]){
  if(!item?.url)return `<div class="blog-card-placeholder" aria-hidden="true">HMP</div>`;
  return ["mp4","mov","webm"].includes(item.type)?`<video controls preload="metadata" playsinline src="${escape(item.url)}" aria-label="Video for ${escape(story.title)}"></video>`:`<img src="${escape(item.url)}" loading="lazy" alt="${escape(story.title)}">`;
}
function card(story){
  const category=categories[ids.indexOf(story.category)]||"HMP Journal";
  return `<article class="blog-card"><div class="blog-card-media">${media(story)}</div><div class="blog-card-copy"><p class="eyebrow">${escape(category)}</p><h3>${escape(story.title)}</h3><p>${escape(story.summary||story.content.slice(0,220))}</p>${story.content?`<button type="button" class="blog-read" data-read="${escape(story.id)}">Read story <span aria-hidden="true">↗</span></button>`:""}</div></article>`;
}
function render(){
  const shown=active==="all"?stories:stories.filter(story=>story.category===active);
  grid.innerHTML=shown.length?shown.map(card).join(""):`<div class="blog-empty"><p class="eyebrow">The journal</p><h3>More stories are on the way.</h3><p>Check back as HMP shares moments from the events we love creating.</p></div>`;
  document.querySelectorAll("[data-filter]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.filter===active)));
}
function openStory(story){
  const dialog=document.createElement("dialog");dialog.className="blog-story-dialog";
  dialog.innerHTML=`<div class="blog-dialog-head"><p class="eyebrow">${escape(categories[ids.indexOf(story.category)]||"HMP Journal")}</p><button type="button" aria-label="Close story">Close ×</button></div><h2>${escape(story.title)}</h2>${story.media?.length?`<div class="blog-dialog-gallery">${story.media.map(item=>`<div class="blog-dialog-media">${media(story,item)}</div>`).join("")}</div>`:""}<div class="blog-story-text">${escape(story.content).split(/\n\s*\n/).filter(Boolean).map(p=>`<p>${p.replace(/\n/g,"<br>")}</p>`).join("")}</div>`;
  document.body.append(dialog);
  dialog.querySelector("button").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("close",()=>dialog.remove());
  dialog.showModal();
}
grid.addEventListener("click",event=>{const button=event.target.closest("[data-read]");if(button){const story=stories.find(x=>x.id===button.dataset.read);if(story)openStory(story);}});
document.querySelector("#blog-filters").addEventListener("click",event=>{const button=event.target.closest("[data-filter]");if(!button)return;active=button.dataset.filter;render();});
try{
  const response=await fetch("/api/hmp-blog",{cache:"no-store"});
  if(!response.ok)throw Error("Stories are temporarily unavailable.");
  const data=await response.json();stories=data.stories||[];categories=data.settings?.categories||defaults;
  document.querySelector("#blog-title").textContent=data.settings?.title||"Our Moments";
  document.querySelector("#blog-subtitle").textContent=data.settings?.subtitle||"A visual journal of events and the details that make them unforgettable.";
  document.querySelector("#blog-filters").innerHTML=`<button type="button" class="blog-filter-all" data-filter="all" aria-pressed="true">All stories <span aria-hidden="true">→</span></button>`+ids.map((id,i)=>`<button type="button" class="blog-category" data-filter="${id}" aria-pressed="false"><img src="${categoryMedia[i].image}" alt="" loading="lazy"><span class="blog-category-copy"><strong>${escape(categories[i])}</strong><span>${categoryMedia[i].description}</span><em>View stories <span aria-hidden="true">→</span></em></span></button>`).join("");
  const featured=stories.find(story=>story.featured)||stories[0];
  if(featured){const section=document.querySelector("#blog-featured");section.hidden=false;section.innerHTML=`<div class="blog-featured-media">${media(featured)}</div><div class="blog-featured-copy"><p class="eyebrow">Featured story</p><h2>${escape(featured.title)}</h2><p>${escape(featured.summary||featured.content.slice(0,240))}</p>${featured.content?`<button type="button" class="blog-read" data-featured="${escape(featured.id)}">Read the story ↗</button>`:""}</div>`;section.querySelector("[data-featured]")?.addEventListener("click",()=>openStory(featured));}
  render();
}catch(error){grid.innerHTML=`<div class="blog-empty"><h3>Stories are temporarily unavailable.</h3><p>Please check back soon.</p></div>`;}
