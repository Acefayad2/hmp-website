export const photoDeadline = (event: {endAt?: string; date?: string}): number | null => {
  // Older inventory events only recorded a date. Treat the end of that UTC date
  // as their latest possible end, so their photos get at least one full day.
  const end = event.endAt
    ? Date.parse(event.endAt)
    : event.date ? Date.parse(`${event.date}T23:59:59.999Z`) : NaN;
  return Number.isFinite(end) ? end + 24 * 60 * 60 * 1000 : null;
};

export const photosExpired = (event: {endAt?: string; date?: string}, now = Date.now()) => {
  const deadline = photoDeadline(event);
  return deadline !== null && now >= deadline;
};
