const fetch = require("node-fetch");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const SYSTEM_PROMPT = `Sos un asistente de deploy para el Project Manager de GRV, una consultora de software que gestiona una plataforma ART con 30+ microservicios.

Tu trabajo es generar resúmenes claros y accionables de TICKETS (no de MRs individuales) pendientes de deploy.

Reglas:
- Usá español argentino, tono amigable pero profesional
- Hablá de TICKETS, no de MRs. El PM no le importa el detalle técnico de las MRs
- Agrupá en estas secciones, en este orden:
  1. "CORE — Requieren ventana 19hs" — tickets core listos o en camino, que no son pendientes de informe
  2. "SECUNDARIOS" — tickets de servicios secundarios
  3. "PENDIENTES INFORME RELEASE" — tickets que están listos para prod y asignados al PM (él tiene que hacer el informe antes de que se desplieguen)
- Para cada ticket incluí: número de ticket, tema/título, estado actual, prioridad, componente si hay, servicios afectados, cuales son core y cuales son secundarios
- Usá emojis para prioridades: 🔴 Bloqueante/Más alta, 🟠 Alta, 🟡 Media, 🟢 Baja
- Usá emojis para estados: ✅ Listo para prod, 🧪 Test, 🔨 En curso, ⏳ Pendiente MR, 📋 Pendiente informe release
- Si hay tickets "Pendientes informe release", decile al PM cuántos tiene pendientes
- Si hay más de 3 tickets core listos, mencioná que es un deploy grande, que debería hacerse en una ventana extendida
- Terminá con "Acciones requeridas" resumiendo qué tiene que hacer el PM
- Formato: texto plano con estructura clara (se envía por email en un bloque <pre>)
- NO uses markdown (ni ** ni ## ni nada de eso), solo texto plano con emojis y guiones`;

/**
 * Generate a deploy summary using Gemini.
 * Receives pre-grouped ticket data, not raw MRs.
 */
async function generateSummary(ticketData) {
  if (!GEMINI_API_KEY) {
    console.warn("GEMINI_API_KEY not set, using fallback summary");
    return generateFallbackSummary(ticketData);
  }

  const now = new Date();
  const userPrompt = `Genera el resumen de deploy para hoy ${now.toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} a las ${now.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Buenos_Aires" })}.

Datos agrupados por ticket:
${JSON.stringify(ticketData, null, 2)}`;

  try {
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 4096,
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
    return generateFallbackSummary(ticketData);
  }
}

/**
 * Fallback summary when Gemini is unavailable.
 */
function generateFallbackSummary(ticketData) {
  const r = ticketData.resumen;
  if (r.total_tickets === 0) return "✅ No hay tickets pendientes para deploy.";

  let summary = `🚀 Resumen de Deploy — ${new Date().toLocaleDateString("es-AR")}\n\n`;
  summary += `Total: ${r.total_tickets} tickets (${r.core} core, ${r.secundarios} secundarios)\n`;
  summary += `Listos para deploy: ${r.listos_para_deploy} | Pendientes informe release: ${r.pendientes_informe_release}\n\n`;

  if (ticketData.tickets_core.length > 0) {
    summary += "━━ CORE — Requieren ventana 19hs ━━\n";
    for (const t of ticketData.tickets_core) {
      const emoji = t.prioridad?.toLowerCase().includes("bloq") ? "🔴" : "🟠";
      const estado = t.pendiente_informe ? "📋 Pendiente informe" : t.listo_para_prod ? "✅ Listo" : `🔨 ${t.estado}`;
      summary += `${emoji} ${t.ticket} — ${t.tema}\n`;
      summary += `   ${estado} | ${t.prioridad} | Servicios: ${t.servicios_core.join(", ")}\n\n`;
    }
  }

  if (ticketData.tickets_secundarios.length > 0) {
    summary += "━━ SECUNDARIOS ━━\n";
    for (const t of ticketData.tickets_secundarios) {
      summary += `🟢 ${t.ticket} — ${t.tema}\n`;
      summary += `   ${t.estado} | Servicios: ${t.servicios.join(", ")}\n\n`;
    }
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