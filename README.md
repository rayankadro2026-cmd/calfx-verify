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
DISCORD_CLIENT_ID=your_discord_application_client_id
DISCORD_CLIENT_SECRET=your_discord_application_client_secret
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_GUILD_ID=your_server_id
UNVERIFIED_ROLE_ID=1498362369053556968
VERIFIED_ROLE_ID=your_verified_role_id
MEMBER_ROLE_ID=1498355879387332648
ROBLOX_CLIENT_ID=your_roblox_oauth_client_id
ROBLOX_CLIENT_SECRET=your_roblox_oauth_client_secret
```

## Discord Developer Portal

Add this exact redirect URL:

```txt
https://YOUR_VERCEL_PROJECT.vercel.app/callback
```

You can open this page after deployment to see the exact values:

```txt
https://YOUR_VERCEL_PROJECT.vercel.app/setup
```

The setup page also shows the Roblox OAuth redirect URL:

```txt
https://YOUR_VERCEL_PROJECT.vercel.app/roblox/callback
```

The OAuth scope is:

```txt
identify
```

## Roblox Creator Dashboard

Create an OAuth app, add the `openid` and `profile` identity scopes, then add this exact redirect URL:

```txt
https://YOUR_VERCEL_PROJECT.vercel.app/roblox/callback
```

Use these URLs if Roblox asks for app links:

```txt
Entry Link:
https://YOUR_VERCEL_PROJECT.vercel.app

Roblox OAuth Review/Test Link:
https://YOUR_VERCEL_PROJECT.vercel.app/roblox/start

Privacy Policy URL:
https://YOUR_VERCEL_PROJECT.vercel.app/privacy

Terms of Service URL:
https://YOUR_VERCEL_PROJECT.vercel.app/terms
```

Use the root URL as the Roblox app entry link. It opens a public landing page with a clear Start Verification button, Privacy Policy, Terms of Service, and a Roblox OAuth Test button for reviewers. Do not use `/start`, `/callback`, or `/roblox/callback` as the app entry link.

Put the Roblox OAuth client ID and secret into Vercel as `ROBLOX_CLIENT_ID` and `ROBLOX_CLIENT_SECRET`. If those two variables are not set, the site will still complete Discord verification without Roblox.

## Bot Hosting Setting

Set this in your Discord bot hosting environment:

```env
DISCORD_VERIFY_URL=https://YOUR_VERCEL_PROJECT.vercel.app
```

Restart the bot after changing it.

Do not set `DISCORD_REDIRECT_URI` in Vercel. The site builds the callback URL from `PUBLIC_BASE_URL`.

## Important Permissions

The bot must have:

- Manage Roles
- Bot role above Unverified role
- Bot role above Verified role
- Bot role above CALFX Member role
- Manage Nicknames, if you want the bot to rename members to their Roblox username

Do not share:

- `DISCORD_BOT_TOKEN`
- `DISCORD_CLIENT_SECRET`
- `ROBLOX_CLIENT_SECRET`

## Local Test

From this folder:

```bash
npm install
npm run dev
```
