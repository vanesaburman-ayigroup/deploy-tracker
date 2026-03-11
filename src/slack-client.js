const fetch = require("node-fetch");

/**
 * Slack Client — Sends DMs via Slack Web API
 *
 * Uses YOUR OWN user token (xoxp-) so messages appear as if you sent them.
 * No admin approval needed. The PM receives a direct message from you.
 *
 * ═══════════════════════════════════════════════════════
 * SETUP (one-time, NO admin needed):
 * ═══════════════════════════════════════════════════════
 *
 * 1. Go to https://api.slack.com/apps → Create New App → From scratch
 *    - App Name: "Deploy Tracker" (or whatever you want)
 *    - Workspace: select your GRV workspace
 *
 * 2. Go to "OAuth & Permissions" in the sidebar
 *    Add these USER TOKEN scopes (not bot scopes):
 *    - chat:write    (send messages)
 *    - im:write      (open DM channels)
 *    - users:read    (look up user by email)
 *    - users:read.email (needed for email lookup)
 *
 * 3. Click "Install to Workspace" at the top
 *    ⚠️ This does NOT require admin approval for user tokens
 *    with these basic scopes in most Slack plans.
 *    If it does ask for admin approval, see FALLBACK below.
 *
 * 4. Copy the "User OAuth Token" (starts with xoxp-)
 *    Store it as SLACK_USER_TOKEN in GitHub Secrets
 *
 * 5. Store the PM's Slack email as SLACK_PM_EMAIL in GitHub Secrets
 *    (or their Slack User ID directly as SLACK_PM_USER_ID — faster)
 *
 * ═══════════════════════════════════════════════════════
 * FALLBACK: If admin approval IS required
 * ═══════════════════════════════════════════════════════
 *
 * Option A: Ask admin to approve your app (one-time).
 *           Frame it as: "Necesito una app personal que me
 *           mande recordatorios" — technically true.
 *
 * Option B: Use Incoming Webhook to a channel instead.
 *           Set SLACK_WEBHOOK_URL and leave SLACK_USER_TOKEN empty.
 *           The code handles both modes automatically.
 *
 * Option C: Skip Slack entirely — email still works.
 *           Leave all Slack env vars empty.
 */

// ── Mode detection ──
function getSlackMode() {
  if (process.env.SLACK_USER_TOKEN) return "dm";
  if (process.env.SLACK_WEBHOOK_URL) return "webhook";
  return "disabled";
}

// ══════════════════════════════════════
//  MODE 1: Direct Message via Web API
// ══════════════════════════════════════

async function lookupUserByEmail(email) {
  const token = process.env.SLACK_USER_TOKEN;
  const response = await fetch(
    `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack lookupByEmail failed: ${data.error}`);
  return data.user.id;
}

async function openDMChannel(userId) {
  const token = process.env.SLACK_USER_TOKEN;
  const response = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ users: userId }),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack conversations.open failed: ${data.error}`);
  return data.channel.id;
}

async function postMessage(channelId, text, blocks) {
  const token = process.env.SLACK_USER_TOKEN;
  const payload = { channel: channelId, text };
  if (blocks && blocks.length > 0) payload.blocks = blocks;

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`Slack postMessage failed: ${data.error}`);
  return data;
}

async function sendDM(text, blocks) {
  const pmIdentifier = process.env.SLACK_PM_USER_ID || process.env.SLACK_PM_EMAIL;
  if (!pmIdentifier) {
    console.warn("No SLACK_PM_USER_ID or SLACK_PM_EMAIL configured");
    return { success: false, reason: "no_pm_configured" };
  }

  let userId;
  if (pmIdentifier.startsWith("U")) {
    userId = pmIdentifier;
  } else {
    userId = await lookupUserByEmail(pmIdentifier);
  }

  const channelId = await openDMChannel(userId);
  const result = await postMessage(channelId, text, blocks);
  console.log(`Slack DM sent to PM. Channel: ${channelId}, TS: ${result.ts}`);
  return { success: true, channel: channelId, ts: result.ts };
}

// ══════════════════════════════════════
//  MODE 2: Webhook (fallback to channel)
// ══════════════════════════════════════

async function sendWebhook(text, blocks) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const payload = { text };
  if (blocks && blocks.length > 0) payload.blocks = blocks;

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Slack webhook error ${response.status}: ${err}`);
  }
  console.log("Slack webhook message sent.");
  return { success: true };
}

// ══════════════════════════════════════
//  UNIFIED INTERFACE
// ══════════════════════════════════════

