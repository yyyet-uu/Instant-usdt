const crypto=require("crypto");
const admin=require("firebase-admin");
const {ethers}=require("ethers");

let DB=null;
const APP_ID=process.env.ADSBITVEX_APP_ID||"000409";
const APP_URL=process.env.APP_URL||"https://instant-usdt.vercel.app";
const BOT_USERNAME=process.env.BOT_USERNAME||"FastInstant_usdt_bot";
const PAYOUT_ADDRESS=(process.env.PAYOUT_WALLET_ADDRESS||"0xDb1e63101a47Cc8A495de9608ECBd6e436309A1f").toLowerCase();
const USDT_CONTRACT="0x55d398326f99059fF775485246999027B3197955".toLowerCase();

function db(){
 if(DB)return DB;
 if(!admin.apps.length){
  const key=(process.env.FIREBASE_PRIVATE_KEY||"").replace(/\\n/g,"\n");
  admin.initializeApp({credential:admin.credential.cert({
   projectId:process.env.FIREBASE_PROJECT_ID,
   clientEmail:process.env.FIREBASE_CLIENT_EMAIL,
   privateKey:key
  })});
 }
 DB=admin.firestore();return DB;
}

function verifyTelegram(initData){
 if(!initData)throw Error("Open Instant USDT from Telegram.");
 const p=new URLSearchParams(initData),hash=p.get("hash");if(!hash)throw Error("Telegram verification failed.");
 const values=[...p.entries()].filter(([k])=>k!=="hash").sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
 const secret=crypto.createHmac("sha256","WebAppData").update(process.env.TELEGRAM_BOT_TOKEN||"").digest();
 const calc=crypto.createHmac("sha256",secret).update(values).digest("hex");
 if(calc.length!==hash.length||!crypto.timingSafeEqual(Buffer.from(calc),Buffer.from(hash)))throw Error("Telegram verification failed.");
 const authDate=Number(p.get("auth_date")||0);if(!authDate||Math.floor(Date.now()/1000)-authDate>86400)throw Error("Telegram session expired.");
 const user=JSON.parse(p.get("user")||"{}");if(!user.id)throw Error("Telegram user missing.");
 return {user,p};
}

function baseUser(){return{mission1:false,referrals:0,ads3:0,ads4:0,pendingReferrals:[],rewarded:false,createdAt:admin.firestore.FieldValue.serverTimestamp()};}

async function ensureUser(user,p){
 const ref=db().collection("users").doc(String(user.id));
 let snap=await ref.get();
 if(!snap.exists){
  const start=p.get("start_param")||"";
  const referrer=start.startsWith("ref_")?start.slice(4):"";
  const data={...baseUser(),telegramId:String(user.id),username:user.username||"",firstName:user.first_name||"",referrer:referrer&&referrer!==String(user.id)?referrer:""};
  await ref.set(data);
  if(data.referrer){
   await db().collection("users").doc(data.referrer).set({pendingReferrals:admin.firestore.FieldValue.arrayUnion(String(user.id))},{merge:true});
  }
  snap=await ref.get();
 }
 return ref;
}

async function qualifyReferrals(ref){
 const snap=await ref.get(),data=snap.data()||{};
 let count=Number(data.referrals||0);
 const pending=[...(data.pendingReferrals||[])];
 for(const id of pending){
  const child=await db().collection("users").doc(String(id)).get();
  if(child.exists&&child.data().mission1){
   count++;
   await ref.set({referrals:count,pendingReferrals:admin.firestore.FieldValue.arrayRemove(String(id))},{merge:true});
  }
 }
 return count;
}

async function getState(ref){
 const referrals=await qualifyReferrals(ref);
 const d=(await ref.get()).data()||{};
 return {userId:String(d.telegramId),mission1:!!d.mission1,referrals,ads3:Number(d.ads3||0),ads4:Number(d.ads4||0),unlocked:!!(d.mission1&&referrals>=3&&Number(d.ads3||0)>=50&&Number(d.ads4||0)>=50)};
}

async function telegramCall(method,payload){
 const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
 const j=await r.json();if(!j.ok)throw Error(j.description||"Telegram API error");return j.result;
}

async function memberStatus(chatId,userId){
 const x=await telegramCall("getChatMember",{chat_id:chatId,user_id:userId});
 return x;
}

