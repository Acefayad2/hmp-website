const escapeHTML = (value = "") => String(value).replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
const inventoryURL = "/api/hmp-inventory";

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
        <label>Event date (optional) <input name="date" type="date" /></label>
        <button class="primary-button" type="submit">Create event inventory</button>
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
            <div class="inventory-actions">
              <button type="button" data-action="${item.status === "out" ? "check-in" : "check-out"}">${item.status === "out" ? "Check in" : "Check out"}</button>
              <button type="button" data-action="rename">Edit name/label</button>
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
      const result = await api("POST", {action:"create-event",name:form.elements.name.value,date:form.elements.date.value});
      events.push(result.event); selectedId = result.event.id; form.reset(); renderEvents(); await loadEvent(); status("Event inventory created. Add items below.", true);
    } catch (error) { status(error.message); }
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
    button.disabled = true;
    try {
      const result = await api("PATCH", {action,eventId:item.eventId,itemId:item.id,expectedVersion:item.version,...details});
      items = items.map(row => row.id === item.id ? result.item : row);
      renderItems(); status(action === "rename" ? "Item label updated." : `Item ${action === "check-in" ? "checked in" : "checked out"}.`, true);
    } catch (error) { status(error.message); button.disabled = false; }
  });
  renderItems();
  return {load};
}
