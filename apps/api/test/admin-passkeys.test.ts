import type { FastifyRequest } from "fastify";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession, SESSION_COOKIE, type Session } from "../src/auth/session.js";
import type { Ctx } from "../src/context.js";
import {
  adminGuard,
  CHALLENGE_TTL_SECONDS,
  deletePasskey,
  enrolment,
  ENROL_WINDOW_SECONDS,
  registerPasskey,
  registrationOptions,
  requireAdminAccess,
  saveChallenge,
  stepUp,
  stepUpOptions,
  takeChallenge,
} from "../src/services/adminPasskeys.js";

// no real WebAuthn here: the library's crypto is its own; we test our policy around it
const webauthn = vi.hoisted(() => ({
  n: 0,
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: `reg-${++webauthn.n}` })),
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: `auth-${++webauthn.n}` })),
  verifyRegistrationResponse: webauthn.verifyRegistrationResponse,
  verifyAuthenticationResponse: webauthn.verifyAuthenticationResponse,
}));

/** In-memory Redis with the subset (and TTL semantics) the service uses. */
class FakeRedis {
  private m = new Map<string, { v: string; exp: number }>();
  async set(k: string, v: string, _ex: "EX", seconds: number) {
    this.m.set(k, { v, exp: Date.now() + seconds * 1000 });
    return "OK";
  }
  async get(k: string) {
    const e = this.m.get(k);
    if (!e || e.exp <= Date.now()) return null;
    return e.v;
  }
  async getdel(k: string) {
    const v = await this.get(k);
    this.m.delete(k);
    return v;
  }
}

interface Row {
  id: string;
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: bigint;
  transports: string[];
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

const SECRET = "s".repeat(32);

function makeCtx(required: boolean) {
  const users = new Map<string, { id: string; role: string; sessionVersion: number; displayName: string }>();
  let rows: Row[] = [];
  const audits: { adminId: string; action: string; targetId: string }[] = [];
  const mine = (where: { userId?: string; id?: string; credentialId?: string }) =>
    rows.filter(
      (r) =>
        (where.userId === undefined || r.userId === where.userId) &&
        (where.id === undefined || r.id === where.id) &&
        (where.credentialId === undefined || r.credentialId === where.credentialId),
    );
  const db = {
    user: { findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null },
    adminPasskey: {
      count: async ({ where }: { where: { userId: string } }) => mine(where).length,
      findMany: async ({ where }: { where: { userId: string } }) => mine(where),
      findFirst: async ({ where }: { where: Partial<Row> }) => mine(where)[0] ?? null,
      create: async ({ data }: { data: Omit<Row, "id" | "createdAt" | "lastUsedAt"> }) => {
        const row = { ...data, id: `pk${rows.length + 1}`, createdAt: new Date(), lastUsedAt: null };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) =>
        Object.assign(rows.find((r) => r.id === where.id)!, data),
      delete: async ({ where }: { where: { id: string } }) => {
        rows = rows.filter((r) => r.id !== where.id);
      },
    },
    adminAuditLog: { create: async ({ data }: { data: (typeof audits)[number] }) => void audits.push(data) },
    notification: { create: async () => ({}) },
  };
  const ctx = {
    config: {
      SESSION_SECRET: SECRET,
      ADMIN_PASSKEY_REQUIRED: required,
      ADMIN_STEPUP_TTL: 900,
      WEBAUTHN_RP_ID: "localhost",
      WEBAUTHN_ORIGIN: "http://localhost:5173",
      WEBAUTHN_RP_NAME: "Bank For All",
    },
    db,
    redis: new FakeRedis(),
    log: { warn: () => {} },
  } as unknown as Ctx;
  return { ctx, users, audits, rows: () => rows };
}

async function login(ctx: Ctx, userId: string, ageSeconds = 0): Promise<FastifyRequest> {
  const token = await new SignJWT({ v: 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(Math.floor(Date.now() / 1000) - ageSeconds)
    .setExpirationTime("1d")
    .sign(new TextEncoder().encode(SECRET));
  return { cookies: { [SESSION_COOKIE]: token } } as unknown as FastifyRequest;
}

const session = async (ctx: Ctx, req: FastifyRequest) => (await currentSession(ctx, req)) as Session;
const code = (p: Promise<unknown>) =>
  p.then(
    () => "OK",
    (e: { code?: string }) => e.code,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  webauthn.verifyRegistrationResponse.mockReset();
  webauthn.verifyAuthenticationResponse.mockReset();
  webauthn.verifyRegistrationResponse.mockImplementation(async ({ response }: { response: { id: string } }) => ({
    verified: true,
    registrationInfo: { credential: { id: response.id, publicKey: new Uint8Array([1, 2, 3]), counter: 0 } },
  }));
  webauthn.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 7 } });
});
afterEach(() => vi.useRealTimers());