async function botIsAdmin(channel){
 const me=await telegramCall("getMe",{});
 const m=await memberStatus(channel,me.id);
 return ["administrator","creator"].includes(m.status);
}

async function verifySponsorPayment(txHash){
 const addr=process.env.SPONSOR_PAYMENT_ADDRESS;
 if(!addr||addr==="YOUR_SPONSOR_PAYMENT_ADDRESS")throw Error("Sponsor payment address is not configured yet.");
 if(!ethers.isAddress(addr))throw Error("Invalid sponsor payment address.");
 if(!/^0x[a-fA-F0-9]{64}$/.test(txHash))throw Error("Invalid BSC transaction hash.");
 const provider=new ethers.JsonRpcProvider(process.env.BSC_RPC_URL||"https://bsc-dataseed.binance.org");
 const tx=await provider.getTransaction(txHash);if(!tx)throw Error("Transaction not found.");
 const receipt=await provider.getTransactionReceipt(txHash);if(!receipt||receipt.status!==1)throw Error("Transaction is not confirmed.");
 if((tx.chainId||56n).toString()!=="56")throw Error("Payment must be on BSC mainnet.");
 const iface=new ethers.Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
 let matched=false;
 for(const log of receipt.logs){
  try{
   if(log.address.toLowerCase()!==USDT_CONTRACT)continue;
   const parsed=iface.parseLog(log);
   if(parsed&&parsed.name==="Transfer"&&parsed.args.to.toLowerCase()===addr.toLowerCase()&&ethers.formatUnits(parsed.args.value,18)==="2.0"){matched=true;break;}
  }catch(_){}
 }
 if(!matched)throw Error("No confirmed $2 USDT payment to the sponsor address was found.");
 return true;
}

async function sendWelcome(chatId,startPayload){
 const direct=`https://t.me/${BOT_USERNAME}/Instant`+(startPayload?`?startapp=${encodeURIComponent(startPayload)}`:"");
 const text="💙 Welcome to Instant USDT\\n\\nComplete the missions in order and unlock the Mystery Box.\\n\\nTap the button below to open the Mini App.";
 return telegramCall("sendMessage",{chat_id:chatId,text,reply_markup:{inline_keyboard:[[{text:"🚀 Open Instant USDT",web_app:{url:APP_URL}}],[{text:"📢 Open App",url:direct}]]}});
}

async function handleTelegramUpdate(update){
 const msg=update&&update.message;
 if(msg&&msg.chat&&msg.chat.type==="private"&&typeof msg.text==="string"&&msg.text.startsWith("/start")){
  const payload=msg.text.split(" ").slice(1).join(" ").trim();
  await sendWelcome(msg.chat.id,payload);return;
 }
}

