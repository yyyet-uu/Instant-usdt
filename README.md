# Instant USDT — simple build

Only 4 files:
- index.html
- api/index.js
- package.json
- .env.example

Important:
1. Put secrets only in Vercel environment variables.
2. Add the Telegram bot as an administrator in @phone_teach and @forex_big so getChatMember can verify users.
3. The payout private key must correspond to PAYOUT_WALLET_ADDRESS.
4. Never commit PRIVATE_KEY_WALLET or TELEGRAM_BOT_TOKEN to GitHub.
5. AdsBitvex App ID is 000409.
6. Deploy at https://instant-usdt.vercel.app and configure the Telegram Main Mini App URL to that address.
