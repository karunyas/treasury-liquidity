import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { curveRouter } from "./routes/curve.js";
import { ordersRouter } from "./routes/orders.js";

const PORT = Number(process.env.PORT ?? 4000);
const here = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: "16kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
});

app.use("/api/curve", curveRouter);
app.use("/api/orders", ordersRouter);

// In production the API also serves the built frontend, so `npm start` is
// the only command needed. In dev, Vite serves the frontend and proxies here.
const webDist = resolve(here, "../../web/dist");
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(resolve(webDist, "index.html"));
  });
}

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = error.status ?? 500;
  if (status >= 500) console.error("[api]", error);
  res.status(status).json({ error: error.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
