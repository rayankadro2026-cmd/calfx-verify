# CALFX Discord OAuth Verification on Vercel

This folder is a Vercel-ready Discord OAuth verification site.

## What It Does

1. User clicks Verify in Discord.
2. Vercel site opens Discord OAuth.
3. Discord shows the consent screen for CALFX Management.
4. Callback receives the Discord user ID.
5. Site removes Unverified role.
6. Site adds Verified role.
7. Site adds CALFX Member role.

## Vercel Project Settings

Deploy this folder as the Vercel project root:

```txt
discord-oauth-verify
```

Use these environment variables in Vercel:

```env
PUBLIC_BASE_URL=https://YOUR_VERCEL_PROJECT.vercel.app
DISCORD_REDIRECT_URI=https://YOUR_VERCEL_PROJECT.vercel.app/callback
DISCORD_CLIENT_ID=your_discord_application_client_id
DISCORD_CLIENT_SECRET=your_discord_application_client_secret
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_GUILD_ID=your_server_id
UNVERIFIED_ROLE_ID=1498362369053556968
VERIFIED_ROLE_ID=your_verified_role_id
MEMBER_ROLE_ID=1498355879387332648
```

## Discord Developer Portal

Add this exact redirect URL:

```txt
https://YOUR_VERCEL_PROJECT.vercel.app/callback
```

The OAuth scope is:

```txt
identify
```

## Bot Hosting Setting

Set this in your Discord bot hosting environment:

```env
DISCORD_VERIFY_URL=https://YOUR_VERCEL_PROJECT.vercel.app/start
```

Restart the bot after changing it.

## Important Permissions

The bot must have:

- Manage Roles
- Bot role above Unverified role
- Bot role above Verified role
- Bot role above CALFX Member role

Do not share:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_SECRET`

## Local Test

From this folder:

```bash
npm install
npm run dev
```
