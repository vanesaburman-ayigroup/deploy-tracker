const fetch = require("node-fetch");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const SYSTEM_PROMPT = `Sos un asistente de deploy para un equipo de desarrollo en una consultora de software (GRV) que gestiona una plataforma ART (Aseguradora de Riesgos del Trabajo) con 30+ microservicios.

Tu trabajo es generar resúmenes claros y accionables de merge requests pendientes para el Project Manager.

Reglas:
- Usá español argentino
- Agrupá por tipo: primero CORE (requieren ventana de no uso a las 19hs), luego SECUNDARIOS
- Dentro de cada grupo, ordená por prioridad (Bloqueante > Alta > Media > Baja)
- Para cada MR incluí: ticket Jira, nombre del repo, título de la MR, branch, cuánto hace que está lista
- Si hay más de 3 MRs core, alertá que es un deploy grande y sugerí hacerlo en fases
- Terminá con un bloque de "Acciones requeridas"
- Usá emojis para prioridades: 🔴 Bloqueante, 🟠 Alta, 🟡 Media, 🟢 Baja
- Si no hay nada pendiente, decilo brevemente
- Formato: texto plano con estructura clara (se envía por email)`;

/**
 * Generate a deploy summary using Gemini.
 *
 * @param {Array<Object>} pendingDeploys - Array of deploy queue entries
 * @returns {Promise<string>} Generated summary text
 */
async function generateSummary(pendingDeploys) {
  if (!GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY not set, using fallback summary");
    return generateFallbackSummary(pendingDeploys);
  }

  const now = new Date();
  const userPrompt = `Genera un resumen de deploy para hoy ${now.toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} a las ${now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Buenos_Aires" })}.

Datos de MRs pendientes:
${JSON.stringify(pendingDeploys, null, 2)}

${pendingDeploys.length === 0 ? "No hay MRs pendientes para deploy." : ""}`;

  try {
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2048,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Empty response from Gemini");
    }

    return text;
  } catch (error) {
    console.error("Gemini error, using fallback:", error.message);
    return generateFallbackSummary(pendingDeploys);
  }
}

/**
 * Fallback summary when Gemini is unavailable.
 */
function generateFallbackSummary(pendingDeploys) {
  if (pendingDeploys.length === 0) {
    return "✅ No hay MRs pendientes para deploy.";
  }

  const core = pendingDeploys.filter(
    (d) => d.service_type === "core_backend" || d.service_type === "core_frontend"
  );
  const secondary = pendingDeploys.filter(
    (d) => d.service_type !== "core_backend" && d.service_type !== "core_frontend"
  );

  let summary = `🚀 Resumen de Deploy — ${new Date().toLocaleDateString("es-AR")}\n\n`;

  if (core.length > 0) {
    summary += "━━ CORE — Requieren ventana 19hs ━━\n";
    for (const item of core) {
      const emoji = item.jira_priority?.toLowerCase() === "blocker" ? "🔴" : "🟠";
      summary += `${emoji} [${item.jira_priority || "?"}] ${item.jira_ticket} — ${item.repo_name}\n`;
      summary += `   MR !${item.mr_id}: ${item.mr_title || "Sin título"}\n`;
      summary += `   Branch: ${item.source_branch} → ${item.target_branch}\n`;
      if (item.detected_at) {
        summary += `   Listo desde: ${new Date(item.detected_at).toLocaleString("es-AR", { timeZone: "America/Buenos_Aires" })}\n`;
      }
      summary += "\n";
    }
  }

  if (secondary.length > 0) {
    summary += "━━ SECUNDARIO ━━\n";
    for (const item of secondary) {
      summary += `🟢 ${item.jira_ticket} — ${item.repo_name}\n`;
      summary += `   MR !${item.mr_id}: ${item.mr_title || "Sin título"}\n\n`;
    }
  }

  if (core.length > 0) {
    summary += `\nℹ️ ${core.length} servicio(s) core listo(s). Se debe coordinar ventana de no uso a las 19:00hs.\n`;
  }

  return summary;
}

/**
 * Generate an alert message for a single critical MR.
 */
async function generateAlertMessage(entry) {
  const fallback =
    `🚨 ALERTA: MR core lista para deploy\n\n` +
    `Ticket: ${entry.jira_ticket}\n` +
    `Servicio: ${entry.repo_name} (${entry.service_type})\n` +
    `MR: !${entry.mr_id} — ${entry.mr_title || "Sin título"}\n` +
    `Prioridad: ${entry.jira_priority}\n` +
    `Branch: ${entry.source_branch} → ${entry.target_branch}\n\n` +
    `⚠️ Acción requerida: Coordinar ventana de no uso del sistema a las 19:00hs`;

  if (!GEMINI_API_KEY) return fallback;

  try {
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [
            {
              text: `Sos un asistente de deploy. Generá un mensaje de alerta conciso en español argentino para el PM. Debe ser breve y accionable. Incluí que se necesita ventana de no uso a las 19hs para servicios core.`,
            },
          ],
        },
        contents: [{ parts: [{ text: `Generá alerta para: ${JSON.stringify(entry)}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
      }),
    });

    if (!response.ok) throw new Error("Gemini error");

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || fallback;
  } catch {
    return fallback;
  }
}

module.exports = { generateSummary, generateAlertMessage };
