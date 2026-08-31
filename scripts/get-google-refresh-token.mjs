#!/usr/bin/env node
// One-time setup script. Run locally with:
//   node scripts/get-google-refresh-token.mjs
//
// Walks you through Google's OAuth "installed app" flow and prints a
// refresh token to paste into .env as GOOGLE_REFRESH_TOKEN. You only need
// to run this once per Google account (re-run if you ever revoke access).
//
// Prerequisites:
//   1. In Google Cloud Console, create/select a project.
//   2. Enable the "Google Calendar API" for it.
//   3. Create an OAuth client ID of type "Desktop app".
//   4. Put its Client ID / Client Secret into .env as GOOGLE_CLIENT_ID /
//      GOOGLE_CLIENT_SECRET before running this script.
//   5. Run `npm install` first so the `googleapis` and `open` packages
//      this script uses are available (open is optional — see below).

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import process from "node:process";
import { google } from "googleapis";

function loadDotEnv() {
  if (!existsSync(".env")) return;
  const lines = readFileSync(".env", "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "\nMissing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.\n" +
      "Add them to .env first (copy .env.example to .env), then re-run this script.\n",
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // forces a refresh_token even if you've authorized before
  scope: ["https://www.googleapis.com/auth/calendar"],
});

console.log("\n1. Open this URL in a browser and sign in with the calendar account to use:\n");
console.log(authUrl);
console.log("\n2. Approve access. You'll be redirected back here automatically.\n");

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");

  if (!code) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("Missing ?code param");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Success — you can close this tab and go back to the terminal.");

    console.log("\n✅ Success! Add this line to your .env:\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

    if (!tokens.refresh_token) {
      console.warn(
        "⚠️  No refresh_token was returned. This usually means the account already\n" +
          "   granted this app access before. Go to https://myaccount.google.com/permissions,\n" +
          "   remove access for this app, then run this script again.\n",
      );
    }
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Token exchange failed — check the terminal.");
    console.error(err);
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(PORT);
