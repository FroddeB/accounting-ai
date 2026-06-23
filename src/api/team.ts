import { Router } from "express";
import { requireAdmin, type AuthedRequest } from "../auth/middleware.js";
import { listTeam, inviteMember } from "../auth/service.js";
import { recordAudit } from "../db/audit.js";

export const teamRouter = Router();
teamRouter.use(requireAdmin);

teamRouter.get("/", async (_req, res) => {
  try {
    res.json({ members: await listTeam() });
  } catch (err) {
    console.error("[team] list:", err);
    res.status(500).json({ error: "Failed to load team" });
  }
});

teamRouter.post("/invite", async (req: AuthedRequest, res) => {
  try {
    const email = String(req.body?.email ?? "").trim();
    if (!email || !email.includes("@")) {
      res.status(400).json({ error: "Valid email required" });
      return;
    }
    const { created } = await inviteMember(email);
    await recordAudit({
      actor: req.user!.email,
      toolName: "team.invite",
      request: { email },
      response: { created },
      status: "success",
    });
    res.json({ ok: true, created });
  } catch (err) {
    console.error("[team] invite:", err);
    res.status(500).json({ error: "Failed to invite member" });
  }
});
