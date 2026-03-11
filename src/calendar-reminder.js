const { refreshAccessToken } = require("./gmail-client");
const { createDeployWindowEvent } = require("./calendar-client");
const { getPendingCoreDeploys } = require("./state");

async function main() {
  console.log("📅 Checking for pending core deploys for calendar reminder...");

  const corePending = getPendingCoreDeploys();

  if (corePending.length === 0) {
    console.log("✅ No core deploys pending. No calendar event needed.");
    process.exit(0);
  }

  console.log(`🔴 ${corePending.length} core deploy(s) pending. Creating calendar event.`);

  // Refresh OAuth token
  try {
    const accessToken = await refreshAccessToken();
    if (accessToken) {
      process.env.GMAIL_ACCESS_TOKEN = accessToken;
    }
  } catch (err) {
    console.warn("Could not refresh OAuth token:", err.message);
  }

  // Create or update calendar event
  try {
    const result = await createDeployWindowEvent(corePending);
    console.log("📅 Calendar event result:", result);
  } catch (err) {
    console.error("Failed to create calendar event:", err.message);
  }

  console.log("✅ Calendar reminder check complete.");
}

main().catch((err) => {
  console.error("❌ Error in calendar reminder:", err);
  process.exit(1);
});
