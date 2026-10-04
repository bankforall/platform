import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { api } from "@/api/endpoints";
import { errorMessage } from "@/api/client";

/** Admin passkeys (WebAuthn): the second factor on top of LINE login for admin actions. */

export const passkeysSupported = () => browserSupportsWebAuthn();

/** Creates a passkey on this device and registers it; returns the updated security view. */
export async function enrolPasskey(name: string) {
  const options = await api.passkeyRegisterOptions();
  const response = await startRegistration({ optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON });
  return api.passkeyRegister(name, response as unknown as Record<string, unknown>);
}

/** Step-up: proves the admin holds a registered passkey; admin changes are allowed until `expiresAt`. */
export async function confirmAdminPasskey() {
  const options = await api.adminStepUpOptions();
  const response = await startAuthentication({ optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON });
  return api.adminStepUp(response as unknown as Record<string, unknown>);
}

/** Thai message for API errors and the browser's WebAuthn errors. */
export function passkeyErrorMessage(e: unknown): string {
  const { name, code } = (e ?? {}) as { name?: string; code?: string };
  if (name === "NotAllowedError" || code === "ERROR_CEREMONY_ABORTED") return "ยกเลิกการใช้พาสคีย์ หรือหมดเวลา กรุณาลองใหม่";
  if (name === "InvalidStateError" || code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return "อุปกรณ์นี้ลงทะเบียนพาสคีย์ไว้แล้ว";
  }
  if (name === "NotSupportedError") return "อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับพาสคีย์";
  if (name === "SecurityError" || code === "ERROR_INVALID_DOMAIN" || code === "ERROR_INVALID_RP_ID") {
    return "โดเมนของเว็บไม่ตรงกับการตั้งค่าพาสคีย์ของระบบ แจ้งทีมดูแลระบบ";
  }
  return errorMessage(e);
}
