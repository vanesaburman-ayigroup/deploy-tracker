const fetch = require("node-fetch");

const GITLAB_TOKEN = process.env.GITLAB_TOKEN;

/**
 * Get MR details from GitLab API.
 *
 * @param {string} baseUrl - GitLab base URL (e.g., "https://gitlab.grv.com.ar")
 * @param {string} projectPath - Project path (e.g., "grv/backend/wssiniestralidad")
 * @param {string} mrIid - MR internal ID (e.g., "892")
 * @returns {Promise<Object>} MR details
 */
async function getMergeRequest(baseUrl, projectPath, mrIid) {
  const encodedPath = encodeURIComponent(projectPath);
  const url = `${baseUrl}/api/v4/projects/${encodedPath}/merge_requests/${mrIid}`;

  const response = await fetch(url, {
    headers: {
      "PRIVATE-TOKEN": GITLAB_TOKEN,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitLab API error ${response.status}: ${text}`);
  }

  const mr = await response.json();

  return {
    id: mr.id,
    iid: mr.iid,
    title: mr.title,
    description: mr.description || "",
    state: mr.state, // "opened", "closed", "merged"
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    web_url: mr.web_url,
    author: mr.author?.name || mr.author?.username || "unknown",
    labels: mr.labels || [],
    created_at: mr.created_at,
    updated_at: mr.updated_at,
    merged_at: mr.merged_at,
    // Extract repo name from the project path
    repo_name: extractRepoName(projectPath),
    project_path: projectPath,
  };
}

/**
 * Extract the repository name from a project path.
 * e.g., "grv/backend/wssiniestralidad" → "wssiniestralidad"
 *
 * @param {string} projectPath
 * @returns {string}
 */
function extractRepoName(projectPath) {
  const parts = projectPath.split("/");
  return parts[parts.length - 1];
}

/**
 * Get multiple MRs in parallel.
 *
 * @param {string} baseUrl
 * @param {Array<{ projectPath: string, mrIid: string }>} mrRefs
 * @returns {Promise<Array<Object>>}
 */
async function getMergeRequests(baseUrl, mrRefs) {
  const results = await Promise.allSettled(
    mrRefs.map((ref) => getMergeRequest(baseUrl, ref.projectPath, ref.mrIid))
  );

  return results
    .filter((r) => r.status === "fulfilled")
    .map((r) => r.value);
}

module.exports = {
  getMergeRequest,
  getMergeRequests,
  extractRepoName,
};
