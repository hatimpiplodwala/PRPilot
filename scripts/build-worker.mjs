import { build } from "esbuild";

/**
 * Bundle the Lambda worker (worker/handler.ts) and all of its lib/ dependencies
 * into a single CommonJS file with the `@/` path alias resolved. The result
 * runs on the bare AWS Lambda Node runtime with no node_modules and no TS
 * toolchain — the Lambda image just copies dist/handler.js into the task root.
 */
await build({
  entryPoints: ["worker/handler.ts"],
  outfile: "dist/handler.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // Reads `paths` ("@/*" -> "./*") so the alias resolves the same as in tsc.
  tsconfig: "tsconfig.json",
  minify: true,
  legalComments: "none",
});

console.log("worker bundled -> dist/handler.js");
