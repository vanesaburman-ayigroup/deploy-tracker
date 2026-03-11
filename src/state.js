const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");

function readJSON(filename) {
  const filepath = path.join(DATA_DIR, filename);
  return JSON.parse(fs.readFileSync(filepath, "utf-8"));
}

function writeJSON(filename, data) {
  const filepath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function getConfig() {
  return readJSON("config.json");
}

function getDeployQueue() {
  return readJSON("deploy-queue.json");
}

function saveDeployQueue(queue) {
  queue.last_updated = new Date().toISOString();
  writeJSON("deploy-queue.json", queue);
}

function getNotificationLog() {
  return readJSON("notification-log.json");
}

function saveNotificationLog(log) {
  log.last_checked = new Date().toISOString();
  writeJSON("notification-log.json", log);
}

/**
 * Generate a unique hash for deduplication.
 * Combines ticket ID + MR ID + status to avoid duplicate notifications.
 */
function generateEventHash(ticketId, mrId, status) {
  const input = `${ticketId}:${mrId}:${status}`;
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/**
 * Check if an event was already notified.
 */
function wasAlreadyNotified(ticketId, mrId, status) {
  const log = getNotificationLog();
  const hash = generateEventHash(ticketId, mrId, status);
  return log.notifications.some((n) => n.event_hash === hash);
}

/**
 * Record a notification as sent.
 */
function recordNotification(ticketId, mrId, status, channel, payload) {
  const log = getNotificationLog();
  const hash = generateEventHash(ticketId, mrId, status);
  log.notifications.push({
    event_hash: hash,
    ticket_id: ticketId,
    mr_id: mrId,
    status,
    channel,
    sent_at: new Date().toISOString(),
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

  // Keep only last 500 notifications to avoid file bloat
  if (log.notifications.length > 500) {
    log.notifications = log.notifications.slice(-500);
  }

  saveNotificationLog(log);
}

/**
 * Add or update an MR in the deploy queue.
 * Uses jira_ticket + mr_id as unique key.
 */
function upsertToQueue(entry) {
  const queue = getDeployQueue();
  const idx = queue.queue.findIndex(
    (item) => item.jira_ticket === entry.jira_ticket && item.mr_id === entry.mr_id
  );

  if (idx >= 0) {
    queue.queue[idx] = { ...queue.queue[idx], ...entry, updated_at: new Date().toISOString() };
  } else {
    queue.queue.push({
      ...entry,
      detected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deployed_at: null,
    });
  }

  saveDeployQueue(queue);
  return queue;
}

/**
 * Get all pending MRs (not yet deployed), sorted by priority weight.
 */
function getPendingDeploys() {
  const queue = getDeployQueue();
  return queue.queue
    .filter((item) => !item.deployed_at)
    .sort((a, b) => (b.priority_weight || 0) - (a.priority_weight || 0));
}

/**
 * Get pending core deploys only.
 */
function getPendingCoreDeploys() {
  return getPendingDeploys().filter(
    (item) => item.service_type === "core_backend" || item.service_type === "core_frontend"
  );
}

/**
 * Mark an MR as deployed.
 */
function markAsDeployed(ticketId, mrId) {
  const queue = getDeployQueue();
  const item = queue.queue.find((i) => i.jira_ticket === ticketId && i.mr_id === mrId);
  if (item) {
    item.deployed_at = new Date().toISOString();
    saveDeployQueue(queue);
  }
}

function markAsDeployedByTicketAndRepo(ticketId, repoName) {
  const queue = getDeployQueue();
  let changed = false;
  for (const item of queue.queue) {
    if (item.jira_ticket === ticketId && item.repo_name === repoName && !item.deployed_at) {
      item.deployed_at = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) {
    saveDeployQueue(queue);
  }
}

module.exports = {
  getConfig,
  getDeployQueue,
  saveDeployQueue,
  getNotificationLog,
  saveNotificationLog,
  generateEventHash,
  wasAlreadyNotified,
  recordNotification,
  upsertToQueue,
  getPendingDeploys,
  getPendingCoreDeploys,
  markAsDeployed,
  markAsDeployedByTicketAndRepo,
};
