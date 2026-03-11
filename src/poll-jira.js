const {
  classifyRepo,
  isAlertPriority,
  calculatePriorityWeight,
  extractMRLinks,
  isReadyForProd,
  isFinalized,
} = require("./classify");
const { getMergeRequests } = require("./gitlab-client");
const { generateAlertMessage } = require("./gemini-client");
const { sendEmail, refreshAccessToken, alertToHtml } = require("./gmail-client");
const { createDeployWindowEvent } = require("./calendar-client");
const { sendSlackMessage, buildAlertBlocks } = require("./slack-client");
const {
  getConfig,
  upsertToQueue,
  wasAlreadyNotified,
  recordNotification,
} = require("./state");
const { pollJira } = require("./jira-client");

async function main() {
  console.log("🔄 Polling Jira for updates...\n");

  const config = getConfig();

  // Refresh OAuth token for Gmail/Calendar
  try {
    const accessToken = await refreshAccessToken();
    if (accessToken) {
      process.env.GMAIL_ACCESS_TOKEN = accessToken;
    }
  } catch (err) {
    console.warn("Could not refresh OAuth token:", err.message);
  }

  // Poll Jira — look back 65 minutes to overlap with hourly cron
  const issues = await pollJira(65);

  if (issues.length === 0) {
    console.log("✅ No recently updated issues. Done.");
    process.exit(0);
  }

  let processedMRs = 0;
  let alertsSent = 0;

  for (const { issue, commentText } of issues) {
    const ticketId = issue.key;
    const jiraStatus = issue.fields?.status?.name || "";
    const jiraPriority = issue.fields?.priority?.name || "";
    const isReady = isReadyForProd(jiraStatus);

    // If ticket is Finalizado, mark all its MRs as deployed and skip
    if (isFinalized(jiraStatus)) {
      const { markAsDeployedByTicket } = require("./state");
      markAsDeployedByTicket(ticketId);
      console.log(`\n✅ ${ticketId} is finalized — marked as deployed`);
      continue;
    }

    // Extract MR links from comments
    const mrLinks = extractMRLinks(commentText, config.gitlab_base_url);

    if (mrLinks.length === 0) continue;

    console.log(`\n🔗 ${ticketId}: ${mrLinks.length} MR(s) found | ${jiraStatus} | ${jiraPriority}`);

    // Fetch MR details from GitLab
    const mrs = await getMergeRequests(config.gitlab_base_url, mrLinks);

    for (const mr of mrs) {
      const classification = classifyRepo(mr.repo_name);
      const alertPriority = isAlertPriority(jiraPriority);
      const weight = calculatePriorityWeight({
        isCore: classification.isCore,
        jiraPriority,
        isReady,
      });

      const entry = {
        jira_ticket: ticketId,
        jira_summary: issue.fields?.summary || "",
        mr_id: mr.iid,
        mr_title: mr.title,
        repo_name: mr.repo_name,
        project_path: mr.project_path,
        service_type: classification.type,
        is_core: classification.isCore,
        jira_priority: jiraPriority,
        jira_status: jiraStatus,
        mr_status: mr.state,
        source_branch: mr.source_branch,
        target_branch: mr.target_branch,
        mr_url: mr.web_url,
        jira_url: `${config.jira_base_url.replace(/\/$/, "")}/browse/${ticketId}`,
        author: mr.author,
        is_ready: isReady,
        priority_weight: weight,
        assignee_name: issue.fields?.assignee?.displayName || "",
        assignee_email: issue.fields?.assignee?.emailAddress || "",
        components: issue.fields?.components || [],
      };

      console.log(
        `  → ${mr.repo_name} (${classification.type}) | Core: ${classification.isCore} | Alert: ${alertPriority} | Ready: ${isReady} | Branch: ${mr.target_branch} | MR: ${mr.state}`
      );

      // Check if this is a MR to master/main that's merged = deployed to prod
      const prodBranches = ["master", "main"];
      const isDeployedToProd = prodBranches.includes(mr.target_branch) && mr.state === "merged";

      if (isDeployedToProd) {
        console.log(`  ✅ MR to ${mr.target_branch} is merged — marking ${ticketId}/${mr.repo_name} as deployed to production`);
        // Mark ALL MRs for this ticket+repo as deployed (the develop MR too)
        const { markAsDeployedByTicketAndRepo } = require("./state");
        markAsDeployedByTicketAndRepo(ticketId, mr.repo_name);
        processedMRs++;
        continue; // Don't re-alert for production MRs
      }

      // Update deploy queue
      upsertToQueue(entry);
      processedMRs++;

      // Immediate alert for core + high priority + ready
      if (classification.isCore && alertPriority && isReady) {
        const alreadyNotified = wasAlreadyNotified(ticketId, mr.iid, "alert_ready");

        if (!alreadyNotified) {
          console.log(`  🚨 ALERT: ${mr.repo_name} ready for prod!`);

          const alertText = await generateAlertMessage(entry);

          // Send email
          if (config.pm_email) {
            try {
              const htmlBody = alertToHtml(entry, config);
              const cc = config.cc_email || "";
              const jiraSummary = issue.fields?.summary || entry.mr_title || "";
              const subject = `🚨 DEPLOY CORE: ${entry.repo_name} — ${entry.jira_ticket} [${entry.jira_priority}] — Solicitar ventana ${config.deploy_window_hour}hs — ${jiraSummary}`;
              await sendEmail(
                config.pm_email,
                subject,
                alertText,
                htmlBody,
                cc
              );
              recordNotification(ticketId, mr.iid, "alert_ready", "email", alertText);
              alertsSent++;
            } catch (err) {
              console.error("  Failed to send email:", err.message);
            }
          }

          // Calendar event
          try {
            await createDeployWindowEvent([entry]);
            recordNotification(ticketId, mr.iid, "calendar_event", "calendar", "Event created");
          } catch (err) {
            console.error("  Failed to create calendar event:", err.message);
          }

          // Slack DM
          try {
            const { text, blocks } = buildAlertBlocks(entry, config);
            await sendSlackMessage(text, blocks);
            recordNotification(ticketId, mr.iid, "alert_slack", "slack", text);
          } catch (err) {
            console.error("  Failed to send Slack:", err.message);
          }
        } else {
          console.log(`  ℹ️ Already notified for ${ticketId}:${mr.iid}`);
        }
      }
    }
  }

  console.log(`\n✅ Polling complete. Processed ${processedMRs} MR(s), sent ${alertsSent} alert(s).`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
