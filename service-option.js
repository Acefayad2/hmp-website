const offeringDetails = {
  "guest-arrival": {
    category: "Guest Seating Experience",
    parentUrl: "/guest-seating",
    title: "Guest Arrival",
    summary: "Confirm attendance with a polished RSVP-based arrival experience and custom digital display.",
    heading: "Welcome every guest with clarity.",
    description:
      "Guest Arrival supports an organized first impression by helping confirm attendance as guests enter. HMP prepares the display and experience around your event details so the welcome feels considered from the start.",
    price: "$800",
    features: [
      "RSVP-based attendance confirmation",
      "Customized Premium LED Signage",
      "32-inch display",
    ],
    image: "/assets/modern-guest-arrival.webp",
    imageAlt: "Premium guest arrival display at an elegant event entrance",
  },
  "arrival-directory": {
    category: "Guest Seating Experience",
    parentUrl: "/guest-seating",
    title: "Guest Arrival+Directory",
    summary: "Combine attendance confirmation and table lookup in one complete guest journey.",
    heading: "Guide guests from entrance to table.",
    description:
      "Guest Arrival+Directory brings check-in and seating lookup together so guests can confirm attendance and find their assigned table through one coordinated experience. HMP manages the presentation to support a smooth transition into the event.",
    price: "$1,450",
    features: [
      "Attendance confirmation and seating lookup",
      "One coordinated arrival experience",
      "Customized 32-inch Premium LED Signage",
    ],
    image: "/assets/hmp-hero-welcome.webp",
    imageAlt: "Complete digital guest arrival and table directory experience",
  },
  "guest-registration": {
    category: "Guest Seating Experience",
    parentUrl: "/guest-seating",
    title: "Guest Registration",
    summary: "Offer seamless on-site registration through innovative technology and refined hospitality.",
    heading: "Make on-site registration feel effortless.",
    description:
      "Simplify on-site registration with an experience that blends innovative technology and refined hospitality. Our in-person registration service allows guests and attendees to register upon arrival through a seamless, organized, and welcoming process.",
    price: "$800",
    features: [
      "In-person registration upon arrival",
      "Organized, welcoming guest flow",
      "Technology supported by refined hospitality",
    ],
    image: "/assets/modern-guest-arrival.webp",
    imageAlt: "Welcoming on-site guest registration experience",
  },
  "arrival-registration-directory": {
    category: "Guest Seating Experience",
    parentUrl: "/guest-seating",
    title: "Guest Arrival+Registration+Directory",
    summary: "Combine on-site registration, arrival confirmation, and an interactive seating directory.",
    heading: "One elevated journey from arrival to seat.",
    description:
      "Designed to make guest arrival effortless, this interactive experience allows guests and attendees to register on-site, quickly find their names, confirm their arrival, and view an interactive floor plan highlighting their assigned table and seat—all while creating a seamless, organized, and elevated guest experience.",
    price: "$1,950",
    features: [
      "On-site registration and arrival confirmation",
      "Interactive guest-name search",
      "Floor plan with assigned table and seat",
    ],
    image: "/assets/hmp-hero-welcome.webp",
    imageAlt: "Interactive guest arrival, registration, and seating directory",
  },
  "money-collecting": {
    category: "Money Table Services",
    parentUrl: "/money-table",
    title: "Money Collecting",
    summary: "Gather and secure sprayed funds in designated storage bags throughout the event.",
    heading: "Keep every collection organized.",
    description:
      "Money Collecting provides dedicated support for gathering sprayed funds and placing them into designated storage bags. The service helps keep the area orderly while the event continues around it.",
    price: "$680",
    features: [
      "Dedicated collection support",
      "Designated storage bags",
      "Four-hour service minimum",
    ],
    image: "/assets/modern-reception.webp",
    imageAlt: "Organized money service table prepared for collection support",
  },
  "money-changing": {
    category: "Money Table Services",
    parentUrl: "/money-table",
    title: "Money Changing",
    summary: "Give guests access to the denominations they need to participate in the tradition.",
    heading: "Make participation easier.",
    description:
      "Money Changing helps guests exchange bills for the denominations needed during money-spraying moments. A dedicated Money Associate manages exchanges so the service stays organized and accessible.",
    price: "$600",
    features: [
      "Guest denomination exchange",
      "Dedicated Money Associate",
      "Four-hour service minimum",
    ],
    image: "/assets/hmp-hero.webp",
    imageAlt: "Elegant money table setup for organized guest denomination exchanges",
  },
  "changing-collecting": {
    category: "Money Table Services",
    parentUrl: "/money-table",
    title: "Changing + Collecting",
    summary: "Combine guest exchanges and fund collection in one coordinated money-table service.",
    heading: "Support the full tradition.",
    description:
      "Changing + Collecting combines denomination exchanges with organized fund collection. This option provides complete support for guests participating in the tradition while keeping collected funds managed throughout the event.",
    price: "$850",
    features: [
      "Guest denomination exchange",
      "Fund collection and designated storage",
      "Four-hour service minimum",
    ],
    image: "/assets/money-machine-table.webp",
    imageAlt: "Complete money table service prepared for guest exchanges and fund collection",
  },
};

