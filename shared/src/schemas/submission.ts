import { z } from "zod";

export const createSubmissionSchema = z.object({
  title: z.string().min(3).max(140),
  notes: z.string().max(1000).optional(),
  desiredStart: z.string().datetime(),
  desiredEnd: z.string().datetime(),
});

export const updateSubmissionStatusSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "scheduled"]),
  rejectionReason: z.string().max(1000).optional(),
}).superRefine((value, ctx) => {
  if (value.status === "rejected" && !value.rejectionReason?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Rejection reason is required when rejecting a submission",
      path: ["rejectionReason"],
    });
  }
});
