(() => {
  const origin = "https://hmpeds.com";
  const organization = { "@id": `${origin}/#organization` };
  const website = { "@id": `${origin}/#website` };
  const pages = {
    "/about": {
      name: "About HMP Luxury Event Services",
      type: "AboutPage",
    },
    "/services": {
      name: "Event Services in Maryland",
      type: "CollectionPage",
      itemList: [
        ["Celebration Accessories", "/celebration-accessories"],
        ["Guest Seating Experience", "/guest-seating"],
        ["Money Table Services", "/money-table"],
      ],
    },
    "/celebration-accessories": {
      name: "Celebration Accessory Rentals in Maryland",
      type: "Service",
      description: "Club signs, strobes, money guns, celebration kits, card boxes, and premium LED welcome sign rentals for Maryland events.",
      image: "/assets/celebration-accessories-hero-v2.webp",
    },
    "/guest-seating": {
      name: "Digital Guest Seating and Event Check-In",
      type: "Service",
      description: "Interactive guest arrival, digital event check-in, seating lookup, and premium LED signage for Maryland celebrations.",
      image: "/assets/hmp-hero-welcome.webp",
    },
    "/money-table": {
      name: "Money Table Services in Maryland",
      type: "Service",
      description: "Organized money collecting, changing, and cash-counting support for celebrations in Maryland.",
      image: "/assets/modern-money-table.webp",
    },
    "/inquiry": {
      name: "Request an Event Services Quote",
      type: "ContactPage",
    },
    "/privacy": {
      name: "HMP Privacy Information",
      type: "WebPage",
    },
  };

  const path = window.location.pathname.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  const page = pages[path];
  if (!page) return;
  const url = `${origin}${path}`;
  const graph = [{
    "@type": ["Organization", "ProfessionalService"],
    "@id": `${origin}/#organization`,
    name: "HMP Luxury Event Services",
    url: `${origin}/`,
    logo: `${origin}/assets/brand/hmp-logo-2026.png`,
    email: "info@hmpeds.com",
    telephone: "+1-301-471-0990",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Laurel",
      addressRegion: "MD",
      addressCountry: "US",
    },
    areaServed: { "@type": "State", name: "Maryland" },
  }];

  if (page.type === "Service") {
    graph.push({
      "@type": "Service",
      "@id": `${url}#service`,
      name: page.name,
      description: page.description,
      url,
      image: `${origin}${page.image}`,
      provider: organization,
      areaServed: { "@type": "State", name: "Maryland" },
      serviceType: page.name,
    });
  } else {
    const webPage = {
      "@type": page.type,
      "@id": `${url}#webpage`,
      url,
      name: page.name,
      isPartOf: website,
      about: organization,
      inLanguage: "en-US",
    };
    if (page.itemList) {
      webPage.mainEntity = {
        "@type": "ItemList",
        itemListElement: page.itemList.map(([name, itemPath], index) => ({
          "@type": "ListItem",
          position: index + 1,
          name,
          url: `${origin}${itemPath}`,
        })),
      };
    }
    graph.push(webPage);
  }

  const breadcrumbItems = [{ name: "Home", url: `${origin}/` }];
  if (path !== "/") {
    if (["/celebration-accessories", "/guest-seating", "/money-table"].includes(path)) {
      breadcrumbItems.push({ name: "Services", url: `${origin}/services` });
    }
    breadcrumbItems.push({ name: page.name, url });
  }
  graph.push({
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: breadcrumbItems.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  });

  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
  document.head.append(script);
})();
