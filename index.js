const crypto = require("crypto");
const express = require("express");

const DISCORD_API = "https://discord.com/api/v10";
const ROBLOX_API = "https://apis.roblox.com/oauth/v1";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function env(name, fallback = "") {
  const value = process.env[name] || fallback;
  return String(value || "").trim().replace(/^["']|["']$/g, "");
}

function requiredEnv(name) {
  const value = env(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function requiredSnowflakeEnv(name) {
  const value = requiredEnv(name);
  if (!/^\d{17,20}$/.test(value)) {
    throw new Error(`${name} must be a Discord ID containing only numbers. Current value starts with: ${value.slice(0, 12)}`);
  }
  return value;
}

function optionalNumericEnv(name) {
  const value = env(name);
  if (value && !/^\d+$/.test(value)) {
    throw new Error(`${name} must contain only numbers.`);
  }
  return value;
}

function normalizeBaseUrl(value, label) {
  let raw = String(value || "").trim().replace(/^["']|["']$/g, "");
  raw = raw.replace(/^https\/\//i, "https://").replace(/^http\/\//i, "http://");

  if (raw && !/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
      throw new Error("invalid URL");
    }
    return url.origin.replace(/\/+$/, "");
  } catch {
    throw new Error(`${label} must be a valid URL like https://calfx-verify.vercel.app`);
  }
}

function getRequestBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return host ? `${proto}://${host}` : "";
}

function getConfig(req) {
  const fallbackBaseUrl = env("VERCEL_PROJECT_PRODUCTION_URL")
    ? `https://${env("VERCEL_PROJECT_PRODUCTION_URL")}`
    : env("VERCEL_URL")
      ? `https://${env("VERCEL_URL")}`
      : getRequestBaseUrl(req);
  const publicBaseUrl = normalizeBaseUrl(env("PUBLIC_BASE_URL", fallbackBaseUrl), "PUBLIC_BASE_URL");
  if (!publicBaseUrl) throw new Error("Missing required environment variable: PUBLIC_BASE_URL");
  const redirectUri = `${publicBaseUrl}/callback`;
  const robloxClientId = optionalNumericEnv("ROBLOX_CLIENT_ID");
  const robloxClientSecret = env("ROBLOX_CLIENT_SECRET");

  if ((robloxClientId && !robloxClientSecret) || (!robloxClientId && robloxClientSecret)) {
    throw new Error("Set both ROBLOX_CLIENT_ID and ROBLOX_CLIENT_SECRET, or leave both empty.");
  }

  return {
    clientId: requiredSnowflakeEnv("DISCORD_CLIENT_ID"),
    clientSecret: requiredEnv("DISCORD_CLIENT_SECRET"),
    botToken: requiredEnv("DISCORD_BOT_TOKEN"),
    guildId: requiredSnowflakeEnv("DISCORD_GUILD_ID"),
    unverifiedRoleId: requiredSnowflakeEnv("UNVERIFIED_ROLE_ID"),
    verifiedRoleId: requiredSnowflakeEnv("VERIFIED_ROLE_ID"),
    memberRoleId: requiredSnowflakeEnv("MEMBER_ROLE_ID"),
    redirectUri,
    publicBaseUrl,
    robloxClientId,
    robloxClientSecret,
    robloxRedirectUri: `${publicBaseUrl}/roblox/callback`
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function signState(config, payload) {
  return crypto
    .createHmac("sha256", config.clientSecret)
    .update(payload)
    .digest("base64url");
}

function encodeStatePayload(data) {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

function decodeStatePayload(payload) {
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

function createOAuthState(config) {
  const payload = encodeStatePayload({
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(18).toString("base64url"),
    flow: "discord",
    redirectUri: config.redirectUri
  });

  return `${payload}.${signState(config, payload)}`;
}

function createRobloxOAuthState(config, discordUser) {
  const payload = encodeStatePayload({
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(18).toString("base64url"),
    flow: "roblox",
    discordUserId: discordUser.id,
    discordUsername: discordUser.username
  });

  return `${payload}.${signState(config, payload)}`;
}

function readOAuthState(config, state) {
  const parts = String(state || "").split(".");
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expected = signState(config, payload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  try {
    const data = decodeStatePayload(payload);
    const ageMs = Date.now() - Number(data.issuedAt);

    if (!Number.isFinite(ageMs) || ageMs < -60_000 || ageMs > STATE_MAX_AGE_MS) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

function htmlPage(title, body, status = 200) {
  return {
    status,
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #111318;
      color: #f4f7fb;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        linear-gradient(120deg, rgba(0, 194, 255, 0.12), transparent 34%),
        radial-gradient(circle at 80% 20%, rgba(255, 196, 87, 0.16), transparent 28%),
        #111318;
    }
    main {
      width: min(620px, calc(100vw - 32px));
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 28px;
      background: rgba(18, 22, 30, 0.92);
      box-shadow: 0 18px 45px rgba(0, 0, 0, 0.28);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 8px;
      margin-bottom: 18px;
      background: #00c2ff;
      color: #101318;
      font-weight: 900;
      letter-spacing: 0.04em;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 28px;
      line-height: 1.15;
      letter-spacing: 0;
    }
    p {
      margin: 0 0 14px;
      color: #cbd5e1;
      line-height: 1.55;
    }
    ul {
      margin: 0 0 16px 20px;
      padding: 0;
      color: #cbd5e1;
      line-height: 1.55;
    }
    li {
      margin: 0 0 8px;
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 18px;
    }
    .links a {
      color: #7ddcff;
      text-decoration: none;
      font-weight: 700;
    }
    a.button {
      display: inline-flex;
      align-items: center;
      min-height: 42px;
      padding: 0 16px;
      border-radius: 6px;
      background: #00c2ff;
      color: #101318;
      text-decoration: none;
      font-weight: 800;
      margin-top: 8px;
    }
    code {
      color: #fff;
      background: rgba(255, 255, 255, 0.08);
      padding: 2px 6px;
      border-radius: 5px;
    }
  </style>
</head>
<body>
  <main>
    <div class="badge">CA</div>
    ${body}
  </main>
</body>
</html>`
  };
}

function sendHtml(res, page) {
  res.status(page.status).set("Content-Type", "text/html; charset=utf-8").send(page.html);
}

function retryButton(config) {
  return `<a class="button" href="${escapeHtml(config.publicBaseUrl)}/start">Try Again</a>`;
}

function retryButtonFromRequest(req) {
  let href = "/start";

  try {
    href = `${normalizeBaseUrl(env("PUBLIC_BASE_URL", getRequestBaseUrl(req)), "PUBLIC_BASE_URL")}/start`;
  } catch {}

  return `<a class="button" href="${escapeHtml(href)}">Try Again</a>`;
}

function setupList(config) {
  const robloxStatus = config.robloxClientId
    ? "Roblox verification is enabled."
    : "Roblox verification is disabled until ROBLOX_CLIENT_ID and ROBLOX_CLIENT_SECRET are set in Vercel.";

  return `
    <p>Use these exact values:</p>
    <p><strong>Bot Verify URL</strong><br><code>${escapeHtml(config.publicBaseUrl)}/start</code></p>
    <p><strong>Discord OAuth2 Redirect</strong><br><code>${escapeHtml(config.redirectUri)}</code></p>
    <p><strong>Roblox OAuth2 Redirect</strong><br><code>${escapeHtml(config.robloxRedirectUri)}</code></p>
    <p><strong>Privacy Policy URL</strong><br><code>${escapeHtml(config.publicBaseUrl)}/privacy</code></p>
    <p><strong>Terms of Service URL</strong><br><code>${escapeHtml(config.publicBaseUrl)}/terms</code></p>
    <p>In Discord Developer Portal, paste the redirect URL exactly under <strong>OAuth2 - Redirects</strong>.</p>
    <p>In Roblox Creator Dashboard, paste the Roblox redirect URL exactly in your OAuth app redirect URLs.</p>
    <p>${escapeHtml(robloxStatus)}</p>
  `;
}

function policyLinks(config) {
  return `
    <div class="links">
      <a href="${escapeHtml(config.publicBaseUrl)}/start">Verify</a>
      <a href="${escapeHtml(config.publicBaseUrl)}/privacy">Privacy Policy</a>
      <a href="${escapeHtml(config.publicBaseUrl)}/terms">Terms of Service</a>
      <a href="${escapeHtml(config.publicBaseUrl)}/setup">Setup</a>
    </div>
  `;
}

function privacyPolicyBody(config) {
  return `
    <h1>Privacy Policy</h1>
    <p><strong>Effective date:</strong> June 22, 2026</p>
    <p>CALFX Verification is used by California State Roleplay to verify Discord members and optionally connect their Roblox account for server access.</p>

    <p><strong>Information we collect</strong></p>
    <ul>
      <li>Discord account ID, username, avatar, and basic profile information provided by Discord OAuth.</li>
      <li>Roblox user ID, username, display name, profile link, and avatar information provided by Roblox OAuth when Roblox verification is enabled.</li>
      <li>Server verification actions, such as roles added, roles removed, and nickname updates.</li>
    </ul>

    <p><strong>How we use information</strong></p>
    <ul>
      <li>To verify that you control the Discord and Roblox accounts used for CALFX access.</li>
      <li>To remove the Unverified role and add the Verified and CALFX Member roles.</li>
      <li>To update your Discord server nickname to your Roblox username when Roblox verification is completed.</li>
      <li>To send you a Discord DM confirming the verification result.</li>
    </ul>

    <p><strong>What we do not collect</strong></p>
    <ul>
      <li>We do not collect your Discord password or Roblox password.</li>
      <li>We do not read your Discord messages through this verification site.</li>
      <li>We do not sell your information.</li>
    </ul>

    <p><strong>Third-party services</strong></p>
    <p>This service uses Discord OAuth, Roblox OAuth, and Vercel hosting. Their own privacy policies also apply when you authorize through their platforms.</p>

    <p><strong>Data retention</strong></p>
    <p>The verification site does not intentionally store a permanent database of your OAuth profile. Discord roles, nickname changes, DMs, and temporary hosting logs may remain on Discord, Roblox, or Vercel according to those services' systems.</p>

    <p><strong>Contact</strong></p>
    <p>For questions or removal requests, contact CALFX Management through the California State Roleplay Discord server.</p>
    ${policyLinks(config)}
  `;
}

function termsBody(config) {
  return `
    <h1>Terms of Service</h1>
    <p><strong>Effective date:</strong> June 22, 2026</p>
    <p>By using CALFX Verification, you agree to these terms.</p>

    <p><strong>Purpose</strong></p>
    <p>CALFX Verification is provided to verify Discord server members and optionally connect Roblox account information for California State Roleplay access.</p>

    <p><strong>User requirements</strong></p>
    <ul>
      <li>You must use your own Discord and Roblox accounts.</li>
      <li>You may not impersonate another person or attempt to bypass server moderation.</li>
      <li>You must follow Discord, Roblox, and California State Roleplay rules while using this service.</li>
    </ul>

    <p><strong>Permissions</strong></p>
    <p>When you authorize the service, Discord and Roblox may share basic profile information with CALFX Verification. The bot may update your Discord server roles and nickname as part of verification.</p>

    <p><strong>Availability</strong></p>
    <p>The service is provided as-is and may be unavailable during maintenance, hosting issues, Discord issues, Roblox issues, or configuration changes.</p>

    <p><strong>Misuse</strong></p>
    <p>CALFX Management may deny, remove, or review verification access if the service is misused or if account information appears incorrect, unsafe, or abusive.</p>

    <p><strong>Changes</strong></p>
    <p>These terms may be updated as the verification system changes. Continued use of the service means you accept the updated terms.</p>

    <p><strong>Contact</strong></p>
    <p>For questions, contact CALFX Management through the California State Roleplay Discord server.</p>
    ${policyLinks(config)}
  `;
}

async function discordRequest(path, options = {}) {
  const response = await fetch(`${DISCORD_API}${path}`, options);
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }

  if (!response.ok) {
    const details = data && typeof data === "object" && data.errors
      ? ` Details: ${JSON.stringify(data.errors).slice(0, 800)}`
      : "";
    const apiError = data && typeof data === "object"
      ? data.error_description || data.error || data.message
      : data;
    const message = apiError || response.statusText || "Discord API request failed";
    throw new Error(`${message} (${response.status})${details}`);
  }

  return data;
}

async function robloxRequest(path, options = {}) {
  const response = await fetch(`${ROBLOX_API}${path}`, options);
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text || null;
  }

  if (!response.ok) {
    const apiError = data && typeof data === "object"
      ? data.error_description || data.error || data.message
      : data;
    const message = apiError || response.statusText || "Roblox API request failed";
    throw new Error(`${message} (${response.status})`);
  }

  return data;
}

async function exchangeCodeForToken(config, code) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri
  });

  return discordRequest("/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
}

async function exchangeRobloxCodeForToken(config, code) {
  const body = new URLSearchParams({
    client_id: config.robloxClientId,
    client_secret: config.robloxClientSecret,
    grant_type: "authorization_code",
    code
  });

  return robloxRequest("/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
}

async function getDiscordUser(accessToken) {
  return discordRequest("/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

async function getRobloxUser(accessToken) {
  return robloxRequest("/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

async function getGuildMember(config, userId) {
  return discordRequest(`/guilds/${config.guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${config.botToken}` }
  });
}

async function addGuildRole(config, userId, roleId) {
  await discordRequest(`/guilds/${config.guildId}/members/${userId}/roles/${roleId}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${config.botToken}` }
  });
}

async function removeGuildRole(config, userId, roleId) {
  await discordRequest(`/guilds/${config.guildId}/members/${userId}/roles/${roleId}`, {
    method: "DELETE",
    headers: { Authorization: `Bot ${config.botToken}` }
  });
}

async function updateGuildNickname(config, userId, nickname) {
  await discordRequest(`/guilds/${config.guildId}/members/${userId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${config.botToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ nick: nickname })
  });
}

async function createDmChannel(config, userId) {
  return discordRequest("/users/@me/channels", {
    method: "POST",
    headers: {
      Authorization: `Bot ${config.botToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ recipient_id: userId })
  });
}

async function sendDiscordDm(config, userId, content) {
  const channel = await createDmChannel(config, userId);

  return discordRequest(`/channels/${channel.id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${config.botToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] }
    })
  });
}

function isRobloxConfigured(config) {
  return Boolean(config.robloxClientId && config.robloxClientSecret);
}

function formatList(items) {
  return items.length ? items.map(item => `- ${item}`).join("\n") : "- None";
}

async function finalizeVerification(config, discordUser, robloxUser = null) {
  const rolesAdded = [];
  const rolesRemoved = [];
  const warnings = [];

  try {
    await getGuildMember(config, discordUser.id);
  } catch (error) {
    if (String(error.message || "").includes("(404)")) {
      throw new Error("You need to join the CALFX Discord server before verifying.");
    }

    throw error;
  }

  await removeGuildRole(config, discordUser.id, config.unverifiedRoleId)
    .then(() => rolesRemoved.push("Unverified"))
    .catch(error => warnings.push(`Could not remove Unverified: ${error.message}`));

  await addGuildRole(config, discordUser.id, config.verifiedRoleId)
    .then(() => rolesAdded.push("Verified"))
    .catch(error => {
      throw new Error(`Could not add the verified role. Check the bot has Manage Roles and its role is above the verified role. Discord said: ${error.message}`);
    });

  await addGuildRole(config, discordUser.id, config.memberRoleId)
    .then(() => rolesAdded.push("CALFX Member"))
    .catch(error => {
      throw new Error(`Could not add the CALFX Member role. Check the bot has Manage Roles and its role is above the member role. Discord said: ${error.message}`);
    });

  const robloxUsername = robloxUser?.preferred_username || robloxUser?.name || robloxUser?.nickname || "";

  if (robloxUsername) {
    await updateGuildNickname(config, discordUser.id, robloxUsername.slice(0, 32))
      .catch(error => warnings.push(`Could not update nickname to ${robloxUsername}: ${error.message}`));
  }

  const dmLines = [
    "You have been verified.",
    "",
    "Roles added:",
    formatList(rolesAdded),
    "",
    "Roles removed:",
    formatList(rolesRemoved)
  ];

  if (robloxUsername) {
    dmLines.push("", `Roblox username: ${robloxUsername}`);
  }

  if (warnings.length) {
    dmLines.push("", "Notes:", formatList(warnings));
  }

  await sendDiscordDm(config, discordUser.id, dmLines.join("\n"))
    .catch(error => console.warn(`Could not DM ${discordUser.id}:`, error.message));

  return { rolesAdded, rolesRemoved, warnings, robloxUsername };
}

const app = express();

app.get("/", (req, res) => {
  res.redirect("/start");
});

app.get("/setup", (req, res) => {
  try {
    const config = getConfig(req);
    return sendHtml(res, htmlPage("CALFX Verification Setup", `
      <h1>Verification Setup</h1>
      ${setupList(config)}
      <a class="button" href="${escapeHtml(config.publicBaseUrl)}/start">Test Verification</a>
    `));
  } catch (error) {
    return sendHtml(res, htmlPage("Verification Setup Needed", `
      <h1>Verification Setup Needed</h1>
      <p>${escapeHtml(error.message || error)}</p>
    `, 500));
  }
});

app.get("/privacy", (req, res) => {
  try {
    const config = getConfig(req);
    return sendHtml(res, htmlPage("Privacy Policy", privacyPolicyBody(config)));
  } catch (error) {
    return sendHtml(res, htmlPage("Privacy Policy", `
      <h1>Privacy Policy</h1>
      <p>${escapeHtml(error.message || error)}</p>
    `, 500));
  }
});

app.get("/terms", (req, res) => {
  try {
    const config = getConfig(req);
    return sendHtml(res, htmlPage("Terms of Service", termsBody(config)));
  } catch (error) {
    return sendHtml(res, htmlPage("Terms of Service", `
      <h1>Terms of Service</h1>
      <p>${escapeHtml(error.message || error)}</p>
    `, 500));
  }
});

app.get("/start", (req, res) => {
  try {
    const config = getConfig(req);
    const state = createOAuthState(config);

    const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("scope", "identify");
    authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("prompt", "consent");

    res.redirect(authorizeUrl.toString());
  } catch (error) {
    console.error("Verification start failed:", error);
    sendHtml(res, htmlPage("Verification Setup Needed", `
      <h1>Verification Setup Needed</h1>
      <p>${escapeHtml(error.message || error)}</p>
      <p>Set the Vercel environment variables, then redeploy the project.</p>
    `, 500));
  }
});

app.get("/callback", async (req, res) => {
  try {
    const config = getConfig(req);
    const { code, state } = req.query;

    if (!code) {
      return sendHtml(res, htmlPage("Verification Failed", `
        <h1>Verification Failed</h1>
        <p>Discord did not return a verification code. Please start again from the verification button.</p>
        ${retryButton(config)}
      `, 400));
    }

    const stateData = readOAuthState(config, state);

    if (stateData?.redirectUri) {
      config.redirectUri = stateData.redirectUri;
    } else {
      console.warn("OAuth state was missing or invalid. Continuing because Discord returned a valid authorization code.");
    }

    const token = await exchangeCodeForToken(config, String(code));
    const user = await getDiscordUser(token.access_token);

    if (isRobloxConfigured(config)) {
      const robloxState = createRobloxOAuthState(config, {
        id: user.id,
        username: user.username
      });

      const authorizeUrl = new URL(`${ROBLOX_API}/authorize`);
      authorizeUrl.searchParams.set("client_id", config.robloxClientId);
      authorizeUrl.searchParams.set("redirect_uri", config.robloxRedirectUri);
      authorizeUrl.searchParams.set("scope", "openid profile");
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("state", robloxState);
      authorizeUrl.searchParams.set("nonce", crypto.randomBytes(18).toString("base64url"));
      authorizeUrl.searchParams.set("prompt", "select_account");

      return res.redirect(authorizeUrl.toString());
    }

    const result = await finalizeVerification(config, user);

    return sendHtml(res, htmlPage("Verified", `
      <h1>Verification Complete</h1>
      <p>You are verified as <strong>${escapeHtml(user.username)}</strong>.</p>
      <p>Roles added: ${escapeHtml(result.rolesAdded.join(", ") || "None")}</p>
      <p>Roles removed: ${escapeHtml(result.rolesRemoved.join(", ") || "None")}</p>
      <p>You can return to Discord now.</p>
    `));
  } catch (error) {
    console.error("Verification callback failed:", error);
    return sendHtml(res, htmlPage("Verification Failed", `
      <h1>Verification Failed</h1>
      <p>${escapeHtml(error.message || error)}</p>
      <p>Make sure you are in the CALFX Discord server and the bot role is above the verification roles.</p>
      ${retryButtonFromRequest(req)}
    `, 500));
  }
});

app.get("/roblox/callback", async (req, res) => {
  try {
    const config = getConfig(req);

    if (!isRobloxConfigured(config)) {
      throw new Error("Roblox OAuth is not configured. Set ROBLOX_CLIENT_ID and ROBLOX_CLIENT_SECRET in Vercel.");
    }

    const { code, state } = req.query;
    const stateData = readOAuthState(config, state);

    if (!code || !stateData || stateData.flow !== "roblox" || !stateData.discordUserId) {
      return sendHtml(res, htmlPage("Verification Failed", `
        <h1>Verification Failed</h1>
        <p>The Roblox verification request expired or was opened incorrectly.</p>
        ${retryButton(config)}
      `, 400));
    }

    const token = await exchangeRobloxCodeForToken(config, String(code));
    const robloxUser = await getRobloxUser(token.access_token);
    const discordUser = {
      id: stateData.discordUserId,
      username: stateData.discordUsername || "Discord user"
    };
    const result = await finalizeVerification(config, discordUser, robloxUser);

    return sendHtml(res, htmlPage("Verified", `
      <h1>Verification Complete</h1>
      <p>You are verified with Discord and Roblox.</p>
      <p>Roblox username: <strong>${escapeHtml(result.robloxUsername || "Unknown")}</strong></p>
      <p>Roles added: ${escapeHtml(result.rolesAdded.join(", ") || "None")}</p>
      <p>Roles removed: ${escapeHtml(result.rolesRemoved.join(", ") || "None")}</p>
      <p>You can close this tab now.</p>
      <script>setTimeout(() => window.close(), 3500);</script>
    `));
  } catch (error) {
    console.error("Roblox verification callback failed:", error);
    return sendHtml(res, htmlPage("Verification Failed", `
      <h1>Verification Failed</h1>
      <p>${escapeHtml(error.message || error)}</p>
      <p>Make sure the Roblox OAuth redirect in Creator Dashboard exactly matches the setup page.</p>
      ${retryButtonFromRequest(req)}
    `, 500));
  }
});


module.exports = app;
