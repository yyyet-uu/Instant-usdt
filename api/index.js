const crypto=require("crypto");
const admin=require("firebase-admin");
const {ethers}=require("ethers");

let db;
function firebase(){
  if(db)return db;
  if(!admin.apps.length){
    const key=(process.env.FIREBASE_PRIVATE_KEY||"").replace(/\\n/g,"\n");
    admin.initializeApp({credential:admin.credential.cert({
      projectId:process.env.FIREBASE_PROJECT_ID,
      clientEmail:process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:key
    })});
  }
  db=admin.firestore(); return db;
}
function telegramUser(initData){
  if(!initData)throw new Error("Open this app from Telegram.");
  const p=new URLSearchParams(initData), hash=p.get("hash"); if(!hash)throw new Error("Invalid Telegram data.");
  const pairs=[]; p.forEach((v,k)=>{if(k!=="hash")pairs.push(`${k}=${v}`)}); pairs.sort();
  const secret=crypto.createHmac("sha256","WebAppData").update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const calc=crypto.createHmac("sha256",secret).update(pairs.join("\n")).digest("hex");
  if(calc!==hash)throw new Error("Telegram verification failed.");
  const u=JSON.parse(p.get("user")||"{}"); if(!u.id)throw new Error("Telegram user missing.");
  return u;
}
async function member(chat,userId){
  const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(chat)}&user_id=${userId}`);
  const j=await r.json(); if(!j.ok)throw new Error("Telegram could not check channel membership.");
  return ["creator","administrator","member"].includes(j.result.status) || (j.result.status==="restricted"&&j.result.is_member);
}
function refFromStart(initData){
  try{return new URLSearchParams(initData).get("start_param")||""}catch{return ""}
}
async function userDoc(u){
  const d=firebase().collection("users").doc(String(u.id)); const s=await d.get();
  if(!s.exists){
    const ref=refFromStart(currentInitData);
    await d.set({telegramId:u.id,username:u.username||"",mission1:false,referrals:0,ads3:0,ads4:0,referrer:ref.startsWith("ref_")?ref.slice(4):"",rewarded:false,createdAt:admin.firestore.FieldValue.serverTimestamp()});
    if(ref.startsWith("ref_")&&ref.slice(4)!==String(u.id)){
      await firebase().collection("users").doc(ref.slice(4)).set({pendingReferrals:admin.firestore.FieldValue.arrayUnion(String(u.id))},{merge:true});
    }
  }
  return d;
}
let currentInitData="";
async function getState(u){
  const s=await userDoc(u); const x=(await s.get()).data()||{};
  const pending=x.pendingReferrals||[]; let referrals=x.referrals||0;
  for(const id of pending.slice()){
    const q=await firebase().collection("users").doc(id).get(); if(q.exists&&q.data().mission1){
      referrals++; await s.set({referrals,pendingReferrals:admin.firestore.FieldValue.arrayRemove(id)},{merge:true});
    }
  }
  const ads={3:x.ads3||0,4:x.ads4||0}; const unlocked=!!(x.mission1&&referrals>=3&&ads[3]>=50&&ads[4]>=50);
  return {userId:String(u.id),referrals,ads,unlocked,message:unlocked?"All missions complete.":""};
}
async function handler(req,res){
 try{
  const body=req.body||{}; currentInitData=body.initData||"";
  const u=telegramUser(currentInitData); const action=body.action;
  if(action==="state")return res.json({ok:true,...await getState(u)});
  if(action==="verifyMission1"){
    const a=await member(process.env.TELEGRAM_CHANNEL_1,u.id),b=await member(process.env.TELEGRAM_CHANNEL_2,u.id);
    if(!a||!b)return res.json({ok:false,message:"Please join both channels first."});
    await userDoc(u).then(d=>d.set({mission1:true},{merge:true}));
    return res.json({ok:true,message:"Mission One complete."});
  }
  if(action==="adComplete"){
    const n=Number(body.mission); if(![3,4].includes(n))throw new Error("Invalid mission.");
    const d=userDoc(u),s=await d.get(),x=s.data()||{};
    if(!x.mission1||(x.referrals||0)<3)throw new Error("Complete the earlier missions first.");
    const field=n===3?"ads3":"ads4",count=Math.min(50,(x[field]||0)+1);
    await d.set({[field]:count},{merge:true}); const st=await getState(u);
    return res.json({ok:true,count,message:`Ad completed: ${count}/50`,unlocked:st.unlocked});
  }
  if(action==="withdraw"){
    const d=userDoc(u),s=await d.get(),x=s.data()||{};
    if(!(x.mission1&&(x.referrals||0)>=3&&(x.ads3||0)>=50&&(x.ads4||0)>=50))throw new Error("Finish all missions first.");
    if(x.rewarded)throw new Error("Reward already withdrawn.");
    if(!ethers.isAddress(body.wallet))throw new Error("Invalid BEP-20 address.");
    const provider=new ethers.JsonRpcProvider(process.env.BSC_RPC_URL||"https://bsc-dataseed.binance.org");
    const signer=new ethers.Wallet(process.env.PRIVATE_KEY_WALLET,provider);
    const token=new ethers.Contract("0x55d398326f99059fF775485246999027B3197955",["function transfer(address,uint256) returns(bool)"],signer);
    const tx=await token.transfer(body.wallet,ethers.parseUnits("0.10",18)); await tx.wait();
    await d.set({rewarded:true,payoutTx:tx.hash,payoutWallet:body.wallet,payoutAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
    return res.json({ok:true,message:"Withdrawal sent successfully."});
  }
  throw new Error("Unknown action.");
 }catch(e){res.status(400).json({ok:false,message:e.message||"Server error."})}
}
module.exports=(req,res)=>{res.json=(x)=>{res.setHeader("content-type","application/json");res.end(JSON.stringify(x))};handler(req,res)};
