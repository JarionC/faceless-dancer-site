import { Router } from "express";
import { pool } from "../../db/postgres.js";

const router = Router();

router.get("/public", async (req, res) => {
  const result = await pool.query(
    `SELECT
       s.id AS submission_id,
       s.title,
       s.status,
       s.desired_start AS starts_at,
       s.desired_end AS ends_at
     FROM submissions s
     WHERE s.status IN ('pending', 'approved', 'scheduled')
     ORDER BY s.desired_start ASC`
  );

  return res.json({ slots: result.rows });
});

export const scheduleRouter = router;
