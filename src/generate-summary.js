const { generateSummary } = require("./gemini-client");
const { sendEmail, refreshAccessToken, summaryToHtml, getRandomPhrase } = require("./gmail-client");
const { sendSlackMessage, buildSummaryBlocks } = require("./slack-client");
const { getConfig, getPendingDeploys, getPendingCoreDeploys } = require("./state");

const PM_EMAILS = ["mathias.fraifer@ayi.group"];
const PM_NAMES = ["mathias fraifer"];

function isPMAssigned(item) {
  const email = (item.assignee_email || "").toLowerCase();
  const name = (item.assignee_name || "").toLowerCase();
  return PM_EMAILS.includes(email) || PM_NAMES.some(n => name.includes(n));
}

/**
 * Group MRs by ticket and build a PM-friendly summary object.
 */
function groupByTicket(items) {
  const map = {};
  for (const item of items) {
    if (!map[item.jira_ticket]) {
      map[item.jira_ticket] = {
        ticket: item.jira_ticket,
        summary: item.jira_summary || item.mr_title || "",
        status: item.jira_status,
        priority: item.jira_priority,
        is_core: false,
        is_ready: item.is_ready,
        assignee_name: item.assignee_name || "",
        assignee_email: item.assignee_email || "",
        components: item.components || [],
        repos: [],
        core_repos: [],
        secondary_repos: [],
        priority_weight: 0,
        jira_url: item.jira_url,
      };
    }
    const g = map[item.jira_ticket];
    if (item.is_core) {
      g.is_core = true;
      if (!g.core_repos.includes(item.repo_name)) g.core_repos.push(item.repo_name);
    } else {
      if (!g.secondary_repos.includes(item.repo_name)) g.secondary_repos.push(item.repo_name);
    }
    if (!g.repos.includes(item.repo_name)) g.repos.push(item.repo_name);
    if (item.priority_weight > g.priority_weight) g.priority_weight = item.priority_weight;
    if (item.jira_summary) g.summary = item.jira_summary;
    if (item.assignee_name) g.assignee_name = item.assignee_name;
    if (item.assignee_email) g.assignee_email = item.assignee_email;
    if (item.is_ready) g.is_ready = true;
    if (item.components && item.components.length) g.components = item.components;
  }
  return Object.values(map);
}

async function main() {
  console.log("📊 Generating scheduled summary...");

  const config = getConfig();
  const pending = getPendingDeploys();

  if (pending.length === 0) {
    console.log("✅ No pending deploys. Skipping summary.");
    process.exit(0);
  }

  // Group by ticket for PM-friendly view
  const tickets = groupByTicket(pending);
  const coreTickets = tickets.filter(t => t.is_core);
  const secondaryTickets = tickets.filter(t => !t.is_core);
  const readyTickets = tickets.filter(t => t.is_ready);
  const pmReleaseTickets = readyTickets.filter(t => isPMAssigned(t));
  const readyForDeploy = readyTickets.filter(t => !isPMAssigned(t));

  console.log(`📋 ${tickets.length} tickets (${coreTickets.length} core, ${secondaryTickets.length} secundarios, ${pmReleaseTickets.length} pendientes informe release)`);

  // Refresh OAuth token
  try {
    const accessToken = await refreshAccessToken();
    if (accessToken) {
      process.env.GMAIL_ACCESS_TOKEN = accessToken;
    }
  } catch (err) {
    console.warn("Could not refresh OAuth token:", err.message);
  }

  // Build ticket-focused data for Gemini
  const ticketData = {
    resumen: {
      total_tickets: tickets.length,
      core: coreTickets.length,
      secundarios: secondaryTickets.length,
      listos_para_deploy: readyForDeploy.length,
      pendientes_informe_release: pmReleaseTickets.length,
    },
    tickets_core: coreTickets.map(t => ({
      ticket: t.ticket,
      tema: t.summary,
      estado: t.status,
      prioridad: t.priority,
      servicios_core: t.core_repos,
      servicios_secundarios: t.secondary_repos,
      componente: t.components.join(", ") || "sin componente",
      asignado_a: t.assignee_name || "sin asignar",
      pendiente_informe: t.is_ready && isPMAssigned(t),
      listo_para_prod: t.is_ready,
    })),
    tickets_secundarios: secondaryTickets.map(t => ({
      ticket: t.ticket,
      tema: t.summary,
      estado: t.status,
      prioridad: t.priority,
      servicios: t.repos,
      componente: t.components.join(", ") || "sin componente",
      asignado_a: t.assignee_name || "sin asignar",
      pendiente_informe: t.is_ready && isPMAssigned(t),
      listo_para_prod: t.is_ready,
    })),
  };

  // Generate summary with Gemini
  const summaryText = await generateSummary(ticketData);
  console.log("📝 Summary generated:");
  console.log(summaryText);

  // Send email
  if (config.pm_email) {
    try {
      const subject = coreTickets.length > 0
        ? `🚀 Deploy Tracker: ${coreTickets.length} tickets core + ${secondaryTickets.length} secundarios`
        : `📋 Deploy Tracker: ${tickets.length} ticket(s) pendiente(s)`;

      const htmlBody = summaryToHtml(summaryText, config, getRandomPhrase());
      // CCO/BCC: acepta string ("a@x.com, b@y.com") o array ["a@x.com", "b@y.com"]
      const cc = Array.isArray(config.cc_email)
        ? config.cc_email.filter(Boolean).join(", ")
        : (config.cc_email || "");
      await sendEmail(config.pm_email, subject, summaryText, htmlBody, cc);
      console.log("📧 Summary email sent.");
    } catch (err) {
      console.error("Failed to send summary email:", err.message);
    }
  } else {
    console.log("⚠️ No PM email configured. Summary not sent.");
  }

  // Send to Slack
  try {
    const { text, blocks } = buildSummaryBlocks(pending, config);
    await sendSlackMessage(text, blocks);
    console.log("💬 Slack summary sent.");
  } catch (err) {
    console.error("Failed to send Slack summary:", err.message);
  }

  console.log("✅ Summary generation complete.");
}

main().catch((err) => {
  console.error("❌ Error generating summary:", err);
  process.exit(1);
});