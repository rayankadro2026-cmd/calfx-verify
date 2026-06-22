const crypto = require("crypto");
const express = require("express");

const DISCORD_API = "https://discord.com/api/v10";
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function requiredEnv(name) {
  const value = env(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function getConfig() {
  const publicBaseUrl = requiredEnv("PUBLIC_BASE_URL").replace(/\/+$/, "");

  return {
    clientId: requiredEnv("DISCORD_CLIENT_ID"),
    clientSecret: requiredEnv("DISCORD_CLIENT_SECRET"),
    botToken: requiredEnv("DISCORD_BOT_TOKEN"),
    guildId: requiredEnv("DISCORD_GUILD_ID"),
    unverifiedRoleId: requiredEnv("UNVERIFIED_ROLE_ID"),
    verifiedRoleId: requiredEnv("VERIFIED_ROLE_ID"),
    memberRoleId: requiredEnv("MEMBER_ROLE_ID"),
    redirectUri: env("DISCORD_REDIRECT_URI", `${publicBaseUrl}/callback`),
    publicBaseUrl
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

function createOAuthState(config) {
  const issuedAt = Date.now().toString(36);
  const nonce = crypto.randomBytes(18).toString("base64url");
  const payload = `${issuedAt}.${nonce}`;
  return `${payload}.${signState(config, payload)}`;
}

function isValidOAuthState(config, state) {
  const parts = String(state || "").split(".");
  if (parts.length !== 3) return false;

  const [issuedAt, nonce, signature] = parts;
  const issuedAtMs = Number.parseInt(issuedAt, 36);
  const ageMs = Date.now() - issuedAtMs;

  if (!Number.isFinite(issuedAtMs) || ageMs < -60_000 || ageMs > STATE_MAX_AGE_MS) {
    return false;
  }

  const expected = signState(config, `${issuedAt}.${nonce}`);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
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

async function discordRequest(path, options = {}) {
  const response = await fetch(`${DISCORD_API}${path}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || response.statusText || "Discord API request failed";
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

async function getDiscordUser(accessToken) {
  return discordRequest("/users/@me", {
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

const app = express();

app.get("/", (req, res) => {
  res.redirect("/start");
});

app.get("/start", (req, res) => {
  try {
    const config = getConfig();
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
    const config = getConfig();
    const { code, state } = req.query;

    if (!code || !state || !isValidOAuthState(config, state)) {
      return sendHtml(res, htmlPage("Verification Failed", `
        <h1>Verification Failed</h1>
        <p>The verification request expired or was opened incorrectly.</p>
        <a class="button" href="/start">Try Again</a>
      `, 400));
    }

    const token = await exchangeCodeForToken(config, String(code));
    const user = await getDiscordUser(token.access_token);

    try {
      await getGuildMember(config, user.id);
    } catch (error) {
      if (String(error.message || "").includes("(404)")) {
        return sendHtml(res, htmlPage("Verification Failed", `
          <h1>Verification Failed</h1>
          <p>You need to join the CALFX Discord server before verifying.</p>
          <a class="button" href="/start">Try Again</a>
        `, 400));
      }

      throw error;
    }

    await removeGuildRole(config, user.id, config.unverifiedRoleId).catch(error => {
      console.warn(`Could not remove unverified role from ${user.id}:`, error.message);
    });
    await addGuildRole(config, user.id, config.verifiedRoleId).catch(error => {
      throw new Error(`Could not add the verified role. Check the bot has Manage Roles and its role is above the verified role. Discord said: ${error.message}`);
    });
    await addGuildRole(config, user.id, config.memberRoleId).catch(error => {
      throw new Error(`Could not add the CALFX Member role. Check the bot has Manage Roles and its role is above the member role. Discord said: ${error.message}`);
    });

    return sendHtml(res, htmlPage("Verified", `
      <h1>Verification Complete</h1>
      <p>You are verified as <strong>${escapeHtml(user.username)}</strong>.</p>
      <p>You can return to Discord now.</p>
    `));
  } catch (error) {
    console.error("Verification callback failed:", error);
    return sendHtml(res, htmlPage("Verification Failed", `
      <h1>Verification Failed</h1>
      <p>${escapeHtml(error.message || error)}</p>
      <p>Make sure you are in the CALFX Discord server and the bot role is above the verification roles.</p>
      <a class="button" href="/start">Try Again</a>
    `, 500));
  }
});


module.exports = app;
