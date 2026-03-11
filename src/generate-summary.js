const { generateSummary } = require("./gemini-client");
const { sendEmail, refreshAccessToken, summaryToHtml } = require("./gmail-client");
const { sendSlackMessage, buildSummaryBlocks } = require("./slack-client");
const { getConfig, getPendingDeploys, getPendingCoreDeploys } = require("./state");

async function main() {
  console.log("📊 Generating scheduled summary...");

  const config = getConfig();
  const pending = getPendingDeploys();

  if (pending.length === 0) {
    console.log("✅ No pending deploys. Skipping summary.");
    process.exit(0);
  }

  console.log(`📋 ${pending.length} pending deploy(s) found.`);

  // Refresh OAuth token
  try {
    const accessToken = await refreshAccessToken();
    if (accessToken) {
      process.env.GMAIL_ACCESS_TOKEN = accessToken;
    }
  } catch (err) {
    console.warn("Could not refresh OAuth token:", err.message);
  }

  // Generate summary with Gemini
  const summaryText = await generateSummary(pending);
  console.log("📝 Summary generated:");
  console.log(summaryText);

  // Send email
  if (config.pm_email) {
    try {
      const corePending = getPendingCoreDeploys();
      const subject = corePending.length > 0
        ? `🚀 Deploy Tracker: ${corePending.length} core + ${pending.length - corePending.length} secundarios pendientes`
        : `📋 Deploy Tracker: ${pending.length} MR(s) pendiente(s)`;

      const htmlBody = summaryToHtml(summaryText, config);
      const cc = config.cc_email || "";
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
