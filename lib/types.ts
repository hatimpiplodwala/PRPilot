/** Shared domain types for PRPilot. */

export type Severity = "low" | "medium" | "high";

export interface PotentialBug {
  file: string;
  description: string;
  severity: Severity;
}

export interface Suggestion {
  file: string;
  description: string;
}

/** Structured review returned by the LLM (matches the Gemini responseSchema). */
export interface Review {
  summary: string;
  potential_bugs: PotentialBug[];
  suggestions: Suggestion[];
}

/** A changed file as returned by the GitHub "list PR files" API. */
export interface ChangedFile {
  filename: string;
  status: string; // added | modified | removed | renamed | ...
  additions: number;
  deletions: number;
  patch?: string; // unified-diff hunk; absent for binary/large files
}

export type JobStatus = "queued" | "running" | "done" | "failed";
export type JobTrigger = "webhook" | "manual";

export interface ReviewJob {
  id: string;
  installation_id: number;
  repo_full_name: string;
  pr_number: number;
  head_sha: string;
  status: JobStatus;
  trigger: JobTrigger;
  result_json: Review | null;
  comment_id: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}
