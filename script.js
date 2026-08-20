const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('#site-nav');

if (menuButton && nav) {
  menuButton.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(open));
  });
  nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    nav.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
  }));
}

document.querySelectorAll('.service-toggle:not(.service-link)').forEach((button) => {
  button.addEventListener('click', () => {
    const row = button.closest('.service-row');
    const open = row.classList.toggle('open');
    button.setAttribute('aria-expanded', String(open));
    const icon = button.querySelector('span');
    if (icon) icon.textContent = open ? '−' : '+';
  });
});

const calendarSheet = document.createElement('dialog');
calendarSheet.className = 'calendar-sheet';
calendarSheet.setAttribute('aria-labelledby', 'calendar-title');
calendarSheet.innerHTML = `
  <div class="calendar-handle" aria-hidden="true"></div>
  <p class="calendar-eyebrow" id="calendar-title">Preferred date</p>
  <div class="calendar-nav">
    <button type="button" class="calendar-arrow calendar-prev" aria-label="Previous month">‹</button>
    <strong class="calendar-month" aria-live="polite"></strong>
    <button type="button" class="calendar-arrow calendar-next" aria-label="Next month">›</button>
  </div>
  <div class="calendar-weekdays" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
  <div class="calendar-grid" role="grid"></div>
  <div class="calendar-actions"><button type="button" class="calendar-clear">Clear</button><button type="button" class="calendar-done">Done</button></div>`;
document.body.appendChild(calendarSheet);

let activeDateInput;
let calendarCursor = new Date();
let pendingDate;
const today = new Date();
today.setHours(0, 0, 0, 0);

const formatDate = (date) => `${String(date.getMonth() + 1).padStart(2, '0')} / ${String(date.getDate()).padStart(2, '0')} / ${date.getFullYear()}`;
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const parseDate = (value) => {
  const parts = value.match(/\d+/g)?.map(Number);
  if (!parts || parts.length !== 3) return null;
  const date = new Date(parts[2], parts[0] - 1, parts[1]);
  return Number.isNaN(date.getTime()) ? null : date;
};

const renderCalendar = () => {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  calendarSheet.querySelector('.calendar-month').textContent = calendarCursor.toLocaleDateString('en-US', {month: 'long', year: 'numeric'});
  const grid = calendarSheet.querySelector('.calendar-grid');
  grid.innerHTML = '';
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  for (let index = 0; index < firstDay; index += 1) grid.appendChild(document.createElement('span'));
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(year, month, day);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(day);
    button.className = 'calendar-day';
    button.disabled = date < today;
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', date.toLocaleDateString('en-US', {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'}));
    if (sameDay(date, today)) button.classList.add('is-today');
    if (sameDay(date, pendingDate)) {
      button.classList.add('is-selected');
      button.setAttribute('aria-selected', 'true');
    }
    button.addEventListener('click', () => {
      pendingDate = date;
      renderCalendar();
    });
    grid.appendChild(button);
  }
  const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  calendarSheet.querySelector('.calendar-prev').disabled = new Date(year, month, 1) <= currentMonth;
};

const openCalendar = (input) => {
  activeDateInput = input;
  calendarSheet.querySelector('.calendar-eyebrow').textContent = input.dataset.calendarLabel || 'Preferred date';
  pendingDate = parseDate(input.value);
  calendarCursor = pendingDate ? new Date(pendingDate) : new Date(today);
  renderCalendar();
  calendarSheet.showModal();
};

calendarSheet.querySelector('.calendar-prev').addEventListener('click', () => { calendarCursor.setMonth(calendarCursor.getMonth() - 1); renderCalendar(); });
calendarSheet.querySelector('.calendar-next').addEventListener('click', () => { calendarCursor.setMonth(calendarCursor.getMonth() + 1); renderCalendar(); });
calendarSheet.querySelector('.calendar-clear').addEventListener('click', () => {
  if (activeDateInput) {
    activeDateInput.value = '';
    activeDateInput.dispatchEvent(new Event('change', {bubbles: true}));
  }
  calendarSheet.close();
});
calendarSheet.querySelector('.calendar-done').addEventListener('click', () => {
  if (activeDateInput && pendingDate) {
    activeDateInput.value = formatDate(pendingDate);
    activeDateInput.dispatchEvent(new Event('change', {bubbles: true}));
  }
  calendarSheet.close();
});
calendarSheet.addEventListener('click', (event) => {
  if (event.target === calendarSheet) calendarSheet.close();
});