async function sendSlackMessage(text, blocks) {
  const mode = getSlackMode();

  if (mode === "disabled") {
    console.log("=== SLACK (disabled — no token configured) ===");
    console.log(text);
    console.log("=== END SLACK ===");
    return { success: true, dryRun: true };
  }

  try {
    if (mode === "dm") {
      return await sendDM(text, blocks);
    } else {
      return await sendWebhook(text, blocks);
    }
  } catch (err) {
    console.error(`Slack ${mode} error:`, err.message);
    return { success: false, error: err.message };
  }
}

// ══════════════════════════════════════
//  BLOCK BUILDERS
// ══════════════════════════════════════

function timeSince(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

function buildSummaryBlocks(pendingDeploys, config) {
  const core = pendingDeploys.filter(
    (d) => d.service_type === "core_backend" || d.service_type === "core_frontend"
  );
  const secondary = pendingDeploys.filter(
    (d) => d.service_type !== "core_backend" && d.service_type !== "core_frontend"
  );

  const blocks = [];

  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `🚀 Deploy Tracker — ${new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}`,
      emoji: true,
    },
  });

  if (core.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🔴 CORE — Requieren ventana ${config.deploy_window_hour}hs* (${core.length})`,
      },
    });

    for (const item of core) {
      const emoji =
        item.jira_priority?.toLowerCase() === "blocker" ? "🔴" :
        item.jira_priority?.toLowerCase() === "high" ? "🟠" : "🟡";
      const readyBadge = item.is_ready ? "✅ Ready" : `⏳ ${item.jira_status}`;
      const age = timeSince(item.detected_at);

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `${emoji} *<${item.jira_url}|${item.jira_ticket}>* — \`${item.repo_name}\` [${item.jira_priority}]`,
            `> <${item.mr_url}|MR !${item.mr_id}>: ${item.mr_title}`,
            `> \`${item.source_branch}\` → \`${item.target_branch}\` · ${readyBadge} · ${age}`,
          ].join("\n"),
        },
      });
    }

    if (core.length >= 3) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: "⚠️ *Deploy grande:* más de 3 servicios core. Considerar hacer en fases." }],
      });
    }
  }

  if (secondary.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*🟢 SECUNDARIO* (${secondary.length})` },
    });

    const secondaryLines = secondary
      .map((item) => {
        const readyBadge = item.is_ready ? "✅" : "⏳";
        return `${readyBadge} <${item.jira_url}|${item.jira_ticket}> — \`${item.repo_name}\` — MR !${item.mr_id}`;
      })
      .join("\n");

    blocks.push({ type: "section", text: { type: "mrkdwn", text: secondaryLines } });
  }

  if (core.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📋 *Acciones:*\n• Coordinar ventana de no uso a las ${config.deploy_window_hour}:00hs\n• ${core.length} servicio(s) core + ${secondary.length} secundario(s) pendientes`,
      },
    });
  }

  blocks.push({
    type: "context",
    elements: [{
      type: "mrkdwn",
      text: `Generado por Deploy Tracker · ${new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Buenos_Aires" })} ART`,
    }],
  });

  const fallbackText = core.length > 0
    ? `🚀 ${core.length} core + ${secondary.length} secundarios pendientes para deploy`
    : `📋 ${secondary.length} MRs secundarias pendientes`;

  return { text: fallbackText, blocks };
}

function buildAlertBlocks(entry, config) {
  const emoji = entry.jira_priority?.toLowerCase() === "blocker" ? "🔴" : "🟠";

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "🚨 Alerta: Servicio CORE listo para deploy", emoji: true },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `${emoji} *<${entry.jira_url}|${entry.jira_ticket}>* — \`${entry.repo_name}\``,
          `*Prioridad:* ${entry.jira_priority}`,
          `*MR:* <${entry.mr_url}|!${entry.mr_id}> — ${entry.mr_title}`,
          `*Branch:* \`${entry.source_branch}\` → \`${entry.target_branch}\``,
        ].join("\n"),
      },
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `⚠️ *Acción requerida:* Coordinar ventana de no uso del sistema a las *${config.deploy_window_hour}:00hs*`,
      },
    },
  ];

  const text = `🚨 CORE listo: ${entry.repo_name} (${entry.jira_ticket}) — ${entry.jira_priority}`;
  return { text, blocks };
}

module.exports = {
  sendSlackMessage,
  buildSummaryBlocks,
  buildAlertBlocks,
  getSlackMode,
};
