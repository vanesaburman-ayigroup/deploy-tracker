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

  // Build MIME headers - encode subject for UTF-8 emoji support
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const headers = [`To: ${to}`];
  if (cc) headers.push(`Cc: ${cc}`);
  headers.push(`Subject: ${encodedSubject}`);

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
 * Convert a deploy queue entry to a rich HTML alert email.
 */
function alertToHtml(entry, config) {
  const priorityColor = {
    bloqueante: "#DC2626", blocker: "#DC2626", highest: "#DC2626",
    "más alta": "#DC2626", alta: "#F59E0B", high: "#F59E0B",
  };
  const color = priorityColor[(entry.jira_priority || "").toLowerCase()] || "#3B82F6";
  const jiraBase = config.jira_base_url.replace(/\/$/, "");

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5;">
  <div style="background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <div style="background: ${color}; padding: 16px 24px;">
      <h1 style="color: white; font-size: 18px; margin: 0;">
        ALERTA: Servicio CORE listo para deploy
      </h1>
      <p style="color: rgba(255,255,255,0.9); font-size: 13px; margin: 6px 0 0 0;">
        Se requiere solicitar ventana de no uso a las ${config.deploy_window_hour}:00hs
      </p>
    </div>

    <div style="background: #FEF3C7; padding: 16px 24px; border-bottom: 1px solid #FDE68A;">
      <p style="margin: 0; color: #92400E; font-size: 15px; font-weight: 600;">
        ACCION REQUERIDA: Pedir ventana de no uso del sistema para las ${config.deploy_window_hour}:00hs
      </p>
      <p style="margin: 6px 0 0 0; color: #78350F; font-size: 13px;">
        Hay un servicio core con prioridad ${entry.jira_priority} listo para desplegar en produccion.
      </p>
    </div>

    <div style="padding: 24px;">
      <h2 style="font-size: 15px; color: #374151; margin: 0 0 4px 0;">${entry.jira_ticket}: ${escapeHtml(entry.jira_summary || "")}</h2>
      <p style="font-size: 13px; color: #6B7280; margin: 0 0 16px 0;">Tema del ticket en Jira</p>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
        <tr>
          <td style="padding: 8px 0; color: #666; width: 120px;">Servicio</td>
          <td style="padding: 8px 0; font-weight: 600;">${entry.repo_name} <span style="background: #FEE2E2; color: #DC2626; padding: 2px 8px; border-radius: 4px; font-size: 12px;">CORE</span></td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Prioridad</td>
          <td style="padding: 8px 0;"><span style="background: ${color}; color: white; padding: 2px 10px; border-radius: 4px; font-size: 12px; font-weight: 600;">${entry.jira_priority}</span></td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">MR</td>
          <td style="padding: 8px 0;"><a href="${entry.mr_url}" style="color: #2563EB; text-decoration: none;">!${entry.mr_id}: ${escapeHtml(entry.mr_title || "")}</a></td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Branch</td>
          <td style="padding: 8px 0;"><code style="background: #F3F4F6; padding: 2px 6px; border-radius: 3px; font-size: 13px;">${entry.source_branch}</code> &#x2192; <code style="background: #F3F4F6; padding: 2px 6px; border-radius: 3px; font-size: 13px;">${entry.target_branch}</code></td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Autor</td>
          <td style="padding: 8px 0;">${entry.author}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Status Jira</td>
          <td style="padding: 8px 0;"><span style="background: #D1FAE5; color: #065F46; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">${entry.jira_status}</span></td>
        </tr>
      </table>

      <div style="display: flex; gap: 8px;">
        <a href="${jiraBase}/browse/${entry.jira_ticket}" style="display: inline-block; background: #2563EB; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 500;">Ver en Jira</a>
        <a href="${entry.mr_url}" style="display: inline-block; background: #7C3AED; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 500;">Ver MR en GitLab</a>
      </div>
    </div>
    <div style="background: #F9FAFB; padding: 12px 24px; border-top: 1px solid #E5E7EB;">
      <p style="font-size: 11px; color: #9CA3AF; margin: 0;">Generado por Deploy Tracker Agent</p>
    </div>
  </div>
</body></html>`;
}

/**
 * Convert plain text summary to a styled HTML email with humor + cataas cat.
 */
function summaryToHtml(plainText, config, humorPhrase) {
  const cacheBuster = Date.now() + Math.floor(Math.random() * 100000);
  const catUrl = `https://cataas.com/cat?width=200&type=small&cb=${cacheBuster}`;
  const jiraBase = config.jira_base_url.replace(/\/$/, "");
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Buenos_Aires" });
  const timeStr = now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Buenos_Aires" });

  const humorBanner = humorPhrase ? `
    <div style="background: #FFFBF0; padding: 20px 28px; border-bottom: 1px solid #FEE2B3; text-align: center;">
      <p style="margin: 0 0 8px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #B45309; font-weight: 600;">
        &#x1F431; El gatito del d&iacute;a
      </p>
      <img
        src="${catUrl}"
        alt="Gatito del dia"
        width="180"
        style="border-radius: 12px; margin: 8px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1);"
      />
      <p style="margin: 8px 0 0 0; font-size: 14px; color: #78350F; font-style: italic; font-family: Georgia, 'Times New Roman', serif; line-height: 1.4;">
        &ldquo;${escapeHtml(humorPhrase)}&rdquo;
      </p>
    </div>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f0f4f8;">
  <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.08);">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 24px 28px; text-align: center;">
      <h1 style="color: white; font-size: 20px; margin: 0; font-weight: 700; letter-spacing: -0.3px;">
        &#x1F680; Deploy Tracker
      </h1>
      <p style="color: rgba(255,255,255,0.85); font-size: 13px; margin: 6px 0 0 0; font-weight: 400;">
        Resumen de deploys &mdash; ${escapeHtml(dateStr)}, ${timeStr}
      </p>
    </div>
    ${humorBanner}
    <div style="padding: 24px 28px;">
      <h2 style="font-size: 14px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.8px; margin: 0 0 16px 0; font-weight: 600;">
        Estado de deploys
      </h2>
      <pre style="font-family: 'SF Mono', 'Fira Code', 'Courier New', monospace; font-size: 13px; line-height: 1.7; white-space: pre-wrap; color: #1F2937; background: #F8FAFC; padding: 20px; border-radius: 10px; border: 1px solid #E2E8F0; margin: 0;">${escapeHtml(plainText)}</pre>
    </div>
    <div style="background: #F8FAFC; padding: 16px 28px; border-top: 1px solid #E2E8F0; text-align: center;">
      <p style="font-size: 11px; color: #9CA3AF; margin: 0;">
        Generado por Deploy Tracker Agent de Vane <3 &#x2022;
        <a href="${jiraBase}" style="color: #667eea; text-decoration: none;">Jira</a> &#x2022;
        <a href="${config.gitlab_base_url}" style="color: #667eea; text-decoration: none;">GitLab</a>
      </p>
      <p style="font-size: 13px; color: #D1D5DB; margin: 6px 0 0 0;">
        1 deploy = 1 chismecito &#x1F63A;
      </p>
    </div>
  </div>
</body></html>`;
}

