import { escape } from "./agreement-ui.mjs";

export function signatureFieldsHTML(consent, allowDraw = true) {
  return `<h2>Review & sign</h2><label class="agreement-field" for="signature-name">Your full name<input id="signature-name" name="signatureName" autocomplete="name" required minlength="2" maxlength="200"></label>
    ${allowDraw ? `<fieldset class="agreement-signature-choice"><legend>Choose how to sign</legend><label><input type="radio" name="signatureMethod" value="typed" checked> Type my name</label><label><input type="radio" name="signatureMethod" value="drawn"> Draw my signature</label></fieldset>` : '<input type="hidden" name="signatureMethod" value="typed">'}
    <div class="agreement-typed-preview" aria-label="Typed signature preview"><span class="agreement-signature-script" id="signature-preview">Your name</span></div>
    ${allowDraw ? '<div class="agreement-draw-panel" hidden><p>Sign below with your finger, stylus, or mouse.</p><canvas id="signature-canvas" width="600" height="180" aria-label="Draw your signature"></canvas><button type="button" class="agreement-button secondary" id="signature-clear">Clear signature</button></div>' : ""}
    <label class="agreement-checkbox"><input name="consent" type="checkbox" required><span>${escape(consent)}</span></label>
    <p>Your signature, answers, form version, submission time, and browser information will be saved with this form. The completed record cannot be edited.</p>`;
}

export function wireSignatureCapture(form) {
  const canvas = form.querySelector("#signature-canvas");
  const preview = form.querySelector("#signature-preview");
  const name = form.querySelector("#signature-name");
  name.addEventListener("input", () => {preview.textContent = name.value.trim() || "Your name";});
  if (!canvas) return () => ({signatureName:name.value.trim(),signatureMethod:"typed"});
  const ink = canvas.getContext("2d");
  const drawPanel = form.querySelector(".agreement-draw-panel");
  const typedPreview = form.querySelector(".agreement-typed-preview");
  let hasInk = false;
  let drawing = false;
  ink.strokeStyle = "#4c3335";
  ink.lineWidth = 2.5;
  ink.lineCap = "round";
  ink.lineJoin = "round";
  const method = () => form.querySelector('input[name="signatureMethod"]:checked').value;
  const point = event => {
    const rect = canvas.getBoundingClientRect();
    return {x:(event.clientX - rect.left) * canvas.width / rect.width, y:(event.clientY - rect.top) * canvas.height / rect.height};
  };
  form.querySelectorAll('input[name="signatureMethod"]').forEach(input => input.addEventListener("change", () => {
    const drawn = method() === "drawn";
    drawPanel.hidden = !drawn;
    typedPreview.hidden = drawn;
  }));
  canvas.addEventListener("pointerdown", event => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    const {x,y} = point(event);
    ink.beginPath(); ink.moveTo(x,y); ink.lineTo(x + 0.1,y + 0.1); ink.stroke();
    hasInk = drawing = true;
  });
  canvas.addEventListener("pointermove", event => {
    if (!drawing) return;
    event.preventDefault();
    const {x,y} = point(event);
    ink.lineTo(x,y); ink.stroke();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(type, () => {drawing = false;});
  form.querySelector("#signature-clear").addEventListener("click", () => {ink.clearRect(0,0,canvas.width,canvas.height); hasInk = false;});
  return () => {
    if (method() === "drawn" && !hasInk) throw new Error("Please draw your signature before submitting.");
    return {signatureName:name.value.trim(), signatureMethod:method(), ...(method() === "drawn" ? {signatureImage:canvas.toDataURL("image/png")} : {})};
  };
}
