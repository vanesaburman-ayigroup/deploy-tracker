/**
 * OAuth Setup Helper
 * 
 * Run this ONCE locally to get the Gmail/Calendar refresh token.
 * After that, store the refresh token as a GitHub Secret.
 * 
 * PREREQUISITES:
 * 1. Go to https://console.cloud.google.com
 * 2. Create a project (or use existing)
 * 3. Enable Gmail API and Google Calendar API
 * 4. Create OAuth 2.0 credentials (Desktop application)
 * 5. Download the credentials JSON
 * 6. Save it as "credentials.json" in this directory
 * 
 * USAGE:
 *   node src/setup-oauth.js
 * 
 * This will:
 * 1. Open a browser for you to authorize
 * 2. Print the refresh token to store as GMAIL_REFRESH_TOKEN secret
 * 3. Print the client ID and secret to store as secrets
 */

const fs = require("fs");
const http = require("http");
const { URL } = require("url");
const fetch = require("node-fetch");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
];

const REDIRECT_PORT = 3000;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

async function main() {
  // Read credentials
  const credsPath = process.argv[2] || "credentials.json";
  if (!fs.existsSync(credsPath)) {
    console.error(`❌ Credentials file not found: ${credsPath}`);
    console.error("\nSteps to create credentials:");
    console.error("1. Go to https://console.cloud.google.com");
    console.error("2. Create a project (or select existing)");
    console.error("3. Enable Gmail API: APIs & Services → Library → Gmail API → Enable");
    console.error("4. Enable Calendar API: APIs & Services → Library → Google Calendar API → Enable");
    console.error("5. Create credentials: APIs & Services → Credentials → Create → OAuth 2.0 Client ID");
    console.error("6. Application type: Desktop application");
    console.error("7. Download JSON and save as credentials.json");
    process.exit(1);
  }

  const creds = JSON.parse(fs.readFileSync(credsPath, "utf-8"));
  const { client_id, client_secret } = creds.installed || creds.web || {};

  if (!client_id || !client_secret) {
    console.error("❌ Invalid credentials file format");
    process.exit(1);
  }

  // Build authorization URL
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", client_id);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("\n🔑 OAuth Setup for Deploy Tracker\n");
  console.log("Open this URL in your browser:\n");
  console.log(authUrl.toString());
  console.log("\nWaiting for authorization...");

  // Start local server to receive the callback
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`);
      const authCode = url.searchParams.get("code");

      if (authCode) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>✅ Authorization successful!</h1><p>You can close this tab.</p>");
        server.close();
        resolve(authCode);
      } else {
        res.writeHead(400);
        res.end("Missing code parameter");
      }
    });

    server.listen(REDIRECT_PORT);
    server.on("error", reject);
  });

  // Exchange code for tokens
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id,
      client_secret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await tokenResponse.json();

  if (tokens.error) {
    console.error("❌ Token exchange failed:", tokens.error_description);
    process.exit(1);
  }

  console.log("\n✅ Authorization successful!\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Add these as GitHub Secrets in your repository:");
  console.log("Settings → Secrets and variables → Actions → New repository secret");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  console.log(`GOOGLE_CLIENT_ID = ${client_id}`);
  console.log(`GOOGLE_CLIENT_SECRET = ${client_secret}`);
  console.log(`GMAIL_REFRESH_TOKEN = ${tokens.refresh_token}`);
  console.log(`\nAccess token (temporary, for testing): ${tokens.access_token}`);
  console.log("\n⚠️  Store these secrets securely. Never commit them to the repo!");
}

main().catch(console.error);
