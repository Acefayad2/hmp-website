const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
const inventoryURL = "/api/hmp-inventory";
const localDateTime = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
};

export function mountEventInventory({root, onAuthRequired = () => {}}) {
  let events = [];
  let currentEvent = null;
  let items = [];
  let selectedId = new URLSearchParams(location.search).get("event") || "";
  const targetItemId = new URLSearchParams(location.search).get("item") || "";
  let loaded = false;
  let busy = false;

  root.innerHTML = `
    <div class="inventory-panel">
      <div class="inventory-toolbar">
        <label>Event <select id="inventory-event"><option value="">Choose an event</option></select></label>
        <button class="agreement-button secondary" type="button" id="inventory-refresh">Refresh</button>
        <button class="agreement-button secondary" type="button" id="inventory-print-all" disabled>Print QR labels</button>
      </div>
      <form id="inventory-create-event" class="inventory-form">
        <h3>Create inventory for an event</h3>
        <label>Event name <input name="name" required maxlength="120" placeholder="Event name" /></label>
        <label>Event ends (local date and time) <input name="end" type="datetime-local" required /></label>
        <button class="primary-button" type="submit">Create event inventory</button>
      </form>
      <form id="inventory-event-end" class="inventory-form" hidden>
        <label>Event ends (local date and time) <input name="end" type="datetime-local" required /></label>
        <button class="agreement-button secondary" type="submit">Save end time</button>
        <p id="inventory-photo-deadline"></p>
      </form>
      <form id="inventory-add-items" class="inventory-form" hidden>
        <h3>Add items</h3>
        <p>One item per line. To print a different QR label, enter <strong>item name | printed label</strong>.</p>
        <label>Inventory items <textarea name="items" rows="5" required placeholder="Gift boxes\nTable signs | Table signs – ballroom"></textarea></label>
        <button class="primary-button" type="submit">Save items and create QR codes</button>
      </form>
      <p id="inventory-status" role="status" aria-live="polite"></p>
      <div id="inventory-list"></div>
    </div>`;
  const $ = selector => root.querySelector(selector);
  const status = (message, good = false) => { const node = $("#inventory-status"); node.textContent = message; node.classList.toggle("success", good); };
  async function api(method, payload, query = "") {
    const response = await fetch(inventoryURL + query, {
      method, credentials: "same-origin", cache: "no-store",
      ...(payload ? {headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)} : {}),
    });
    if (response.status === 401) { onAuthRequired(); throw new Error("Admin verification expired. Please sign in again."); }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Inventory request failed. Please try again.");
    return data;
  }
  function renderEvents() {
    const select = $("#inventory-event");
    select.innerHTML = `<option value="">Choose an event</option>` + events
      .sort((a,b) => a.name.localeCompare(b.name))
      .map(event => `<option value="${escapeHTML(event.id)}">${escapeHTML(event.name)}${event.date ? ` · ${escapeHTML(event.date)}` : ""}</option>`).join("");
    select.value = events.some(event => event.id === selectedId) ? selectedId : "";
  }
  function renderItems() {
    $("#inventory-add-items").hidden = !currentEvent;
    const endForm = $("#inventory-event-end");
    endForm.hidden = !currentEvent;
    if (currentEvent) {
      endForm.elements.end.value = currentEvent.endAt ? localDateTime(currentEvent.endAt) : "";
      $("#inventory-photo-deadline").textContent = currentEvent.photoDeleteAt
        ? `Photos are deleted 24 hours after the event ends: ${new Date(currentEvent.photoDeleteAt).toLocaleString()}. Uploads close two hours before that time. Inventory records remain.`
        : "Set the event end date and time to schedule photo deletion. Inventory records remain.";
    }
    $("#inventory-print-all").disabled = !items.length;
    const list = $("#inventory-list");
    if (!currentEvent) { list.innerHTML = `<p class="inventory-empty">Choose or create an event to manage its inventory.</p>`; return; }
    if (!items.length) { list.innerHTML = `<p class="inventory-empty">No items yet. Add an item above to create its QR code.</p>`; return; }
    list.innerHTML = `<h3>${escapeHTML(currentEvent.name)} · ${items.length} item${items.length === 1 ? "" : "s"}</h3><div class="inventory-grid">` +
      [...items].sort((a,b) => a.name.localeCompare(b.name)).map(item => `
        <article class="inventory-card" id="inventory-item-${escapeHTML(item.id)}" data-id="${escapeHTML(item.id)}">
          <img class="inventory-qr" src="${inventoryURL}?qr=1&amp;event=${encodeURIComponent(currentEvent.id)}&amp;item=${encodeURIComponent(item.id)}" alt="QR code for ${escapeHTML(item.label)}" width="128" height="128" />
          <div class="inventory-card-body">
            <h4>${escapeHTML(item.name)}</h4>
            <p class="inventory-label">Printed label: ${escapeHTML(item.label)}</p>
            <p class="inventory-state ${item.status === "out" ? "is-out" : ""}">${item.status === "out" ? "Checked out" : "In inventory"}</p>
            <p class="inventory-last">${item.history?.length ? `Last action: ${escapeHTML(item.history.at(-1).action === "check-in" ? "Checked in" : "Checked out")} · ${escapeHTML(new Date(item.history.at(-1).at).toLocaleString())}` : "No check-ins or check-outs yet"}</p>
            ${item.photo?.url ? `<img class="inventory-photo" src="${escapeHTML(item.photo.url)}" alt="Photo of ${escapeHTML(item.name)}" loading="lazy" />` : ""}
            <label class="inventory-detail-label">Item details <textarea class="inventory-details" maxlength="2000" rows="3" placeholder="Description, condition, location, or notes">${escapeHTML(item.details || "")}</textarea></label>
            ${currentEvent.photoDeleteAt && Date.now() < Date.parse(currentEvent.photoDeleteAt) - 2 * 60 * 60 * 1000 ? `<label class="inventory-detail-label">${item.photo?.path ? "Replace photo" : "Add photo"} <input class="inventory-file" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" /></label>` : ""}
            <div class="inventory-actions">
              <button type="button" data-action="${item.status === "out" ? "check-in" : "check-out"}">${item.status === "out" ? "Check in" : "Check out"}</button>
              <button type="button" data-action="rename">Edit name/label</button>
              <button type="button" data-action="update-details">Save details</button>
              ${currentEvent.photoDeleteAt && Date.now() < Date.parse(currentEvent.photoDeleteAt) - 2 * 60 * 60 * 1000 ? `<button type="button" data-action="attach-photo">Upload photo</button>` : ""}
              ${item.photo?.path ? `<button type="button" data-action="remove-photo">Remove photo</button>` : ""}
              <button type="button" data-action="print">Print QR</button>
            </div>
          </div>
        </article>`).join("") + `</div>`;
    if (targetItemId) list.querySelector(`#inventory-item-${CSS.escape(targetItemId)}`)?.scrollIntoView({block:"center"});
  }
  async function loadEvent() {
    currentEvent = null; items = []; renderItems();
    if (!selectedId) return;
    const data = await api("GET", null, `?event=${encodeURIComponent(selectedId)}`);
    currentEvent = data.event; items = data.items || [];
    renderItems();
  }
  async function load() {
    if (busy) return;
    busy = true; status("Loading inventory…");
    try {
      const data = await api("GET"); events = data.events || [];
      if (!loaded && selectedId && !events.some(event => event.id === selectedId)) selectedId = "";
      loaded = true; renderEvents(); await loadEvent(); status("");
    } catch (error) { status(error.message); } finally { busy = false; }
  }
  $("#inventory-event").addEventListener("change", async event => {
    selectedId = event.target.value;
    status("Loading event inventory…");
    try { await loadEvent(); status(""); } catch (error) { status(error.message); }
  });
  $("#inventory-refresh").addEventListener("click", load);
  $("#inventory-create-event").addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget;
    try {
      const end = form.elements.end.value;
      const result = await api("POST", {action:"create-event",name:form.elements.name.value,date:end.slice(0,10),endAt:new Date(end).toISOString()});
      events.push(result.event); selectedId = result.event.id; form.reset(); renderEvents(); await loadEvent(); status("Event inventory created. Add items below.", true);
    } catch (error) { status(error.message); }
  });
  $("#inventory-event-end").addEventListener("submit", async event => {
    event.preventDefault(); const end=event.currentTarget.elements.end.value;
    try {
      const result=await api("PATCH",{action:"set-event-end",eventId:selectedId,date:end.slice(0,10),endAt:new Date(end).toISOString()});
      events=events.map(row=>row.id===selectedId?result.event:row);
      currentEvent=result.event;renderEvents();renderItems();status("Event end time and photo deletion date saved.",true);
    } catch(error){status(error.message);}
  });
  $("#inventory-add-items").addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget;
    const lines = form.elements.items.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const newItems = lines.map(line => { const [name, ...parts] = line.split("|"); return {name:name.trim(),label:parts.join("|").trim()}; });
    if (newItems.length > 100) { status("Add no more than 100 items at once."); return; }
    try {
      await api("POST", {action:"add-items",eventId:selectedId,items:newItems});
      form.reset(); await loadEvent(); status(`${newItems.length} item${newItems.length === 1 ? "" : "s"} saved with QR codes.`, true);
    } catch (error) { status(error.message); }
  });
  async function printItems(printList) {
    const page = window.open("", "_blank");
    if (!page) throw new Error("Allow pop-ups to print QR labels, then try again.");
    page.document.write("<p>Preparing QR labels…</p>");
    try {
      const prepared = await Promise.all(printList.map(async item => {
        const response = await fetch(`${inventoryURL}?qr=1&event=${encodeURIComponent(item.eventId)}&item=${encodeURIComponent(item.id)}`, {credentials:"same-origin",cache:"no-store"});
        if (!response.ok) throw new Error("QR labels could not be loaded. Refresh and try again.");
        return {item,svg:await response.text()};
      }));
      page.document.open();
      page.document.write(`<!doctype html><html><head><title>HMP inventory QR labels</title><style>body{font:16px Arial;margin:24px}.labels{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.label{break-inside:avoid;border:1px solid #aaa;padding:12px;text-align:center}.label svg{width:150px;height:150px}.name{font-weight:bold;margin:7px 0}.event{font-size:12px;color:#555}button{padding:10px;margin-bottom:20px}@media print{button{display:none}}</style></head><body><button onclick="print()">Print labels</button><div class="labels">${prepared.map(({item,svg}) => `<div class="label">${svg}<div class="name">${escapeHTML(item.label)}</div><div class="event">${escapeHTML(currentEvent.name)}</div></div>`).join("")}</div></body></html>`);
      page.document.close();
    } catch (error) { page.close(); throw error; }
  }
  $("#inventory-print-all").addEventListener("click", () => { printItems(items).catch(error => status(error.message)); });
  $("#inventory-list").addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]"); if (!button) return;
    const item = items.find(row => row.id === button.closest("[data-id]")?.dataset.id); if (!item) return;
    const action = button.dataset.action;
    if (action === "print") { try { await printItems([item]); } catch (error) { status(error.message); } return; }
    let details = {};
    if (action === "rename") {
      const name = prompt("Item name", item.name); if (name === null) return;
      const label = prompt("Printed QR label", item.label); if (label === null) return;
      details = {name,label};
    }
    if (action === "update-details") details = {details:button.closest(".inventory-card").querySelector(".inventory-details").value};
    if (action === "attach-photo") {
      const file = button.closest(".inventory-card").querySelector(".inventory-file").files?.[0];
      if (!file) { status("Choose a photo for this item first."); return; }
      if (file.size > 10 * 1024 * 1024) { status("Choose a photo smaller than 10 MB."); return; }
      button.disabled = true; status("Uploading photo…");
      try {
        const upload = await api("POST", {action:"prepare-photo",eventId:item.eventId,itemId:item.id,type:file.type,size:file.size});
        const form = new FormData(); form.append("cacheControl","3600"); form.append("",file,file.name);
        const response = await fetch(upload.signedUrl,{method:"PUT",headers:{"x-upsert":"false"},body:form});
        if (!response.ok) throw new Error("Photo upload failed. Please try again.");
        const result = await api("PATCH",{action:"attach-photo",eventId:item.eventId,itemId:item.id,expectedVersion:item.version,path:upload.path});
        items = items.map(row => row.id === item.id ? result.item : row);
        renderItems(); status("Item photo saved.",true);
      } catch (error) { status(error.message); button.disabled = false; }
      return;
    }
    button.disabled = true;
    try {
      const result = await api("PATCH", {action,eventId:item.eventId,itemId:item.id,expectedVersion:item.version,...details});
      items = items.map(row => row.id === item.id ? result.item : row);
      renderItems(); status(({rename:"Item label updated.","update-details":"Item details saved.","remove-photo":"Item photo removed.","check-in":"Item checked in.","check-out":"Item checked out."})[action], true);
    } catch (error) { status(error.message); button.disabled = false; }
  });
  renderItems();
  return {load};
}
