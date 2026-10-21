export function mountAdminNotifications({button, dialog, openDocument, fetchFn=fetch}) {
  const list=dialog.querySelector("[data-notification-list]");
  const status=dialog.querySelector("[data-notification-status]");
  let rows=[],loading=false,lastRender="";
  function render() {
    button.textContent=`Notifications${rows.some(row=>!row.read)?` (${rows.filter(row=>!row.read).length})`:""}`;
    const next=JSON.stringify(rows);
    if(next===lastRender) return;
    lastRender=next;list.replaceChildren();
    for(const row of rows) {
      const item=document.createElement("li");item.className="admin-notification";
      const title=document.createElement("strong");title.textContent=`${row.read?"":"New · "}${row.clientName} ${row.kind==="agreement_signed"?"signed an agreement":"completed a form"}`;
      const detail=document.createElement("p");detail.textContent=row.title;
      const meta=document.createElement("p");meta.className="notification-meta";meta.textContent=`${new Date(row.createdAt).toLocaleString()} · ${row.emailStatus}`;
      const open=document.createElement("button");open.type="button";open.className="secondary-button";open.textContent="View document";
      open.addEventListener("click",async()=>{
        open.disabled=true;
        try {
          dialog.close();
          if(!await openDocument(row)) throw new Error("Document could not be opened. Please try again.");
          await markRead(row);
        }
        catch(error){if(!dialog.open)dialog.showModal();status.textContent=error.message || "Document could not be opened.";}
        finally{open.disabled=false;}
      });
      item.append(title,detail,meta,open);
      if(!row.read) {
        const read=document.createElement("button");read.type="button";read.className="text-button";read.textContent="Mark read";
        read.addEventListener("click",async()=>{read.disabled=true;try{await markRead(row);}catch(error){status.textContent=error.message;}finally{read.disabled=false;}});
        item.append(read);
      }
      list.append(item);
    }
  }
  async function markRead(row) {
    if(row.read) return;
    const response=await fetchFn("/api/hmp-notifications",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"read",id:row.id})});
    if(!response.ok) throw new Error("Could not mark the notification read. Please try again.");
    row.read=true;
    rows=rows.map(item=>item.id===row.id?{...item,read:true}:item);
    render();
  }
  async function refresh() {
    if(loading) return;loading=true;
    try {
      const response=await fetchFn("/api/hmp-notifications",{credentials:"same-origin",cache:"no-store"});
      if(!response.ok) throw new Error("Notifications could not be loaded. Please refresh.");
      rows=(await response.json()).notifications || [];render();
      status.textContent=rows.length?"Showing the latest 100 notifications. Read status is saved for your Admin account.":"No new form completions or signatures since notifications were enabled.";
    } catch(error){status.textContent=error.message;button.textContent="Notifications · unavailable";}
    finally{loading=false;}
  }
  button.addEventListener("click",()=>{dialog.showModal();void refresh();});
  dialog.querySelector("[data-notifications-close]").addEventListener("click",()=>dialog.close());
  dialog.querySelector("[data-notifications-refresh]").addEventListener("click",()=>void refresh());
  return {refresh,open:()=>{if(!dialog.open)dialog.showModal();void refresh();}};
}
