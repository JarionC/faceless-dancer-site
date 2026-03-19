import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { createSubmissionSchema } from "@faceless/shared";
import { db } from "../../db/sqlite.js";
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

function getDraftSubmission(userId: string) {
  return db
    .prepare(`SELECT id, user_id FROM submissions WHERE user_id = ? AND status = 'draft' ORDER BY created_at DESC LIMIT 1`)
    .get(userId) as { id: string; user_id: string } | undefined;
}

function getOrCreateDraftSubmission(userId: string) {
  const existingDraft = getDraftSubmission(userId);
  if (existingDraft) {
    return existingDraft;
  }

  const submissionId = createId();
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);

  db.prepare(
    `INSERT INTO submissions (id, user_id, title, notes, desired_start, desired_end, status)
     VALUES (?, ?, ?, ?, ?, ?, 'draft')`
  ).run(
    submissionId,
    userId,
    "Draft submission",
    null,
    now.toISOString(),
    nextHour.toISOString()
  );

  return { id: submissionId, user_id: userId };
}

router.post("/", requireAuth, requireHolder, (req, res) => {
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

  const draft = getDraftSubmission(req.session!.userId);
  if (!draft) {
    return res.status(400).json({ error: "Upload at least one asset before submitting" });
  }

  const assetCount = db
    .prepare(`SELECT COUNT(1) AS count FROM assets WHERE submission_id = ?`)
    .get(draft.id) as { count: number };

  if (assetCount.count < 1) {
    return res.status(400).json({ error: "Upload at least one asset before submitting" });
  }

  db.prepare(
    `UPDATE submissions
     SET title = ?, notes = ?, desired_start = ?, desired_end = ?, status = 'pending', rejection_reason = NULL, updated_at = datetime('now')
     WHERE id = ?`
  ).run(title, notes ?? null, desiredStart, desiredEnd, draft.id);

  return res.status(201).json({ submissionId: draft.id, status: "pending" });
});

router.get("/me", requireAuth, (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM submissions WHERE user_id = ? AND status != 'draft' ORDER BY created_at DESC`)
    .all(req.session!.userId);
  return res.json({ submissions: rows });
});

async function handleAssetUpload(req: any, res: any, submissionIdOverride?: string) {
  try {
    const draft = submissionIdOverride
      ? (db
          .prepare(`SELECT id, user_id FROM submissions WHERE id = ? LIMIT 1`)
          .get(submissionIdOverride) as { id: string; user_id: string } | undefined)
      : getOrCreateDraftSubmission(req.session!.userId);

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
    const objectPath = buildObjectPath([
      "submissions",
      draft.id,
      `${assetId}${ext || ""}`,
    ]);

    const uploadResult = await uploadBufferToBunny({
      buffer: req.file.buffer,
      contentType: mime,
      objectPath,
    });

    db.prepare(
      `INSERT INTO assets (id, submission_id, uploader_user_id, asset_type, original_name, mime_type, size_bytes, bunny_object_path, bunny_public_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      assetId,
      draft.id,
      req.session!.userId,
      normalizedAssetType,
      req.file.originalname,
      mime,
      req.file.size,
      uploadResult.objectPath,
      uploadResult.publicUrl
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