/**
 * Get a random humor phrase, avoiding recent repeats.
 * Uses the notification log to track which phrases were used.
 */
function getRandomPhrase() {
  try {
    const fs = require("fs");
    const path = require("path");
    const humorPath = path.join(__dirname, "..", "data", "humor.json");
    const humor = JSON.parse(fs.readFileSync(humorPath, "utf-8"));
    const phrases = humor.phrases || [];
    if (phrases.length === 0) return null;

    // Try to read recently used phrases from notification log
    const { getNotificationLog } = require("./state");
    const log = getNotificationLog();
    const recentPhrases = log.notifications
      .filter(n => n.channel === "humor_phrase")
      .slice(-20) // last 20 used phrases
      .map(n => n.payload);

    // Filter out recently used
    const available = phrases.filter(p => !recentPhrases.includes(p));
    const pool = available.length > 0 ? available : phrases; // reset if all used

    const phrase = pool[Math.floor(Math.random() * pool.length)];

    // Record usage
    const { recordNotification } = require("./state");
    recordNotification("humor", 0, "phrase", "humor_phrase", phrase);

    return phrase;
  } catch (err) {
    console.warn("Could not load humor phrases:", err.message);
    return null;
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

module.exports = { sendEmail, refreshAccessToken, summaryToHtml, alertToHtml, getRandomPhrase };
