import { useEffect, useState } from "preact/hooks";
import { api } from "../lib/api";

interface Props {
  enabled: boolean;
}

interface SubmissionRow {
  id: string;
  title: string;
  notes: string | null;
  desired_start: string;
  desired_end: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
}

export function MySubmissionsCard({ enabled }: Props) {
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [status, setStatus] = useState("Idle");

  useEffect(() => {
    if (!enabled) {
      setSubmissions([]);
      setStatus("Sign in to view your submissions");
      return;
    }

    setStatus("Loading submissions...");
    api.mySubmissions()
      .then((data) => {
        setSubmissions(data.submissions);
        setStatus(data.submissions.length ? "Loaded" : "No submissions yet");
      })
      .catch((error) => setStatus(error.message));
  }, [enabled]);

  return (
    <section className="card">
      <h2>My Submissions</h2>
      {!enabled ? <span className="badge warn">Authentication required</span> : <span className="badge ok">Visible</span>}
      <div className="small">{status}</div>

      {enabled && submissions.length > 0 ? (
        <div style={{ overflow: "auto", marginTop: "10px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">Title</th>
                <th align="left">Status</th>
                <th align="left">Desired Window</th>
                <th align="left">Created</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((submission) => (
                <tr key={submission.id}>
                  <td>
                    <div>{submission.title}</div>
                    {submission.notes ? <div className="small">{submission.notes}</div> : null}
                  </td>
                  <td>{submission.status}</td>
                  <td>
                    <div>{new Date(submission.desired_start).toLocaleString()}</div>
                    <div className="small">to {new Date(submission.desired_end).toLocaleString()}</div>
                    {submission.status === "rejected" && submission.rejection_reason ? (
                      <div className="small">Reason: {submission.rejection_reason}</div>
                    ) : null}
                  </td>
                  <td>{new Date(submission.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
