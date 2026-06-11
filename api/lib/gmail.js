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

async function gmailRequest(path, options = {}) {
  const accessToken = await getAccessToken();
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Gmail request failed: ${await response.text()}`);
  }

  return response.json();
}

async function sendEmail({ to, subject, body }) {
  const accessToken = await getAccessToken();
  const raw = buildRawEmail({ to, subject, body });

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

async function createDraftEmail({ to, subject, body }) {
  const accessToken = await getAccessToken();
  const raw = buildRawEmail({ to, subject, body });
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: { raw: base64UrlEncode(raw) } }),
  });

  if (!response.ok) {
    throw new Error(`Gmail draft creation failed: ${await response.text()}`);
  }

  return response.json();
}

function buildRawEmail({ to, subject, body }) {
  const from = process.env.GMAIL_FROM || "dan.fuzecoteer@gmail.com";
  const recipients = Array.isArray(to) ? to : [to].filter(Boolean);
  return [
    `From: ${from}`,
    recipients.length ? `To: ${recipients.join(", ")}` : "To:",
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].join("\r\n");
}

function base64UrlDecode(value = "") {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function headerValue(headers, name) {
  const header = (headers || []).find((item) => item.name.toLowerCase() === name.toLowerCase());
  return header ? header.value : "";
}

function extractTextPayload(part) {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body && part.body.data) {
    return base64UrlDecode(part.body.data);
  }
  if (part.parts && part.parts.length) {
    return part.parts.map(extractTextPayload).filter(Boolean).join("\n");
  }
  return "";
}

function stripQuotedReply(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (trimmed.startsWith(">")) return false;
      if (/^On .+ wrote:$/i.test(trimmed)) return false;
      if (/^(From|Sent|To|Subject):\s/i.test(trimmed)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

async function searchMessages({ query, maxResults = 10 }) {
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  const data = await gmailRequest(`/messages?${params.toString()}`);
  return data.messages || [];
}

async function getMessage(id) {
  const params = new URLSearchParams({ format: "full" });
  const message = await gmailRequest(`/messages/${id}?${params.toString()}`);
  const headers = message.payload ? message.payload.headers : [];
  return {
    id: message.id,
    threadId: message.threadId,
    snippet: message.snippet || "",
    subject: headerValue(headers, "Subject"),
    from: headerValue(headers, "From"),
    date: headerValue(headers, "Date"),
    body: stripQuotedReply(extractTextPayload(message.payload)),
  };
}

function isLikelyReplyOrNote(message, subjectPrefix) {
  const subject = message.subject.toLowerCase();
  const prefix = subjectPrefix.toLowerCase();
  return (
    subject.startsWith("re:") ||
    subject.includes(`${prefix} note`) ||
    subject.includes(`${prefix} comment`) ||
    subject.includes(`${prefix} feedback`) ||
    /\b(note|comment|feedback)\b/i.test(message.body)
  );
}

async function recentAutomationNotes({ subjectPrefix, days = 45, maxResults = 8 }) {
  const query = `newer_than:${days}d subject:"${subjectPrefix}"`;
  const messages = await searchMessages({ query, maxResults: maxResults * 3 });
  const fetched = await Promise.all(messages.map((message) => getMessage(message.id)));

  return fetched
    .filter((message) => isLikelyReplyOrNote(message, subjectPrefix))
    .slice(0, maxResults)
    .map((message) => ({
      subject: message.subject,
      from: message.from,
      date: message.date,
      text: (message.body || message.snippet || "").slice(0, 1600),
    }));
}

async function buildAutomationNoteContext(automation) {
  const notes = await recentAutomationNotes({ subjectPrefix: automation.subjectPrefix });
  if (!notes.length) return "";

  const formatted = notes
    .map((note, index) => {
      return [
        `Note ${index + 1}`,
        `Subject: ${note.subject}`,
        `From: ${note.from}`,
        `Date: ${note.date}`,
        note.text,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  return [
    "Recent user replies/comments found in Gmail for this automation:",
    formatted,
    "Use these as steering notes for this run. Prioritize direct user comments over older generated briefing text.",
  ].join("\n\n");
}

module.exports = {
  buildAutomationNoteContext,
  createDraftEmail,
  recentAutomationNotes,
  sendEmail,
};
