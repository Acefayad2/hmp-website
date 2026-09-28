import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";

const derive = promisify(scrypt);
const table = "hmp_client_portal_pins";
const duration = 8 * 60 * 60 * 1000;
type PinRecord = { id: string; pin_hash: string | null; version: string };

export const portalPinId = (scope: string, privateToken: string) =>
  `${scope}:${createHash("sha256").update(privateToken).digest("hex")}`;

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

async function hashPin(pin: string, salt = randomBytes(16).toString("hex")) {
  const key = await derive(pin, salt, 64) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}

async function matches(pin: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!/^[a-f0-9]{32}$/.test(salt || "") || !/^[a-f0-9]{128}$/.test(hash || "")) return false;
  const actual = Buffer.from((await hashPin(pin, salt)).split(":")[1], "hex");
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}

function cookieName(id: string, secure: boolean) {
  return `${secure ? "__Host-" : ""}hmp_client_${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
}

function signedSession(row: PinRecord, secret: string) {
  const payload = Buffer.from(JSON.stringify({ id: row.id, version: row.version, exp: Date.now() + duration })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

function sessionValid(request: Request, row: PinRecord, name: string, secret: string) {
  if (!row.pin_hash) return false;
  const cookie = (request.headers.get("cookie") || "").split(";").map((v) => v.trim()).find((v) => v.startsWith(name + "="))?.slice(name.length + 1);
  if (!cookie || cookie.length > 2048) return false;
  const parts = cookie.split(".");
  if (parts.length !== 2) return false;
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  try {
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    return value.id === row.id && value.version === row.version && Number.isFinite(value.exp) && value.exp > Date.now();
  } catch { return false; }
}

// Call only AFTER checking the private link and event/conversation availability.
// A non-null response means no portal data or mutation may be processed.
export async function requireClientPin(request: Request, database: SupabaseClient | null, id: string, secret: string, action = ""): Promise<Response | null> {
  if (!database || !secret) return reply({ error: "Client sign-in is temporarily unavailable." }, 503);
  const secure = new URL(request.url).protocol === "https:";
  const name = cookieName(id, secure);
  const cookie = (value: string, age: number) => `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? "; Secure" : ""}`;
  if (request.method !== "GET") {
    if (request.headers.get("origin") !== new URL(request.url).origin)
      return reply({ error: "Invalid request origin." }, 403);
  }
  try {
    if (action === "logout" && request.method === "POST")
      return reply({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    const { data: existing, error: readError } = await database.from(table).select("id,pin_hash,version").eq("id", id).maybeSingle();
    if (readError) throw readError;
    const row = existing as PinRecord | null;
    if (!action) {
      if (row && sessionValid(request, row, name, secret)) return null;
      return reply({ error: row?.pin_hash ? "Enter your PIN to sign in." : "Create your PIN to continue.", code: row?.pin_hash ? "CLIENT_PIN_REQUIRED" : "CLIENT_PIN_SETUP" }, 401);
    }
    if (!["setup", "login"].includes(action) || request.method !== "POST")
      return reply({ error: "Invalid sign-in request." }, 400);
    const raw = await request.text();
    if (raw.length > 1000) return reply({ error: "Invalid PIN request." }, 400);
    let body: { pin?: unknown; confirmPin?: unknown };
    try { body = JSON.parse(raw); } catch { return reply({ error: "Invalid PIN request." }, 400); }
    const pin = body.pin;
    if (typeof pin !== "string" || !/^\d{6}$/.test(pin))
      return reply({ error: "Enter a 6-digit PIN." }, 400);
    if (action === "setup" && pin !== body.confirmPin)
      return reply({ error: "The PINs do not match." }, 400);
    // Reserve attempts in Postgres before checking the hash, across all devices.
    const { data: permitted, error: limitError } = await database.rpc("hmp_client_pin_attempt", { p_id: id });
    if (limitError) throw limitError;
    if (permitted !== true) return reply({ error: "Too many attempts. Wait 15 minutes or contact HMP for a reset." }, 429, { "Retry-After": "900" });
    const { data: current, error: currentError } = await database.from(table).select("id,pin_hash,version").eq("id", id).single();
    if (currentError || !current) throw currentError || new Error("Missing PIN record");
    let authenticated = current as PinRecord;
    if (action === "setup") {
      if (current.pin_hash) return reply({ error: "A PIN is already set. Sign in or contact HMP for a reset.", code: "CLIENT_PIN_REQUIRED" }, 409);
      const { data: saved, error: saveError } = await database.from(table).update({ pin_hash: await hashPin(pin) }).eq("id", id).eq("version", current.version).is("pin_hash", null).select("id,pin_hash,version").maybeSingle();
      if (saveError) throw saveError;
      if (!saved) return reply({ error: "The PIN was changed. Sign in again.", code: "CLIENT_PIN_REQUIRED" }, 409);
      authenticated = saved as PinRecord;
    } else if (!current.pin_hash || !(await matches(pin, current.pin_hash))) {
      return reply({ error: "Incorrect PIN. Try again or contact HMP for a reset." }, 401);
    }
    return reply({ ok: true }, 200, { "Set-Cookie": cookie(signedSession(authenticated, secret), duration / 1000) });
  } catch {
    return reply({ error: "Client sign-in is temporarily unavailable. Please try again." }, 503);
  }
}

