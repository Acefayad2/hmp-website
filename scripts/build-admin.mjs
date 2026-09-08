import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const outputDirectory = process.env.HMP_BUILD_DIR || "dist";
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(`${outputDirectory}/assets/brand`, { recursive: true });

const productionFiles = [
  "index.html",
  "about.html",
  "services.html",
  "guest-seating.html",
  "celebration-accessories.html",
  "money-table.html",
  "inquiry.html",
  "conversation.html",
  "conversation.css",
  "conversation.js",
  "service-option.html",
  "service-option.js",
  "seo-schema.js",
  "privacy.html",
  "dashboard.html",
  "dashboard.css",
  "404.html",
  "styles.css",
  "mobile.css",
  "pages.css",
  "brand.css",
  "script.js",
  "sitemap.xml",
  "assets/hmp-hero.png",
  "assets/hmp-hero.webp",
  "assets/hmp-hero-no-screen-2026.webp",
  "assets/hmp-hero-welcome.webp",
  "assets/celebration-accessories-hero-v2.webp",
  "assets/gallery-arrival-v2.webp",
  "assets/gallery-details-v2.webp",
  "assets/gallery-reception-v2.webp",
  "assets/modern-reception.jpg",
  "assets/modern-reception.webp",
  "assets/modern-guest-arrival.jpg",
  "assets/modern-guest-arrival.webp",
  "assets/modern-guest-arrival-no-screen.webp",
  "assets/modern-money-table.jpg",
  "assets/modern-money-table.webp",
  "assets/money-machine-table.webp",
  "assets/brand/hmp-logo-2026.png",
];

await Promise.all(
  productionFiles.map(async (file) => {
    const destination = `${outputDirectory}/${file}`;
    await mkdir(destination.split("/").slice(0, -1).join("/"), {
      recursive: true,
    });

    // The repository is the source of truth for deploys. Fetching these files
    // from production can silently roll a new deploy back to an older version.
    await copyFile(file, destination);
  }),
);

const publicPages = productionFiles.filter((file) => file.endsWith(".html"));
await Promise.all(
  publicPages.map(async (file) => {
    const path = `${outputDirectory}/${file}`;
    const html = await readFile(path, "utf8");
    const withAdminAccess = html.includes('href="/admin"')
      ? html
      : html.replace(
          /(<a href="\/privacy">Privacy<\/a>)/,
          '$1\n        <a href="/admin">Admin login</a>',
        );
    await writeFile(path, withAdminAccess);
  }),
);

await Promise.all([
  copyFile("admin.html", `${outputDirectory}/admin.html`),
  copyFile("admin.css", `${outputDirectory}/admin.css`),
  copyFile("robots.txt", `${outputDirectory}/robots.txt`),
]);

await build({
  entryPoints: ["src/admin.js"],
  outfile: `${outputDirectory}/assets/admin.js`,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
});
