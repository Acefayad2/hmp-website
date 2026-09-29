import { installPageSearch } from "./page-search.js";

installPageSearch({
  root: document.querySelector(".hub-shell"),
  mount: document.querySelector("#hub-search"),
  id: "workspace-search", label: "Search workspaces",
  placeholder: "Admin, messages, receipts, seating…",
  items: ".workspace", containers: [document.querySelector("#workspace-list")],
});
