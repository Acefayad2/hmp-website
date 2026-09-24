(() => {
  const hero = document.querySelector('[data-hero-slideshow]');
  if (!hero) return;
  const frames = [...hero.querySelectorAll('[data-hero-frame]')];
  const buttons = [...hero.querySelectorAll('[data-hero-select]')];
  const playback = hero.querySelector('[data-hero-playback]');
  const icon = hero.querySelector('[data-hero-playback-icon]');
  const status = hero.querySelector('[data-hero-status]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let paused = reducedMotion.matches;
  let hovered = false;
  let visible = true;
  let timer;
  let request = 0;

  function schedule() {
    window.clearTimeout(timer);
    const playing = !paused && !hovered && visible && !document.hidden;
    hero.classList.toggle('is-slideshow-playing', playing);
    playback.setAttribute('aria-label', paused ? 'Play slideshow' : 'Pause slideshow');
    icon.textContent = paused ? '▶' : 'Ⅱ';
    if (playing) timer = window.setTimeout(() => show((current + 1) % frames.length), 7500);
  }

  async function show(index, manual = false) {
    const token = ++request;
    window.clearTimeout(timer);
    if (manual) paused = true;
    try {
      await frames[index].querySelector('img').decode();
    } catch {
      if (token === request) { paused = true; schedule(); }
      return; // Never crossfade to an unloaded or failed image.
    }
    if (token !== request) return;
    // Decoding may finish after the visitor pauses or leaves the hero.
    if (!manual && (paused || hovered || !visible || document.hidden)) {
      schedule();
      return;
    }
    current = index;
    frames.forEach((frame, i) => {
      frame.classList.toggle('is-active', i === index);
      frame.setAttribute('aria-hidden', String(i !== index));
      buttons[i].setAttribute('aria-pressed', String(i === index));
    });
    if (manual) status.textContent = frames[index].querySelector('img').alt;
    schedule();
  }

  buttons.forEach((button, index) => button.addEventListener('click', () => show(index, true)));
  playback.addEventListener('click', () => { paused = !paused; schedule(); });
  // Keyboard users get a stable scene until they explicitly choose Play.
  hero.addEventListener('focusin', (event) => {
    if (event.target === playback) return;
    paused = true;
    schedule();
  });
  hero.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') { hovered = true; schedule(); }
  });
  hero.addEventListener('pointerleave', () => { hovered = false; schedule(); });
  document.addEventListener('visibilitychange', schedule);
  reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; schedule(); });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule(); }, { threshold: .1 }).observe(hero);
  }
  hero.querySelector('[data-hero-controls]').hidden = false;
  hero.classList.add('is-slideshow-ready');
  schedule();
})();
