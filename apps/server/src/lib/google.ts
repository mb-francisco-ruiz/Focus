import { eq } from "drizzle-orm";
import { env } from "../config.js";
import { db, schema } from "../db/index.js";
import { decrypt, encrypt } from "./crypto.js";

/**
 * Google OAuth + Gmail via plain REST (no googleapis SDK — we use three
 * endpoints and control our token lifecycle).
 */

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  // read+write of events — lets Focus push tasks onto the user's calendar
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

export function googleConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function authUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${env.PUBLIC_URL}/integrations/google/callback`,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent", // always mint a refresh token, incl. re-connects
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCode(code: string): Promise<TokenResponse & { email: string }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${env.PUBLIC_URL}/integrations/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  const tokens = (await res.json()) as TokenResponse;

  const info = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!info.ok) throw new Error(`userinfo failed: ${info.status}`);
  const { email } = (await info.json()) as { email: string };
  return { ...tokens, email };
}

interface StoredCredentials {
  refreshToken: string; // encrypted
  accessToken: string; // encrypted
  expiresAt: number;
}

export function toStoredCredentials(tokens: TokenResponse): StoredCredentials {
  return {
    refreshToken: encrypt(tokens.refresh_token ?? ""),
    accessToken: encrypt(tokens.access_token),
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}

type AccountRow = typeof schema.integrationAccounts.$inferSelect;

/** Valid access token for an account, refreshing (and persisting) if expired. */
export async function accessTokenFor(account: AccountRow): Promise<string> {
  const creds = account.credentials as unknown as StoredCredentials;
  if (Date.now() < creds.expiresAt - 60_000) return decrypt(creds.accessToken);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: decrypt(creds.refreshToken),
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed for ${account.externalId}: ${res.status}`);
  const tokens = (await res.json()) as TokenResponse;

  const next: StoredCredentials = {
    refreshToken: creds.refreshToken,
    accessToken: encrypt(tokens.access_token),
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  await db
    .update(schema.integrationAccounts)
    .set({ credentials: next })
    .where(eq(schema.integrationAccounts.id, account.id));
  return tokens.access_token;
}

/**
 * Real-time inbox push (PLAN.md §5.3): register a Gmail watch so new mail
 * publishes to our Pub/Sub topic instead of us polling. Expires in ~7 days —
 * renewed by a daily job. Best-effort; polling remains the fallback.
 */
export async function watchInbox(token: string): Promise<boolean> {
  if (!env.GMAIL_PUBSUB_TOPIC) return false;
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ topicName: env.GMAIL_PUBSUB_TOPIC, labelIds: ["INBOX"] }),
  });
  return res.ok;
}

// ---- Calendar ---------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  allDay: boolean;
  account: string;
}

/** Events between timeMin/timeMax (ISO) from the account's primary calendar. */
export async function listEvents(
  token: string,
  account: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`calendar list failed: ${res.status}`);
  const data = (await res.json()) as {
    items?: {
      id: string;
      summary?: string;
      status?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }[];
  };
  return (data.items ?? [])
    .filter((e) => e.status !== "cancelled" && (e.start?.dateTime || e.start?.date))
    .map((e) => ({
      id: e.id,
      title: e.summary ?? "(no title)",
      start: e.start!.dateTime ?? `${e.start!.date}T00:00:00.000Z`,
      end: e.end?.dateTime ?? e.end?.date ? (e.end!.dateTime ?? `${e.end!.date}T00:00:00.000Z`) : e.start!.dateTime ?? "",
      allDay: !e.start!.dateTime,
      account,
    }));
}

/** A Google event start/end: `{dateTime}` (timed) or `{date}` (all-day). */
export type EventBound = { dateTime: string } | { date: string };

/**
 * Create or update an event on the account's primary calendar. Pass `eventId`
 * to patch an existing one, else a new event is created. Returns the event id.
 * Throws on failure (e.g. 403 when the token lacks the calendar.events scope).
 */
export async function upsertEvent(
  token: string,
  opts: { eventId?: string | null; summary: string; start: EventBound; end: EventBound },
): Promise<string> {
  const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const url = opts.eventId ? `${base}/${opts.eventId}` : base;
  const res = await fetch(url, {
    method: opts.eventId ? "PATCH" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ summary: opts.summary, start: opts.start, end: opts.end }),
  });
  if (!res.ok) throw new Error(`calendar upsert failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

// ---- Gmail ------------------------------------------------------------------

export interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  internalDate: number;
}

/** Inbox messages from the last 24h (personal-inbox category, newest first). */
export async function recentMessages(token: string, max = 25): Promise<GmailMessage[]> {
  const list = await fetch(
    // NOTE: category:primary matches nothing on accounts without Gmail tabs
    // (most Workspace accounts) — use negative filters instead.
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent("in:inbox newer_than:1d -category:promotions -category:social")}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!list.ok) throw new Error(`gmail list failed: ${list.status}`);
  const { messages = [] } = (await list.json()) as { messages?: { id: string }[] };

  const out: GmailMessage[] = [];
  for (const { id } of messages) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) continue;
    const msg = (await res.json()) as {
      id: string;
      snippet: string;
      internalDate: string;
      payload?: { headers?: { name: string; value: string }[] };
    };
    const header = (name: string) =>
      msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
    out.push({
      id: msg.id,
      from: header("From"),
      subject: header("Subject"),
      snippet: msg.snippet,
      internalDate: Number(msg.internalDate),
    });
  }
  return out;
}
