import { createSign } from "node:crypto";
import { env } from "../config.js";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

interface AccessToken {
  token: string;
  expiresAt: number;
}

let cachedToken: AccessToken | null = null;

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function serviceAccount(): ServiceAccount | null {
  if (!env.FCM_PROJECT_ID || !env.FCM_SERVICE_ACCOUNT_JSON) return null;
  try {
    const parsed = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

async function accessToken(): Promise<string | null> {
  const account = serviceAccount();
  if (!account) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) return cachedToken.token;

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const assertion = `${unsigned}.${base64Url(signer.sign(account.private_key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) return null;
  cachedToken = {
    token: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600),
  };
  return cachedToken.token;
}

export async function sendFcmDataMessage(input: {
  token: string;
  title: string;
  body: string;
  taskId?: string;
  kind: string;
}): Promise<boolean> {
  const token = await accessToken();
  if (!token || !env.FCM_PROJECT_ID) return false;
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: input.token,
          notification: {
            title: input.title,
            body: input.body,
          },
          data: {
            kind: input.kind,
            ...(input.taskId ? { taskId: input.taskId } : {}),
          },
          android: {
            priority: "HIGH",
          },
        },
      }),
    },
  );
  return res.ok;
}
