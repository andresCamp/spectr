import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await build({
  entryPoints: [path.join(__dirname, "src/editor.js")],
  outfile: path.join(__dirname, "../../specter/Resources/Editor/editor.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  logLevel: "info",
  sourcemap: false,
  minify: false,
});
