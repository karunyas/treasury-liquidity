import { Router } from "express";
import { getCurveResponse, refreshFromSource } from "../lib/curves.js";
import { TENORS } from "../lib/tenors.js";

export const curveRouter = Router();

/** GET /api/curve — the current curve, with day and week deltas per tenor. */
curveRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await getCurveResponse());
  } catch (error) {
    next(error);
  }
});

/** GET /api/curve/tenors — the tradable term list. */
curveRouter.get("/tenors", (_req, res) => {
  res.json({ tenors: TENORS.map(({ key, label, months }) => ({ key, label, months })) });
});

/** POST /api/curve/refresh — force a pull, bypassing the TTL. */
curveRouter.post("/refresh", async (_req, res, next) => {
  try {
    await refreshFromSource(true);
    res.json(await getCurveResponse());
  } catch (error) {
    next(error);
  }
});
