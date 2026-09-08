# Instant USDT — final clean build

## Files
- `index.html` — Telegram Mini App UI
- `api/index.js` — Vercel API, Telegram verification, missions, sponsor verification, payout and webhook
- `package.json`
- `.env.example`
- `vercel.json`

## Mission flow
1. Mission One: join `@phone_teach` and `@forex_big`. The Mini App does **not** display the usernames; it only shows Channel 1 / Channel 2. The **Add Sponsor** button exists only on Mission One.
2. Mission Two: invite 3 users. A referral counts only after the invited user completes Mission One.
3. Mission Three: complete 50 Monetag rewarded ads.
4. Mission Four: complete exactly 15 Monetag ads + 10 AdsBitvex ads (25 total).
5. USDT Box appears directly under the missions and unlocks after Mission Four. The visual spin ends at 0.10 USDT.
6. User enters a BEP-20 address and the backend sends 0.10 USDT from the payout wallet.

## Ad setup
### AdsBitvex
App ID is `000409`. The frontend loads:
`https://sdk.adsbitvex.com/functions/v1/ad-script?appid=000409`

### AdsGram
Create/approve a **Reward** ad block in AdsGram and put its numeric Block ID into `ADSGRAM_BLOCK_ID`. The app uses the official SDK script `https://sad.adsgram.ai/js/sad.min.js` and `Adsgram.init({blockId})`.

### Monetag
Put your exact Monetag TMA SDK script URL in `MONETAG_SDK_URL` and the main Monetag zone ID in `MONETAG_ZONE_ID`. The frontend loads the script with `data-zone` and `data-sdk="show_<zone>"` and calls the rewarded/end flow.

## Telegram bot start message + Open button
The backend already handles Telegram `/start` updates and sends a welcome message with an **Open Instant USDT** Web App button.

After deployment, set the Telegram webhook once using your bot token privately (do not put the token in GitHub):
`https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://instant-usdt.vercel.app/api`

Then open the bot and press `/start`. It should send the welcome message and Open button.

Set BotFather Main Mini App URL to:
`https://instant-usdt.vercel.app`

## Vercel
- Framework Preset: **Other**
- Root Directory: `./`
- Install Command: `npm install`
- Build Command: leave default/empty
- Output Directory: leave default/empty

Add every variable from `.env.example` to Vercel Environment Variables. Never commit real Telegram/Firebase/private-key secrets.

## Firebase / Telegram
The bot must be an administrator in both required channels so `getChatMember` can reliably verify membership.

## Payout
The signer private key is only read by `api/index.js` from `PRIVATE_KEY_WALLET`. The code checks that the signer address matches `PAYOUT_WALLET_ADDRESS`, then sends exactly 0.10 BSC USDT. Keep BNB in the payout wallet for gas and test with a small amount before production.

## Device anti-multi-account check

When the Mini App opens, it now runs a device security check before loading the app. A device is bound to the first Telegram account that uses it. If another Telegram account tries to open the app on the same device/browser, access is blocked. The app uses a random device ID plus a SHA-256 browser/device fingerprint; the fingerprint also helps detect a second account after local storage/cookies are cleared.

This is anti-abuse protection, not a guaranteed hardware identity system. Telegram does not expose a permanent hardware ID to Mini Apps, so determined users may still evade device checks by changing the device/browser environment.
