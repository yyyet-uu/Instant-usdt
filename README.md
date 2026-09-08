# Instant USDT — simple Vercel build

Only 5 files are included:
- `index.html`
- `api/index.js`
- `package.json`
- `.env.example`
- `README.md`

## Required environment variables
Copy the variables from `.env.example` into Vercel. Never commit real secrets to GitHub.

## Telegram setup
1. Create `@FastInstant_usdt_bot` with @BotFather.
2. Set the Mini App URL to `https://instant-usdt.vercel.app`.
3. Set the bot webhook to `https://instant-usdt.vercel.app/api`.
4. Add the bot as an administrator in `@phone_teach` and `@forex_big` so membership can be verified.

## Missions
1. Mission One: join both required channels.
2. Mission Two: invite 3 users; each referral counts only after the invited user completes Mission One.
3. Mission Three: 50 AdsBitvex reward ads.
4. Mission Four: 50 AdsBitvex reward ads.
5. Mystery Box unlocks only after all four missions are complete. The wheel animation always ends on 0.10, then the user enters a BEP-20 address for the automatic payout.

## AdsBitvex
The app uses AdsBitvex App ID `000409` and the official reward-ad SDK. The frontend records progress only after the SDK Promise resolves; the backend additionally requires a short-lived ad session and minimum elapsed time. This is not a cryptographic proof of ad viewing because AdsBitvex's public SDK integration exposes completion through the client-side Promise.

## Sponsor
The Add Sponsor page expects a configured `SPONSOR_PAYMENT_ADDRESS`. The backend checks for a confirmed 2 USDT BEP-20 transfer to that address and checks that the Instant USDT bot is an administrator of the submitted channel.

## Payout security
`PRIVATE_KEY_WALLET` is server-only. It must never be placed in GitHub or frontend code. The backend checks that the signing wallet matches `PAYOUT_WALLET_ADDRESS` before sending the fixed reward.
