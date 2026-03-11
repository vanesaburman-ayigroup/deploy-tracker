const fetch = require("node-fetch");

/**
 * Send an email using Gmail API with OAuth2.
 *
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} body - Email body (plain text)
 * @param {string} [htmlBody] - Optional HTML body
 * @param {string} [cc] - Optional CC email(s), comma-separated
 */
async function sendEmail(to, subject, body, htmlBody, cc) {
  const accessToken = process.env.GMAIL_ACCESS_TOKEN;

  if (!accessToken) {
    console.log("=== EMAIL (dry run — no GMAIL_ACCESS_TOKEN) ===");
    console.log(`To: ${to}${cc ? ` | CC: ${cc}` : ""}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body:\n${body}`);
    console.log("=== END EMAIL ===");
    return { success: true, dryRun: true };
  }

  // Build MIME headers
  const headers = [`To: ${to}`];
  if (cc) headers.push(`Cc: ${cc}`);
  headers.push(`Subject: ${subject}`);

  const boundary = "boundary_deploy_tracker";
  const mimeContent = htmlBody
    ? [
        ...headers,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        "",
        `--${boundary}`,
        `Content-Type: text/plain; charset="UTF-8"`,
        "",
        body,
        "",
        `--${boundary}`,
        `Content-Type: text/html; charset="UTF-8"`,
        "",
        htmlBody,
        "",
        `--${boundary}--`,
      ].join("\r\n")
    : [...headers, `Content-Type: text/plain; charset="UTF-8"`, "", body].join("\r\n");

  // Base64url encode
  const encoded = Buffer.from(mimeContent)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: encoded }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gmail API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  console.log(`Email sent successfully. Message ID: ${result.id}`);
  return { success: true, messageId: result.id };
}

/**
 * Refresh the Gmail access token using a refresh token.
 * Called at the beginning of each GitHub Action run.
 *
 * @returns {Promise<string>} New access token
 */
async function refreshAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn("Google OAuth credentials not fully configured");
    return null;
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token refresh error: ${err}`);
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Convert plain text summary to a styled HTML email.
 */
function summaryToHtml(plainText, config) {
  const lines = plainText.split("\n");
  let html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5;">
  <div style="background: white; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <h1 style="color: #1B3A5C; font-size: 20px; margin-top: 0; border-bottom: 2px solid #2E75B6; padding-bottom: 8px;">
      🚀 Deploy Tracker — Resumen
    </h1>
    <pre style="font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px; line-height: 1.5; white-space: pre-wrap; color: #333;">
${escapeHtml(plainText)}
    </pre>
    <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;">
    <p style="font-size: 11px; color: #999; margin-bottom: 0;">
      Generado automáticamente por Deploy Tracker Agent<br>
      <a href="${config.jira_base_url}" style="color: #2E75B6;">Jira</a> ·
      <a href="${config.gitlab_base_url}" style="color: #2E75B6;">GitLab</a>
    </p>
  </div>
</body>
</html>`;
  return html;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = { sendEmail, refreshAccessToken, summaryToHtml };
