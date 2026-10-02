import type { z, ZodType } from "zod";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST") => new AppError(400, code, message);
export const unauthorized = (message = "กรุณาเข้าสู่ระบบ") => new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "ไม่มีสิทธิ์ทำรายการนี้") => new AppError(403, "FORBIDDEN", message);
export const notFound = (message = "ไม่พบข้อมูล") => new AppError(404, "NOT_FOUND", message);
export const conflict = (message: string, code = "CONFLICT") => new AppError(409, code, message);

export function parse<S extends ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    throw new AppError(400, "VALIDATION", `${where}${first?.message ?? "invalid input"}`);
  }
  return result.data;
}
