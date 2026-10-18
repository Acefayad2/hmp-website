// Store bounded numeric strokes, never uploaded image/SVG markup.
export function validateSignatureDrawing(value) {
  if (!Array.isArray(value) || !value.length || value.length > 80) throw new Error("Draw your signature or choose Type instead.");
  let count = 0, moved = false;
  const strokes = value.map(stroke => {
    if (!Array.isArray(stroke) || !stroke.length || (count += stroke.length) > 1000) throw new Error("Signature is too detailed. Clear it and sign again.");
    return stroke.map((point, index) => {
      if (!Array.isArray(point) || point.length !== 2 || point.some(n => typeof n !== "number" || !Number.isFinite(n)) || point[0] < 0 || point[0] > 1000 || point[1] < 0 || point[1] > 300) throw new Error("Signature drawing is invalid. Clear it and sign again.");
      if (index && Math.hypot(point[0]-stroke[0][0],point[1]-stroke[0][1]) > 2) moved = true;
      return point.map(n => Math.round(n * 10) / 10);
    });
  });
  if (!moved) throw new Error("Draw your signature or choose Type instead.");
  return strokes;
}

export function signatureDrawingHTML(value) {
  const strokes = validateSignatureDrawing(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 300" class="signature-drawing" role="img" aria-label="Hand-drawn signature"><g fill="none" stroke="#38282b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${strokes.map(points => `<polyline points="${points.map(p => p.join(",")).join(" ")}"/>`).join("")}</g></svg>`;
}

export function mountSignaturePad(input, label, onChange = () => {}) {
  const root = document.createElement("section");
  root.className = "signature-pad agreement-wide";
  const heading = document.createElement("strong"); heading.textContent = `${label} signature`;
  const controls = document.createElement("div"); controls.className = "agreement-actions";
  const typed = document.createElement("button"), drawn = document.createElement("button"), clear = document.createElement("button");
  for (const button of [typed,drawn,clear]) {button.type="button";button.className="agreement-button secondary";}
  typed.textContent="Type"; drawn.textContent="Draw"; clear.textContent="Clear signature";
  const preview = document.createElement("p"); preview.className="agreement-signature";
  const canvas = document.createElement("canvas"); canvas.width=1000;canvas.height=300;canvas.hidden=true;
  canvas.setAttribute("aria-label",`${label}: draw with a finger, stylus or mouse. Use Type for keyboard signing.`);
  const hint = document.createElement("p"); hint.textContent="Enter your full name above for identification, then type or draw your signature. Each person must sign for themselves.";
  const status = document.createElement("p"); status.setAttribute("role","status");
  const consentLabel=document.createElement("label");consentLabel.className="agreement-checkbox";
  const consent=document.createElement("input");consent.type="checkbox";
  consentLabel.append(consent,document.createTextNode("I authorize this drawing as part of my electronic signature."));
  consent.onchange=()=>{status.textContent="";onChange();};
  controls.append(typed,drawn,clear);root.append(heading,hint,controls,preview,canvas,consentLabel,status);
  input.closest("label").after(root);
  let mode="typed", strokes=[], stroke=null, pointer=null;
  const context=canvas.getContext("2d");
  const refresh = () => {
    typed.setAttribute("aria-pressed",String(mode==="typed")); drawn.setAttribute("aria-pressed",String(mode==="drawn"));
    preview.hidden=mode!=="typed";canvas.hidden=mode!=="drawn";clear.hidden=mode!=="drawn";consentLabel.hidden=mode!=="drawn";
    preview.textContent=input.value;
  };
  typed.onclick=()=>{mode="typed";refresh();onChange();};
  drawn.onclick=()=>{mode="drawn";refresh();onChange();};
  clear.onclick=()=>{strokes=[];stroke=null;pointer=null;consent.checked=false;context.clearRect(0,0,1000,300);status.textContent="Signature cleared.";onChange();};
  input.addEventListener("input",refresh);
  const point = event => {const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1000,(event.clientX-r.left)*1000/r.width)),Math.max(0,Math.min(300,(event.clientY-r.top)*300/r.height))].map(n=>Math.round(n*10)/10);};
  canvas.addEventListener("pointerdown",event=>{
    if (input.disabled || pointer!==null || mode!=="drawn" || (event.pointerType==="mouse" && event.button!==0)) return;
    if(strokes.length>=80 || strokes.flat().length>=1000){status.textContent="Signature is too detailed. Clear it and sign again.";return;}
    event.preventDefault();pointer=event.pointerId;canvas.setPointerCapture(pointer);stroke=[point(event)];strokes.push(stroke);status.textContent="";onChange();
  });
  canvas.addEventListener("pointermove",event=>{
    if(input.disabled || event.pointerId!==pointer || !stroke) return;
    const p=point(event),previous=stroke.at(-1);
    if(Math.hypot(p[0]-previous[0],p[1]-previous[1])<2) return;
    if(strokes.flat().length>=1000){status.textContent="Signature limit reached. Clear it if more space is needed.";return;}
    stroke.push(p);context.strokeStyle="#38282b";context.lineWidth=4;context.lineCap="round";context.beginPath();context.moveTo(...previous);context.lineTo(...p);context.stroke();onChange();
  });
  const stop=event=>{if(event.pointerId===pointer){pointer=null;stroke=null;}};
  canvas.addEventListener("pointerup",stop);canvas.addEventListener("pointercancel",stop);canvas.addEventListener("lostpointercapture",stop);
  refresh();
  return {read(){if(mode==="typed") return null;try{const checked=validateSignatureDrawing(strokes);if(!consent.checked)throw new Error("Confirm your drawing authorization.");return {strokes:checked,consent:true};}catch(error){status.textContent=`${label}: ${error.message}`;root.scrollIntoView({block:"center"});throw new Error(status.textContent);}}};
}