describe("admin guard (pure)", () => {
  it("needs a passkey when required, and a step-up for changes once one exists", () => {
    expect(adminGuard({ required: true, passkeys: 0, steppedUp: false, access: "read" })).toBe("ADMIN_PASSKEY_REQUIRED");
    expect(adminGuard({ required: true, passkeys: 0, steppedUp: false, access: "write" })).toBe("ADMIN_PASSKEY_REQUIRED");
    expect(adminGuard({ required: true, passkeys: 1, steppedUp: false, access: "read" })).toBeNull();
    expect(adminGuard({ required: true, passkeys: 1, steppedUp: false, access: "write" })).toBe("ADMIN_STEP_UP_REQUIRED");
    expect(adminGuard({ required: true, passkeys: 1, steppedUp: true, access: "write" })).toBeNull();
    // not required (development/test): free until the admin enrols, then the same rules
    expect(adminGuard({ required: false, passkeys: 0, steppedUp: false, access: "write" })).toBeNull();
    expect(adminGuard({ required: false, passkeys: 2, steppedUp: false, access: "write" })).toBe("ADMIN_STEP_UP_REQUIRED");
  });

  it("allows the first passkey only right after login, later ones only after a step-up", () => {
    expect(enrolment({ passkeys: 0, steppedUp: false, sessionAgeSeconds: 10 })).toBe("open");
    expect(enrolment({ passkeys: 0, steppedUp: false, sessionAgeSeconds: ENROL_WINDOW_SECONDS + 1 })).toBe("relogin");
    expect(enrolment({ passkeys: 1, steppedUp: false, sessionAgeSeconds: 10 })).toBe("step-up");
    expect(enrolment({ passkeys: 1, steppedUp: true, sessionAgeSeconds: 99_999 })).toBe("open");
  });
});

describe("WebAuthn challenges", () => {
  it("are single-use, bound to the login and short-lived", async () => {
    const { ctx, users } = makeCtx(true);
    users.set("a1", { id: "a1", role: "ADMIN", sessionVersion: 0, displayName: "Admin" });
    const s1 = await session(ctx, await login(ctx, "a1"));
    const s2 = await session(ctx, await login(ctx, "a1", 5));
    expect(s1.id).not.toBe(s2.id);

    await saveChallenge(ctx, "auth", s1, "c1");
    expect(await code(takeChallenge(ctx, "auth", s2))).toBe("WEBAUTHN_CHALLENGE_EXPIRED"); // other login
    expect(await code(takeChallenge(ctx, "reg", s1))).toBe("WEBAUTHN_CHALLENGE_EXPIRED"); // other purpose
    expect(await takeChallenge(ctx, "auth", s1)).toBe("c1");
    expect(await code(takeChallenge(ctx, "auth", s1))).toBe("WEBAUTHN_CHALLENGE_EXPIRED"); // used

    await saveChallenge(ctx, "auth", s1, "c2");
    vi.setSystemTime(Date.now() + (CHALLENGE_TTL_SECONDS + 1) * 1000);
    expect(await code(takeChallenge(ctx, "auth", s1))).toBe("WEBAUTHN_CHALLENGE_EXPIRED"); // expired
  });
});

