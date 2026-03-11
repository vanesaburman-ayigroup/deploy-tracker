const fetch = require("node-fetch");
const { getConfig } = require("./state");

/**
 * Jira Cloud REST API Client — Polling mode
 *
 * Uses YOUR personal Jira API token. No admin needed.
 *
 * SETUP:
 * 1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
 * 2. Click "Create API token"
 * 3. Label: "deploy-tracker"
 * 4. Copy the token
 * 5. Store as JIRA_API_TOKEN in GitHub Secrets
 * 6. Store your Jira email as JIRA_USER_EMAIL in GitHub Secrets
 */

const JIRA_USER_EMAIL = process.env.JIRA_USER_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;

/**
 * Make an authenticated request to Jira Cloud REST API.
 */
async function jiraFetch(path) {
  const config = getConfig();
  const baseUrl = config.jira_base_url.replace(/\/$/, "");
  const url = `${baseUrl}/rest/api/3/${path}`;

  const auth = Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jira API error ${response.status}: ${text}`);
  }

  return response.json();
}

/**
 * Search for recently updated issues using JQL.
 *
 * @param {number} minutesAgo - Look back this many minutes
 * @returns {Promise<Array>} Array of Jira issues
 */
async function getRecentlyUpdatedIssues(minutesAgo = 20) {
  const config = getConfig();

  // JQL to find issues updated recently in the GRV project
  // that have comments (likely containing MR links)
  const jql = encodeURIComponent(
    `project = GRV AND updated >= -${minutesAgo}m ORDER BY updated DESC`
  );

  const fields = "key,summary,status,priority,comment";
  const data = await jiraFetch(`search/jql?jql=${jql}&fields=${fields}&maxResults=50`);

  return data.issues || [];
}

/**
 * Get all comments for a specific issue.
 *
 * @param {string} issueKey - e.g., "GRV-1579"
 * @returns {Promise<Array>} Array of comments
 */
async function getIssueComments(issueKey) {
  const data = await jiraFetch(`issue/${issueKey}/comment`);
  return data.comments || [];
}

/**
 * Extract plain text from Jira's Atlassian Document Format (ADF).
 * Jira Cloud returns comments in ADF (JSON), not plain text.
 *
 * @param {Object} adfDoc - ADF document object
 * @returns {string} Plain text content
 */
function adfToPlainText(adfDoc) {
  if (!adfDoc || !adfDoc.content) return "";

  let text = "";

  function walk(nodes) {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (node.type === "text") {
        text += node.text || "";
      } else if (node.type === "inlineCard" || node.type === "blockCard") {
        // Jira smart links — the URL is in attrs.url
        text += " " + (node.attrs?.url || "") + " ";
      } else if (node.type === "hardBreak") {
        text += "\n";
      } else if (node.type === "paragraph") {
        if (node.content) walk(node.content);
        text += "\n";
      } else if (node.content) {
        walk(node.content);
      }
    }
  }

  walk(adfDoc.content);
  return text;
}

/**
 * Poll Jira for recently updated issues and extract comment text.
 * Returns data in the same format as the webhook payload so the
 * rest of the pipeline works identically.
 *
 * @param {number} minutesAgo
 * @returns {Promise<Array<{ issue: Object, commentText: string }>>}
 */
async function pollJira(minutesAgo = 20) {
  console.log(`🔍 Polling Jira for issues updated in the last ${minutesAgo} minutes...`);

  const issues = await getRecentlyUpdatedIssues(minutesAgo);
  console.log(`📋 Found ${issues.length} recently updated issue(s)`);

  const results = [];

  for (const issue of issues) {
    const key = issue.key;
    const status = issue.fields?.status?.name || "";
    const priority = issue.fields?.priority?.name || "";

    // Get all comments and extract text
    let commentText = "";

    // Comments might be in the search response
    if (issue.fields?.comment?.comments) {
      commentText = issue.fields.comment.comments
        .map((c) => {
          if (c.body && typeof c.body === "object") {
            return adfToPlainText(c.body);
          }
          return c.body || "";
        })
        .join(" ");
    }

    // If no comments in search response, fetch them separately
    if (!commentText.trim()) {
      try {
        const comments = await getIssueComments(key);
        commentText = comments
          .map((c) => {
            if (c.body && typeof c.body === "object") {
              return adfToPlainText(c.body);
            }
            return c.body || "";
          })
          .join(" ");
      } catch (err) {
        console.warn(`  ⚠️ Could not fetch comments for ${key}: ${err.message}`);
      }
    }

    results.push({
      issue: {
        key,
        fields: {
          status: { name: status },
          priority: { name: priority },
          summary: issue.fields?.summary || "",
        },
      },
      commentText,
    });

    console.log(`  → ${key} | ${status} | ${priority} | ${commentText.length} chars of comments`);
  }

  return results;
}

module.exports = {
  jiraFetch,
  getRecentlyUpdatedIssues,
  getIssueComments,
  adfToPlainText,
  pollJira,
};
