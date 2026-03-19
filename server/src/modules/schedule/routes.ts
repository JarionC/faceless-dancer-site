import { Router } from "express";
import { db } from "../../db/sqlite.js";

const router = Router();

router.get("/public", (req, res) => {
  const slots = db
    .prepare(
      `SELECT
         s.id AS submission_id,
         s.title,
         s.status,
         s.desired_start AS starts_at,
         s.desired_end AS ends_at
       FROM submissions s
       WHERE s.status IN ('pending', 'approved', 'scheduled')
       ORDER BY s.desired_start ASC`
    )
    .all();

  return res.json({ slots });
});

export const scheduleRouter = router;
