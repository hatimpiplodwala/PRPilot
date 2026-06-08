/**
 * Tiny structured logger.
 *
 * One JSON object per line in production (Vercel ingests this into the runtime
 * log explorer with queryable fields). Pretty single-line output in dev so it
 * stays readable in a terminal.
 *
 * Use `log.child({ jobId })` to attach context that flows to every subsequent
 * line — keeps each call site free of repeated bookkeeping.
 *
 * Errors are passed as `{ err }` and unwrapped to `{ err: { name, message,
 * stack } }` so a single grep on `err.message` works across the whole log
 * stream and so stacks aren't lost behind `[object Object]`.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const envLevel = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug")) as Level;
const threshold = LEVEL_RANK[envLevel] ?? LEVEL_RANK.info;
const pretty = process.env.NODE_ENV !== "production";

type Context = Record<string, unknown>;

export interface Logger {
  debug: (msg: string, ctx?: Context) => void;
  info: (msg: string, ctx?: Context) => void;
  warn: (msg: string, ctx?: Context) => void;
  error: (msg: string, ctx?: Context) => void;
  child: (ctx: Context) => Logger;
}

function serializeError(err: unknown): Context {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

function normalize(ctx: Context | undefined): Context {
  if (!ctx) return {};
  const out: Context = { ...ctx };
  if (out.err !== undefined) out.err = serializeError(out.err);
  return out;
}

function emit(level: Level, base: Context, msg: string, ctx?: Context): void {
  if (LEVEL_RANK[level] < threshold) return;
  const record = { ts: new Date().toISOString(), level, msg, ...base, ...normalize(ctx) };
  const line = pretty ? prettify(record) : JSON.stringify(record);
  const stream = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  stream(line);
}

function prettify(record: Record<string, unknown>): string {
  const { ts, level, msg, ...rest } = record;
  const ctxStr = Object.keys(rest).length ? " " + JSON.stringify(rest) : "";
  return `${ts as string} ${String(level).toUpperCase().padEnd(5)} ${msg as string}${ctxStr}`;
}

function build(base: Context): Logger {
  return {
    debug: (msg, ctx) => emit("debug", base, msg, ctx),
    info: (msg, ctx) => emit("info", base, msg, ctx),
    warn: (msg, ctx) => emit("warn", base, msg, ctx),
    error: (msg, ctx) => emit("error", base, msg, ctx),
    child: (ctx) => build({ ...base, ...ctx }),
  };
}

export const log: Logger = build({});

/** Short random id for correlating one HTTP request's log lines. */
export function newRequestId(): string {
  return Math.random().toString(36).slice(2, 10);
}