async function handleClient(body,res){
 const {user,p}=verifyTelegram(body.initData||"");
 const ref=await ensureUser(user,p);
 if(body.action==="state")return res.json({ok:true,...await getState(ref)});

 if(body.action==="verifyMission1"){
  const a=await memberStatus(process.env.TELEGRAM_CHANNEL_1,user.id);
  const b=await memberStatus(process.env.TELEGRAM_CHANNEL_2,user.id);
  const joined=(["creator","administrator","member"].includes(a.status)||(a.status==="restricted"&&a.is_member))&&(["creator","administrator","member"].includes(b.status)||(b.status==="restricted"&&b.is_member));
  if(!joined)return res.json({ok:false,message:"Please join both channels first."});
  await ref.set({mission1:true},{merge:true});
  return res.json({ok:true,message:"Mission One completed."});
 }

 if(body.action==="adStart"){
  const mission=Number(body.mission);
  const s=await getState(ref);
  if(mission===3&&!(s.mission1&&s.referrals>=3))throw Error("Complete the earlier missions first.");
  if(mission===4&&!(s.mission1&&s.referrals>=3&&s.ads3>=50))throw Error("Complete Mission Three first.");
  if(![3,4].includes(mission))throw Error("Invalid ad mission.");
  const token=crypto.randomBytes(24).toString("hex");
  await db().collection("adSessions").doc(token).set({telegramId:String(user.id),mission,createdAt:admin.firestore.FieldValue.serverTimestamp(),used:false,appId:APP_ID});
  return res.json({ok:true,session:token});
 }

 if(body.action==="adComplete"){
  const mission=Number(body.mission),token=String(body.session||"");
  if(![3,4].includes(mission)||!token)throw Error("Invalid ad completion.");
  const adRef=db().collection("adSessions").doc(token);
  const adSnap=await adRef.get();if(!adSnap.exists)throw Error("Ad session expired.");
  const ad=adSnap.data();
  if(ad.used||String(ad.telegramId)!==String(user.id)||Number(ad.mission)!==mission)throw Error("Ad session is invalid.");
  const created=ad.createdAt?.toDate?.().getTime?.()||0;
  if(!created||Date.now()-created<12000)throw Error("Please complete the ad before claiming the mission progress.");
  await adRef.set({used:true,completedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
  const field=mission===3?"ads3":"ads4";
  let count=0;
  await db().runTransaction(async t=>{
   const s=await t.get(ref);const d=s.data()||{};
   count=Math.min(50,Number(d[field]||0)+1);
   t.set(ref,{[field]:count,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
  });
  return res.json({ok:true,count,message:`Ad completed: ${count}/50`,missionComplete:count>=50});
 }

 if(body.action==="sponsorInfo"){
  return res.json({ok:true,address:process.env.SPONSOR_PAYMENT_ADDRESS||"Not configured"});
 }

 if(body.action==="sponsorSubmit"){
  const txHash=String(body.txHash||"").trim(),channel=String(body.channel||"").trim();
  if(!channel)throw Error("Enter your Telegram channel username.");
  if(!(await verifySponsorPayment(txHash)))throw Error("Payment verification failed.");
  const adminOk=await botIsAdmin(channel);
  if(!adminOk)throw Error("The Instant USDT bot must be an administrator in this channel.");
  const existing=await db().collection("sponsorPayments").where("txHash","==",txHash).limit(1).get();
  if(!existing.empty)throw Error("This payment has already been used.");
  await db().collection("sponsorPayments").doc(txHash).set({telegramId:String(user.id),txHash,channel,status:"approved",createdAt:admin.firestore.FieldValue.serverTimestamp()});
  return res.json({ok:true,message:"Sponsor channel verified successfully."});
 }

 if(body.action==="withdraw"){
  const s=await getState(ref);
  if(!s.unlocked)throw Error("Complete all missions first.");
  const wallet=String(body.wallet||"").trim();
  if(!ethers.isAddress(wallet))throw Error("Enter a valid BEP-20 address.");
  const current=await ref.get(),d=current.data()||{};
  if(d.rewarded)throw Error("This reward has already been withdrawn.");
  const provider=new ethers.JsonRpcProvider(process.env.BSC_RPC_URL||"https://bsc-dataseed.binance.org");
  const signer=new ethers.Wallet(process.env.PRIVATE_KEY_WALLET,provider);
  if(signer.address.toLowerCase()!==PAYOUT_ADDRESS)throw Error("The configured payout key does not match the payout address.");
  const token=new ethers.Contract(USDT_CONTRACT,["function transfer(address,uint256) returns(bool)"],signer);
  const tx=await token.transfer(wallet,ethers.parseUnits("0.10",18));
  await ref.set({rewarded:true,payoutWallet:wallet,payoutTx:tx.hash,payoutStatus:"processing",payoutAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
  try{await tx.wait();await ref.set({payoutStatus:"paid"},{merge:true})}catch(_){}
  return res.json({ok:true,message:"Withdrawal processed. Transaction: "+tx.hash});
 }

 throw Error("Unknown action.");
}

module.exports=async function(req,res){
 res.setHeader("content-type","application/json");
 if(req.method==="GET")return res.status(200).end('{"ok":true,"service":"Instant USDT"}');
 try{
  let body=req.body;
  if(typeof body==="string")body=JSON.parse(body);
  if(body&&body.update_id!==undefined)return await handleTelegramUpdate(body),res.status(200).end('{"ok":true}');
  return await handleClient(body||{},{
   json:x=>res.status(200).end(JSON.stringify(x)),
   status:code=>({json:x=>res.status(code).end(JSON.stringify(x))})
  });
 }catch(e){
  return res.status(400).end(JSON.stringify({ok:false,message:e.message||"Server error."}));
 }
};
