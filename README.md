# 🚀 Deploy Tracker Agent

**Agente IA para gestión de deploys — GRV**

Automatiza el seguimiento de merge requests, clasifica servicios core/secundarios, y notifica al PM cuando hay MRs listas para producción.

## Arquitectura

```
Jira Webhook → Pipedream → GitHub Actions → {GitLab API, Gemini, Gmail, Calendar}
                                                         ↓
                                              deploy-queue.json (GitHub repo)
                                                         ↓
                                              Dashboard (Vercel) ← PM
```

**Costo total: USD 0/mes** — Todo corre en free tiers.

## Quick Start

### 1. Crear el repo en GitHub

```bash
git clone <este-repo>
cd deploy-tracker
npm install
```

### 2. Configurar Google OAuth (una sola vez)

1. Ir a [Google Cloud Console](https://console.cloud.google.com)
2. Crear un proyecto (o usar uno existente)
3. Habilitar **Gmail API** y **Google Calendar API**
4. Crear credenciales OAuth 2.0 (tipo: Desktop Application)
5. Descargar el JSON de credenciales
6. Ejecutar:

```bash
node src/setup-oauth.js credentials.json
```

7. Seguir las instrucciones en pantalla para autorizar
8. Copiar los secrets que muestra en pantalla

### 3. Configurar GitHub Secrets

En el repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Descripción |
|--------|-------------|
| `GITLAB_TOKEN` | Personal Access Token de GitLab (scope: `read_api`) |
| `GEMINI_API_KEY` | API key de [Google AI Studio](https://aistudio.google.com/apikey) |
| `GOOGLE_CLIENT_ID` | Del paso anterior |
| `GOOGLE_CLIENT_SECRET` | Del paso anterior |
| `GMAIL_REFRESH_TOKEN` | Del paso anterior |
| `PM_CALENDAR_ID` | ID del calendario del PM (o `primary`) |

### 4. Configurar listas core

Editar `data/config.json`:

```json
{
  "core_backend": ["wssiniestralidad", "wslogistica", ...],
  "core_frontend": ["portal-art", "portal-prestador", ...],
  "alert_priorities": ["Blocker", "High"],
  "pm_email": "pm@grv.com.ar",
  "deploy_window_hour": 19
}
```

### 5. Configurar Pipedream (relay de webhooks)

1. Crear cuenta en [Pipedream](https://pipedream.com)
2. Crear un nuevo workflow con trigger HTTP
3. Agregar un step Node.js con el código de `src/pipedream-relay.js`
4. Configurar `GITHUB_TOKEN` como variable de entorno en Pipedream
5. Copiar la URL del trigger

### 6. Configurar Jira Webhook

1. Jira → Administración → Sistema → WebHooks → Crear
2. URL: la URL del trigger de Pipedream
3. Eventos: `Issue updated`, `Comment created`
4. (Opcional) Filtrar por proyecto

### 7. Deploy del Dashboard

```bash
cd dashboard
# Deploy en Vercel
npx vercel
```

## Comandos

```bash
npm run test      # Ejecutar tests del clasificador
npm run webhook   # Procesar webhook manualmente (necesita JIRA_PAYLOAD env var)
npm run summary   # Generar resumen manualmente
npm run calendar  # Verificar y crear evento de calendario
```

## Cómo funciona

### Clasificación (determinística)
- Los repos se clasifican como core/secundario según las listas en `config.json`
- No se usa LLM para clasificar
- El PM puede actualizar las listas desde el dashboard

### Alertas
| Tipo | Prioridad | Status | Acción |
|------|-----------|--------|--------|
| Core | Bloqueante/Alta | Ready | Email inmediato + Calendar 19hs |
| Core | Media/Baja | Ready | Incluido en resumen programado |
| Secundario | Cualquiera | Ready | Solo registro en dashboard |

### Resúmenes
- Se generan a las 9:30, 13:00 y 15:00 ART (lunes a viernes)
- Solo se envían si hay novedades
- Gemini 2.5 Flash genera el texto del resumen

### Deduplicación
- Cada notificación se registra con un hash (ticket + MR + status)
- No se envían duplicados

## Estructura

```
├── .github/workflows/      # GitHub Actions
│   ├── jira-webhook.yml     # Procesa webhooks de Jira
│   ├── scheduled-summary.yml # Resúmenes programados
│   └── calendar-reminder.yml # Evento de calendario 19hs
├── src/
│   ├── process-webhook.js   # Lógica principal
│   ├── classify.js          # Clasificador determinístico
│   ├── gitlab-client.js     # Cliente GitLab API
│   ├── gemini-client.js     # Cliente Gemini (resúmenes)
│   ├── gmail-client.js      # Envío de emails
│   ├── calendar-client.js   # Google Calendar
│   ├── state.js             # Gestión de estado (JSON files)
│   ├── setup-oauth.js       # Setup OAuth (una sola vez)
│   ├── pipedream-relay.js   # Código para Pipedream
│   └── test-classify.js     # Tests
├── data/
│   ├── config.json          # Configuración (listas core, prioridades)
│   ├── deploy-queue.json    # Cola de MRs pendientes
│   └── notification-log.json # Log de notificaciones
└── dashboard/
    └── index.html           # Dashboard del PM
```

## Free Tier Limits

| Recurso | Límite | Uso estimado |
|---------|--------|--------------|
| GitHub Actions | 2,000 min/mes | ~100-200 min |
| Gemini Flash | 1,500 req/día | ~10-20 req |
| Vercel | 100 deploys/día | 1-2/semana |
| Gmail/Calendar | Sin límite práctico | ~5-15/día |
| Pipedream | Workflows ilimitados | ~20-50/día |

---

Hecho con 💜 por Vane — Líder Técnica @ GRV
