"use client";
import {useEffect,useState} from "react";
declare global{interface Window{Telegram?:any}}
const channels=[["phone_teach","https://t.me/phone_teach"],["forex_big","https://t.me/forex_big"]];
export default function Home(){
 const [m,setM]=useState([0,0,0,0]); const [status,setStatus]=useState("Complete missions in order.");
 useEffect(()=>{window.Telegram?.WebApp?.ready();window.Telegram?.WebApp?.expand()},[]);
 const verify=async()=>{setStatus("Checking channel membership…");try{let r=await fetch("/api/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({initData:window.Telegram?.WebApp?.initData||""})});let d=await r.json();if(d.ok)setM(d.missions);setStatus(d.message)}catch{setStatus("Verification failed.")}};
 return <main><header><div className="logo">₮</div><div><small>TELEGRAM MINI APP</small><h1>Instant <b>USDT</b></h1><p>Complete missions. Unlock the Mystery Box.</p></div></header>
 <div className="notice">🔵 {status}</div><section><div className="title"><small>YOUR JOURNEY</small><h2>Missions</h2></div>
 {[["Join 2 Channels","Join both required channels.",2],["Invite 3 People","Each invited person must complete Mission 1.",3],["Complete 50 Ads","Complete 50 Monetag ads.",50],["Complete 50 Ads","25 Adsgram + 25 ads from the second network.",50]].map((x,i)=><article className={i>0&&m[i-1]<[2,3,50,50][i-1]?"locked":""}><div className="row"><span className="icon">{m[i]>=[2,3,50,50][i]?"✓":i+1}</span><div><small>MISSION {i+1}</small><h3>{x[0]}</h3></div><strong>{m[i]}/{x[2]}</strong></div><p>{x[1]}</p><div className="bar"><i style={{width:`${Math.min(100,m[i]/Number(x[2])*100)}%`}}/></div>{i===0&&<div className="channels">{channels.map(c=><a href={c[1]} target="_blank">Join @{c[0]}</a>)}<button onClick={verify}>VERIFY</button></div>}</article>)}</section>
 <div className="mystery">🎁<small>FINAL REWARD</small><h2>Mystery Box</h2><p>Complete all 4 missions to unlock your $0.10 USDT reward.</p><button disabled={m[3]<50}>🔒 OPEN MYSTERY BOX</button></div><footer>Instant USDT • Fast & simple</footer></main>
}
