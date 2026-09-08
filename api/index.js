const crypto = require("crypto");
const admin = require("firebase-admin");
const { ethers } = require("ethers");

let firestore = null;

const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955";
const DEFAULT_PAYOUT = "0xDb1e63101a47Cc8A495de9608ECBd6e436309A1f";

function db() {
  if (firestore) return firestore;
  if (!admin.apps.length) {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey
      })
    });
  }
  firestore = admin.firestore();
  return firestore;
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function telegramVerify(initData) {
  if (!initData) throw new Error("Open Instant USDT from Telegram.");
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) throw new Error("Telegram session is invalid.");

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key !== "hash") pairs.push(`${key}=${value}`);
  }
  pairs.sort();

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.TELEGRAM_BOT_TOKEN || "")
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secret)
    .update(pairs.join("\n"))
    .digest("hex");

  if (receivedHash.length !== calculatedHash.length ||
      !crypto.timingSafeEqual(Buffer.from(receivedHash), Buffer.from(calculatedHash))) {
    throw new Error("Telegram session verification failed.");
  }

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > 86400) {
    throw new Error("Telegram session expired. Reopen the Mini App.");
  }

  const user = JSON.parse(params.get("user") || "{}");
  if (!user.id) throw new Error("Telegram user not found.");

  return { user, params };
}


function normalizeDeviceId(value) {
  const v = String(value || '').trim();
  if (!/^[a-fA-F0-9-]{20,100}$/.test(v)) throw new Error('Device check data is invalid. Please reopen the Mini App.');
  return v;
}

function normalizeFingerprint(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(v)) throw new Error('Device fingerprint is invalid. Please reopen the Mini App.');
  return v;
}

async function deviceCheck(userId, deviceId, fingerprint) {
  const uid = String(userId);
  const did = normalizeDeviceId(deviceId);
  const fp = normalizeFingerprint(fingerprint);
  const devices = db().collection('devices');
  const ref = devices.doc(did);

  await db().runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    if (!snap.exists) {
      transaction.set(ref, {
        deviceId: did,
        fingerprint: fp,
        uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return;
    }
    const data = snap.data() || {};
    if (String(data.uid || '') !== uid) {
      throw new Error('This device is already linked to another Telegram account. Multiple Telegram accounts are not allowed.');
    }
    transaction.update(ref, { lastSeenAt: admin.firestore.FieldValue.serverTimestamp(), fingerprint: fp });
  });

  // Also check the stable browser fingerprint. This catches a second Telegram
  // account after the user clears local storage or cookies.
  const matches = await devices.where('fingerprint', '==', fp).limit(5).get();
  for (const doc of matches.docs) {
    const data = doc.data() || {};
    if (String(data.uid || '') !== uid) {
      throw new Error('This device is already linked to another Telegram account. Multiple Telegram accounts are not allowed.');
    }
  }

  return { allowed: true };
}

function userRef(uid) {
  return db().collection("users").doc(String(uid));
}

