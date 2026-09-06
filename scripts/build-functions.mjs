import { build } from "esbuild";
import { mkdir, readdir, rm } from "node:fs/promises";

const sourceDirectory = "netlify/functions";
const outputDirectory = ".netlify/deploy-functions";
await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const entries = (await readdir(sourceDirectory))
  .filter((file) => file.endsWith(".mts") && !file.startsWith("_"))
  .map((file) => `${sourceDirectory}/${file}`);

await build({
  entryPoints: entries,
  outdir: outputDirectory,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  outExtension: { ".js": ".mjs" },
  logLevel: "info",
});

process.exit(0);
