import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { env } from "./env";
import type { ChangedFile, Review } from "./types";
import { buildDiffText, selectFilesForReview } from "./diff";

/**
 * LLM integration — isolated here so the provider can be swapped without
 * touching the rest of the app. Uses Gemini's native JSON mode with a
 * responseSchema so output validates against `Review` with minimal parsing.
 */

const SYSTEM_INSTRUCTION = `You are a senior software engineer performing a code review on a GitHub pull request.
Be concise and high-signal: only flag things that genuinely matter — likely bugs, correctness issues, security problems, and clear risks. Do NOT nitpick style, formatting, or naming unless it causes a real bug.
Always reference the specific file. If you find nothing wrong, return empty arrays and say so briefly in the summary.`;

// Mirrors the `Review` type. Gemini enforces this shape.
const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING },
    potential_bugs: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          file: { type: SchemaType.STRING },
          description: { type: SchemaType.STRING },
          severity: { type: SchemaType.STRING, enum: ["low", "medium", "high"], format: "enum" },
        },
        required: ["file", "description", "severity"],
      },
    },
    suggestions: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          file: { type: SchemaType.STRING },
          description: { type: SchemaType.STRING },
        },
        required: ["file", "description"],
      },
    },
  },
  required: ["summary", "potential_bugs", "suggestions"],
} as const;

export interface ReviewMeta {
  repo: string;
  prNumber: number;
  title: string;
  body?: string;
}

export interface ReviewOutcome {
  review: Review;
  truncatedNote?: string;
}

function buildPrompt(meta: ReviewMeta, diffText: string): string {
  return [
    `Repository: ${meta.repo}`,
    `Pull request #${meta.prNumber}: ${meta.title}`,
    meta.body ? `Description:\n${meta.body}` : "",
    "",
    "Review the following changes:",
    "",
    diffText,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Run a review over the changed files. Caps files first (token safety),
 * calls Gemini in JSON mode, and retries once on malformed output.
 */
export async function reviewDiff(files: ChangedFile[], meta: ReviewMeta): Promise<ReviewOutcome> {
  const selected = selectFilesForReview(files, env.reviewMaxFiles);

  if (selected.files.length === 0) {
    return {
      review: {
        summary: "No reviewable code changes were found in this pull request.",
        potential_bugs: [],
        suggestions: [],
      },
    };
  }

  const diffText = buildDiffText(selected.files);
  const prompt = buildPrompt(meta, diffText);

  const genAI = new GoogleGenerativeAI(env.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: env.geminiModel,
    systemInstruction: SYSTEM_INSTRUCTION,
    generationConfig: {
      responseMimeType: "application/json",
      // Cast: the SDK's Schema type is structurally compatible with our literal.
      responseSchema: RESPONSE_SCHEMA as never,
      temperature: 0.2,
    },
  });

  const review = await callWithRetry(model, prompt);

  const truncatedNote = selected.truncated
    ? `Reviewed the ${selected.files.length} most significant file(s); ${selected.skipped} additional changed file(s) were not reviewed to stay within limits.`
    : undefined;

  return { review, truncatedNote };
}

async function callWithRetry(
  model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>,
  prompt: string
): Promise<Review> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      return parseReview(text);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Gemini review failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}

/** Parse + minimally validate the model's JSON into a Review. Exported for tests. */
export function parseReview(text: string): Review {
  const data = JSON.parse(text) as unknown;
  if (typeof data !== "object" || data === null) {
    throw new Error("review is not an object");
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.summary !== "string") throw new Error("missing summary");
  if (!Array.isArray(obj.potential_bugs)) throw new Error("missing potential_bugs");
  if (!Array.isArray(obj.suggestions)) throw new Error("missing suggestions");

  return {
    summary: obj.summary,
    potential_bugs: (obj.potential_bugs as Review["potential_bugs"]).map((b) => ({
      file: String(b.file ?? ""),
      description: String(b.description ?? ""),
      severity: (["low", "medium", "high"] as const).includes(b.severity) ? b.severity : "medium",
    })),
    suggestions: (obj.suggestions as Review["suggestions"]).map((s) => ({
      file: String(s.file ?? ""),
      description: String(s.description ?? ""),
    })),
  };
}
