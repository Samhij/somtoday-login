const CLIENT_ID = "somtoday-leerling-web";
const REDIRECT_URI = "https://leerling.somtoday.nl/oauth/callback";

export { CLIENT_ID, REDIRECT_URI };

export async function captureAuthorizationCode(tenantUuid: string, username: string) {
  const base = process.env.CYFERS_SSO_URL;
  const secret = process.env.CYFERS_SSO_SECRET;
  if (!base || !secret) {
    throw new Error("Kon het school-inlogvenster niet openen.");
  }

  const response = await fetch(`${base}/sso/capture`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ tenantUuid, username }),
  });

  const payload = (await response.json().catch(() => null)) as
    | { code?: string; error?: string }
    | null;

  if (!response.ok || !payload?.code) {
    throw new Error(payload?.error || "Kon het school-inlogvenster niet openen.");
  }

  return payload.code;
}
