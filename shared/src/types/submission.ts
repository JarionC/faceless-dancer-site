export type SubmissionStatus = "pending" | "approved" | "rejected" | "scheduled";

export interface SubmissionRecord {
  id: string;
  userId: string;
  title: string;
  notes: string | null;
  desiredStart: string;
  desiredEnd: string;
  status: SubmissionStatus;
  rejectionReason: string | null;
  createdAt: string;
}
