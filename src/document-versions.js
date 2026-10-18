import {agreementRequest} from "../agreement-ui.mjs";

// Shared admin-only controls. Creating/restoring a version never sends it.
export function mountDocumentVersions(container,{kind,id,status,open,beforeSwitch=()=>true}) {
  container.querySelector("[data-document-versions]")?.remove();
  if(!id)return;
  const panel=document.createElement("section");
  panel.dataset.documentVersions=""; panel.className="agreement-panel";
  const actions=document.createElement("div");actions.className="agreement-actions";
  const note=document.createElement("p");
  note.textContent="Revisions are saved privately as drafts. Resend or share a revision when it is ready; the client’s existing link will then show the latest issued copy. Signed and paid originals are preserved.";
  const feedback=document.createElement("p");feedback.setAttribute("role","status");
  let creating=false, requestId="";
  const revise=async(source=id)=>{
    if(creating||!beforeSwitch())return;
    if(!confirm("Create a new draft from this version? The original stays unchanged. Nothing will be sent until you explicitly send or share the draft."))return;
    creating=true; requestId ||= crypto.randomUUID();
    feedback.textContent="Creating private revision…";
    try{
      const data=await agreementRequest("/api/hmp-document-versions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind,id:source,requestId})});
      requestId="";
      historyDialog?.close();
      await open(data.id,null,true);
      window.dispatchEvent(new Event("hmp-drafts-changed"));
    }catch(error){feedback.textContent=error.message;}finally{creating=false;}
  };
  if(status!=="Draft"&&status!=="Void"){
    const create=document.createElement("button");create.type="button";create.className="agreement-button secondary";create.textContent="Create revision";
    create.onclick=()=>revise();actions.append(create);
  }
  const history=document.createElement("button");history.type="button";history.className="agreement-button secondary";history.textContent="Version history";
  actions.append(history);panel.append(note,actions,feedback);
  const form=container.querySelector("form");
  if(form)form.before(panel);else container.append(panel);
  let historyDialog;
  history.onclick=async()=>{
    if(!beforeSwitch())return;
    historyDialog?.remove();
    historyDialog=document.createElement("dialog");historyDialog.className="agreement-dialog";historyDialog.setAttribute("aria-label","Document version history");
    document.body.append(historyDialog);
    const title=document.createElement("h2");title.textContent="Version history";
    const explanation=document.createElement("p");explanation.textContent="Latest five versions. Older versions are kept in the private archive below. Restore creates a new draft; it never overwrites the original.";
    const close=document.createElement("button");close.type="button";close.className="agreement-button secondary";close.textContent="Close history";close.onclick=()=>historyDialog.close();
    const list=document.createElement("div"), more=document.createElement("button"), message=document.createElement("p");
    more.type="button";more.className="agreement-button secondary";more.textContent="Show older archived versions";more.hidden=true;
    message.setAttribute("role","status");
    historyDialog.append(title,explanation,close,list,more,message);historyDialog.showModal();
    let offset=0;
    const load=async()=>{
      more.disabled=true;message.textContent="Loading versions…";
      try{
        const data=await agreementRequest(`/api/hmp-document-versions?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}&offset=${offset}`);
        for(const version of data.versions){
          const row=document.createElement("section");row.className="agreement-panel";
          const heading=document.createElement("h3");heading.textContent=`Version ${version.version} · ${version.title}`;
          const detail=document.createElement("p");detail.textContent=`${version.status}${version.createdAt?` · ${new Date(version.createdAt).toLocaleString()}`:""}${offset>=5?" · Private archive":""}`;
          const view=document.createElement("button");view.type="button";view.className="agreement-button secondary";view.textContent=version.status==="Draft"?"Open draft":"View original";
          view.onclick=async()=>{try{await open(version.id,version.record,false);historyDialog.close();}catch(error){message.textContent=error.message;}};
          row.append(heading,detail,view);
          if(version.status!=="Draft"&&version.canRevise){
            const restore=document.createElement("button");restore.type="button";restore.className="agreement-button secondary";restore.textContent="Restore as new draft";
            restore.onclick=async()=>{await revise(version.id);message.textContent=feedback.textContent;};row.append(restore);
          }
          list.append(row);
        }
        offset+=5;more.hidden=!data.hasMore;message.textContent=data.versions.length?"":"No versions found.";
      }catch(error){message.textContent=error.message;}finally{more.disabled=false;}
    };
    more.onclick=load;await load();
  };
}
