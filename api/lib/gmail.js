function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GMAIL_CLIENT_ID"),
      client_secret: requireEnv("GMAIL_CLIENT_SECRET"),
      refresh_token: requireEnv("GMAIL_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`Gmail token refresh failed: ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function sendEmail({ to, subject, body }) {
  const from = process.env.GMAIL_FROM || "dan.fuzecoteer@gmail.com";
  const accessToken = await getAccessToken();
  const raw = [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: base64UrlEncode(raw) }),
  });

  if (!response.ok) {
    throw new Error(`Gmail send failed: ${await response.text()}`);
  }

  return response.json();
}

module.exports = {
  sendEmail,
};