document.querySelectorAll('input[type="date"]').forEach((input) => {
  const labelText = input.closest('label')?.childNodes[0]?.textContent.trim() || 'Date';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.placeholder = 'MM / DD / YYYY';
  input.classList.add('date-entry');
  input.readOnly = true;
  input.dataset.calendarLabel = labelText;
  input.setAttribute('aria-haspopup', 'dialog');
  input.setAttribute('aria-label', `${labelText}, MM DD YYYY`);
  const shell = document.createElement('div');
  shell.className = 'date-shell';
  input.parentNode.insertBefore(shell, input);
  shell.appendChild(input);
  const calendarButton = document.createElement('button');
  calendarButton.type = 'button';
  calendarButton.className = 'date-icon-button';
  calendarButton.setAttribute('aria-label', `Enter ${labelText.toLowerCase()}`);
  calendarButton.setAttribute('aria-haspopup', 'dialog');
  calendarButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/></svg>';
  shell.appendChild(calendarButton);
  calendarButton.addEventListener('click', () => openCalendar(input));
  input.addEventListener('click', () => openCalendar(input));
});

document.querySelectorAll('input[type="time"]').forEach((input) => {
  const group = document.createElement('div');
  group.className = 'time-select-group';
  const makeSelect = (label, placeholder, values) => {
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    select.required = input.required;
    select.innerHTML = `<option value="">${placeholder}</option>` + values.map((value) => `<option value="${value}">${value}</option>`).join('');
    return select;
  };
  const hour = makeSelect('Hour', 'Hour', Array.from({length: 12}, (_, index) => String(index + 1).padStart(2, '0')));
  const minute = makeSelect('Minute', 'Min', Array.from({length: 12}, (_, index) => String(index * 5).padStart(2, '0')));
  const period = makeSelect('AM or PM', 'AM / PM', ['AM', 'PM']);
  group.append(hour, minute, period);
  input.type = 'hidden';
  input.insertAdjacentElement('afterend', group);
  const hint = document.createElement('span');
  hint.className = 'field-hint';
  hint.textContent = 'Select hour, minute, and AM or PM';
  group.insertAdjacentElement('afterend', hint);
  const syncTime = () => {
    if (!hour.value || !minute.value || !period.value) { input.value = ''; return; }
    let hour24 = Number(hour.value) % 12;
    if (period.value === 'PM') hour24 += 12;
    input.value = `${String(hour24).padStart(2, '0')}:${minute.value}`;
  };
  [hour, minute, period].forEach((select) => select.addEventListener('change', syncTime));
});

const dialog = document.querySelector('#led-dialog');
const serviceSelect = document.querySelector('#service-select');
let acknowledged = false;

if (serviceSelect) {
  const requestedService = new URLSearchParams(window.location.search).get('service');
  if (requestedService && [...serviceSelect.options].some((option) => option.value === requestedService)) serviceSelect.value = requestedService;
  const showSeatingNotice = () => {
    if (dialog && !acknowledged && serviceSelect.value.includes('Guest Seating')) dialog.showModal();
  };
  serviceSelect.addEventListener('change', showSeatingNotice);
  if (serviceSelect.value.includes('Guest Seating')) setTimeout(showSeatingNotice, 350);
  dialog?.querySelector('.dialog-close')?.addEventListener('click', () => { serviceSelect.value = ''; dialog.close(); });
  dialog?.querySelector('.dialog-confirm')?.addEventListener('click', () => { acknowledged = true; dialog.close(); serviceSelect.focus(); });
}

const form = document.querySelector('#inquiry-form');
if (form) {
  form.addEventListener('submit', async (event) => {
    if (serviceSelect?.value.includes('Guest Seating') && !acknowledged) { event.preventDefault(); dialog?.showModal(); return; }
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    submit.textContent = 'Sending…';
    try {
      await fetch('/', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(new FormData(form)).toString()});
      form.reset();
      document.querySelector('.toast')?.classList.add('show');
      setTimeout(() => document.querySelector('.toast')?.classList.remove('show'), 6000);
    } catch (error) { form.submit(); }
    finally { submit.disabled = false; submit.innerHTML = 'Request my personalized quote <span>↗</span>'; }
  });
}

document.querySelectorAll('#year').forEach((year) => { year.textContent = new Date().getFullYear(); });

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, {threshold: .12});
document.querySelectorAll('.section,.service-row,.price-card,.process-step,.page-cta').forEach((element) => {
  element.classList.add('scroll-reveal');
  revealObserver.observe(element);
});
