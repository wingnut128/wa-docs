import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { join } from "path";
import { registerRoutes } from "./routes";

const app = new Hono();
const rootDir = join(import.meta.dir, "..");

// Serve static assets from server/public/ (absolute path to avoid CWD-dependent resolution)
app.use("/*", serveStatic({ root: join(import.meta.dir, "public") + "/" }));

// Register doc routes
await registerRoutes(app, rootDir);

const port = parseInt(process.env.PORT || "8080", 10);

console.log(`Server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