async function ensureUser(user, startParam) {
  const ref = userRef(user.id);
  const snap = await ref.get();
  if (!snap.exists) {
    let referredBy = null;
    if (startParam && startParam.startsWith("ref_")) {
      const candidate = startParam.slice(4);
      if (candidate && candidate !== String(user.id)) referredBy = candidate;
    }
    await ref.set({
      uid: String(user.id),
      username: user.username || "",
      firstName: user.first_name || "",
      mission1: false,
      mission2: false,
      mission3: false,
      mission4: false,
      referrals: 0,
      ad3: 0,
      ad3AdsBitvex: 0,
      ad4: 0,
      ad4AdsBitvex: 0,
      ad4Adsgram: 0,
      referredBy,
      referralQualified: false,
      spun: false,
      withdrawn: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Notify the inviter immediately when a genuinely new referred user opens
    // the Mini App for the first time. The referral is only counted later
    // when that user completes the first step.
    if (referredBy) {
      try {
        const invitedName = user.first_name || user.username || `User ${user.id}`;
        await telegramCall("sendMessage", {
          chat_id: referredBy,
          text: `🎉 NEW INVITED USER!\n\n👤 ${invitedName} just opened Instant USDT using your invite link.\n\n⏳ Your referral will be counted after they complete Mission One.\n\n👥 Keep inviting friends to reach 3 referrals and reach the second key!`
        });
      } catch (notifyError) {
        console.error("Referral notification failed:", notifyError.message);
      }
    }
  } else if (startParam && startParam.startsWith("ref_") && !snap.data().referredBy) {
    const candidate = startParam.slice(4);
    if (candidate && candidate !== String(user.id)) {
      await ref.update({ referredBy: candidate });
    }
  }
  return ref;
}

async function stateFor(uid) {
  const ref = userRef(uid);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : {};
  return {
    userId: String(uid),
    mission1: !!data.mission1,
    mission2: !!data.mission2,
    mission3: !!data.mission3,
    mission4: !!data.mission4,
    referrals: Number(data.referrals || 0),
    ad3: Number(data.ad3 || 0),
    ad3AdsBitvex: Number(data.ad3AdsBitvex || 0),
    ad4: Number(data.ad4 || 0),
    ad4AdsBitvex: Number(data.ad4AdsBitvex || 0),
    ad4Adsgram: Number(data.ad4Adsgram || 0),
    spun: !!data.spun,
    withdrawn: !!data.withdrawn,
    cooldownUntil: data.cooldownUntil ? (data.cooldownUntil.toMillis ? data.cooldownUntil.toMillis() : Number(data.cooldownUntil)) : null
  };
}

async function telegramCall(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await response.json();
  if (!json.ok) throw new Error(json.description || "Telegram API error.");
  return json.result;
}

async function verifyMembership(chat, userId) {
  const member = await telegramCall("getChatMember", {
    chat_id: chat,
    user_id: userId
  });
  return ["creator", "administrator", "member"].includes(member.status) ||
    (member.status === "restricted" && member.is_member === true);
}

async function qualifyReferralFor(userId) {
  const childRef = userRef(userId);
  await db().runTransaction(async transaction => {
    const childSnap = await transaction.get(childRef);
    if (!childSnap.exists) return;
    const child = childSnap.data();
    if (!child.mission1 || child.referralQualified || !child.referredBy) return;

    const parentRef = userRef(child.referredBy);
    const parentSnap = await transaction.get(parentRef);
    if (!parentSnap.exists) {
      transaction.update(childRef, { referralQualified: true });
      return;
    }

    const current = Number(parentSnap.data().referrals || 0);
    const next = Math.min(3, current + 1);
    transaction.update(parentRef, {
      referrals: next,
      mission2: next >= 3
    });
    transaction.update(childRef, { referralQualified: true });
  });
}

async function completeMission1(userId) {
  const one = await verifyMembership(process.env.TELEGRAM_CHANNEL_1, userId);
  const two = await verifyMembership(process.env.TELEGRAM_CHANNEL_2, userId);
  if (!one || !two) {
    return { completed: false, message: "Join both required channels first.", state: await stateFor(userId) };
  }

  const ref = userRef(userId);
  await ref.update({ mission1: true });
  await qualifyReferralFor(userId);

  return { completed: true, message: "Key 1 collected.", state: await stateFor(userId) };
}

async function startAd(userId, mission, provider) {
  const state = await stateFor(userId);
  if (![3, 4].includes(mission)) throw new Error("Invalid ad mission.");
  if (mission === 3 && !state.mission2) throw new Error("Complete Mission Two first.");
  if (mission === 4 && !state.mission3) throw new Error("Complete Mission Three first.");

  const adProvider = String(provider || "").toLowerCase();
  if (mission === 3 && !["monetag", "adsbitvex"].includes(adProvider)) throw new Error("Mission Three uses Monetag and AdsBitvex.");
  if (mission === 4 && !["adsbitvex", "adsgram"].includes(adProvider)) {
    throw new Error("Mission Four uses AdsBitvex and AdsGram.");
  }

  let current = 0;
  if (mission === 3) current = adProvider === "adsbitvex" ? state.ad3AdsBitvex : state.ad3;
  else if (adProvider === "adsbitvex") current = state.ad4AdsBitvex;
  else current = state.ad4Adsgram;

  if (mission === 3 && adProvider === "monetag" && current >= 25) throw new Error("All 25 Monetag ads are complete.");
  if (mission === 3 && adProvider === "adsbitvex" && current >= 6) throw new Error("All 6 AdsBitvex ads are complete.");
  if (mission === 4 && state.ad4 >= 30) throw new Error("Mission Four is already complete.");
  if (mission === 4 && adProvider === "adsbitvex" && current >= 15) throw new Error("All 15 AdsBitvex ads are complete.");
  if (mission === 4 && adProvider === "adsgram" && current >= 15) throw new Error("All 15 AdsGram ads are complete.");

  const id = crypto.randomBytes(18).toString("hex");
  await db().collection("adSessions").doc(id).set({
    uid: String(userId),
    mission,
    provider: adProvider,
    used: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return id;
}

async function completeAd(userId, sessionId, mission, provider, clickConfirmed = false) {
  if (![3, 4].includes(mission) || !sessionId) throw new Error("Invalid ad completion.");
  const adProvider = String(provider || "").toLowerCase();
  if (mission === 3 && !["monetag", "adsbitvex"].includes(adProvider)) throw new Error("Mission Three uses Monetag and AdsBitvex.");
  if (mission === 4 && !["adsbitvex", "adsgram"].includes(adProvider)) throw new Error("Mission Four uses AdsBitvex and AdsGram.");
  
  const ref = db().collection("adSessions").doc(sessionId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Ad session not found.");

  const session = snap.data();
  if (String(session.uid) !== String(userId) || Number(session.mission) !== mission || String(session.provider) !== adProvider || session.used) {
    throw new Error("Ad session is invalid or already used.");
  }

  // The ad provider SDK completion callback is the completion signal.
  // Do not add a client-side timer here: some rewarded SDKs resolve their
  // Promise only after the ad finishes, and a server-time delay can reject
  // legitimate completions due to timing differences.

  await ref.update({ used: true, completedAt: admin.firestore.FieldValue.serverTimestamp() });
  const user = userRef(userId);

  await db().runTransaction(async transaction => {
    const snapUser = await transaction.get(user);
    const data = snapUser.data() || {};
    const patch = {};
    if (mission === 3 && adProvider === "monetag") {
      const count = Math.min(25, Number(data.ad3 || 0) + 1);
      patch.ad3 = count;
    } else if (mission === 3 && adProvider === "adsbitvex") {
      const count = Math.min(6, Number(data.ad3AdsBitvex || 0) + 1);
      patch.ad3AdsBitvex = count;
    }
    if (mission === 3) {
      const monetag = Number(data.ad3 || 0) + (adProvider === "monetag" ? 1 : 0);
      const bitvex = Number(data.ad3AdsBitvex || 0) + (adProvider === "adsbitvex" ? 1 : 0);
      if (monetag >= 25 && bitvex >= 6) patch.mission3 = true;
    } else if (adProvider === "adsbitvex") {
      const count = Math.min(15, Number(data.ad4AdsBitvex || 0) + 1);
      patch.ad4AdsBitvex = count;
      const total = count + Number(data.ad4Adsgram || 0);
      patch.ad4 = Math.min(30, total);
      if (total >= 30) patch.mission4 = true;
    } else {
      const count = Math.min(15, Number(data.ad4Adsgram || 0) + 1);
      patch.ad4Adsgram = count;
      const total = Number(data.ad4AdsBitvex || 0) + count;
      patch.ad4 = Math.min(30, total);
      if (total >= 30) patch.mission4 = true;
    }
    transaction.update(user, patch);
  });

  const state = await stateFor(userId);
  return { count: mission === 3 ? state.ad3 : state.ad4, provider: adProvider, completed: !!state[`mission${mission}`], state };
}

async function sponsorInfo() {
  return {
    address: process.env.SPONSOR_PAYMENT_ADDRESS ||
      process.env.PAYOUT_WALLET_ADDRESS ||
      DEFAULT_PAYOUT
  };
}

async function verifySponsorPayment(txHash) {
  const destination = process.env.SPONSOR_PAYMENT_ADDRESS ||
    process.env.PAYOUT_WALLET_ADDRESS ||
    DEFAULT_PAYOUT;

  if (!ethers.isAddress(destination)) throw new Error("Sponsor payment address is invalid.");
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error("Enter a valid BSC transaction hash.");

  const provider = new ethers.JsonRpcProvider(
    process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org"
  );
  const transaction = await provider.getTransaction(txHash);
  const receipt = await provider.getTransactionReceipt(txHash);

  if (!transaction || !receipt || receipt.status !== 1) {
    throw new Error("Transaction not found or not confirmed on BSC.");
  }
  if (String(transaction.chainId) !== "56") {
    throw new Error("Sponsor payment must be on BSC mainnet.");
  }

  const iface = new ethers.Interface([
    "event Transfer(address indexed from,address indexed to,uint256 value)"
  ]);
  const twoUsdt = ethers.parseUnits("2", 18);
  let matched = false;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== USDT_BSC.toLowerCase()) continue;
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (
        parsed &&
        parsed.name === "Transfer" &&
        parsed.args.to.toLowerCase() === destination.toLowerCase() &&
        parsed.args.value === twoUsdt
      ) {
        matched = true;
        break;
      }
    } catch (_) {}
  }

  if (!matched) throw new Error("No confirmed 2 USDT payment to the sponsor address was found.");
  return true;
}

async function verifySponsorChannel(channel) {
  const bot = await telegramCall("getMe");
  const chat = await telegramCall("getChat", { chat_id: channel });
  const member = await telegramCall("getChatMember", {
    chat_id: chat.id,
    user_id: bot.id
  });
  if (!["administrator","creator"].includes(member.status)) {
    throw new Error("Instant USDT bot must be an administrator in that channel.");
  }
  return { id: chat.id, username: channel };
}

async function sponsorSubmit(userId, txHash, channel) {
  if (!channel) throw new Error("Enter the Telegram channel username.");
  await verifySponsorPayment(txHash);

  const used = await db().collection("sponsors")
    .where("txHash", "==", txHash)
    .limit(1)
    .get();
  if (!used.empty) throw new Error("This sponsor payment has already been used.");

  const verified = await verifySponsorChannel(channel);
  await db().collection("sponsors").doc(txHash).set({
    uid: String(userId),
    txHash,
    channel,
    chatId: String(verified.id),
    status: "verified",
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return "Sponsor payment and channel verified successfully.";
}

async function spin(uid) {
  const ref = userRef(uid);
  let newState;
  await db().runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    const data = snap.data() || {};
    const complete = data.mission1 && data.mission2 && data.mission3 && data.mission4;
    if (!complete) throw new Error("Collect all 4 keys first.");
    if (data.spun) throw new Error("USDT Box already opened.");
    transaction.update(ref, {
      spun: true,
      rewardAmount: "0.10",
      rewardCreatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });
  newState = await stateFor(uid);
  return newState;
}

async function payout(uid, wallet) {
  if (!ethers.isAddress(wallet)) throw new Error("Enter a valid BEP-20 address.");

  const state = await stateFor(uid);
  if (!(state.mission1 && state.mission2 && state.mission3 && state.mission4)) {
    throw new Error("Collect all 4 keys first.");
  }
  if (!state.spun) throw new Error("Open the USDT Box first.");

  const ref = userRef(uid);
  const current = await ref.get();
  const data = current.data() || {};
  if (data.withdrawn) {
    const until = data.cooldownUntil && data.cooldownUntil.toMillis ? data.cooldownUntil.toMillis() : Number(data.cooldownUntil || 0);
    if (until > Date.now()) throw new Error("Your next gift unlocks after the 24-hour countdown.");
    throw new Error("This reward has already been withdrawn.");
  }

  const privateKey = process.env.PRIVATE_KEY_WALLET;
  if (!privateKey) throw new Error("Payout wallet is not configured.");

  const expected = (process.env.PAYOUT_WALLET_ADDRESS || DEFAULT_PAYOUT).toLowerCase();
  const provider = new ethers.JsonRpcProvider(
    process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org"
  );
  const signer = new ethers.Wallet(privateKey, provider);

  if (signer.address.toLowerCase() !== expected) {
    throw new Error("Payout wallet key does not match PAYOUT_WALLET_ADDRESS.");
  }

  const token = new ethers.Contract(
    USDT_BSC,
    ["function transfer(address to,uint256 amount) returns(bool)"],
    signer
  );

  const tx = await token.transfer(wallet, ethers.parseUnits("0.10", 18));
  const cooldownUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await ref.update({
    withdrawn: true,
    payoutWallet: wallet,
    payoutTx: tx.hash,
    payoutStatus: "processing",
    payoutAt: admin.firestore.FieldValue.serverTimestamp(),
    cooldownUntil: admin.firestore.Timestamp.fromDate(cooldownUntil)
  });

  try {
    await tx.wait();
    await ref.update({ payoutStatus: "paid" });
  } catch (_) {}

  return tx.hash;
}

async function telegramStart(update) {
  const message = update && update.message;
  if (!message || message.chat?.type !== "private" || typeof message.text !== "string") return;

  if (message.text.startsWith("/start")) {
    const payload = message.text.substring(6).trim();
    const url = process.env.APP_URL || "https://instant-usdt.vercel.app";
    await telegramCall("sendMessage", {
      chat_id: message.chat.id,
      text: `⚡ INSTANT USDT\n\n💎 Welcome to Instant USDT!\n\n🎯 Complete simple missions\n📺 Watch ads\n👥 Invite friends\n🎁 Unlock the Mystery Box\n💰 Earn USDT rewards\n\n━━━━━━━━━━━━━━━━━━\n🚀 HOW IT WORKS\n\n1️⃣ Complete Mission 1\n2️⃣ Invite 3 friends\n3️⃣ Complete the Treasure Hunt\n4️⃣ Win the Ad Battle\n5️⃣ 🎁 Unlock your Mystery Box\n6️⃣ 💳 Receive your reward\n\n━━━━━━━━━━━━━━━━━━\n\n🔐 Secure • Fast • Simple\n⚡ Start earning with Instant USDT today!\n\n👇 Tap the button below to enter`, 
      reply_markup: {
        inline_keyboard: [[
          { text: "🚀 Open Instant USDT", web_app: { url } }
        ]]
      }
    });
  }
}

module.exports = async function(req, res) {
  try {
    if (req.method === "GET") {
      return sendJson(res, 200, { ok: true, service: "Instant USDT" });
    }

    let body = req.body || {};
    if (typeof body === "string") body = JSON.parse(body);

    if (body.update_id !== undefined) {
      await telegramStart(body);
      return sendJson(res, 200, { ok: true });
    }

    const { user, params } = telegramVerify(body.initData || "");
    const action = body.action;

    if (action === "deviceCheck") {
      const result = await deviceCheck(user.id, body.deviceId, body.fingerprint);
      await ensureUser(user, params.get("start_param") || "");
      return sendJson(res, 200, { ok: true, ...result, state: await stateFor(user.id) });
    }

    // Every normal app action also passes the device binding check.
    await deviceCheck(user.id, body.deviceId, body.fingerprint);
    await ensureUser(user, params.get("start_param") || "");

    if (action === "config") {
      return sendJson(res, 200, {
        ok: true,
        monetagSdkUrl: process.env.MONETAG_SDK_URL || "",
        monetagZoneId: process.env.MONETAG_ZONE_ID || "",
        adsgramBlockId: process.env.ADSGRAM_BLOCK_ID || ""
      });
    }

    if (action === "state") {
      return sendJson(res, 200, { ok: true, state: await stateFor(user.id) });
    }

    if (action === "verifyMission1") {
      return sendJson(res, 200, await completeMission1(user.id));
    }

    if (action === "startAd") {
      return sendJson(res, 200, { ok: true, session: await startAd(user.id, Number(body.mission), String(body.provider || "")) });
    }

    if (action === "completeAd") {
      const result = await completeAd(user.id, String(body.session || ""), Number(body.mission), String(body.provider || ""));
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (action === "sponsorInfo") {
      return sendJson(res, 200, { ok: true, ...(await sponsorInfo()) });
    }

    if (action === "sponsor") {
      const message = await sponsorSubmit(
        user.id,
        String(body.txHash || "").trim(),
        String(body.channel || "").trim()
      );
      return sendJson(res, 200, { ok: true, message });
    }

    if (action === "spin") {
      return sendJson(res, 200, { ok: true, state: await spin(user.id) });
    }

    if (action === "withdraw") {
      const tx = await payout(user.id, String(body.wallet || "").trim());
      return sendJson(res, 200, {
        ok: true,
        message: `Payout sent successfully. Transaction: ${tx}`,
        tx
      });
    }

    return sendJson(res, 400, { error: "Unknown action." });
  } catch (error) {
    return sendJson(res, 400, { error: error.message || "Server error." });
  }
};