describe("admin passkeys end to end (mocked authenticator)", () => {
  it("enrols, steps up, guards writes, and refuses replays", async () => {
    const { ctx, users, audits, rows } = makeCtx(true);
    users.set("a1", { id: "a1", role: "ADMIN", sessionVersion: 0, displayName: "Admin" });
    users.set("u1", { id: "u1", role: "USER", sessionVersion: 0, displayName: "User" });
    const req = await login(ctx, "a1");
    const s = await session(ctx, req);

    expect(await code(requireAdminAccess(ctx, await login(ctx, "u1"), "read"))).toBe("FORBIDDEN");
    expect(await code(requireAdminAccess(ctx, req, "read"))).toBe("ADMIN_PASSKEY_REQUIRED");

    // first passkey right after login
    await registrationOptions(ctx, s);
    const view = await registerPasskey(ctx, s, "มือถือ", { id: "cred-1" });
    expect(view.passkeys.map((p) => p.name)).toEqual(["มือถือ"]);
    expect(view.stepUpExpiresAt).not.toBeNull(); // enrolment with user verification counts as a step-up
    expect(audits.map((a) => a.action)).toContain("admin.passkey.register");
    // the same registration response cannot be replayed
    expect(await code(registerPasskey(ctx, s, "อีกเครื่อง", { id: "cred-1" }))).toBe("WEBAUTHN_CHALLENGE_EXPIRED");

    expect(await code(requireAdminAccess(ctx, req, "write"))).toBe("OK");
    // a different login of the same admin is not stepped up
    const other = await login(ctx, "a1", 30);
    expect(await code(requireAdminAccess(ctx, other, "read"))).toBe("OK");
    expect(await code(requireAdminAccess(ctx, other, "write"))).toBe("ADMIN_STEP_UP_REQUIRED");

    // step-up expires
    vi.setSystemTime(Date.now() + 901_000);
    expect(await code(requireAdminAccess(ctx, req, "write"))).toBe("ADMIN_STEP_UP_REQUIRED");

    // step up again; the assertion is single-use
    await stepUpOptions(ctx, s);
    const until = await stepUp(ctx, s, { id: "cred-1" });
    expect(until.getTime()).toBeGreaterThan(Date.now());
    expect(rows()[0]!.counter).toBe(7n);
    expect(rows()[0]!.lastUsedAt).not.toBeNull();
    expect(await code(requireAdminAccess(ctx, req, "write"))).toBe("OK");
    expect(await code(stepUp(ctx, s, { id: "cred-1" }))).toBe("WEBAUTHN_CHALLENGE_EXPIRED");
    expect(webauthn.verifyAuthenticationResponse).toHaveBeenCalledTimes(1);
    expect(audits.filter((a) => a.action === "admin.stepup")).toHaveLength(1);
  });

  it("rejects failed assertions and unknown credentials without granting a step-up", async () => {
    const { ctx, users, audits } = makeCtx(true);
    users.set("a1", { id: "a1", role: "ADMIN", sessionVersion: 0, displayName: "Admin" });
    const req = await login(ctx, "a1");
    const s = await session(ctx, req);
    await registrationOptions(ctx, s);
    await registerPasskey(ctx, s, "key", { id: "cred-1" });
    vi.setSystemTime(Date.now() + 901_000);

    await stepUpOptions(ctx, s);
    expect(await code(stepUp(ctx, s, { id: "someone-elses" }))).toBe("PASSKEY_INVALID");
    webauthn.verifyAuthenticationResponse.mockRejectedValueOnce(new Error("counter went backwards"));
    await stepUpOptions(ctx, s);
    expect(await code(stepUp(ctx, s, { id: "cred-1" }))).toBe("PASSKEY_INVALID");
    expect(await code(requireAdminAccess(ctx, req, "write"))).toBe("ADMIN_STEP_UP_REQUIRED");
    expect(audits.filter((a) => a.action === "admin.stepup.failed")).toHaveLength(2);
  });

  it("only opens first enrolment right after login and needs a step-up for more passkeys", async () => {
    const { ctx, users } = makeCtx(true);
    users.set("a1", { id: "a1", role: "ADMIN", sessionVersion: 0, displayName: "Admin" });
    const stale = await session(ctx, await login(ctx, "a1", ENROL_WINDOW_SECONDS + 60));
    expect(await code(registrationOptions(ctx, stale))).toBe("ADMIN_REAUTH_REQUIRED");

    const s = await session(ctx, await login(ctx, "a1"));
    await registrationOptions(ctx, s);
    await registerPasskey(ctx, s, "first", { id: "cred-1" });
    vi.setSystemTime(Date.now() + 901_000);
    expect(await code(registrationOptions(ctx, s))).toBe("ADMIN_STEP_UP_REQUIRED");
    await stepUpOptions(ctx, s);
    await stepUp(ctx, s, { id: "cred-1" });
    await registrationOptions(ctx, s);
    const view = await registerPasskey(ctx, s, "second", { id: "cred-2" });
    expect(view.passkeys).toHaveLength(2);
  });

  it("keeps the last passkey while passkeys are required", async () => {
    const { ctx, users, audits } = makeCtx(true);
    users.set("a1", { id: "a1", role: "ADMIN", sessionVersion: 0, displayName: "Admin" });
    const s = await session(ctx, await login(ctx, "a1"));
    await registrationOptions(ctx, s);
    await registerPasskey(ctx, s, "first", { id: "cred-1" });
    await registrationOptions(ctx, s);
    await registerPasskey(ctx, s, "second", { id: "cred-2" });
    const admin = s.user;
    await deletePasskey(ctx, admin, "pk1");
    expect(await code(deletePasskey(ctx, admin, "pk2"))).toBe("ADMIN_LAST_PASSKEY");
    expect(await code(deletePasskey(ctx, admin, "nope"))).toBe("NOT_FOUND");
    expect(audits.filter((a) => a.action === "admin.passkey.delete")).toHaveLength(1);
  });

  it("lets admins without a passkey act when passkeys are not required (development/test)", async () => {
    const { ctx, users } = makeCtx(false);
    users.set("a1", { id: "a1", role: "ADMIN", sessionVersion: 0, displayName: "Admin" });
    expect(await code(requireAdminAccess(ctx, await login(ctx, "a1", 99_999), "write"))).toBe("OK");
  });
});
