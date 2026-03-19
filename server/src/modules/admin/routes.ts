import { Router } from "express";
import { updateSubmissionStatusSchema } from "@faceless/shared";
import { db } from "../../db/sqlite.js";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";
import { downloadFromBunny } from "../storage/bunnyStorage.js";

const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/submissions", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";

  const base = `
    SELECT s.*, u.public_key,
      (SELECT COUNT(1) FROM assets a WHERE a.submission_id = s.id) AS asset_count
    FROM submissions s
    JOIN users u ON u.id = s.user_id
  `;

  const rows = status
    ? db.prepare(`${base} WHERE s.status != 'draft' AND s.status = ? ORDER BY s.created_at DESC`).all(status)
    : db.prepare(`${base} WHERE s.status != 'draft' ORDER BY s.created_at DESC`).all();

  return res.json({ submissions: rows });
});

router.get("/submissions/:submissionId", (req, res) => {
  const submissionId = req.params.submissionId;

  const submission = db
    .prepare(`SELECT * FROM submissions WHERE id = ? LIMIT 1`)
    .get(submissionId);

  if (!submission) {
    return res.status(404).json({ error: "Submission not found" });
  }

  const assets = db.prepare(`SELECT * FROM assets WHERE submission_id = ? ORDER BY created_at ASC`).all(submissionId);

  return res.json({ submission, assets });
});

router.post("/submissions/:submissionId/status", (req, res) => {
  const submissionId = req.params.submissionId;

  const parsed = updateSubmissionStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const result = db
    .prepare(`UPDATE submissions SET status = ?, rejection_reason = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(
      parsed.data.status,
      parsed.data.status === "rejected" ? parsed.data.rejectionReason!.trim() : null,
      submissionId
    );

  if (result.changes === 0) {
    return res.status(404).json({ error: "Submission not found" });
  }

  return res.json({ updated: true });
});

router.get("/assets/:assetId/download", async (req, res) => {
  try {
    const asset = db
      .prepare(`SELECT original_name, bunny_object_path, mime_type FROM assets WHERE id = ? LIMIT 1`)
      .get(req.params.assetId) as
      | { original_name: string; bunny_object_path: string; mime_type: string }
      | undefined;

    if (!asset) {
      return res.status(404).json({ error: "Asset not found" });
    }

    const file = await downloadFromBunny(asset.bunny_object_path);
    res.setHeader("Content-Type", file.contentType || asset.mime_type);
    res.setHeader("Content-Disposition", `attachment; filename=\"${asset.original_name}\"`);
    return res.send(file.buffer);
  } catch (error: any) {
    return res.status(500).json({ error: error.message ?? "Asset download failed" });
  }
});

export const adminRouter = router;
