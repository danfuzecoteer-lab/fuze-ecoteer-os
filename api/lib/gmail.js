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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripMarkdown(value) {
  return String(value || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .trim();
}

function inlineMarkdownToHtml(value) {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function linesToHtml(lines) {
  const html = [];
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdownToHtml(bullet[1])}</li>`);
      continue;
    }

    if (inList) {
      html.push("</ul>");
      inList = false;
    }

    const heading = line.match(/^\*\*([^*]+)\*\*:?$/);
    if (heading) {
      html.push(`<h3>${escapeHtml(heading[1])}</h3>`);
    } else {
      html.push(`<p>${inlineMarkdownToHtml(line)}</p>`);
    }
  }

  if (inList) html.push("</ul>");
  return html.join("\n");
}

function bodyToHtml(body) {
  return [
    "<!doctype html>",
    "<html>",
    "<body style=\"font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.45; color: #202124;\">",
    linesToHtml(String(body || "").split(/\r?\n/)),
    "</body>",
    "</html>",
  ].join("\n");
}

function buildRawEmail({ to, subject, body }) {
  const from = process.env.GMAIL_FROM || "dan.fuzecoteer@gmail.com";
  const recipients = Array.isArray(to) ? to : [to].filter(Boolean);
  const boundary = `fe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const plainBody = stripMarkdown(body);
  const htmlBody = bodyToHtml(body);
  return [
    `From: ${from}`,
    recipients.length ? `To: ${recipients.join(", ")}` : "To:",
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    plainBody,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    htmlBody,
    "",
    `--${boundary}--`,
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
