# Instant USDT — clean final build

Files:
- index.html
- api/index.js
- package.json
- vercel.json
- .env.example
- README.md

Vercel:
- Framework Preset: Other
- Root Directory: ./
- Build Command: empty
- Output Directory: empty
- Install Command: npm install

Required:
- @FastInstant_usdt_bot must be administrator in @phone_teach and @forex_big.
- Add the real secrets only in Vercel Environment Variables.
- Never put PRIVATE_KEY_WALLET or TELEGRAM_BOT_TOKEN in GitHub.
- The payout wallet must contain enough BSC USDT and BNB for gas.
- Set the Telegram Mini App URL to https://instant-usdt.vercel.app.
- Set the bot webhook to https://instant-usdt.vercel.app/api if using the included /start webhook handler.

Mission order:
1. Join both channels.
2. Invite 3 users; each counts only after completing Mission One.
3. 50 AdsBitvex ads, App ID 000409.
4. 50 AdsBitvex ads, App ID 000409.
5. Mystery Box → spin → fixed 0.10 USDT reward → BEP-20 address → server-side payout.

Sponsor:
- $2 USDT on BSC to SPONSOR_PAYMENT_ADDRESS.
- Bot must be administrator in submitted channel.
- Backend checks the BSC transaction and the bot's admin status.

Security:
- All mission/reward state is server-side.
- Frontend cannot directly set mission completion or payout status.
- AdsBitvex completion is based on the SDK Promise plus a short-lived server ad session and minimum elapsed time. The ad network itself remains the source of truth for the ad impression.
