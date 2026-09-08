const crypto=require("crypto");
const admin=require("firebase-admin");
const {ethers}=require("ethers");
let db;
const USDT="0x55d398326f99059fF775485246999027B3197955".toLowerCase();
const TREASURY=(process.env.PAYOUT_WALLET_ADDRESS||"0xDb1e63101a47Cc8A495de9608ECBd6e436309A1f").toLowerCase();

function database(){
 if(db)return db;
 if(!admin.apps.length){
  const key=(process.env.FIREBASE_PRIVATE_KEY||"").replace(/\\n/g,"\n");
  admin.initializeApp({credential:admin.credential.cert({projectId:process.env.FIREBASE_PROJECT_ID,clientEmail:process.env.FIREBASE_CLIENT_EMAIL,privateKey:key})});
 }
 db=admin.firestore();return db;
}
function getUser(initData){
 if(!initData)throw Error("Open the Mini App from Telegram.");
 const p=new URLSearchParams(initData),hash=p.get("hash");if(!hash)throw Error("Telegram data is missing.");
 const data=[...p.entries()].filter(([k])=>k!=="hash").sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
 const secret=crypto.createHmac("sha256","WebAppData").update(process.env.TELEGRAM_BOT_TOKEN).digest();
 const calc=crypto.createHmac("sha256",secret).update(data).digest("hex");
 if(!crypto.timingSafeEqual(Buffer.from(calc),Buffer.from(hash)))throw Error("Telegram verification failed.");
 const u=JSON.parse(p.get("user")||"{}");if(!u.id)throw Error("Telegram user missing.");return {u,p};
}
async function ensureUser(u,p){
 const ref=(p.get("start_param")||"").replace(/^ref_/,"");
 const d=database().collection("users").doc(String(u.id));let s=await d.get();
 if(!s.exists){
  await d.set({telegramId:String(u.id),username:u.username||"",mission1:false,referrals:0,ads3:0,ads4:0,referrer:ref&&ref!==String(u.id)?ref:"",pending:[],rewarded:false,createdAt:admin.firestore.FieldValue.serverTimestamp()});
  if(ref&&ref!==String(u.id))await database().collection("users").doc(ref).set({pending:admin.firestore.FieldValue.arrayUnion(String(u.id))},{merge:true});
 }
 return d;
}
async function isMember(chat,id){
 const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(chat)}&user_id=${id}`);
 const j=await r.json();if(!j.ok)throw Error("Telegram could not verify channel membership. Make the bot an administrator in both channels.");
 return ["creator","administrator","member"].includes(j.result.status)||(j.result.status==="restricted"&&j.result.is_member===true);
}
async function state(d){
 let x=(await d.get()).data()||{},ref=x.referrals||0;
 for(const id of (x.pending||[])){
  const s=await database().collection("users").doc(id).get();
  if(s.exists&&s.data().mission1){ref++;await d.set({referrals:ref,pending:admin.firestore.FieldValue.arrayRemove(id)},{merge:true});}
 }
 x=(await d.get()).data()||x;
 const ads={3:x.ads3||0,4:x.ads4||0};
 return {userId:String(x.telegramId),referrals:ref,ads,unlocked:!!(x.mission1&&ref>=3&&ads[3]>=50&&ads[4]>=50)};
}
module.exports=async(req,res)=>{
 try{
  const body=req.body||{};const {u,p}=getUser(body.initData||"");const d=await ensureUser(u,p);
  if(body.action==="state")return res.status(200).json({ok:true,...await state(d)});
  if(body.action==="verifyMission1"){
   const a=await isMember(process.env.TELEGRAM_CHANNEL_1,u.id),b=await isMember(process.env.TELEGRAM_CHANNEL_2,u.id);
   if(!a||!b)return res.status(200).json({ok:false,message:"Please join both channels first."});
   await d.set({mission1:true},{merge:true});return res.status(200).json({ok:true,message:"Mission One complete."});
  }
  if(body.action==="adComplete"){
   const n=Number(body.mission);if(![3,4].includes(n)||String(body.projectCode)!=="000409")throw Error("Invalid ad mission.");
   const s=await d.get(),x=s.data()||{};if(!x.mission1||(x.referrals||0)<3)throw Error("Complete the earlier missions first.");
   const field=n===3?"ads3":"ads4";const count=Math.min(50,(x[field]||0)+1);await d.set({[field]:count},{merge:true});
   const st=await state(d);return res.status(200).json({ok:true,count,message:`Ad completed: ${count}/50`,unlocked:st.unlocked});
  }
  if(body.action==="withdraw"){
   const s=await d.get(),x=s.data()||{};if(!(x.mission1&&(x.referrals||0)>=3&&(x.ads3||0)>=50&&(x.ads4||0)>=50))throw Error("Finish all missions first.");
   if(x.rewarded)throw Error("This reward has already been withdrawn.");
   if(!ethers.isAddress(body.wallet))throw Error("Invalid BEP-20 address.");
   const provider=new ethers.JsonRpcProvider(process.env.BSC_RPC_URL||"https://bsc-dataseed.binance.org");
   const signer=new ethers.Wallet(process.env.PRIVATE_KEY_WALLET,provider);
   if(signer.address.toLowerCase()!==TREASURY)throw Error("Payout wallet does not match PAYOUT_WALLET_ADDRESS.");
   const token=new ethers.Contract(USDT,["function transfer(address,uint256) returns(bool)"],signer);
   const tx=await token.transfer(body.wallet,ethers.parseUnits("0.10",18));await tx.wait();
   await d.set({rewarded:true,payoutTx:tx.hash,payoutWallet:body.wallet,payoutAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
   return res.status(200).json({ok:true,message:"Withdrawal sent successfully."});
  }
  throw Error("Unknown action.");
 }catch(e){return res.status(400).json({ok:false,message:e.message||"Server error."})}
};
