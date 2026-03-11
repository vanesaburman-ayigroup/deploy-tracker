/**
 * Pipedream Workflow — Jira to GitHub Relay
 * 
 * SETUP:
 * 1. Create a new Pipedream workflow
 * 2. Add an HTTP trigger (this gives you a URL to configure in Jira)
 * 3. Add a Node.js code step with this code
 * 4. Set the GITHUB_TOKEN environment variable in Pipedream
 * 5. Update REPO_OWNER and REPO_NAME below
 * 
 * JIRA WEBHOOK CONFIG:
 * Go to Jira → Settings → System → WebHooks → Create
 * URL: Your Pipedream trigger URL
 * Events: Issue updated, Comment created
 * (Optionally filter by project)
 */

export default defineComponent({
  props: {
    github_token: {
      type: "string",
      label: "GitHub Personal Access Token",
      secret: true,
    },
  },

  async run({ steps }) {
    const REPO_OWNER = "YOUR_GITHUB_USERNAME";  // ← Cambiar
    const REPO_NAME = "deploy-tracker";

    const payload = steps.trigger.event.body;

    // Only process relevant events
    const webhookEvent = payload.webhookEvent || "";
    const relevant = [
      "jira:issue_updated",
      "comment_created",
    ];

    if (!relevant.some((e) => webhookEvent.includes(e))) {
      console.log(`Skipping irrelevant event: ${webhookEvent}`);
      return { skipped: true, event: webhookEvent };
    }

    // Dispatch to GitHub Actions
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.github_token}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "jira_webhook",
          client_payload: {
            issue: payload.issue || null,
            comment: payload.comment || null,
            webhookEvent,
            timestamp: new Date().toISOString(),
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`GitHub dispatch failed: ${response.status} ${err}`);
    }

    return {
      dispatched: true,
      ticket: payload.issue?.key,
      event: webhookEvent,
    };
  },
});
