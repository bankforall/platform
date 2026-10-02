import type { Config } from "../config.js";

/**
 * LINE Login v2.1 (OAuth 2.0 + OpenID Connect) and Messaging API push.
 * https://developers.line.biz/en/docs/line-login/integrate-line-login/
 */
export class Line {
  constructor(private readonly config: Config) {}

  get loginEnabled() {
    return Boolean(this.config.LINE_CHANNEL_ID && this.config.LINE_CHANNEL_SECRET);
  }

  get messagingEnabled() {
    return Boolean(this.config.LINE_MESSAGING_TOKEN);
  }

  callbackUrl() {
    return new URL("/api/auth/line/callback", this.config.PUBLIC_URL).toString();
  }

  authorizeUrl(state: string, nonce: string): string {
    const url = new URL("https://access.line.me/oauth2/v2.1/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: this.config.LINE_CHANNEL_ID,
      redirect_uri: this.callbackUrl(),
      state,
      nonce,
      scope: "profile openid",
      bot_prompt: "aggressive", // offer to add the official account so reminders can be pushed
    }).toString();
    return url.toString();
  }

  /** Exchanges the code and verifies the ID token with LINE; returns the LINE user profile. */
  async exchange(code: string, nonce: string): Promise<{ userId: string; name: string; picture: string | null }> {
    const tokenRes = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: this.callbackUrl(),
        client_id: this.config.LINE_CHANNEL_ID,
        client_secret: this.config.LINE_CHANNEL_SECRET,
      }),
    });
    if (!tokenRes.ok) throw new Error(`LINE token exchange failed: ${tokenRes.status}`);
    const token = (await tokenRes.json()) as { id_token: string };

    const verifyRes = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: token.id_token, client_id: this.config.LINE_CHANNEL_ID, nonce }),
    });
    if (!verifyRes.ok) throw new Error(`LINE ID token verification failed: ${verifyRes.status}`);
    const claims = (await verifyRes.json()) as { sub: string; name?: string; picture?: string };
    return { userId: claims.sub, name: claims.name ?? "ผู้ใช้ LINE", picture: claims.picture ?? null };
  }

  async push(lineUserId: string, text: string): Promise<void> {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.LINE_MESSAGING_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: "text", text: text.slice(0, 5000) }] }),
    });
    if (!res.ok) throw new Error(`LINE push failed: ${res.status} ${await res.text()}`);
  }
}
