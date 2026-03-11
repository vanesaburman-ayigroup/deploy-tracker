const { getConfig } = require("./state");

/**
 * Classify a GitLab repository as core or secondary.
 * Pure deterministic lookup — no LLM needed.
 *
 * @param {string} repoName - The repository name (e.g., "wssiniestralidad")
 * @returns {{ type: string, isCore: boolean }}
 */
function classifyRepo(repoName) {
  const config = getConfig();
  const name = repoName.toLowerCase().trim();

  if (config.core_backend.map((r) => r.toLowerCase()).includes(name)) {
    return { type: "core_backend", isCore: true };
  }

  if (config.core_frontend.map((r) => r.toLowerCase()).includes(name)) {
    return { type: "core_frontend", isCore: true };
  }

  // Heuristic: repos starting with "ws" are backend, others are frontend
  if (name.startsWith("ws") || name.startsWith("ws-")) {
    return { type: "secondary_backend", isCore: false };
  }

  return { type: "secondary_frontend", isCore: false };
}

/**
 * Check if a Jira priority should trigger immediate alerts.
 *
 * @param {string} jiraPriority - Priority name from Jira (e.g., "Blocker", "High")
 * @returns {boolean}
 */
function isAlertPriority(jiraPriority) {
  if (!jiraPriority) return false;
  const config = getConfig();
  return config.alert_priorities.map((p) => p.toLowerCase()).includes(jiraPriority.toLowerCase());
}

/**
 * Calculate a priority weight for sorting.
 * Higher weight = higher priority.
 *
 * @param {{ isCore: boolean, jiraPriority: string, isReady: boolean }} params
 * @returns {number}
 */
function calculatePriorityWeight({ isCore, jiraPriority, isReady }) {
  let weight = 0;

  if (isCore) weight += 100;
  if (isReady) weight += 50;

  const priorityMap = {
    blocker: 40,
    highest: 35,
    high: 30,
    medium: 20,
    low: 10,
    lowest: 5,
  };

  weight += priorityMap[(jiraPriority || "").toLowerCase()] || 0;

  return weight;
}

/**
 * Extract GitLab MR URLs from Jira comment text.
 * Supports various URL formats commonly found in Jira comments.
 *
 * @param {string} commentText - Raw comment text from Jira
 * @param {string} gitlabBaseUrl - Base URL of GitLab instance
 * @returns {Array<{ projectPath: string, mrIid: string, fullUrl: string }>}
 */
function extractMRLinks(commentText, gitlabBaseUrl) {
  if (!commentText) return [];

  const baseUrl = gitlabBaseUrl.replace(/\/$/, "");
  // Match patterns like:
  // https://gitlab.grv.com.ar/group/project/-/merge_requests/123
  // https://gitlab.grv.com.ar/group/subgroup/project/-/merge_requests/123
  // Also handles links wrapped in Jira markup [text|url] or just plain URLs
  const urlPattern = new RegExp(
    baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
      "/([\\w./-]+?)/-/merge_requests/(\\d+)",
    "gi"
  );

  const matches = [];
  let match;

  while ((match = urlPattern.exec(commentText)) !== null) {
    matches.push({
      projectPath: match[1],
      mrIid: match[2],
      fullUrl: match[0],
    });
  }

  // Deduplicate by MR URL
  const seen = new Set();
  return matches.filter((m) => {
    const key = `${m.projectPath}:${m.mrIid}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Determine the "ready for prod" status from Jira issue status.
 * Customize these status names to match your Jira workflow.
 */
function isReadyForProd(jiraStatus) {
  if (!jiraStatus) return false;
  const readyStatuses = [
    "ready for prod",
    "ready for production",
    "listo para prod",
    "listo para produccion",
    "listo para producción",
    "ready to deploy",
    "aprobado qa",
    "qa aprobado",
    "done",
  ];
  return readyStatuses.includes(jiraStatus.toLowerCase().trim());
}

module.exports = {
  classifyRepo,
  isAlertPriority,
  calculatePriorityWeight,
  extractMRLinks,
  isReadyForProd,
};