const offeringKey = window.location.pathname.split("/").filter(Boolean).pop();
const offering = offeringDetails[offeringKey];

if (!offering) {
  window.location.replace(offeringKey === "guest-directory" ? "/guest-seating" : "/services");
} else {
  const inquiryUrl = `/inquiry?service=${encodeURIComponent(offering.category)}&service-option=${encodeURIComponent(offering.title)}`;
  const pageTitle = `${offering.title} in Maryland | HMP`;
  const pageUrl = `https://hmpeds.com${window.location.pathname}`;
  const socialImageUrl = new URL(offering.image, "https://hmpeds.com").href;
  const pageDescription = `${offering.summary} Available from HMP Luxury Event Services in Maryland.`;

  document.title = pageTitle;
  document.querySelector('meta[name="description"]')?.setAttribute("content", pageDescription);
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", pageTitle);
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", pageDescription);
  document.querySelector('meta[property="og:url"]')?.setAttribute("content", pageUrl);
  document.querySelector('meta[property="og:image"]')?.setAttribute("content", socialImageUrl);
  document.querySelector('meta[property="og:image:alt"]')?.setAttribute("content", offering.imageAlt);
  document.querySelector('meta[name="twitter:title"]')?.setAttribute("content", pageTitle);
  document.querySelector('meta[name="twitter:description"]')?.setAttribute("content", pageDescription);
  document.querySelector('meta[name="twitter:image"]')?.setAttribute("content", socialImageUrl);
  document.querySelector('meta[name="twitter:image:alt"]')?.setAttribute("content", offering.imageAlt);
  document.querySelector("#option-canonical")?.setAttribute("href", pageUrl);

  const schema = document.createElement("script");
  schema.type = "application/ld+json";
  schema.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Service",
        "@id": `${pageUrl}#service`,
        name: offering.title,
        description: pageDescription,
        url: pageUrl,
        image: socialImageUrl,
        serviceType: offering.title,
        category: offering.category,
        provider: {
          "@type": ["Organization", "ProfessionalService"],
          "@id": "https://hmpeds.com/#organization",
          name: "HMP Luxury Event Services",
          url: "https://hmpeds.com/",
          telephone: "+1-301-471-0990",
          address: {
            "@type": "PostalAddress",
            addressLocality: "Laurel",
            addressRegion: "MD",
            addressCountry: "US",
          },
        },
        areaServed: { "@type": "State", name: "Maryland" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://hmpeds.com/" },
          { "@type": "ListItem", position: 2, name: "Services", item: "https://hmpeds.com/services" },
          { "@type": "ListItem", position: 3, name: offering.category, item: `https://hmpeds.com${offering.parentUrl}` },
          { "@type": "ListItem", position: 4, name: offering.title, item: pageUrl },
        ],
      },
    ],
  });
  document.head.append(schema);

  document.querySelector("#option-category").textContent = offering.category;
  document.querySelector("#option-title").textContent = offering.title;
  document.querySelector("#option-summary").textContent = offering.summary;
  document.querySelector("#option-heading").textContent = offering.heading;
  document.querySelector("#option-description").textContent = offering.description;
  document.querySelector("#option-price").textContent = offering.price;

  const visual = document.querySelector("#option-visual");
  visual.style.backgroundImage = `url("${offering.image}")`;
  visual.setAttribute("aria-label", offering.imageAlt);

  const parentLink = document.querySelector("#option-parent-link");
  parentLink.href = offering.parentUrl;
  parentLink.textContent = `View all ${offering.category}`;

  ["#option-inquiry", "#option-cta"].forEach((selector) => {
    document.querySelector(selector).href = inquiryUrl;
  });

  const featureList = document.querySelector("#option-features");
  offering.features.forEach((feature) => {
    const item = document.createElement("li");
    item.textContent = feature;
    featureList.appendChild(item);
  });
}
