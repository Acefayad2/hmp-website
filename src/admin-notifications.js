export function mountAdminNotifications({button, dialog, openDocument, fetchFn=fetch, confirmFn=message=>window.confirm(message)}) {
  const list=dialog.querySelector("[data-notification-list]");
  const status=dialog.querySelector("[data-notification-status]");
  const clearAll=dialog.querySelector("[data-notifications-clear]");
  let rows=[],loading=false,clearing=false,lastRender="";
  function controls() {
    clearAll.disabled=loading || clearing || !rows.length;
    dialog.querySelectorAll("[data-notification-clear]").forEach(control=>{control.disabled=loading || clearing;});
  }
  function render() {
    button.textContent=`Notifications${rows.some(row=>!row.read)?` (${rows.filter(row=>!row.read).length})`:""}`;
    const next=JSON.stringify(rows);
    if(next===lastRender) {controls();return;}
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
      const clear=document.createElement("button");clear.type="button";clear.className="text-button";clear.textContent="Clear";
      clear.setAttribute("data-notification-clear","");
      clear.setAttribute("aria-label",`Clear notification: ${row.clientName} — ${row.title}`);
      clear.addEventListener("click",()=>clearRows([row.id]));item.append(clear);
      list.append(item);
    }
    controls();
  }
  async function clearRows(ids) {
    if(loading || clearing || !ids.length) return;
    clearing=true;controls();status.textContent="Clearing notifications…";
    try {
      const response=await fetchFn("/api/hmp-notifications",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"clear",ids})});
      if(!response.ok) throw new Error("Notifications could not be cleared. Please try again.");
      rows=rows.filter(row=>!ids.includes(row.id));render();
      status.textContent=`${ids.length===1?"Notification cleared":"Notifications cleared"} from your list. Documents, notification history and other Admin accounts are unchanged.${rows.length?"":" No notifications remaining in this view. Refresh to check for more."}`;
    } catch(error) {status.textContent=error.message || "Notifications could not be cleared. Please try again.";}
    finally {clearing=false;controls();}
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
    if(loading || clearing) return;loading=true;controls();
    try {
      const response=await fetchFn("/api/hmp-notifications",{credentials:"same-origin",cache:"no-store"});
      if(!response.ok) throw new Error("Notifications could not be loaded. Please refresh.");
      rows=(await response.json()).notifications || [];render();
      status.textContent=rows.length?"Showing up to 100 uncleared notifications. Read and cleared status are saved for your Admin account.":"No uncleared notifications. New form completions and signatures will appear here.";
    } catch(error){status.textContent=error.message;button.textContent="Notifications · unavailable";}
    finally{loading=false;controls();}
  }
  button.addEventListener("click",()=>{dialog.showModal();void refresh();});
  dialog.querySelector("[data-notifications-close]").addEventListener("click",()=>dialog.close());
  dialog.querySelector("[data-notifications-refresh]").addEventListener("click",()=>void refresh());
  clearAll.addEventListener("click",()=>{
    if(loading || clearing || !rows.length) return;
    const ids=rows.map(row=>row.id);
    if(confirmFn(`Clear these ${ids.length} notifications from your Admin list? Documents and notification history will be kept. Other staff lists and any new notifications are not affected.`)) return clearRows(ids);
  });
  controls();
  return {refresh,open:()=>{if(!dialog.open)dialog.showModal();void refresh();}};
}
