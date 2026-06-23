import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { getDashboard } from "../clients/economicDashboard.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get("/", async (_req, res) => {
  try {
    res.json(await getDashboard());
  } catch (err) {
    console.error("[dashboard]:", err);
    res.status(502).json({ error: "Failed to build dashboard from e-conomic" });
  }
});
