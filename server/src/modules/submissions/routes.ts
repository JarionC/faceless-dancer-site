import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { createSubmissionSchema } from "@faceless/shared";
import { pool } from "../../db/postgres.js";
import { createId } from "../../utils/crypto.js";
import { env } from "../../config/env.js";
import { requireAuth, requireHolder } from "../../middleware/auth.js";
import { buildObjectPath, uploadBufferToBunny } from "../storage/bunnyStorage.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.maxUploadSizeBytes,
  },
});

async function getDraftSubmission(userId: string) {
  const result = await pool.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM submissions WHERE user_id = $1 AND status = 'draft' ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return result.rows[0];
}

async function getOrCreateDraftSubmission(userId: string) {
  const existingDraft = await getDraftSubmission(userId);
  if (existingDraft) {
    return existingDraft;
  }

  const submissionId = createId();
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO submissions (id, user_id, title, notes, desired_start, desired_end, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft')`,
    [submissionId, userId, "Draft submission", null, now.toISOString(), nextHour.toISOString()]
  );

  return { id: submissionId, user_id: userId };
}

router.post("/", requireAuth, requireHolder, async (req, res) => {
  const parsed = createSubmissionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { title, notes, desiredStart, desiredEnd } = parsed.data;
  const desiredStartTime = new Date(desiredStart).getTime();
  const desiredEndTime = new Date(desiredEnd).getTime();

  if (desiredEndTime <= desiredStartTime) {
    return res.status(400).json({ error: "Desired end must be after desired start" });
  }

  if (desiredEndTime - desiredStartTime !== 60 * 60 * 1000) {
    return res.status(400).json({ error: "Schedule requests must be exactly one hour" });
  }

  const desiredStartDate = new Date(desiredStart);
  const desiredEndDate = new Date(desiredEnd);
  if (
    desiredStartDate.getUTCMinutes() !== 0 ||
    desiredStartDate.getUTCSeconds() !== 0 ||
    desiredStartDate.getUTCMilliseconds() !== 0 ||
    desiredEndDate.getUTCMinutes() !== 0 ||
    desiredEndDate.getUTCSeconds() !== 0 ||
    desiredEndDate.getUTCMilliseconds() !== 0
  ) {
    return res.status(400).json({ error: "Schedule requests must start on the hour" });
  }

  const draft = await getDraftSubmission(req.session!.userId);
  if (!draft) {
    return res.status(400).json({ error: "Upload at least one asset before submitting" });
  }

  const assetCountResult = await pool.query<{ count: string }>(
    `SELECT COUNT(1) AS count FROM assets WHERE submission_id = $1`,
    [draft.id]
  );

  if (Number(assetCountResult.rows[0]?.count ?? 0) < 1) {
    return res.status(400).json({ error: "Upload at least one asset before submitting" });
  }

  await pool.query(
    `UPDATE submissions
     SET title = $1, notes = $2, desired_start = $3, desired_end = $4, status = 'pending', rejection_reason = NULL, updated_at = now()
     WHERE id = $5`,
    [title, notes ?? null, desiredStart, desiredEnd, draft.id]
  );

  return res.status(201).json({ submissionId: draft.id, status: "pending" });
});

router.get("/me", requireAuth, async (req, res) => {
  const result = await pool.query(`SELECT * FROM submissions WHERE user_id = $1 AND status != 'draft' ORDER BY created_at DESC`, [
    req.session!.userId,
  ]);
  return res.json({ submissions: result.rows });
});

async function handleAssetUpload(req: any, res: any, submissionIdOverride?: string) {
  try {
    const draft = submissionIdOverride
      ? (
          await pool.query<{ id: string; user_id: string }>(`SELECT id, user_id FROM submissions WHERE id = $1 LIMIT 1`, [
            submissionIdOverride,
          ])
        ).rows[0]
      : await getOrCreateDraftSubmission(req.session!.userId);

    const assetType = String(req.body.assetType ?? "").trim();

    if (!draft) {
      return res.status(404).json({ error: "Submission not found" });
    }

    if (draft.user_id !== req.session!.userId && !req.session!.isAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Missing file" });
    }

    const mime = req.file.mimetype;
    const normalizedAssetType = assetType || "unspecified";
    const lowerName = req.file.originalname.toLowerCase();
    const isMusic = normalizedAssetType === "music";
    const validForType =
      isMusic
        ? mime === "audio/mpeg" || lowerName.endsWith(".mp3")
        : ["background", "head", "torso"].includes(normalizedAssetType) &&
          (mime === "image/png" || lowerName.endsWith(".png"));

    if (!validForType) {
      return res.status(400).json({
        error: isMusic
          ? "Music assets must be uploaded as .mp3"
          : "Background, head, and torso assets must be uploaded as .png",
      });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const assetId = createId();
    const objectPath = buildObjectPath(["submissions", draft.id, `${assetId}${ext || ""}`]);

    const uploadResult = await uploadBufferToBunny({
      buffer: req.file.buffer,
      contentType: mime,
      objectPath,
    });

    await pool.query(
      `INSERT INTO assets (id, submission_id, uploader_user_id, asset_type, original_name, mime_type, size_bytes, bunny_object_path, bunny_public_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        assetId,
        draft.id,
        req.session!.userId,
        normalizedAssetType,
        req.file.originalname,
        mime,
        req.file.size,
        uploadResult.objectPath,
        uploadResult.publicUrl,
      ]
    );

    return res.status(201).json({ submissionId: draft.id, assetId, publicUrl: uploadResult.publicUrl });
  } catch (error: any) {
    return res.status(500).json({ error: error.message ?? "Failed to upload asset" });
  }
}

router.post("/assets", requireAuth, requireHolder, upload.single("file"), async (req, res) => {
  return handleAssetUpload(req, res);
});

router.post("/:submissionId/assets", requireAuth, requireHolder, upload.single("file"), async (req, res) => {
  return handleAssetUpload(req, res, req.params.submissionId);
});

export const submissionsRouter = router;
