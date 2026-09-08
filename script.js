const menuButton = document.querySelector(".menu-toggle");
const nav = document.querySelector("#site-nav");

if (menuButton && nav) {
  const servicesNav = nav.querySelector(".services-nav");
  const servicesTrigger = nav.querySelector(".services-trigger");

  const closeServicesMenu = () => {
    servicesNav?.classList.remove("is-open");
    servicesTrigger?.setAttribute("aria-expanded", "false");
  };

  servicesTrigger?.addEventListener("click", () => {
    const open = servicesNav.classList.toggle("is-open");
    servicesTrigger.setAttribute("aria-expanded", String(open));
  });

  menuButton.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("menu-open", open);
    if (!open) closeServicesMenu();
  });
  nav.querySelectorAll("a").forEach((link) =>
    link.addEventListener("click", () => {
      nav.classList.remove("open");
      menuButton.setAttribute("aria-expanded", "false");
      document.body.classList.remove("menu-open");
      closeServicesMenu();
    }),
  );
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (servicesNav?.classList.contains("is-open")) {
      closeServicesMenu();
      servicesTrigger?.focus();
      return;
    }
    if (!nav.classList.contains("open")) return;
    nav.classList.remove("open");
    menuButton.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-open");
    menuButton.focus();
  });
  document.addEventListener("click", (event) => {
    if (!servicesNav?.contains(event.target)) closeServicesMenu();
  });
}

document
  .querySelectorAll(".service-toggle:not(.service-link)")
  .forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest(".service-row");
      const open = row.classList.toggle("open");
      button.setAttribute("aria-expanded", String(open));
      const icon = button.querySelector("span");
      if (icon) icon.textContent = open ? "−" : "+";
    });
  });

const calendarSheet = document.createElement("dialog");
calendarSheet.className = "calendar-sheet";
calendarSheet.setAttribute("aria-labelledby", "calendar-title");
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

const formatDate = (date) =>
  `${String(date.getMonth() + 1).padStart(2, "0")} / ${String(date.getDate()).padStart(2, "0")} / ${date.getFullYear()}`;
const sameDay = (a, b) =>
  a &&
  b &&
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();
const parseDate = (value) => {
  const parts = value.match(/\d+/g)?.map(Number);
  if (!parts || parts.length !== 3) return null;
  const date = new Date(parts[2], parts[0] - 1, parts[1]);
  return Number.isNaN(date.getTime()) ? null : date;
};

const renderCalendar = () => {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  calendarSheet.querySelector(".calendar-month").textContent =
    calendarCursor.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  const grid = calendarSheet.querySelector(".calendar-grid");
  grid.innerHTML = "";
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  for (let index = 0; index < firstDay; index += 1)
    grid.appendChild(document.createElement("span"));
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(year, month, day);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(day);
    button.className = "calendar-day";
    button.disabled = date < today;
    button.setAttribute("role", "gridcell");
    button.setAttribute(
      "aria-label",
      date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    );
    if (sameDay(date, today)) button.classList.add("is-today");
    if (sameDay(date, pendingDate)) {
      button.classList.add("is-selected");
      button.setAttribute("aria-selected", "true");
    }
    button.addEventListener("click", () => {
      pendingDate = date;
      renderCalendar();
    });
    grid.appendChild(button);
  }
  const currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  calendarSheet.querySelector(".calendar-prev").disabled =
    new Date(year, month, 1) <= currentMonth;
};

const openCalendar = (input) => {
  activeDateInput = input;
  calendarSheet.querySelector(".calendar-eyebrow").textContent =
    input.dataset.calendarLabel || "Preferred date";
  pendingDate = parseDate(input.value);
  calendarCursor = pendingDate ? new Date(pendingDate) : new Date(today);
  renderCalendar();
  calendarSheet.showModal();
};

