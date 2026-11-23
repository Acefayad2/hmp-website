const BUTTON_ID = "document-back-to-top";
const STYLE_ID = "document-back-to-top-style";

export function mountBackToTop({
  root = globalThis.document,
  viewport = globalThis.window,
  label = "Back to top of document",
  threshold = 320,
} = {}) {
  if (!root?.body || !viewport?.addEventListener) return null;
  const existing = root.getElementById?.(BUTTON_ID);
  if (existing) return existing;

  if (!root.getElementById?.(STYLE_ID)) {
    const style = root.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .document-back-to-top {
        position: fixed;
        right: max(1rem, env(safe-area-inset-right));
        bottom: max(1rem, env(safe-area-inset-bottom));
        z-index: 1200;
        display: inline-grid;
        place-items: center;
        width: 3rem;
        height: 3rem;
        border: 1px solid rgba(255, 255, 255, .24);
        border-radius: 999px;
        background: #5f2435;
        color: #fff;
        box-shadow: 0 .55rem 1.5rem rgba(31, 18, 22, .24);
        cursor: pointer;
      }
      .document-back-to-top:hover { background: #461927; }
      .document-back-to-top:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
      .document-back-to-top[hidden] { display: none; }
      .document-back-to-top svg { width: 1.35rem; height: 1.35rem; }
    `;
    (root.head || root.body).append(style);
  }

  const button = root.createElement("button");
  button.id = BUTTON_ID;
  button.className = "document-back-to-top";
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.hidden = true;
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  root.body.append(button);

  let scheduled = false;
  const update = () => {
    scheduled = false;
    const top = Number(viewport.scrollY || root.documentElement?.scrollTop || 0);
    button.hidden = top <= threshold;
  };
  const onScroll = () => {
    if (scheduled) return;
    scheduled = true;
    (viewport.requestAnimationFrame || (callback => callback()))(update);
  };
  const reduceMotion = () => Boolean(viewport.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  button.addEventListener("click", () => viewport.scrollTo({top: 0, behavior: reduceMotion() ? "auto" : "smooth"}));
  viewport.addEventListener("scroll", onScroll, {passive: true});
  update();

  return button;
}
