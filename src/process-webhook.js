const {
  classifyRepo,
  isAlertPriority,
  calculatePriorityWeight,
  extractMRLinks,
  isReadyForProd,
} = require("./classify");
const { getMergeRequests } = require("./gitlab-client");
const { generateAlertMessage } = require("./gemini-client");
const { sendEmail, refreshAccessToken, summaryToHtml } = require("./gmail-client");
const { createDeployWindowEvent } = require("./calendar-client");
const { sendSlackMessage, buildAlertBlocks } = require("./slack-client");
const {
  getConfig,
  upsertToQueue,
  wasAlreadyNotified,
  recordNotification,
} = require("./state");

async function main() {
  console.log("🔄 Processing Jira webhook...");

  // Parse the Jira payload from environment
  const payload = JSON.parse(process.env.JIRA_PAYLOAD || "{}");

  if (!payload || (!payload.issue && !payload.comment)) {
    console.log("⚠️ No relevant data in payload, skipping.");
    process.exit(0);
  }

  const config = getConfig();

  // Refresh OAuth token for Gmail/Calendar
  let accessToken = null;
  try {
    accessToken = await refreshAccessToken();
    if (accessToken) {
      process.env.GMAIL_ACCESS_TOKEN = accessToken;
    }
  } catch (err) {
    console.warn("Could not refresh OAuth token:", err.message);
  }

  // Extract issue details
  const issue = payload.issue || {};
  const ticketId = issue.key || "UNKNOWN";
  const jiraStatus = issue.fields?.status?.name || "";
  const jiraPriority = issue.fields?.priority?.name || "";
  const isReady = isReadyForProd(jiraStatus);

  console.log(`📋 Ticket: ${ticketId} | Status: ${jiraStatus} | Priority: ${jiraPriority} | Ready: ${isReady}`);

  // Extract MR links from comments
  let commentText = "";

  // If the event is a comment creation, use the comment body
  if (payload.comment) {
    commentText = payload.comment.body || "";
  }

  // Also check all existing comments if available
  if (issue.fields?.comment?.comments) {
    commentText += " " + issue.fields.comment.comments.map((c) => c.body).join(" ");
  }

  const mrLinks = extractMRLinks(commentText, config.gitlab_base_url);

  if (mrLinks.length === 0) {
    console.log("ℹ️ No GitLab MR links found in comments.");
    // Still update queue if status changed
    process.exit(0);
  }

  console.log(`🔗 Found ${mrLinks.length} MR link(s)`);

  // Fetch MR details from GitLab
  const mrs = await getMergeRequests(config.gitlab_base_url, mrLinks);
  console.log(`📦 Fetched ${mrs.length} MR detail(s) from GitLab`);

  // Process each MR
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
      jira_url: `${config.jira_base_url}/browse/${ticketId}`,
      author: mr.author,
      is_ready: isReady,
      priority_weight: weight,
    };

    console.log(
      `  → ${mr.repo_name} (${classification.type}) | Core: ${classification.isCore} | Alert: ${alertPriority} | Ready: ${isReady}`
    );

    // Update deploy queue
    upsertToQueue(entry);

    // Check if we need to send an immediate alert
    if (classification.isCore && alertPriority && isReady) {
      const alreadyNotified = wasAlreadyNotified(ticketId, mr.iid, "alert_ready");

      if (!alreadyNotified) {
        console.log(`🚨 ALERT: Core service ${mr.repo_name} is ready for prod with ${jiraPriority} priority!`);

        // Generate alert message
        const alertText = await generateAlertMessage(entry);

        // Send email
        if (config.pm_email) {
          try {
            const htmlBody = summaryToHtml(alertText, config);
            await sendEmail(
              config.pm_email,
              `🚨 DEPLOY CORE: ${mr.repo_name} — ${ticketId} [${jiraPriority}]`,
              alertText,
              htmlBody
            );
            recordNotification(ticketId, mr.iid, "alert_ready", "email", alertText);
          } catch (err) {
            console.error("Failed to send alert email:", err.message);
          }
        }

        // Create/update calendar event for 19hs
        try {
          await createDeployWindowEvent([entry]);
          recordNotification(ticketId, mr.iid, "calendar_event", "calendar", "Event created");
        } catch (err) {
          console.error("Failed to create calendar event:", err.message);
        }

        // Send Slack alert
        try {
          const { text, blocks } = buildAlertBlocks(entry, config);
          await sendSlackMessage(text, blocks);
          recordNotification(ticketId, mr.iid, "alert_slack", "slack", text);
        } catch (err) {
          console.error("Failed to send Slack alert:", err.message);
        }
      } else {
        console.log(`  ℹ️ Already notified for ${ticketId}:${mr.iid}, skipping.`);
      }
    }
  }

  console.log("✅ Webhook processing complete.");
}

main().catch((err) => {
  console.error("❌ Error processing webhook:", err);
  process.exit(1);
});
