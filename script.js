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

document.querySelectorAll('input[type="date"]').forEach((input) => {
  const labelText = input.closest('label')?.childNodes[0]?.textContent.trim() || 'Date';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.placeholder = 'MM / DD / YYYY';
  input.classList.add('date-entry');
  input.setAttribute('aria-label', `${labelText}, MM DD YYYY`);
  const shell = document.createElement('div');
  shell.className = 'date-shell';
  input.parentNode.insertBefore(shell, input);
  shell.appendChild(input);
  const calendarButton = document.createElement('button');
  calendarButton.type = 'button';
  calendarButton.className = 'date-icon-button';
  calendarButton.setAttribute('aria-label', `Enter ${labelText.toLowerCase()}`);
  calendarButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/></svg>';
  shell.appendChild(calendarButton);
  calendarButton.addEventListener('click', () => {
    input.focus();
    input.select();
  });
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').slice(0, 8);
    const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
    input.value = parts.join(' / ');
  });
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
