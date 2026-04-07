import { Router } from "express";
import { updateSubmissionStatusSchema } from "@faceless/shared";
import { pool } from "../../db/postgres.js";
import { requireAuth, requireAdmin } from "../../middleware/auth.js";
import { downloadFromBunny } from "../storage/bunnyStorage.js";

const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/submissions", async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";

  const base = `
    SELECT s.*, u.public_key,
      (SELECT COUNT(1) FROM assets a WHERE a.submission_id = s.id) AS asset_count
    FROM submissions s
    JOIN users u ON u.id = s.user_id
  `;

  const rows = status
    ? (await pool.query(`${base} WHERE s.status != 'draft' AND s.status = $1 ORDER BY s.created_at DESC`, [status])).rows
    : (await pool.query(`${base} WHERE s.status != 'draft' ORDER BY s.created_at DESC`)).rows;

  return res.json({ submissions: rows });
});

router.get("/submissions/:submissionId", async (req, res) => {
  const submissionId = req.params.submissionId;

  const submissionResult = await pool.query(`SELECT * FROM submissions WHERE id = $1 LIMIT 1`, [submissionId]);
  const submission = submissionResult.rows[0];

  if (!submission) {
    return res.status(404).json({ error: "Submission not found" });
  }

  const assetsResult = await pool.query(`SELECT * FROM assets WHERE submission_id = $1 ORDER BY created_at ASC`, [submissionId]);

  return res.json({ submission, assets: assetsResult.rows });
});

router.post("/submissions/:submissionId/status", async (req, res) => {
  const submissionId = req.params.submissionId;

  const parsed = updateSubmissionStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const result = await pool.query(
    `UPDATE submissions SET status = $1, rejection_reason = $2, updated_at = now() WHERE id = $3`,
    [parsed.data.status, parsed.data.status === "rejected" ? parsed.data.rejectionReason!.trim() : null, submissionId]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: "Submission not found" });
  }

  return res.json({ updated: true });
});

router.get("/assets/:assetId/download", async (req, res) => {
  try {
    const assetResult = await pool.query<{
      original_name: string;
      bunny_object_path: string;
      mime_type: string;
    }>(`SELECT original_name, bunny_object_path, mime_type FROM assets WHERE id = $1 LIMIT 1`, [req.params.assetId]);

    const asset = assetResult.rows[0];
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
