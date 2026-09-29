// Search only the records already loaded for this page. Never fetch or save queries.
export const searchText = (...values) => values.flat(Infinity)
  .filter(value => typeof value === "string" || typeof value === "number")
  .join(" ");

const normalize = value => String(value ?? "").normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function matchesSearch(text, query) {
  const haystack = normalize(text);
  return normalize(query).trim().split(/\s+/).filter(Boolean).every(term => haystack.includes(term));
}

export function installPageSearch({ root, mount = root, id, label, placeholder, items, containers }) {
  const controls = document.createElement("div");
  controls.className = "page-search";
  controls.setAttribute("role", "search");
  controls.setAttribute("aria-label", label);
  const field = document.createElement("label");
  field.htmlFor = id;
  field.textContent = label;
  const row = document.createElement("div");
  row.className = "page-search-row";
  const input = document.createElement("input");
  input.id = id;
  input.type = "search";
  input.placeholder = placeholder;
  input.autocomplete = "off";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Clear";
  clear.setAttribute("aria-label", `Clear ${label.toLowerCase()}`);
  const status = document.createElement("p");
  status.id = `${id}-status`;
  status.setAttribute("role", "status");
  input.setAttribute("aria-describedby", status.id);
  input.setAttribute("aria-controls", containers.map(container => container.id).filter(Boolean).join(" "));
  row.append(input, clear);
  controls.append(field, row, status);
  mount.prepend(controls);
  const apply = () => {
    const records = [...root.querySelectorAll(items)];
    let matches = 0;
    for (const record of records) {
      const found = matchesSearch(searchText(record.textContent, record.dataset.searchText), input.value);
      record.dataset.searchHidden = String(!found);
      if (found) matches++;
    }
    clear.disabled = !input.value;
    status.textContent = !input.value.trim() ? "" : matches
      ? `${matches} of ${records.length} items match.`
      : "No matches on this page. Try another search or clear the search.";
  };
  input.addEventListener("input", apply);
  input.addEventListener("search", apply);
  clear.addEventListener("click", () => { input.value = ""; apply(); input.focus(); });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); input.value = ""; apply(); }
  });
  // Data refreshes replace rows. Reapply without replacing the input or any editors.
  const observer = new MutationObserver(apply);
  for (const container of containers) observer.observe(container, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ["data-search-text"],
  });
  apply();
  return { input, apply, disconnect: () => observer.disconnect() };
}
