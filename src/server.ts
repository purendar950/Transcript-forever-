/**
 * Standalone server entrypoint.
 *
 * Deno Deploy starts an app with `deno run <entrypoint>`, so it needs a file
 * that calls `Deno.serve` itself. `src/main.ts` stays a plain handler module so
 * it also works with `deno serve` and Cloudflare Workers.
 */
import { handler } from "./main.ts";

const port = Number(Deno.env.get("PORT") ?? "8000");

Deno.serve({ port: Number.isFinite(port) && port > 0 ? port : 8000 }, handler);
