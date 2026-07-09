import { useCallback, useEffect, useState } from "react";
import type { IntegrationAccountInfo } from "@focus/shared";
import {
  disconnectIntegration,
  getProfile,
  googleConnectUrl,
  listIntegrations,
  setCalendarAccount,
  setIntegrationSphere,
  slackConnectUrl,
} from "./api";
import { isTauri } from "./tauri-env";

async function openExternal(url: string): Promise<void> {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank");
  }
}

/** Settings card: connected accounts + connect buttons. */
export default function Integrations() {
  const [accounts, setAccounts] = useState<IntegrationAccountInfo[]>([]);
  const [spheres, setSpheres] = useState<string[]>([]);
  const [calAccount, setCalAccount] = useState<string | null>(null);
  const [googleReady, setGoogleReady] = useState(false);
  const [slackReady, setSlackReady] = useState(false);

  const refresh = useCallback(() => {
    listIntegrations()
      .then(({ accounts, googleConfigured, slackConfigured }) => {
        setAccounts(accounts);
        setGoogleReady(googleConfigured);
        setSlackReady(slackConfigured);
      })
      .catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    refresh();
    void getProfile()
      .then((p) => {
        setSpheres(p.spheres);
        setCalAccount(p.calendarAccountId);
      })
      .catch(() => {});
    // OAuth finishes in the browser; re-check when the app regains focus.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const linkSphere = (id: string, sphere: string | null) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, sphere } : a)));
    void setIntegrationSphere(id, sphere).catch(() => refresh());
  };

  const googleAccounts = accounts.filter((a) => a.provider === "google");
  const slackAccounts = accounts.filter((a) => a.provider === "slack");

  return (
    <section className="settings-card">
      <h2>Integrations</h2>
      <div className="settings-row">
        <span className="settings-label">Google (Gmail + Calendar)</span>
        <span className="settings-value">
          {googleReady ? (
            <button className="chip" onClick={() => void openExternal(googleConnectUrl())}>
              + Connect account
            </button>
          ) : (
            <span className="soon">needs GOOGLE_CLIENT_ID/SECRET</span>
          )}
        </span>
      </div>
      {googleAccounts.map((a) => (
        <div className="settings-row" key={a.id}>
          <span className="settings-label connected">{a.externalId}</span>
          <span className="settings-value account-controls">
            <select
              className="sphere-select"
              title="File emails from this account under this category"
              value={a.sphere ?? ""}
              onChange={(e) => linkSphere(a.id, e.target.value || null)}
            >
              <option value="">no category</option>
              {spheres.map((s) => (
                <option key={s} value={s}>
                  → {s}
                </option>
              ))}
            </select>
            <button
              className="link"
              onClick={() => {
                void disconnectIntegration(a.id).then(refresh);
              }}
            >
              Disconnect
            </button>
          </span>
        </div>
      ))}
      {googleAccounts.length > 0 && (
        <>
          <div className="settings-row">
            <span className="settings-label">Sync tasks to calendar</span>
            <span className="settings-value">
              <select
                className="sphere-select"
                title="Which Google account's calendar 'Add to Google Calendar' writes to"
                value={calAccount ?? googleAccounts[0]!.id}
                onChange={(e) => {
                  setCalAccount(e.target.value);
                  void setCalendarAccount(e.target.value).catch(() => refresh());
                }}
              >
                {googleAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.externalId}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <p className="settings-hint">
            Toggle “Add to Google Calendar” on a task to mirror it here. Reconnect the account
            once above to grant calendar-write access.
          </p>
        </>
      )}
      <div className="settings-row">
        <span className="settings-label">Slack</span>
        <span className="settings-value">
          {slackReady ? (
            <button className="chip" onClick={() => void openExternal(slackConnectUrl())}>
              + Connect workspace
            </button>
          ) : (
            <span className="soon">needs custom Slack app</span>
          )}
        </span>
      </div>
      {slackAccounts.map((a) => (
        <div className="settings-row" key={a.id}>
          <span className="settings-label connected">
            Slack · {a.externalId} <span className="soon">react 👀 to capture</span>
          </span>
          <span className="settings-value">
            <button
              className="link"
              onClick={() => {
                void disconnectIntegration(a.id).then(refresh);
              }}
            >
              Disconnect
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}
