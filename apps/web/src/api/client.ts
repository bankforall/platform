import type { z } from "zod";

/** Error returned by the API (`{ error: { code, message } }`) or raised by the client. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api";

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface RequestOptions<S extends z.ZodTypeAny | undefined> {
  method?: Method;
  body?: unknown;
  form?: FormData;
  schema?: S;
  signal?: AbortSignal;
}

/**
 * Typed fetch: sends the session cookie, the CSRF header on mutations, and validates
 * the response with the shared zod schema so contract drift fails loudly.
 */
export async function request<S extends z.ZodTypeAny | undefined = undefined>(
  path: string,
  opts: RequestOptions<S> = {},
): Promise<S extends z.ZodTypeAny ? z.infer<S> : unknown> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET");
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET") headers["x-requested-with"] = "bankforall";
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  }

  let res: Response;
  try {
    res = await fetch(BASE + path, { method, headers, body, credentials: "include", signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK", "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต");
  }

  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? defaultMessage(res.status));
  }

  if (opts.schema) {
    const parsed = (opts.schema as z.ZodTypeAny).safeParse(json);
    if (!parsed.success) {
      console.error("API contract mismatch", path, parsed.error.issues);
      throw new ApiError(res.status, "BAD_RESPONSE", "ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง");
    }
    return parsed.data;
  }
  return json as never;
}

function defaultMessage(status: number): string {
  if (status === 401) return "กรุณาเข้าสู่ระบบอีกครั้ง";
  if (status === 403) return "คุณไม่มีสิทธิ์ทำรายการนี้";
  if (status === 404) return "ไม่พบข้อมูล";
  if (status === 429) return "ทำรายการถี่เกินไป กรุณารอสักครู่";
  if (status >= 500) return "ระบบขัดข้องชั่วคราว กรุณาลองใหม่";
  return "ทำรายการไม่สำเร็จ";
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "เกิดข้อผิดพลาด";
}