calendarSheet.querySelector(".calendar-prev").addEventListener("click", () => {
  calendarCursor.setMonth(calendarCursor.getMonth() - 1);
  renderCalendar();
});
calendarSheet.querySelector(".calendar-next").addEventListener("click", () => {
  calendarCursor.setMonth(calendarCursor.getMonth() + 1);
  renderCalendar();
});
calendarSheet.querySelector(".calendar-clear").addEventListener("click", () => {
  if (activeDateInput) {
    activeDateInput.value = "";
    activeDateInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
  calendarSheet.close();
});
calendarSheet.querySelector(".calendar-done").addEventListener("click", () => {
  if (activeDateInput && pendingDate) {
    activeDateInput.value = formatDate(pendingDate);
    activeDateInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
  calendarSheet.close();
});
calendarSheet.addEventListener("click", (event) => {
  if (event.target === calendarSheet) calendarSheet.close();
});

document.querySelectorAll('input[type="date"]').forEach((input) => {
  const labelText =
    input.closest("label")?.childNodes[0]?.textContent.trim() || "Date";
  input.type = "text";
  input.inputMode = "numeric";
  input.placeholder = "MM / DD / YYYY";
  input.classList.add("date-entry");
  input.readOnly = true;
  input.dataset.calendarLabel = labelText;
  input.setAttribute("aria-haspopup", "dialog");
  input.setAttribute("aria-label", `${labelText}, MM DD YYYY`);
  const shell = document.createElement("div");
  shell.className = "date-shell";
  input.parentNode.insertBefore(shell, input);
  shell.appendChild(input);
  const calendarButton = document.createElement("button");
  calendarButton.type = "button";
  calendarButton.className = "date-icon-button";
  calendarButton.setAttribute("aria-label", `Enter ${labelText.toLowerCase()}`);
  calendarButton.setAttribute("aria-haspopup", "dialog");
  calendarButton.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v3M17 3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/></svg>';
  shell.appendChild(calendarButton);
  calendarButton.addEventListener("click", () => openCalendar(input));
  input.addEventListener("click", () => openCalendar(input));
});

document.querySelectorAll('input[type="time"]').forEach((input) => {
  const group = document.createElement("div");
  group.className = "time-select-group";
  const makeSelect = (label, placeholder, values) => {
    const select = document.createElement("select");
    select.setAttribute("aria-label", label);
    select.required = input.required;
    select.innerHTML =
      `<option value="">${placeholder}</option>` +
      values
        .map((value) => `<option value="${value}">${value}</option>`)
        .join("");
    return select;
  };
  const hour = makeSelect(
    "Hour",
    "Hour",
    Array.from({ length: 12 }, (_, index) =>
      String(index + 1).padStart(2, "0"),
    ),
  );
  const minute = makeSelect(
    "Minute",
    "Min",
    Array.from({ length: 12 }, (_, index) =>
      String(index * 5).padStart(2, "0"),
    ),
  );
  const period = makeSelect("AM or PM", "AM / PM", ["AM", "PM"]);
  group.append(hour, minute, period);
  input.type = "hidden";
  input.insertAdjacentElement("afterend", group);
  const hint = document.createElement("span");
  hint.className = "field-hint";
  hint.textContent = "Select hour, minute, and AM or PM";
  group.insertAdjacentElement("afterend", hint);
  const syncTime = () => {
    if (!hour.value || !minute.value || !period.value) {
      input.value = "";
      return;
    }
    let hour24 = Number(hour.value) % 12;
    if (period.value === "PM") hour24 += 12;
    input.value = `${String(hour24).padStart(2, "0")}:${minute.value}`;
  };
  [hour, minute, period].forEach((select) =>
    select.addEventListener("change", syncTime),
  );
});

const dialog = document.querySelector("#led-dialog");
const serviceSelect = document.querySelector("#service-select");
const serviceOptionField = document.querySelector("#service-option-field");
const serviceOptionLabel = document.querySelector("#service-option-label");
const serviceOptionSelect = document.querySelector("#service-option-select");
const multipleServicesField = document.querySelector("#multiple-services-field");
const multipleServicesInput = multipleServicesField?.querySelector("textarea");
const otherServiceField = document.querySelector("#other-service-field");
const otherServiceInput = otherServiceField?.querySelector("textarea");
let acknowledged = false;

const inquiryServiceOptions = {
  "Celebration Accessories": {
    label: "Celebration accessory of interest",
    placeholder: "Choose an accessory",
    options: [
      "Celebration Kit",
      "Club Sign + Strobes",
      "Lux-Framed Premium LED Welcome Sign",
      "Money Guns",
    ],
  },
  "Guest Seating Experience": {
    label: "Guest seating service of interest",
    placeholder: "Choose a guest seating service",
    options: ["Arrival + Directory", "Guest Arrival", "Guest Directory"],
  },
  "Money Table Services": {
    label: "Money table service of interest",
    placeholder: "Choose a money table service",
    options: [
      "Changing + Collecting",
      "Money Changing",
      "Money Collecting",
      "Money Machine",
    ],
  },
};

const setConditionalField = (field, input, visible, required = false) => {
  if (!field || !input) return;
  field.hidden = !visible;
  input.disabled = !visible;
  input.required = visible && required;
  if (!visible) input.value = "";
};

const syncInquiryFields = () => {
  const service = serviceSelect?.value || "";
  const serviceOptions = inquiryServiceOptions[service];
  if (serviceOptionField && serviceOptionSelect) {
    const previousValue = serviceOptionSelect.value;
    serviceOptionSelect.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent =
      serviceOptions?.placeholder || "Choose a specific service";
    serviceOptionSelect.append(placeholder);
    serviceOptions?.options.forEach((serviceOption) => {
      const option = document.createElement("option");
      option.value = serviceOption;
      option.textContent = serviceOption;
      serviceOptionSelect.append(option);
    });
    if (serviceOptions?.options.includes(previousValue)) {
      serviceOptionSelect.value = previousValue;
    }
    if (serviceOptionLabel) {
      serviceOptionLabel.textContent =
        serviceOptions?.label || "Specific service of interest";
    }
    setConditionalField(
      serviceOptionField,
      serviceOptionSelect,
      Boolean(serviceOptions),
      true,
    );
  }
  const isMultiple = service === "Multiple services";
  setConditionalField(
    multipleServicesField,
    multipleServicesInput,
    isMultiple,
    true,
  );
  setConditionalField(
    otherServiceField,
    otherServiceInput,
    service === "Interested in something else",
    true,
  );
};

if (serviceSelect) {
  const inquiryParams = new URLSearchParams(window.location.search);
  const requestedService = inquiryParams.get("service");
  const requestedServiceOption = inquiryParams.get("service-option");
  if (
    requestedService &&
    [...serviceSelect.options].some(
      (option) => option.value === requestedService,
    )
  )
    serviceSelect.value = requestedService;
  const showSeatingNotice = () => {
    if (
      dialog &&
      !acknowledged &&
      serviceSelect.value.includes("Guest Seating")
    )
      dialog.showModal();
  };
  serviceSelect.addEventListener("change", showSeatingNotice);
  serviceSelect.addEventListener("change", syncInquiryFields);
  syncInquiryFields();
  if (
    requestedServiceOption &&
    [...(serviceOptionSelect?.options || [])].some(
      (option) => option.value === requestedServiceOption,
    )
  ) {
    serviceOptionSelect.value = requestedServiceOption;
  }
  if (serviceSelect.value.includes("Guest Seating"))
    setTimeout(showSeatingNotice, 350);
  dialog?.querySelector(".dialog-close")?.addEventListener("click", () => {
    serviceSelect.value = "";
    dialog.close();
  });
  dialog?.querySelector(".dialog-confirm")?.addEventListener("click", () => {
    acknowledged = true;
    dialog.close();
    serviceSelect.focus();
  });
}

const form = document.querySelector("#inquiry-form");
if (form) {
  form.addEventListener("submit", async (event) => {
    if (serviceSelect?.value.includes("Guest Seating") && !acknowledged) {
      event.preventDefault();
      dialog?.showModal();
      return;
    }
    event.preventDefault();
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    submit.textContent = "Sending…";
    const status = document.querySelector("#form-status");
    try {
      const submissionId = form.querySelector('[name="submission-id"]');
      if (submissionId && !submissionId.value) {
        submissionId.value =
          globalThis.crypto?.randomUUID?.() ||
          `hmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      }
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      if (payload["service-option"]) {
        payload.service = `${payload.service}: ${payload["service-option"]}`;
      }
      const inquiryResponse = await fetch("/api/hmp-inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!inquiryResponse.ok)
        throw new Error(
          `Inquiry sync failed with status ${inquiryResponse.status}`,
        );
      form.reset();
      syncInquiryFields();
      if (status) {
        status.textContent =
          "Thank you. Your inquiry has been received, and a copy has been emailed to you. We’ll be in touch within 48 hours.";
        status.classList.remove("error");
        status.classList.add("show");
      }
    } catch (error) {
      if (status) {
        status.textContent =
          "We could not send your inquiry. Your information is still here. Please try again or email info@hmpeds.com.";
        status.classList.add("error", "show");
      }
    } finally {
      submit.disabled = false;
      submit.innerHTML = "Request my personalized quote <span>↗</span>";
      setTimeout(() => status?.classList.remove("show"), 7000);
    }
  });
}

document.querySelectorAll("#year").forEach((year) => {
  year.textContent = new Date().getFullYear();
});

document.querySelectorAll("[data-service-carousel]").forEach((carousel) => {
  const slides = [...carousel.querySelectorAll("[data-service-slide]")];
  const dots = [...carousel.querySelectorAll(".service-carousel-dots button")];
  const previous = carousel.querySelector(".service-carousel-prev");
  const next = carousel.querySelector(".service-carousel-next");
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  let activeIndex = 0;
  let timer;

  const showSlide = (requestedIndex, restart = true) => {
    activeIndex = (requestedIndex + slides.length) % slides.length;
    slides.forEach((slide, index) => {
      const active = index === activeIndex;
      slide.hidden = !active;
      slide.classList.toggle("is-active", active);
      slide.setAttribute("aria-hidden", String(!active));
    });
    dots.forEach((dot, index) => {
      const active = index === activeIndex;
      dot.classList.toggle("is-active", active);
      if (active) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
    if (restart) startCarousel();
  };

  const stopCarousel = () => {
    window.clearInterval(timer);
  };

  function startCarousel() {
    stopCarousel();
    if (reduceMotion || document.hidden) return;
    timer = window.setInterval(() => showSlide(activeIndex + 1, false), 6500);
  }

  previous?.addEventListener("click", () => showSlide(activeIndex - 1));
  next?.addEventListener("click", () => showSlide(activeIndex + 1));
  dots.forEach((dot, index) =>
    dot.addEventListener("click", () => showSlide(index)),
  );
  carousel.addEventListener("mouseenter", stopCarousel);
  carousel.addEventListener("mouseleave", startCarousel);
  carousel.addEventListener("focusin", stopCarousel);
  carousel.addEventListener("focusout", (event) => {
    if (!carousel.contains(event.relatedTarget)) startCarousel();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCarousel();
    else startCarousel();
  });

  showSlide(0);
});

const reviewsTrack = document.querySelector("#reviews-track");
const reviewsMarquee = document.querySelector("[data-reviews-marquee]");
const reviewsSection = reviewsTrack?.closest(".reviews-section");

const createReviewCard = (review, duplicate = false) => {
  const card = document.createElement("article");
  card.className = "review-card";
  if (duplicate) card.setAttribute("aria-hidden", "true");

  const stars = document.createElement("div");
  stars.className = "review-stars";
  const rating = Math.min(5, Math.max(1, Number(review.rating) || 5));
  for (let index = 0; index < rating; index += 1) {
    const moon = document.createElement("span");
    moon.className = "review-moon";
    moon.setAttribute("aria-hidden", "true");
    stars.append(moon);
  }
  stars.setAttribute("aria-label", `${rating} out of 5`);

  const quote = document.createElement("blockquote");
  quote.textContent = `“${review.reviewText}”`;

  const footer = document.createElement("footer");
  const name = document.createElement("strong");
  name.textContent = review.reviewerName || "HMP client";
  const detail = document.createElement("span");
  detail.textContent = [...new Set([review.reviewerRole, review.service].filter(Boolean))].join(" - ") || "HMP celebration";
  footer.append(name, detail);
  card.append(stars, quote, footer);
  return card;
};

const syncReviewsMarquee = () => {
  if (!reviewsTrack) return;
  const firstSet = reviewsTrack.querySelector(".reviews-set");
  if (!firstSet) return;
  const gap = Number.parseFloat(getComputedStyle(reviewsTrack).columnGap) || 0;
  const shift = `-${Math.ceil(firstSet.getBoundingClientRect().width + gap)}px`;
  if (reviewsTrack.style.getPropertyValue("--reviews-shift") === shift) return;
  reviewsTrack.classList.remove("is-moving");
  reviewsTrack.style.setProperty("--reviews-shift", shift);
  void reviewsTrack.offsetWidth;
  reviewsTrack.classList.add("is-moving");
};

const renderReviews = (reviews) => {
  if (!reviewsTrack || !reviews.length) {
    reviewsSection?.classList.add("is-empty");
    if (reviewsSection) reviewsSection.hidden = true;
    if (reviewsMarquee) reviewsMarquee.hidden = true;
    return;
  }
  reviewsSection?.classList.remove("is-empty");
  if (reviewsSection) reviewsSection.hidden = false;
  if (reviewsMarquee) reviewsMarquee.hidden = false;
  const approximateCardWidth = window.matchMedia("(max-width: 760px)").matches ? 360 : 620;
  const minimumCards = Math.ceil(
    ((window.innerWidth + approximateCardWidth * 2) * 2) / approximateCardWidth,
  );
  const repetitions = Math.max(1, Math.ceil(minimumCards / reviews.length));
  const marqueeReviews = Array.from(
    { length: reviews.length * repetitions },
    (_, index) => reviews[index % reviews.length],
  );
  const firstSet = document.createElement("div");
  firstSet.className = "reviews-set";
  const duplicateSet = document.createElement("div");
  duplicateSet.className = "reviews-set";
  duplicateSet.setAttribute("aria-hidden", "true");
  marqueeReviews.forEach((review) => {
    firstSet.append(createReviewCard(review));
    duplicateSet.append(createReviewCard(review, true));
  });
  reviewsTrack.replaceChildren(firstSet, duplicateSet);
  requestAnimationFrame(syncReviewsMarquee);
};

if (reviewsTrack && "ResizeObserver" in window) {
  const reviewsResizeObserver = new ResizeObserver(syncReviewsMarquee);
  reviewsResizeObserver.observe(reviewsTrack);
}

requestAnimationFrame(syncReviewsMarquee);

if (reviewsTrack) {
  fetch("/api/hmp-reviews")
    .then((response) => {
      if (!response.ok) throw new Error("Reviews unavailable");
      return response.json();
    })
    .then((data) => renderReviews(data.reviews || []))
    .catch(() => {
      reviewsSection?.classList.add("is-empty");
      if (reviewsSection) reviewsSection.hidden = true;
      if (reviewsMarquee) reviewsMarquee.hidden = true;
    });
}

const backToTopSentinel = document.createElement("span");
backToTopSentinel.className = "back-to-top-sentinel";
backToTopSentinel.setAttribute("aria-hidden", "true");
document.body.prepend(backToTopSentinel);

const backToTopButton = document.createElement("button");
backToTopButton.type = "button";
backToTopButton.className = "back-to-top";
backToTopButton.setAttribute("aria-label", "Back to top");
const backToTopArrow = document.createElement("span");
backToTopArrow.setAttribute("aria-hidden", "true");
backToTopArrow.textContent = "↑";
backToTopButton.appendChild(backToTopArrow);
document.body.appendChild(backToTopButton);

const backToTopObserver = new IntersectionObserver(([entry]) => {
  backToTopButton.classList.toggle("is-visible", !entry.isIntersecting);
});
backToTopObserver.observe(backToTopSentinel);

backToTopButton.addEventListener("click", () => {
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 },
);
document
  .querySelectorAll(
    ".section,.service-feature,.service-row,.price-card,.process-step,.page-cta,.decor-gallery-head,.decor-shot,.directory-service,.principle,.reviews-heading",
  )
  .forEach((element) => {
    element.classList.add("scroll-reveal");
    revealObserver.observe(element);
  });
