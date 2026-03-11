const fetch = require("node-fetch");

/**
 * Create a Google Calendar event for the deploy window.
 *
 * @param {Array<Object>} coreDeploys - Core MRs pending deploy
 * @returns {Promise<Object>}
 */
async function createDeployWindowEvent(coreDeploys) {
  const accessToken = process.env.GMAIL_ACCESS_TOKEN; // Same OAuth token works for Calendar
  const calendarId = process.env.PM_CALENDAR_ID || "primary";

  if (!accessToken) {
    console.log("=== CALENDAR EVENT (dry run) ===");
    console.log(`Would create event at 19:00 for ${coreDeploys.length} core deploy(s)`);
    console.log("=== END ===");
    return { success: true, dryRun: true };
  }

  const today = new Date();
  const eventDate = today.toISOString().split("T")[0]; // YYYY-MM-DD

  // Check if event already exists for today
  const existing = await findExistingEvent(accessToken, calendarId, eventDate);
  if (existing) {
    console.log(`Deploy window event already exists for ${eventDate}: ${existing.id}`);
    // Update the existing event with current MR list
    return updateEvent(accessToken, calendarId, existing.id, coreDeploys, eventDate);
  }

  const summary = `🚀 DEPLOY CORE — Solicitar ventana de no uso`;
  const description = buildEventDescription(coreDeploys);

  const event = {
    summary,
    description,
    start: {
      dateTime: `${eventDate}T19:00:00`,
      timeZone: "America/Buenos_Aires",
    },
    end: {
      dateTime: `${eventDate}T20:00:00`,
      timeZone: "America/Buenos_Aires",
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 30 },
        { method: "popup", minutes: 10 },
      ],
    },
    colorId: "11", // Red (tomato)
  };

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Calendar API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  console.log(`Calendar event created: ${result.htmlLink}`);
  return { success: true, eventId: result.id, link: result.htmlLink };
}

/**
 * Find an existing deploy window event for a given date.
 */
async function findExistingEvent(accessToken, calendarId, dateStr) {
  const timeMin = `${dateStr}T18:00:00-03:00`;
  const timeMax = `${dateStr}T21:00:00-03:00`;

  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  );
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("q", "DEPLOY CORE");
  url.searchParams.set("singleEvents", "true");

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return null;

  const data = await response.json();
  return data.items?.find((e) => e.summary?.includes("DEPLOY CORE")) || null;
}

/**
 * Update an existing event with new deploy details.
 */
async function updateEvent(accessToken, calendarId, eventId, coreDeploys, dateStr) {
  const description = buildEventDescription(coreDeploys);

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ description }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Calendar update error: ${err}`);
  }

  console.log(`Calendar event updated: ${eventId}`);
  return { success: true, eventId, updated: true };
}

/**
 * Build the event description from core deploys.
 */
function buildEventDescription(coreDeploys) {
  let desc = "⚠️ ACCIÓN REQUERIDA: Coordinar ventana de no uso del sistema\n\n";
  desc += `Servicios core pendientes de deploy (${coreDeploys.length}):\n\n`;

  for (const item of coreDeploys) {
    const emoji = item.jira_priority?.toLowerCase() === "blocker" ? "🔴" : "🟠";
    desc += `${emoji} ${item.jira_ticket} — ${item.repo_name}\n`;
    desc += `   MR !${item.mr_id}: ${item.mr_title || ""}\n`;
    desc += `   Prioridad: ${item.jira_priority || "?"}\n\n`;
  }

  desc += "---\nGenerado por Deploy Tracker Agent";
  return desc;
}

module.exports = { createDeployWindowEvent };
