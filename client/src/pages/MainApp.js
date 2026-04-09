import React,{useState,useEffect,useRef,useCallback,useMemo}from'react';
import{useAuth}from'../context/AuthContext';
import{useSocket}from'../context/SocketContext';
import{api}from'../utils/api';
import{generateEphemeralKeyPair,importPublicKey,deriveSharedKey,encryptMessage,decryptMessage,deriveRoomKey,encryptRoomMessage,decryptRoomMessage}from'../utils/crypto';
import{v4 as uuidv4}from'uuid';

// ── UTILS ─────────────────────────────────────────────────────
const fmt=ts=>new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
const fmtSz=b=>{if(!b)return'';if(b<1024)return b+'B';if(b<1048576)return(b/1024).toFixed(1)+'KB';if(b<1073741824)return(b/1048576).toFixed(1)+'MB';return(b/1073741824).toFixed(2)+'GB';};
const fIco=n=>{const e=(n||'').split('.').pop().toLowerCase();if(['jpg','jpeg','png','gif','webp','svg'].includes(e))return'🖼️';if(e==='pdf')return'📄';if(['zip','rar','7z'].includes(e))return'📦';if(['mp3','wav','ogg'].includes(e))return'🎵';if(['mp4','mov','avi'].includes(e))return'🎬';if(['doc','docx'].includes(e))return'📝';if(['xls','xlsx'].includes(e))return'📊';return'📎';};
const gColor=s=>{const c=['#6366f1','#8b5cf6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#3b82f6','#f97316','#14b8a6'];let h=0;for(const x of(s||'?'))h=(h<<5)-h+x.charCodeAt(0);return c[Math.abs(h)%c.length];};

function createRing(ctx){
  try{
    const t=ctx.currentTime;
    for(let i=0;i<2;i++){
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.connect(g);g.connect(ctx.destination);
      o.type='sine';
      o.frequency.setValueAtTime(480,t+i*0.5);
      o.frequency.setValueAtTime(380,t+i*0.5+0.25);
      g.gain.setValueAtTime(0,t+i*0.5);
      g.gain.linearRampToValueAtTime(0.35,t+i*0.5+0.05);
      g.gain.setValueAtTime(0.35,t+i*0.5+0.4);
      g.gain.linearRampToValueAtTime(0,t+i*0.5+0.5);
      o.start(t+i*0.5);o.stop(t+i*0.5+0.5);
    }
  }catch{}
}

// Request browser notifications
async function requestNotifPerm(){
  if('Notification'in window&&Notification.permission==='default') await Notification.requestPermission();
}
function sendNotif(title,body,icon='👻'){
  if('Notification'in window&&Notification.permission==='granted'){
    try{new Notification(title,{body,icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">👻</text></svg>'});}catch{}
  }
}

// ── CSS VARS ─────────────────────────────────────────────────
const DARK={
  '--bg':'#0f1117','--bg2':'#161b27','--sur':'#1e2535','--sur2':'#252d3d','--sur3':'#2d3650',
  '--brd':'#2a3450','--brd2':'#3a4a6a','--tx':'#e8edf5','--tx2':'#8899bb','--tx3':'#4a5a7a',
  '--ac':'#4f8ef7','--ac2':'#7c6af7','--acg':'rgba(79,142,247,0.12)','--sbar':'#161b27'
};
const LIGHT={
  '--bg':'#f0f2f5','--bg2':'#ffffff','--sur':'#ffffff','--sur2':'#f5f7fa','--sur3':'#eaecf0',
  '--brd':'#e2e5ea','--brd2':'#c8cdd6','--tx':'#1a1d23','--tx2':'#4a5568','--tx3':'#9ca3af',
  '--ac':'#2563eb','--ac2':'#7c3aed','--acg':'rgba(37,99,235,0.08)','--sbar':'#ffffff'
};

// ── AVATAR ────────────────────────────────────────────────────
function Av({ghostId,color,photo,size=36,group=false,online=false,square=false}){
  const s={width:size,height:size,fontSize:size*0.4,background:color||gColor(ghostId||'?'),minWidth:size,borderRadius:group||square?Math.max(6,size*0.25)+'px':'50%',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,color:'white',position:'relative',overflow:'hidden',flexShrink:0};
  return<div style={s}>{photo?<img src={photo} alt="" style={{width:'100%',height:'100%',objectFit:'cover',position:'absolute',inset:0}}/>:group?'👥':(ghostId||'?')[0].toUpperCase()}{online&&!group&&<div style={{position:'absolute',bottom:0,right:0,width:size*0.28,height:size*0.28,borderRadius:'50%',background:'#22c55e',border:`2px solid var(--sbar)`,boxShadow:'0 0 4px #22c55e'}}/>}</div>;
}

// ── TOAST ─────────────────────────────────────────────────────
function Toast({msg,type='success',onDone}){
  useEffect(()=>{const t=setTimeout(onDone,3500);return()=>clearTimeout(t);},[onDone]);
  const colors={success:'#22c55e',error:'#ef4444',info:'#4f8ef7',warn:'#f59e0b'};
  return<div style={{position:'fixed',bottom:24,right:16,zIndex:9999,background:'var(--sur)',border:`1px solid ${colors[type]||colors.info}33`,borderRadius:12,padding:'11px 16px',fontSize:13,color:'var(--tx)',boxShadow:'0 8px 32px rgba(0,0,0,0.4)',display:'flex',alignItems:'center',gap:9,maxWidth:'min(320px,calc(100vw - 32px))',animation:'slideUp .2s ease',backdropFilter:'blur(8px)'}}><span>{type==='success'?'✅':type==='error'?'❌':type==='warn'?'⚠️':'ℹ️'}</span>{msg}</div>;
}

// ── MODAL SHELL ───────────────────────────────────────────────
function Modal({title,onClose,children,maxW=420}){
  return<div style={{position:'fixed',inset:0,zIndex:5000,background:'rgba(0,0,0,0.65)',display:'flex',alignItems:'center',justifyContent:'center',padding:16,backdropFilter:'blur(4px)'}} onClick={onClose}><div style={{background:'var(--sur)',border:'1px solid var(--brd)',borderRadius:18,padding:26,width:'100%',maxWidth:maxW,boxShadow:'0 20px 60px rgba(0,0,0,0.5)',animation:'slideUp .2s ease'}} onClick={e=>e.stopPropagation()}><h3 style={{fontSize:17,fontWeight:700,marginBottom:18}}>{title}</h3>{children}</div></div>;
}

// ── BTN ───────────────────────────────────────────────────────
const Btn=({children,onClick,variant='primary',disabled,style={},...p})=>{
  const base={display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6,border:'none',borderRadius:8,fontFamily:'inherit',fontWeight:600,cursor:disabled?'not-allowed':'pointer',transition:'all .15s',opacity:disabled?.55:1,...style};
  const vs={primary:{background:'linear-gradient(135deg,var(--ac),var(--ac2))',color:'white',padding:'10px 18px',fontSize:14},secondary:{background:'var(--sur2)',color:'var(--tx)',border:'1px solid var(--brd)',padding:'10px 18px',fontSize:14},ghost:{background:'none',color:'var(--tx2)',padding:'8px 14px',fontSize:13},danger:{background:'rgba(239,68,68,.1)',color:'#ef4444',border:'1px solid rgba(239,68,68,.25)',padding:'10px 18px',fontSize:14},icon:{background:'var(--sur2)',border:'1px solid var(--brd)',color:'var(--tx2)',width:36,height:36,padding:0,fontSize:16,borderRadius:8}};
  return<button onClick={onClick} disabled={disabled} style={{...base,...vs[variant],...style}} {...p}>{children}</button>;
};

// ── INPUT FIELD ───────────────────────────────────────────────
const Field=({label,children,hint})=><div style={{display:'flex',flexDirection:'column',gap:5}}>{label&&<label style={{fontSize:11,fontWeight:700,color:'var(--tx2)',textTransform:'uppercase',letterSpacing:'.6px'}}>{label}</label>}{children}{hint&&<span style={{fontSize:11,color:'var(--tx3)'}}>{hint}</span>}</div>;
const Inp=({...p})=><input style={{width:'100%',padding:'11px 14px',background:'var(--sur)',border:'1.5px solid var(--brd)',borderRadius:8,color:'var(--tx)',fontSize:14,outline:'none',fontFamily:'inherit',...(p.mono?{fontFamily:"'JetBrains Mono',monospace",letterSpacing:2}:{})}} onFocus={e=>e.target.style.borderColor='var(--ac)'} onBlur={e=>e.target.style.borderColor='var(--brd)'} {...p}/>;

// ── SETTINGS ──────────────────────────────────────────────────
function Settings({user,theme,onTheme,onUpdate,onBack,showToast}){
  const{logout}=useAuth();
  const[photo,setPhoto]=useState(user.avatarPhoto||null);
  const[cp,setCp]=useState('');const[np,setNp]=useState('');const[conf,setConf]=useState('');
  const[dp,setDp]=useState('');const[showDel,setShowDel]=useState(false);
  const[loading,setLoading]=useState(false);
  const[friends,setFriends]=useState([]);const[blocked,setBlocked]=useState([]);
  const[freqs,setFreqs]=useState([]);const[msgreqs,setMsgreqs]=useState([]);
  const fileRef=useRef();

  useEffect(()=>{
    api.getFriends().then(d=>setFriends(d.friends||[])).catch(()=>{});
    api.getBlocked().then(d=>setBlocked(d.blocked||[])).catch(()=>{});
    api.getFriendRequests().then(d=>setFreqs(d.requests||[])).catch(()=>{});
    api.getMsgRequests().then(d=>setMsgreqs(d.requests||[])).catch(()=>{});
  },[]);

  const handlePhoto=e=>{const f=e.target.files[0];if(!f)return;if(f.size>5*1024*1024){showToast('Photo under 5MB please','error');return;}const r=new FileReader();r.onload=ev=>setPhoto(ev.target.result);r.readAsDataURL(f);};
  const save=async()=>{
    setLoading(true);
    try{
      const u={};
      if(photo!==(user.avatarPhoto||null))u.avatarPhoto=photo;
      if(np){if(np!==conf){showToast('Passwords do not match','error');setLoading(false);return;}if(!cp){showToast('Enter current password','error');setLoading(false);return;}u.newPassword=np;u.currentPassword=cp;}
      if(!Object.keys(u).length){showToast('Nothing changed','error');setLoading(false);return;}
      const{user:ud}=await api.updateProfile(u);onUpdate(ud);showToast('Saved!','success');setCp('');setNp('');setConf('');
    }catch(e){showToast(e.message,'error');}finally{setLoading(false);}
  };
  const schedDel=async()=>{
    if(!dp){showToast('Enter password','error');return;}setLoading(true);
    try{await api.deleteAccount(dp);onUpdate({...user,pendingDelete:true,deleteAt:Date.now()+15*86400000});showToast('Account deletion scheduled for 15 days','warn');setShowDel(false);setDp('');}
    catch(e){showToast(e.message,'error');}finally{setLoading(false);}
  };
  const recover=async()=>{setLoading(true);try{await api.recoverAccount();onUpdate({...user,pendingDelete:false,deleteAt:null});showToast('Account recovered!','success');}catch(e){showToast(e.message,'error');}finally{setLoading(false);};};
  const daysLeft=user.deleteAt?Math.max(0,Math.ceil((user.deleteAt-Date.now())/86400000)):0;

  const S=({title,children})=><div style={{display:'flex',flexDirection:'column',gap:14}}><div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:1,color:'var(--tx3)',paddingBottom:8,borderBottom:'1px solid var(--brd)'}}>{title}</div>{children}</div>;

  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'var(--bg)',overflowY:'auto'}}>
      <div style={{padding:'14px 18px',borderBottom:'1px solid var(--brd)',background:'var(--bg2)',display:'flex',alignItems:'center',gap:10,flexShrink:0,position:'sticky',top:0,zIndex:10}}>
        <button onClick={onBack} style={{background:'none',border:'none',color:'var(--tx2)',cursor:'pointer',fontSize:18,padding:'4px 8px',borderRadius:6,display:'flex',alignItems:'center'}}>←</button>
        <h2 style={{fontSize:17,fontWeight:700}}>⚙️ Settings</h2>
      </div>
      <div style={{padding:22,display:'flex',flexDirection:'column',gap:24,maxWidth:560}}>

        {user.pendingDelete&&<div style={{background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.3)',borderRadius:12,padding:16}}>
          <div style={{fontWeight:700,color:'#fca5a5',marginBottom:8}}>⚠️ Account deletes in {daysLeft} days</div>
          <div style={{fontSize:13,color:'var(--tx2)',marginBottom:12}}>All your data will be permanently erased. Recover it now if this was a mistake.</div>
          <Btn onClick={recover} disabled={loading} style={{width:'100%',background:'#16a34a',color:'white',border:'none',borderRadius:8,padding:'10px'}}>🔄 Recover My Account</Btn>
        </div>}

        <S title="Profile">
          <div style={{display:'flex',alignItems:'center',gap:16}}>
            <div style={{position:'relative',cursor:'pointer'}} onClick={()=>fileRef.current?.click()}>
              <Av ghostId={user.ghostId} color={gColor(user.ghostId)} photo={photo} size={68}/>
              <div style={{position:'absolute',inset:0,borderRadius:'50%',background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',opacity:0,transition:'opacity .15s',fontSize:18}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=0}>✏️</div>
            </div>
            <input type="file" ref={fileRef} style={{display:'none'}} accept="image/*" onChange={handlePhoto}/>
            <div><div style={{fontWeight:700,fontSize:16}}>@{user.ghostId}</div><div style={{fontSize:12,color:'var(--tx3)',marginTop:4}}>Click avatar to change photo</div>{photo&&<button onClick={()=>setPhoto(null)} style={{marginTop:6,background:'none',border:'none',color:'var(--tx3)',cursor:'pointer',fontSize:12}}>✕ Remove</button>}</div>
          </div>
        </S>

        <S title="Appearance">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 14px',background:'var(--sur)',border:'1px solid var(--brd)',borderRadius:10}}>
            <div><div style={{fontWeight:600,fontSize:14}}>Theme</div><div style={{fontSize:12,color:'var(--tx3)',marginTop:2}}>{theme==='dark'?'Dark mode':'Light mode'}</div></div>
            <div style={{display:'flex',gap:8}}>
              {['dark','light'].map(t=><button key={t} onClick={()=>onTheme(t)} style={{padding:'7px 14px',borderRadius:7,border:`1.5px solid ${theme===t?'var(--ac)':'var(--brd)'}`,background:theme===t?'var(--acg)':'none',color:theme===t?'var(--ac)':'var(--tx2)',cursor:'pointer',fontWeight:600,fontSize:13,fontFamily:'inherit',transition:'all .15s'}}>{t==='dark'?'🌙 Dark':'☀️ Light'}</button>)}
            </div>
          </div>
        </S>

        <S title="Change Password">
          {[['Current Password',cp,setCp,'current-password'],['New Password',np,setNp,'new-password'],['Confirm New Password',conf,setConf,'new-password']].map(([l,v,s,ac])=><Field key={l} label={l}><input style={{width:'100%',padding:'11px 14px',background:'var(--sur)',border:'1.5px solid var(--brd)',borderRadius:8,color:'var(--tx)',fontSize:14,outline:'none',fontFamily:'inherit'}} type="password" value={v} onChange={e=>s(e.target.value)} placeholder="••••••••" autoComplete={ac} onFocus={e=>e.target.style.borderColor='var(--ac)'} onBlur={e=>e.target.style.borderColor='var(--brd)'}/></Field>)}
        </S>

        <Btn onClick={save} disabled={loading} style={{width:'100%',padding:'13px',fontSize:15}}>{loading?'Saving…':'💾 Save Changes'}</Btn>

        <S title="Friends">
          {friends.length===0&&<div style={{fontSize:13,color:'var(--tx3)',textAlign:'center',padding:'12px 0'}}>No friends yet. Add people from search!</div>}
          {friends.map(f=><div key={f.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px',background:'var(--sur)',borderRadius:10,border:'1px solid var(--brd)'}}>
            <Av ghostId={f.ghostId} color={f.avatarColor} photo={f.avatarPhoto} size={36} online={f.status==='online'}/>
            <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{f.ghostId}</div><div style={{fontSize:11,color:'var(--tx3)'}}>{f.status==='online'?'🟢 online':'⚫ offline'}</div></div>
            <Btn variant="danger" onClick={async()=>{await api.removeFriend(f.ghostId);setFriends(p=>p.filter(x=>x.id!==f.id));showToast('Removed','warn');}} style={{padding:'5px 12px',fontSize:12}}>Remove</Btn>
          </div>)}
        </S>

        {freqs.length>0&&<S title={`Friend Requests (${freqs.length})`}>
          {freqs.map(r=><div key={r.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px',background:'var(--sur)',borderRadius:10,border:'1px solid var(--brd)'}}>
            <Av ghostId={r.from.ghost_id} color={r.from.avatar_color} photo={r.from.avatar_photo} size={36}/>
            <div style={{flex:1,fontWeight:600,fontSize:13}}>{r.from.ghost_id}</div>
            <Btn onClick={async()=>{await api.acceptFriendRequest(r.id);setFreqs(p=>p.filter(x=>x.id!==r.id));showToast('Friend added!','success');}} style={{padding:'5px 12px',fontSize:12}}>✓ Accept</Btn>
            <Btn variant="danger" onClick={async()=>{await api.declineFriendRequest(r.id);setFreqs(p=>p.filter(x=>x.id!==r.id));}} style={{padding:'5px 12px',fontSize:12}}>✕</Btn>
          </div>)}
        </S>}

        {msgreqs.length>0&&<S title={`Message Requests (${msgreqs.length})`}>
          <div style={{fontSize:12,color:'var(--tx3)',marginBottom:4}}>These people want to chat with you. You can see their first message before deciding.</div>
          {msgreqs.map(r=><div key={r.id} style={{display:'flex',flexDirection:'column',gap:8,padding:'12px',background:'var(--sur)',borderRadius:10,border:'1px solid var(--brd)'}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <Av ghostId={r.from.ghost_id} color={r.from.avatar_color} photo={r.from.avatar_photo} size={36}/>
              <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{r.from.ghost_id}</div><div style={{fontSize:11,color:'var(--tx3)'}}>Wants to message you</div></div>
            </div>
            {r.first_message&&<div style={{padding:'8px 12px',background:'var(--sur2)',borderRadius:8,fontSize:13,color:'var(--tx2)',borderLeft:'2px solid var(--brd2)',fontStyle:'italic'}}>"{r.first_message}"</div>}
            <div style={{display:'flex',gap:8}}>
              <Btn onClick={async()=>{await api.approveMsgRequest(r.from.ghost_id);setMsgreqs(p=>p.filter(x=>x.id!==r.id));showToast(`${r.from.ghost_id} can now message you`,'success');}} style={{flex:1,padding:'7px',fontSize:12}}>✓ Accept</Btn>
              <Btn variant="danger" onClick={async()=>{await api.declineMsgRequest(r.from.ghost_id);setMsgreqs(p=>p.filter(x=>x.id!==r.id));showToast('Declined','warn');}} style={{flex:1,padding:'7px',fontSize:12}}>✕ Decline</Btn>
            </div>
          </div>)}
        </S>}

        {blocked.length>0&&<S title="Blocked Users">
          {blocked.map(b=><div key={b.id} style={{display:'flex',alignItems:'center',gap:10,padding:'10px',background:'var(--sur)',borderRadius:10,border:'1px solid var(--brd)'}}>
            <Av ghostId={b.ghostId} color={gColor(b.ghostId)} size={34}/>
            <div style={{flex:1,fontWeight:600,fontSize:13}}>{b.ghostId}</div>
            <Btn variant="secondary" onClick={async()=>{await api.unblockUser(b.ghostId);setBlocked(p=>p.filter(x=>x.id!==b.id));showToast('Unblocked','success');}} style={{padding:'5px 12px',fontSize:12}}>Unblock</Btn>
          </div>)}
        </S>}

        <S title="Privacy">
          <div style={{background:'var(--acg)',border:'1px solid rgba(79,142,247,.2)',borderRadius:10,padding:14,display:'flex',flexDirection:'column',gap:7,fontSize:13,color:'var(--tx2)',lineHeight:1.8}}>
            <span>🔐 <b>E2EE</b> — New ECDH keys every session.</span>
            <span>💨 <b>Disappears on Read</b> — Messages vanish when seen by default.</span>
            <span>📵 <b>No IP Logs</b> — Your IP is never stored.</span>
            <span>🌐 <b>Tor Ready</b> — Works over Tor Browser.</span>
            <span>🤝 <b>Message Requests</b> — Strangers need your approval first.</span>
          </div>
        </S>

        <S title="Danger Zone">
          {!user.pendingDelete&&!showDel&&<Btn variant="danger" onClick={()=>setShowDel(true)} style={{width:'100%',padding:'12px',fontSize:14}}>🗑️ Delete My Account</Btn>}
          {showDel&&!user.pendingDelete&&<div style={{background:'rgba(239,68,68,.07)',border:'1px solid rgba(239,68,68,.2)',borderRadius:12,padding:16,display:'flex',flexDirection:'column',gap:12}}>
            <div style={{fontWeight:700,color:'#fca5a5'}}>⚠️ Account deletion — 15 day grace period</div>
            <div style={{fontSize:13,color:'var(--tx2)',lineHeight:1.6}}>Your account will be scheduled for deletion. You have 15 days to recover it from Settings. After that, everything is gone permanently.</div>
            <Inp type="password" value={dp} onChange={e=>setDp(e.target.value)} placeholder="Enter your password to confirm"/>
            <div style={{display:'flex',gap:10}}>
              <Btn variant="secondary" onClick={()=>{setShowDel(false);setDp('');}} style={{flex:1}}>Cancel</Btn>
              <button onClick={schedDel} disabled={loading||!dp} style={{flex:1,background:'#ef4444',color:'white',border:'none',borderRadius:8,padding:'10px',fontWeight:700,cursor:loading||!dp?'not-allowed':'pointer',fontFamily:'inherit',opacity:loading||!dp?.6:1}}>Delete in 15 Days</button>
            </div>
          </div>}
          <Btn variant="secondary" onClick={logout} style={{width:'100%',padding:'11px',marginTop:4}}>🚪 Sign Out</Btn>
        </S>
      </div>
    </div>
  );
}

// ── ROOM MEMBERS PANEL ─────────────────────────────────────────
function RoomMembers({room,myUserId,myGhostId,socket,onClose,showToast,onLeave,onRoomUpdate}){
  const[members,setMembers]=useState([]);
  const[loading,setLoading]=useState(true);
  const[addInput,setAddInput]=useState('');
  const[addLoading,setAddLoading]=useState(false);
  const[membersCanInvite,setMembersCanInvite]=useState(room.membersCanInvite!==false);

  useEffect(()=>{ refresh(); },[room.id]);
  const refresh=()=>{ api.getRoomMembers(room.id).then(d=>setMembers(d.members||[])).catch(()=>{}).finally(()=>setLoading(false)); };

  const myMember=members.find(m=>m.id===myUserId);
  const isAdmin=myMember?.role==='admin';

  const kick=async(m)=>{
    if(!window.confirm(`Remove ${m.ghostId} from the room?`)) return;
    try{
      await api.removeRoomMember(room.id,m.ghostId);
      socket?.emit('room:kick',{roomId:room.id,targetGhostId:m.ghostId});
      setMembers(p=>p.filter(x=>x.id!==m.id));
      showToast(`${m.ghostId} removed`,'warn');
    }catch(e){showToast(e.message,'error');}
  };

  const promote=async(m,role)=>{
    try{
      await api.setRoomMemberRole(room.id,m.ghostId,role);
      setMembers(p=>p.map(x=>x.id===m.id?{...x,role}:x));
      showToast(`${m.ghostId} is now ${role}`,'success');
    }catch(e){showToast(e.message,'error');}
  };

  const addMember=async()=>{
    if(!addInput.trim()) return;
    setAddLoading(true);
    try{
      await api.addRoomMember(room.id,addInput.trim());
      socket?.emit('room:add-member',{roomId:room.id,targetGhostId:addInput.trim()});
      showToast(`${addInput.trim()} added to room`,'success');
      setAddInput(''); refresh();
    }catch(e){showToast(e.message,'error');}
    finally{setAddLoading(false);}
  };

  const toggleInvite=async()=>{
    const newVal=!membersCanInvite;
    try{
      await api.updateRoomSettings(room.id,{membersCanInvite:newVal});
      socket?.emit('room:settings',{roomId:room.id,membersCanInvite:newVal});
      setMembersCanInvite(newVal);
      if(onRoomUpdate) onRoomUpdate({...room,membersCanInvite:newVal});
      showToast(newVal?'Members can now invite others':'Only admins can invite now','success');
    }catch(e){showToast(e.message,'error');}
  };

  const leave=async()=>{
    if(!window.confirm(isAdmin&&room.creatorId===myUserId?'Leaving will transfer admin to the next member. Continue?':'Leave this room?')) return;
    try{
      const res=await api.leaveRoom(room.id);
      if(res.transferred) showToast(`Admin transferred to ${res.newAdmin}`,'success');
      else if(res.deleted) showToast('Room deleted (no members left)','warn');
      else showToast('Left room','success');
      onLeave(room.id); onClose();
    }catch(e){showToast(e.message,'error');}
  };

  return(
    <Modal title={`👥 # ${room.name}`} onClose={onClose} maxW={400}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>

        {/* Admin: add member */}
        {isAdmin&&<div style={{display:'flex',flexDirection:'column',gap:8}}>
          <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:.6,color:'var(--tx3)'}}>Add Member</div>
          <div style={{display:'flex',gap:8}}>
            <input value={addInput} onChange={e=>setAddInput(e.target.value)} placeholder="GhostID to add…" onKeyDown={e=>e.key==='Enter'&&addMember()} style={{flex:1,padding:'8px 12px',background:'var(--sur2)',border:'1.5px solid var(--brd)',borderRadius:8,color:'var(--tx)',fontSize:13,outline:'none',fontFamily:'inherit'}} onFocus={e=>e.target.style.borderColor='var(--ac)'} onBlur={e=>e.target.style.borderColor='var(--brd)'}/>
            <Btn onClick={addMember} disabled={addLoading||!addInput.trim()} style={{padding:'8px 14px',fontSize:13}}>{addLoading?'…':'Add'}</Btn>
          </div>
        </div>}

        {/* Admin: invite setting */}
        {isAdmin&&<div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',background:'var(--sur2)',borderRadius:9,border:'1px solid var(--brd)'}}>
          <div><div style={{fontSize:13,fontWeight:600}}>Members can invite others</div><div style={{fontSize:11,color:'var(--tx3)',marginTop:2}}>{membersCanInvite?'Anyone with invite code can join':'Only admins can add members'}</div></div>
          <div onClick={toggleInvite} style={{width:44,height:24,borderRadius:12,background:membersCanInvite?'var(--ac)':'var(--brd2)',cursor:'pointer',position:'relative',transition:'background .2s',flexShrink:0}}>
            <div style={{position:'absolute',top:2,left:membersCanInvite?22:2,width:20,height:20,borderRadius:'50%',background:'white',transition:'left .2s',boxShadow:'0 1px 4px rgba(0,0,0,.3)'}}/>
          </div>
        </div>}

        {/* Members list */}
        <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:.6,color:'var(--tx3)'}}>Members {loading?'':'('+members.length+')'}</div>
        {loading&&<div style={{textAlign:'center',padding:16,color:'var(--tx3)'}}>Loading…</div>}
        <div style={{maxHeight:280,overflowY:'auto',display:'flex',flexDirection:'column',gap:6}}>
          {members.map(m=>{
            const isMe=m.id===myUserId;
            const isCreator=m.id===room.creatorId;
            return<div key={m.id} style={{display:'flex',alignItems:'center',gap:9,padding:'8px 10px',background:'var(--sur2)',borderRadius:9,border:'1px solid var(--brd)'}}>
              <Av ghostId={m.ghostId} color={m.avatarColor} photo={m.avatarPhoto} size={34} online={m.status==='online'}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:600,fontSize:13,display:'flex',alignItems:'center',gap:6}}>
                  {m.ghostId}
                  {isMe&&<span style={{fontSize:9,color:'var(--tx3)',background:'var(--sur3)',padding:'1px 5px',borderRadius:20}}>you</span>}
                  {m.role==='admin'&&<span style={{fontSize:9,color:'#f59e0b',background:'rgba(245,158,11,.1)',padding:'1px 6px',borderRadius:20,border:'1px solid rgba(245,158,11,.2)'}}>👑 admin</span>}
                </div>
                <div style={{fontSize:10,color:'var(--tx3)',marginTop:1}}>{m.status==='online'?'🟢 online':'⚫ offline'}</div>
              </div>
              {isAdmin&&!isMe&&!isCreator&&<div style={{display:'flex',gap:5,flexShrink:0}}>
                {m.role==='member'
                  ?<button onClick={()=>promote(m,'admin')} title="Make admin" style={{background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.25)',borderRadius:6,padding:'3px 7px',cursor:'pointer',fontSize:11,color:'#f59e0b',fontFamily:'inherit',fontWeight:700}}>👑</button>
                  :m.id!==room.creatorId&&<button onClick={()=>promote(m,'member')} title="Remove admin" style={{background:'var(--sur3)',border:'1px solid var(--brd)',borderRadius:6,padding:'3px 7px',cursor:'pointer',fontSize:11,color:'var(--tx3)',fontFamily:'inherit'}}>↓</button>
                }
                <button onClick={()=>kick(m)} title="Remove from room" style={{background:'rgba(239,68,68,.08)',border:'1px solid rgba(239,68,68,.2)',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:12,color:'#ef4444',fontFamily:'inherit'}}>✕</button>
              </div>}
            </div>;
          })}
        </div>

        <div style={{display:'flex',gap:9}}>
          <Btn variant="danger" onClick={leave} style={{flex:1}}>{room.creatorId===myUserId?'🚪 Leave (transfer admin)':'🚪 Leave Room'}</Btn>
          <Btn variant="secondary" onClick={onClose} style={{flex:1}}>Close</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── CHAT VIEW ──────────────────────────────────────────────────
function ChatView({chat,user,socket,onStartCall,showToast,onOpenMsgReqs}){
  const[msgs,setMsgs]=useState([]);
  const[input,setInput]=useState('');
  const[theirTyping,setTheirTyping]=useState(false);
  const[expiry,setExpiry]=useState('read');
  const[customSecs,setCustomSecs]=useState('');
  const[showExpiryPanel,setShowExpiryPanel]=useState(false);
  const[sharedKey,setSharedKey]=useState(null);
  const[roomKey,setRoomKey]=useState(null);
  const[pendingApproval,setPendingApproval]=useState(false);
  const endRef=useRef();
  const typingRef=useRef();
  const fileRef=useRef();
  const kpRef=useRef(null);
  const pendRef=useRef([]);
  const skRef=useRef(null);
  const isRoom=chat.type==='room';

  useEffect(()=>{skRef.current=sharedKey;},[sharedKey]);

  useEffect(()=>{
    setMsgs([]);setSharedKey(null);setRoomKey(null);setInput('');setTheirTyping(false);setPendingApproval(false);
    kpRef.current=null;pendRef.current=[];skRef.current=null;
    if(isRoom){
      deriveRoomKey(chat.inviteCode).then(k=>setRoomKey(k));
      socket?.emit('room:join',{roomId:chat.id});
    }
    else setupKeys();
  },[chat.id]);

  async function setupKeys(){
    try{
      const{keyPair,publicKeyB64}=await generateEphemeralKeyPair();
      kpRef.current={keyPair,publicKeyB64};
      await api.uploadKey(publicKeyB64);
      socket?.emit('key:exchange',{toGhostId:chat.ghostId,publicKey:publicKeyB64});
      try{const{publicKey:tb64}=await api.getKey(chat.ghostId);const tk=await importPublicKey(tb64);const k=await deriveSharedKey(keyPair.privateKey,tk);skRef.current=k;setSharedKey(k);for(const pm of pendRef.current){const enc=await encryptMessage(k,pm.p);socket?.emit('dm:message',{toGhostId:chat.ghostId,encryptedPayload:enc,msgId:pm.id,expiresIn:pm.exp});}pendRef.current=[];}catch{}
    }catch{}
  }

  const getExp=()=>{if(expiry==='never')return null;if(expiry==='read')return -1;if(expiry==='custom')return Math.max(5,parseInt(customSecs)||60);return parseInt(expiry);};

  useEffect(()=>{
    if(!socket)return;
    const onKex=async({fromGhostId,publicKey:tb64})=>{
      if(fromGhostId!==chat.ghostId||!kpRef.current)return;
      try{const tk=await importPublicKey(tb64);const k=await deriveSharedKey(kpRef.current.keyPair.privateKey,tk);skRef.current=k;setSharedKey(k);socket.emit('key:exchange',{toGhostId:fromGhostId,publicKey:kpRef.current.publicKeyB64});for(const pm of pendRef.current){const enc=await encryptMessage(k,pm.p);socket.emit('dm:message',{toGhostId:chat.ghostId,encryptedPayload:enc,msgId:pm.id,expiresIn:pm.exp});}pendRef.current=[];}catch(e){console.error(e);}
    };
    const decPay=async(ep,key)=>{try{if(ep?.encrypted&&key)return await decryptMessage(key,ep);if(!ep?.encrypted)return ep;return null;}catch{return null;}};
    const onDM=async({msgId,fromGhostId,encryptedPayload,timestamp,expiresIn})=>{
      if(fromGhostId!==chat.ghostId)return;
      // Send read receipt
      socket.emit('dm:read',{toGhostId:fromGhostId,msgId});
      const d=await decPay(encryptedPayload,skRef.current);
      let content='',type='text',fileData=null;
      if(d){content=d.text||'';type=d.type||'text';if(type==='file')fileData=d;}
      else content='[🔒 encrypting — reopen chat if this persists]';
      const expAt=expiresIn===-1?Date.now()+6000:expiresIn?Date.now()+expiresIn*1000:null; // -1 = on read (5s after receive)
      if(fileData)addMsg({id:msgId,from:fromGhostId,type:'file',fileName:fileData.name,fileSize:fileData.size,fileUrl:fileData.data,timestamp,expiresAt:null});
      else addMsg({id:msgId,from:fromGhostId,content,type,timestamp,expiresAt:expAt});
    };
    const onRoom=async({msgId,fromGhostId,encryptedPayload,timestamp,avatarColor,avatarPhoto})=>{
      const d=await decPay(encryptedPayload,roomKey);
      let content='',type='text',fileData=null;
      if(d){content=d.text||'';type=d.type||'text';if(type==='file')fileData=d;}
      if(fileData)addMsg({id:msgId,from:fromGhostId,avatarColor,avatarPhoto,type:'file',fileName:fileData.name,fileSize:fileData.size,fileUrl:fileData.data,timestamp});
      else addMsg({id:msgId,from:fromGhostId,avatarColor,avatarPhoto,content,type,timestamp});
    };
    const onTyp=({fromGhostId,typing:t})=>{if(!isRoom&&fromGhostId!==chat.ghostId)return;setTheirTyping(t);if(t)setTimeout(()=>setTheirTyping(false),3500);};
    const onDel=({msgId})=>setMsgs(p=>p.map(m=>m.id===msgId?{...m,status:'delivered'}:m));
    const onRead=({fromGhostId,msgId})=>{if(fromGhostId!==chat.ghostId)return;setMsgs(p=>p.map(m=>m.id===msgId?{...m,status:'read'}:m));};
    const onPend=()=>setPendingApproval(true);
    socket.on('key:exchange',onKex);socket.on('dm:message',onDM);socket.on('room:message',onRoom);socket.on('dm:typing',onTyp);socket.on('room:typing',onTyp);socket.on('dm:delivered',onDel);socket.on('dm:read',onRead);socket.on('dm:pending',onPend);
    return()=>{socket.off('key:exchange',onKex);socket.off('dm:message',onDM);socket.off('room:message',onRoom);socket.off('dm:typing',onTyp);socket.off('room:typing',onTyp);socket.off('dm:delivered',onDel);socket.off('dm:read',onRead);socket.off('dm:pending',onPend);};
  },[socket,chat,roomKey,isRoom]);

  const addMsg=useCallback(m=>setMsgs(p=>[...p,m]),[]);
  const rmMsg=useCallback(id=>setMsgs(p=>p.filter(m=>m.id!==id)),[]);
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:'smooth'});},[msgs,theirTyping]);

  const handleTyp=e=>{
    setInput(e.target.value);if(!socket)return;
    clearTimeout(typingRef.current);
    isRoom?socket.emit('room:typing',{roomId:chat.id,typing:true}):socket.emit('dm:typing',{toGhostId:chat.ghostId,typing:true});
    typingRef.current=setTimeout(()=>{isRoom?socket.emit('room:typing',{roomId:chat.id,typing:false}):socket.emit('dm:typing',{toGhostId:chat.ghostId,typing:false});},2000);
  };

  const sendMsg=async()=>{
    if(!input.trim()||!socket)return;
    const text=input.trim();setInput('');
    const msgId=uuidv4();const exp=getExp();
    const exAt=exp&&exp>0?Date.now()+exp*1000:null;
    addMsg({id:msgId,from:user.ghostId,content:text,type:'text',timestamp:Date.now(),expiresAt:exAt,status:'sending'});
    const payload={text,type:'text'};
    try{
      if(isRoom&&roomKey){const enc=await encryptRoomMessage(roomKey,payload);socket.emit('room:message',{roomId:chat.id,encryptedPayload:enc,msgId});}
      else if(!isRoom){
        const k=skRef.current;
        // If no key yet (first message / request), send plain so server can show preview
        if(k){const enc=await encryptMessage(k,payload);socket.emit('dm:message',{toGhostId:chat.ghostId,encryptedPayload:enc,msgId,expiresIn:exp});}
        else{
          // Send as plain text — this becomes the message request preview
          socket.emit('dm:message',{toGhostId:chat.ghostId,encryptedPayload:{text,type:'text'},msgId,expiresIn:exp});
          pendRef.current.push({p:payload,id:msgId,exp});
        }
      }
      setMsgs(p=>p.map(m=>m.id===msgId?{...m,status:'sent'}:m));
    }catch(e){showToast('Send failed','error');}
  };

  const sendFile=async file=>{
    if(!file||!socket)return;
    if(file.size>5*1024*1024*1024){showToast('Max file size is 5GB','error');return;}
    showToast(`Sending ${file.name}…`,'info');
    const r=new FileReader();
    r.onload=async ev=>{
      const msgId=uuidv4();
      addMsg({id:msgId,from:user.ghostId,type:'file',fileName:file.name,fileSize:file.size,fileUrl:ev.target.result,timestamp:Date.now(),status:'sent'});
      try{
        const payload={type:'file',name:file.name,size:file.size,data:ev.target.result};
        if(isRoom&&roomKey){const enc=await encryptRoomMessage(roomKey,payload);socket.emit('room:message',{roomId:chat.id,encryptedPayload:enc,msgId,type:'file',fileName:file.name,fileSize:file.size});}
        else if(!isRoom){const k=skRef.current;const enc=k?await encryptMessage(k,payload):payload;socket.emit('dm:message',{toGhostId:chat.ghostId,encryptedPayload:enc,msgId});}
      }catch(e){showToast('File send failed','error');}
    };
    r.readAsDataURL(file);
  };

  const grouped=useMemo(()=>{const g=[];msgs.forEach((m,i)=>{const p=msgs[i-1];const nw=!p||p.from!==m.from||(m.timestamp-p.timestamp)>180000;if(nw)g.push({sender:m.from,aC:m.avatarColor,aP:m.avatarPhoto,msgs:[m]});else g[g.length-1].msgs.push(m);});return g;},[msgs]);
  const expOpts=[{k:'never',l:'Never'},{k:'read',l:'On Read'},{k:'30',l:'30s'},{k:'300',l:'5 min'},{k:'3600',l:'1 hr'},{k:'86400',l:'1 day'},{k:'custom',l:'Custom'}];

  return(
    <div style={{display:'flex',flexDirection:'column',height:'100%',background:'var(--bg)'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'11px 14px',background:'var(--bg2)',borderBottom:'1px solid var(--brd)',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <Av ghostId={isRoom?chat.name:chat.ghostId} color={chat.color} photo={chat.photo} group={isRoom} online={chat.online} size={38}/>
          <div><div style={{fontWeight:700,fontSize:14}}>{isRoom?`# ${chat.name}`:chat.ghostId}</div><div style={{fontSize:11,color:'var(--tx3)'}}>{isRoom?`Code: ${chat.inviteCode}`:(chat.online?'🟢 Online':'⚫ Offline')}</div></div>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <button onClick={()=>setShowExpiryPanel(e=>!e)} style={{background:'none',border:'1px solid var(--brd)',borderRadius:7,padding:'5px 9px',cursor:'pointer',fontSize:11,color:'var(--tx2)',fontFamily:'inherit',fontWeight:600}}>⏱ {expOpts.find(o=>o.k===expiry)?.l||'Custom'}</button>
          {!isRoom&&<><button onClick={()=>onStartCall('audio')} style={{background:'var(--sur2)',border:'1px solid var(--brd)',borderRadius:7,width:34,height:34,cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center'}}>📞</button><button onClick={()=>onStartCall('video')} style={{background:'var(--sur2)',border:'1px solid var(--brd)',borderRadius:7,width:34,height:34,cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center'}}>📹</button></>}
          {isRoom&&<><button onClick={()=>{if(chat.showMembers)chat.showMembers();}} title="Members" style={{background:'var(--sur2)',border:'1px solid var(--brd)',borderRadius:7,width:34,height:34,cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center'}}>👥</button><button onClick={()=>{navigator.clipboard.writeText(chat.inviteCode);showToast('Copied!','success');}} style={{background:'var(--sur2)',border:'1px solid var(--brd)',borderRadius:7,width:34,height:34,cursor:'pointer',fontSize:16,display:'flex',alignItems:'center',justifyContent:'center'}}>🔗</button></>}
        </div>
      </div>

      {/* Expiry panel */}
      {showExpiryPanel&&<div style={{padding:'8px 14px',background:'var(--sur)',borderBottom:'1px solid var(--brd)',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',flexShrink:0}}>
        <span style={{fontSize:11,color:'var(--tx3)',fontWeight:700,whiteSpace:'nowrap'}}>⏱ Disappear:</span>
        {expOpts.map(o=><button key={o.k} onClick={()=>setExpiry(o.k)} style={{padding:'3px 10px',borderRadius:20,border:`1px solid ${expiry===o.k?'var(--ac)':'var(--brd)'}`,background:expiry===o.k?'var(--acg)':'none',color:expiry===o.k?'var(--ac)':'var(--tx3)',cursor:'pointer',fontSize:11,fontWeight:600,fontFamily:'inherit'}}>{o.l}</button>)}
        {expiry==='custom'&&<input type="number" min="5" placeholder="secs" value={customSecs} onChange={e=>setCustomSecs(e.target.value)} style={{width:70,padding:'3px 8px',background:'var(--sur)',border:'1px solid var(--brd)',borderRadius:6,color:'var(--tx)',fontSize:12,outline:'none',fontFamily:'inherit'}}/>}
      </div>}

      {/* Pending approval banner */}
      {pendingApproval&&<div style={{padding:'10px 14px',background:'rgba(245,158,11,.1)',borderBottom:'1px solid rgba(245,158,11,.2)',fontSize:13,color:'#f59e0b',display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
        <span>⏳</span><span>Message request sent. Waiting for {chat.ghostId} to approve it.</span>
        <button onClick={onOpenMsgReqs} style={{marginLeft:'auto',background:'none',border:'1px solid rgba(245,158,11,.4)',borderRadius:6,padding:'3px 10px',color:'#f59e0b',cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>View Settings</button>
      </div>}

      {/* Messages */}
      <div style={{flex:1,overflowY:'auto',padding:'14px',display:'flex',flexDirection:'column',gap:2}}>
        {msgs.length===0&&<div style={{textAlign:'center',color:'var(--tx3)',padding:'50px 20px',display:'flex',flexDirection:'column',alignItems:'center',gap:8}}><div style={{fontSize:36}}>🔒</div><div style={{fontWeight:600,color:'var(--tx2)'}}>End-to-end encrypted</div><div style={{fontSize:13}}>Messages are never stored on our servers.</div></div>}
        {grouped.map((g,gi)=>{
          const isMe=g.sender===user.ghostId;
          return<div key={gi} style={{marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:4,justifyContent:isMe?'flex-end':'flex-start'}}>
              {!isMe&&<Av ghostId={g.sender} color={g.aC||gColor(g.sender)} photo={g.aP} size={18}/>}
              <span style={{fontSize:11,fontWeight:600,color:'var(--tx2)'}}>{isMe?'You':g.sender}</span>
              <span style={{fontSize:10,color:'var(--tx3)'}}>{fmt(g.msgs[0].timestamp)}</span>
            </div>
            {g.msgs.map(m=><Bubble key={m.id} msg={m} isMe={isMe} onExpire={rmMsg}/>)}
          </div>;
        })}
        {theirTyping&&<div style={{display:'flex',alignItems:'center',gap:7,padding:'3px 2px',color:'var(--tx3)',fontSize:12,fontStyle:'italic'}}>
          <div style={{display:'flex',gap:3}}>{[0,1,2].map(i=><div key={i} style={{width:5,height:5,borderRadius:'50%',background:'var(--tx3)',animation:`dotBounce 1.2s ${i*.15}s infinite`}}/>)}</div>
          <span>{isRoom?'Someone is typing…':`${chat.ghostId} is typing…`}</span>
        </div>}
        <div ref={endRef}/>
      </div>

      {/* Input */}
      <div style={{padding:'9px 12px 11px',background:'var(--bg2)',borderTop:'1px solid var(--brd)',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'flex-end',gap:7,background:'var(--sur)',border:'1.5px solid var(--brd)',borderRadius:20,padding:'5px 7px 5px 13px',transition:'border-color .15s'}} onFocus={e=>e.currentTarget.style.borderColor='var(--ac)'} onBlur={e=>e.currentTarget.style.borderColor='var(--brd)'}>
          <textarea style={{flex:1,background:'none',border:'none',outline:'none',fontFamily:'inherit',fontSize:14,color:'var(--tx)',resize:'none',maxHeight:110,padding:'7px 0',lineHeight:1.5,minHeight:32}} rows={1} placeholder={`Message ${isRoom?'#'+chat.name:chat.ghostId}…`} value={input} onChange={handleTyp} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}}} onInput={e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,110)+'px';}}/>
          <input type="file" ref={fileRef} style={{display:'none'}} onChange={e=>{sendFile(e.target.files[0]);e.target.value='';}}/>
          <button onClick={()=>fileRef.current?.click()} title="Attach (up to 5GB)" style={{background:'none',border:'none',color:'var(--tx3)',cursor:'pointer',fontSize:18,width:33,height:33,display:'flex',alignItems:'center',justifyContent:'center',borderRadius:7,flexShrink:0}} onMouseEnter={e=>e.currentTarget.style.color='var(--ac)'} onMouseLeave={e=>e.currentTarget.style.color='var(--tx3)'}>📎</button>
          <button onClick={sendMsg} disabled={!input.trim()} style={{width:34,height:34,borderRadius:'50%',background:input.trim()?'linear-gradient(135deg,var(--ac),var(--ac2))':'var(--sur2)',border:'none',color:input.trim()?'white':'var(--tx3)',fontSize:16,cursor:input.trim()?'pointer':'default',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all .15s'}}>↑</button>
        </div>
      </div>

      <div style={{display:'flex',alignItems:'center',gap:5,padding:'4px 12px',background:'rgba(34,197,94,.04)',borderTop:'1px solid rgba(34,197,94,.08)',flexShrink:0,flexWrap:'wrap'}}>
        <span style={{fontSize:10,color:'#4ade80',fontWeight:700}}>🔒 E2EE</span>
        {['No IP Logs','Ephemeral','Tor Ready'].map(l=><span key={l} style={{padding:'1px 6px',background:'rgba(34,197,94,.07)',border:'1px solid rgba(34,197,94,.1)',borderRadius:20,fontSize:9,color:'#4ade80',fontWeight:700}}>{l}</span>)}
      </div>
    </div>
  );
}

// ── BUBBLE ─────────────────────────────────────────────────────
function Bubble({msg,isMe,onExpire}){
  const[left,setLeft]=useState(null);
  useEffect(()=>{
    if(!msg.expiresAt)return;
    const tick=()=>{const l=Math.max(0,Math.ceil((msg.expiresAt-Date.now())/1000));setLeft(l);if(l<=0&&onExpire)onExpire(msg.id);};
    tick();const t=setInterval(tick,1000);return()=>clearInterval(t);
  },[msg.expiresAt,msg.id,onExpire]);
  const sc={read:'#60a5fa',delivered:'#9ca3af',sent:'#9ca3af',sending:'#555'};
  return(
    <div style={{display:'flex',justifyContent:isMe?'flex-end':'flex-start',marginBottom:2}}>
      <div style={{maxWidth:'72%',padding:msg.type==='file'?'8px 10px':'9px 13px',borderRadius:16,background:isMe?'linear-gradient(135deg,var(--ac),var(--ac2))':'var(--sur)',border:isMe?'none':'1px solid var(--brd)',borderBottomRightRadius:isMe?3:16,borderBottomLeftRadius:isMe?16:3,color:isMe?'white':'var(--tx)',fontSize:14,lineHeight:1.5,wordBreak:'break-word'}}>
        {msg.type==='file'?(
          <div onClick={()=>msg.fileUrl&&window.open(msg.fileUrl)} style={{display:'flex',alignItems:'center',gap:9,cursor:'pointer',minWidth:160}}>
            <span style={{fontSize:26}}>{fIco(msg.fileName)}</span>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:170}}>{msg.fileName||'File'}</div><div style={{fontSize:10,opacity:.7,marginTop:1}}>{fmtSz(msg.fileSize)} · tap to download</div></div>
            <span style={{fontSize:14,opacity:.7}}>⬇️</span>
          </div>
        ):(
          <span style={{whiteSpace:'pre-wrap'}}>{msg.content}</span>
        )}
        {left!==null&&<div style={{fontSize:9,opacity:.6,marginTop:3,display:'flex',alignItems:'center',gap:2}}>⏱ {left>3600?Math.ceil(left/3600)+'h':left>60?Math.ceil(left/60)+'m':left+'s'}</div>}
        {isMe&&msg.status&&<div style={{fontSize:9,color:sc[msg.status]||'#555',marginTop:2,textAlign:'right'}}>{msg.status==='read'?'✓✓ Read':msg.status==='delivered'?'✓✓ Delivered':msg.status==='sent'?'✓ Sent':'⏳ Sending…'}</div>}
      </div>
    </div>
  );
}

// ── CALL UI ────────────────────────────────────────────────────
function CallUI({call,onEnd,onAccept,onReject,localStream,remoteStream}){
  const lRef=useRef();const rRef=useRef();
  useEffect(()=>{if(lRef.current&&localStream)lRef.current.srcObject=localStream;},[localStream]);
  useEffect(()=>{if(rRef.current&&remoteStream)rRef.current.srcObject=remoteStream;},[remoteStream]);
  if(call.status==='incoming')return(
    <div style={{position:'fixed',top:16,right:16,zIndex:9000,background:'var(--sur)',border:'1px solid var(--brd)',borderRadius:16,padding:'14px 18px',boxShadow:'0 8px 32px rgba(0,0,0,.5)',display:'flex',alignItems:'center',gap:12,animation:'slideUp .2s ease',minWidth:240,maxWidth:'calc(100vw - 32px)'}}>
      <Av ghostId={call.with} color={call.color} photo={call.photo} size={46}/>
      <div style={{flex:1,minWidth:0}}><div style={{fontWeight:700,fontSize:14}}>{call.with}</div><div style={{fontSize:12,color:'var(--tx3)'}}>Incoming {call.callType==='video'?'📹 video':'📞 voice'} call…</div></div>
      <div style={{display:'flex',gap:8}}>
        <button onClick={onAccept} style={{width:42,height:42,borderRadius:'50%',background:'#16a34a',border:'none',fontSize:18,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>📞</button>
        <button onClick={onReject} style={{width:42,height:42,borderRadius:'50%',background:'#ef4444',border:'none',fontSize:18,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>📵</button>
      </div>
    </div>
  );
  return(
    <div style={{position:'fixed',inset:0,zIndex:8000,background:'rgba(10,13,20,.97)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:20,backdropFilter:'blur(12px)'}}>
      {call.callType==='video'&&remoteStream?(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,width:'100%',maxWidth:800,padding:14}}>
          <video ref={rRef} autoPlay playsInline style={{width:'100%',borderRadius:14,background:'#000',aspectRatio:'16/9',objectFit:'cover'}}/>
          <video ref={lRef} autoPlay playsInline muted style={{width:'100%',borderRadius:14,background:'#111',aspectRatio:'16/9',objectFit:'cover',opacity:.85}}/>
        </div>
      ):(
        <>
          <div style={{width:100,height:100,borderRadius:'50%',background:call.color||gColor(call.with),display:'flex',alignItems:'center',justifyContent:'center',fontSize:40,fontWeight:800,color:'white',animation:'callPulse 2s infinite',overflow:'hidden'}}>
            {call.photo?<img src={call.photo} style={{width:'100%',height:'100%',objectFit:'cover'}} alt=""/>:(call.with||'?')[0].toUpperCase()}
          </div>
          <div style={{fontSize:26,fontWeight:700,color:'white'}}>{call.with}</div>
          <div style={{fontSize:13,color:'rgba(255,255,255,.5)'}}>{call.status}</div>
        </>
      )}
      <button onClick={onEnd} style={{width:58,height:58,borderRadius:'50%',background:'#ef4444',border:'none',fontSize:24,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'white',marginTop:8}}>📵</button>
    </div>
  );
}


// ── FRIENDS UNDER PROFILE ─────────────────────────────────────
function FriendsUnderProfile({userId,ghostId,onOpenDM,onlineMap}){
  const[friends,setFriends]=useState([]);
  const[show,setShow]=useState(false);
  useEffect(()=>{ api.getFriends().then(d=>setFriends(d.friends||[])).catch(()=>{}); },[userId]);
  if(friends.length===0) return null;
  return(
    <div style={{marginBottom:8}}>
      <button onClick={()=>setShow(s=>!s)} style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 10px',background:'none',border:'none',cursor:'pointer',color:'var(--tx3)',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.6px',fontFamily:'inherit'}}>
        <span>🤝 Friends ({friends.length})</span>
        <span style={{fontSize:10}}>{show?'▲':'▼'}</span>
      </button>
      {show&&<div style={{display:'flex',flexDirection:'column',gap:3,padding:'0 4px 6px'}}>
        {friends.map(f=>(
          <div key={f.id} onClick={()=>onOpenDM(f.ghostId,f.avatarColor,f.avatarPhoto)} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 8px',borderRadius:8,cursor:'pointer',transition:'background .1s'}} onMouseEnter={e=>e.currentTarget.style.background='var(--sur)'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
            <Av ghostId={f.ghostId} color={f.avatarColor} photo={f.avatarPhoto} size={26} online={onlineMap[f.ghostId]||f.status==='online'}/>
            <span style={{fontSize:12,fontWeight:500,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.ghostId}</span>
            {(onlineMap[f.ghostId]||f.status==='online')&&<div style={{width:6,height:6,borderRadius:'50%',background:'#22c55e',flexShrink:0}}/>}
          </div>
        ))}
      </div>}
    </div>
  );
}

// ── REQUESTS TAB ──────────────────────────────────────────────
function RequestsTab({msgRequests,friendRequests,onApproveMsgReq,onDeclineMsgReq,onAcceptFriend,onDeclineFriend}){
  const total=msgRequests.length+friendRequests.length;
  return(
    <div style={{padding:8,display:'flex',flexDirection:'column',gap:6}}>
      {total===0&&<div style={{padding:'20px 8px',textAlign:'center',color:'var(--tx3)',fontSize:12}}>No pending requests</div>}

      {friendRequests.length>0&&<>
        <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:1,color:'var(--tx3)',padding:'4px 8px'}}>Friend Requests</div>
        {friendRequests.map(r=>(
          <div key={r.id} style={{background:'var(--sur)',border:'1px solid var(--brd)',borderRadius:10,padding:'10px',display:'flex',flexDirection:'column',gap:8}}>
            <div style={{display:'flex',alignItems:'center',gap:9}}>
              <Av ghostId={r.from.ghost_id} color={r.from.avatar_color} photo={r.from.avatar_photo} size={34}/>
              <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{r.from.ghost_id}</div><div style={{fontSize:10,color:'var(--tx3)'}}>wants to be friends</div></div>
            </div>
            <div style={{display:'flex',gap:7}}>
              <button onClick={()=>onAcceptFriend(r)} style={{flex:1,padding:'7px',background:'var(--ac)',color:'white',border:'none',borderRadius:7,cursor:'pointer',fontWeight:600,fontSize:12,fontFamily:'inherit'}}>✓ Accept</button>
              <button onClick={()=>onDeclineFriend(r)} style={{flex:1,padding:'7px',background:'var(--sur2)',color:'var(--tx2)',border:'1px solid var(--brd)',borderRadius:7,cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>✕ Decline</button>
            </div>
          </div>
        ))}
      </>}

      {msgRequests.length>0&&<>
        <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:1,color:'var(--tx3)',padding:'4px 8px',marginTop:4}}>Message Requests</div>
        {msgRequests.map(r=>(
          <div key={r.id} style={{background:'var(--sur)',border:'1px solid var(--brd)',borderRadius:10,padding:'10px',display:'flex',flexDirection:'column',gap:8}}>
            <div style={{display:'flex',alignItems:'center',gap:9}}>
              <Av ghostId={r.from.ghost_id} color={r.from.avatar_color} photo={r.from.avatar_photo} size={34}/>
              <div style={{flex:1}}><div style={{fontWeight:600,fontSize:13}}>{r.from.ghost_id}</div><div style={{fontSize:10,color:'var(--tx3)'}}>wants to message you</div></div>
            </div>
            {r.first_message&&<div style={{padding:'7px 10px',background:'var(--sur2)',borderRadius:7,fontSize:12,color:'var(--tx2)',borderLeft:'2px solid var(--brd2)',fontStyle:'italic',wordBreak:'break-word'}}>"{r.first_message}"</div>}
            <div style={{display:'flex',gap:7}}>
              <button onClick={()=>onApproveMsgReq(r)} style={{flex:1,padding:'7px',background:'var(--ac)',color:'white',border:'none',borderRadius:7,cursor:'pointer',fontWeight:600,fontSize:12,fontFamily:'inherit'}}>✓ Accept</button>
              <button onClick={()=>onDeclineMsgReq(r)} style={{flex:1,padding:'7px',background:'rgba(239,68,68,.08)',color:'#ef4444',border:'1px solid rgba(239,68,68,.2)',borderRadius:7,cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>✕ Decline</button>
            </div>
          </div>
        ))}
      </>}
    </div>
  );
}

// ── MAIN APP ───────────────────────────────────────────────────
const ICE={iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]};

export default function MainApp(){
  const{user,logout}=useAuth();
  const{socket}=useSocket();
  const[userData,setUserData]=useState(user);
  const[theme,setTheme]=useState(()=>localStorage.getItem('gl_theme')||'dark');
  const[view,setView]=useState('chat');
  const[activeChat,setActiveChat]=useState(null);
  const[dms,setDms]=useState([]);
  const[rooms,setRooms]=useState([]);
  const[tab,setTab]=useState('dms');
  const[msgRequests,setMsgRequests]=useState([]);
  const[friendRequests,setFriendRequests]=useState([]);
  const msgRequestCount=msgRequests.length+friendRequests.length;
  const[search,setSearch]=useState('');
  const[results,setResults]=useState([]);
  const[onlineMap,setOnlineMap]=useState({});
  const[modal,setModal]=useState(null);
  const[roomMembersChat,setRoomMembersChat]=useState(null);
  const[call,setCall]=useState(null);
  const[localStream,setLocalStream]=useState(null);
  const[remoteStream,setRemoteStream]=useState(null);
  const[toast,setToast]=useState(null);
  const[sidebarOpen,setSidebarOpen]=useState(false);
  const[unreadMap,setUnreadMap]=useState({});
  const peerRef=useRef(null);
  const ringCtxRef=useRef(null);
  const ringIntRef=useRef(null);
  const activeChatRef=useRef(null);
  const isMobile=window.innerWidth<=700;

  const showToast=(msg,type='success')=>setToast({msg,type,id:Date.now()});

  useEffect(()=>{
    document.documentElement.setAttribute('data-theme',theme);
    localStorage.setItem('gl_theme',theme);
  },[theme]);

  // Keep activeChatRef in sync so socket handlers can access current chat without stale closure
  useEffect(()=>{ activeChatRef.current=activeChat; },[activeChat]);

  useEffect(()=>{
    api.getRooms().then(({rooms:r})=>setRooms(r)).catch(()=>{});
    api.getMsgRequests().then(({requests})=>setMsgRequests(requests||[])).catch(()=>{});
    api.getFriendRequests().then(({requests})=>setFriendRequests(requests||[])).catch(()=>{});
    requestNotifPerm();
  },[]);

  const startRing=()=>{
    try{
      stopRing(); // stop any existing ring first
      const ctx=new(window.AudioContext||window.webkitAudioContext)();
      ringCtxRef.current=ctx;
      // Resume context if suspended (browser autoplay policy)
      const doRing=()=>{ if(ctx.state==='suspended') ctx.resume().then(()=>createRing(ctx)); else createRing(ctx); };
      doRing();
      ringIntRef.current=setInterval(doRing,2500);
    }catch(e){console.warn('Ring failed',e);}
  };;
  const stopRing=()=>{clearInterval(ringIntRef.current);try{ringCtxRef.current?.close();}catch{};ringCtxRef.current=null;};

  useEffect(()=>{
    if(!socket)return;
    socket.on('user-status',({ghostId,status})=>{setOnlineMap(p=>({...p,[ghostId]:status==='online'}));setDms(p=>p.map(d=>d.ghostId===ghostId?{...d,online:status==='online'}:d));});
    socket.on('call:offer',({fromGhostId,offer,callType,avatarColor,avatarPhoto})=>{setCall({with:fromGhostId,color:avatarColor||gColor(fromGhostId),photo:avatarPhoto,status:'incoming',incoming:true,callType,offer});startRing();});
    socket.on('call:end',()=>{stopRing();endCall(false);});
    // When someone approves our message request, clear pending state
    socket.on('msgrequest:approved',({fromGhostId})=>{
      showToast(`${fromGhostId} accepted your message request — you can now chat!`,'success');
    });
    socket.on('room:kicked',({roomId})=>{
      setRooms(p=>p.filter(r=>r.id!==roomId));
      if(activeChatRef.current?.id===roomId) setActiveChat(null);
      showToast('You were removed from the room by an admin','error');
    });
    socket.on('room:added',({roomId,roomName,by})=>{
      showToast(`You were added to #${roomName} by ${by}`,'info');
      api.getRooms().then(({rooms:r})=>setRooms(r)).catch(()=>{});
    });
    socket.on('call:rejected',()=>{stopRing();endCall(false);showToast('Call declined','warn');});
    socket.on('call:failed',({reason})=>{showToast(reason||'Call failed','error');endCall(false);});
    // Notification for new messages when chat not open
    socket.on('dm:message',({fromGhostId,timestamp})=>{
      // Only show notification & unread if not currently viewing that chat
      const currentChat = activeChatRef.current;
      const isViewingChat = currentChat?.type==='dm' && currentChat?.ghostId===fromGhostId;
      if(!isViewingChat){
        if(document.hidden||!isViewingChat) sendNotif(`💬 ${fromGhostId}`, 'New message — open GhostLink to read');
        setUnreadMap(p=>({...p,[fromGhostId]:(p[fromGhostId]||0)+1}));
      }
    });
    socket.on('new:msgrequest',({fromGhostId,avatarColor,avatarPhoto,firstMessage})=>{
      sendNotif(`💬 Message request from ${fromGhostId}`,firstMessage||'New message request');
      showToast(`Message request from ${fromGhostId}`,'info');
      setMsgRequests(p=>[...p,{id:Date.now().toString(),from:{ghost_id:fromGhostId,avatar_color:avatarColor,avatar_photo:avatarPhoto},first_message:firstMessage,created_at:Date.now()}]);
    });
    return()=>{socket.off('user-status');socket.off('call:offer');socket.off('call:end');socket.off('call:rejected');socket.off('call:failed');socket.off('dm:message');socket.off('new:msgrequest');socket.off('room:kicked');socket.off('room:added');socket.off('msgrequest:approved');};
  },[socket]);

  useEffect(()=>{
    if(!search.trim()){setResults([]);return;}
    const t=setTimeout(async()=>{try{const{users}=await api.searchUsers(search);setResults(users);}catch{}},300);
    return()=>clearTimeout(t);
  },[search]);

  const openDM=async(ghostId,color,photo)=>{
    setSearch('');setResults([]);
    setUnreadMap(p=>({...p,[ghostId]:0}));
    if(!dms.find(d=>d.ghostId===ghostId)){
      try{const{user:u}=await api.getUser(ghostId);setDms(p=>[...p,{ghostId,color:u.avatar_color||color,photo:u.avatar_photo||photo,online:u.status==='online',isFriend:u.is_friend}]);}
      catch{setDms(p=>[...p,{ghostId,color:color||gColor(ghostId),online:false}]);}
    }
    setActiveChat({type:'dm',ghostId,color:color||gColor(ghostId),photo,online:onlineMap[ghostId]||false});
    setView('chat');setSidebarOpen(false);
  };

  const openRoom=r=>{
    const chatObj={type:'room',id:r.id,name:r.name,inviteCode:r.inviteCode,color:gColor(r.name),creatorId:r.creatorId,membersCanInvite:r.membersCanInvite};
    chatObj.showMembers=()=>setRoomMembersChat(chatObj);
    setActiveChat(chatObj);setView('chat');setSidebarOpen(false);
  };

  const addFriend=async ghostId=>{try{await api.sendFriendRequest(ghostId);showToast('Friend request sent!','success');}catch(e){showToast(e.message,'error');}};
  const blockUser=async ghostId=>{if(!window.confirm(`Block ${ghostId}?`))return;try{await api.blockUser(ghostId);showToast(`Blocked ${ghostId}`,'warn');setDms(p=>p.filter(d=>d.ghostId!==ghostId));if(activeChat?.ghostId===ghostId)setActiveChat(null);}catch(e){showToast(e.message,'error');}};

  const startCall=async type=>{
    if(!activeChat||activeChat.type==='room')return;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:type==='video'});
      setLocalStream(stream);
      const pc=new RTCPeerConnection(ICE);peerRef.current=pc;
      stream.getTracks().forEach(t=>pc.addTrack(t,stream));
      const rs=new MediaStream();
      pc.ontrack=({track})=>{rs.addTrack(track);setRemoteStream(new MediaStream(rs.getTracks()));};
      pc.onicecandidate=({candidate})=>{if(candidate)socket?.emit('call:ice',{toGhostId:activeChat.ghostId,candidate});};
      const offer=await pc.createOffer();await pc.setLocalDescription(offer);
      socket?.emit('call:offer',{toGhostId:activeChat.ghostId,offer,callType:type});
      setCall({with:activeChat.ghostId,color:activeChat.color,photo:activeChat.photo,status:'Calling…',callType:type});
    }catch{showToast('Camera/mic access denied','error');}
  };
  const acceptCall=async()=>{
    if(!call)return;stopRing();
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:call.callType==='video'});
      setLocalStream(stream);
      const pc=new RTCPeerConnection(ICE);peerRef.current=pc;
      stream.getTracks().forEach(t=>pc.addTrack(t,stream));
      const rs=new MediaStream();
      pc.ontrack=({track})=>{rs.addTrack(track);setRemoteStream(new MediaStream(rs.getTracks()));};
      pc.onicecandidate=({candidate})=>{if(candidate)socket?.emit('call:ice',{toGhostId:call.with,candidate});};
      await pc.setRemoteDescription(call.offer);
      const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
      socket?.emit('call:answer',{toGhostId:call.with,answer});
      setCall(p=>({...p,status:'Connected',incoming:false}));
    }catch{showToast('Mic/camera access denied','error');endCall(false);}
  };
  const rejectCall=()=>{stopRing();if(call)socket?.emit('call:reject',{toGhostId:call.with});setCall(null);};
  useEffect(()=>{
    if(!socket)return;
    const onAns=async({answer})=>{try{await peerRef.current?.setRemoteDescription(answer);setCall(p=>p?{...p,status:'Connected'}:p);}catch{}};
    const onICE=async({candidate})=>{try{await peerRef.current?.addIceCandidate(candidate);}catch{}};
    socket.on('call:answer',onAns);socket.on('call:ice',onICE);
    return()=>{socket.off('call:answer',onAns);socket.off('call:ice',onICE);};
  },[socket]);
  const endCall=(notify=true)=>{stopRing();peerRef.current?.close();peerRef.current=null;localStream?.getTracks().forEach(t=>t.stop());setLocalStream(null);setRemoteStream(null);if(notify&&call)socket?.emit('call:end',{toGhostId:call.with});setCall(null);};

  const handleUserUpdate=u=>{setUserData(u);localStorage.setItem('gl_user',JSON.stringify(u));};
  const handleTheme=t=>{setTheme(t);};

  const vars=theme==='dark'?DARK:LIGHT;

  return(
    <div style={{display:'flex',height:'100dvh',overflow:'hidden',fontFamily:"'Plus Jakarta Sans',sans-serif",...vars,background:'var(--bg)',color:'var(--tx)'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--brd2);border-radius:4px}
        @keyframes slideUp{from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes dotBounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}
        @keyframes callPulse{0%{box-shadow:0 0 0 0 rgba(79,142,247,.5)}70%{box-shadow:0 0 0 20px rgba(79,142,247,0)}100%{box-shadow:0 0 0 0 rgba(79,142,247,0)}}
        input,textarea{font-family:inherit;font-size:inherit;color:var(--tx);background:var(--sur);}
        input::placeholder,textarea::placeholder{color:var(--tx3);}
      `}</style>

      {/* Mobile FAB */}
      {isMobile&&<button onClick={()=>setSidebarOpen(s=>!s)} style={{position:'fixed',bottom:20,left:16,zIndex:300,width:48,height:48,borderRadius:'50%',background:'var(--ac)',border:'none',color:'white',fontSize:20,cursor:'pointer',boxShadow:'0 4px 16px rgba(0,0,0,.3)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:400}}>{sidebarOpen?'✕':'☰'}</button>}
      {isMobile&&sidebarOpen&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:199}} onClick={()=>setSidebarOpen(false)}/>}

      {/* SIDEBAR */}
      <div style={{width:272,flexShrink:0,display:'flex',flexDirection:'column',background:'var(--sbar)',borderRight:'1px solid var(--brd)',zIndex:200,...(isMobile?{position:'fixed',inset:'0 auto 0 0',transform:sidebarOpen?'translateX(0)':'translateX(-100%)',transition:'transform .25s ease',width:'80%',maxWidth:290}:{})}}>
        {/* Brand */}
        <div style={{padding:'12px 12px 10px',borderBottom:'1px solid var(--brd)'}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <img src="/ghost-logo.png" alt="GhostLink" style={{width:28,height:28,objectFit:'contain'}} onError={e=>e.target.style.display='none'}/>
              <span style={{fontSize:16,fontWeight:800,background:'linear-gradient(135deg,var(--ac),var(--ac2))',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>GhostLink</span>
            </div>
            <button onClick={()=>{setView('settings');setSidebarOpen(false);}} style={{background:'var(--sur2)',border:'1px solid var(--brd)',borderRadius:7,width:32,height:32,cursor:'pointer',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--tx2)'}}>⚙️</button>
          </div>
          <div onClick={()=>{setView('settings');setSidebarOpen(false);}} style={{display:'flex',alignItems:'center',gap:9,padding:'8px 10px',background:'var(--sur2)',borderRadius:9,cursor:'pointer',border:'1px solid var(--brd)',marginBottom:9}}>
            <Av ghostId={userData.ghostId} color={gColor(userData.ghostId)} photo={userData.avatarPhoto} size={28} online={true}/>
            <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'var(--tx2)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>@{userData.ghostId}</span>
            <div style={{width:7,height:7,borderRadius:'50%',background:'#22c55e',boxShadow:'0 0 5px #22c55e'}}/>
          </div>
          {/* Friends quick list */}
          <FriendsUnderProfile userId={userData.id} ghostId={userData.ghostId} onOpenDM={(gId,color,photo)=>{openDM(gId,color,photo);setSidebarOpen(false);}} onlineMap={onlineMap}/>

          {/* Search */}
          <div style={{position:'relative'}}>
            <span style={{position:'absolute',left:9,top:'50%',transform:'translateY(-50%)',fontSize:12,color:'var(--tx3)',pointerEvents:'none'}}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search GhostID…" style={{width:'100%',padding:'8px 10px 8px 28px',background:'var(--sur2)',border:'1.5px solid var(--brd)',borderRadius:8,color:'var(--tx)',fontSize:12,outline:'none',fontFamily:'inherit'}} onFocus={e=>e.target.style.borderColor='var(--ac)'} onBlur={e=>e.target.style.borderColor='var(--brd)'}/>
            {results.length>0&&<div style={{position:'absolute',top:'calc(100%+6px)',left:0,right:0,background:'var(--sur)',border:'1px solid var(--brd)',borderRadius:10,boxShadow:'0 8px 32px rgba(0,0,0,.35)',zIndex:50,overflow:'hidden',maxHeight:300,overflowY:'auto'}}>
              {results.map(u=><div key={u.ghost_id} style={{padding:'9px 12px',cursor:'pointer',display:'flex',alignItems:'center',gap:9,transition:'background .1s'}} onMouseEnter={e=>e.currentTarget.style.background='var(--sur2)'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                <Av ghostId={u.ghost_id} color={u.avatar_color} photo={u.avatar_photo} size={32} online={u.status==='online'}/>
                <div style={{flex:1,minWidth:0}} onClick={()=>openDM(u.ghost_id,u.avatar_color,u.avatar_photo)}>
                  <div style={{fontSize:13,fontWeight:600}}>{u.ghost_id}</div>
                  <div style={{fontSize:10,color:'var(--tx3)'}}>{u.status==='online'?'🟢 online':'⚫ offline'}{u.is_friend?' · 🤝 friend':''}</div>
                </div>
                <div style={{display:'flex',gap:5,flexShrink:0}}>
                  {!u.is_friend&&!u.is_blocked&&<button onClick={e=>{e.stopPropagation();addFriend(u.ghost_id);}} style={{background:'var(--acg)',border:'1px solid var(--ac)',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:10,color:'var(--ac)',fontWeight:700,fontFamily:'inherit'}}>+ Add</button>}
                  <button onClick={e=>{e.stopPropagation();blockUser(u.ghost_id);}} style={{background:'rgba(239,68,68,.08)',border:'1px solid rgba(239,68,68,.2)',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:10,color:'#ef4444',fontWeight:700,fontFamily:'inherit'}}>Block</button>
                </div>
              </div>)}
            </div>}
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:'flex',borderBottom:'1px solid var(--brd)'}}>
          {[['dms','Messages'],['requests','Requests'],['rooms','Rooms']].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:'9px 4px',textAlign:'center',background:'none',border:'none',borderBottom:`2px solid ${tab===k?'var(--ac)':'transparent'}`,color:tab===k?'var(--ac)':'var(--tx3)',fontFamily:'inherit',fontSize:10,fontWeight:700,cursor:'pointer',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:-1,transition:'all .15s',position:'relative'}}>
              {l}
              {k==='requests'&&msgRequestCount>0&&<span style={{position:'absolute',top:6,right:4,background:'var(--ac)',color:'white',fontSize:9,fontWeight:700,minWidth:14,height:14,borderRadius:7,display:'inline-flex',alignItems:'center',justifyContent:'center',padding:'0 3px'}}>{msgRequestCount}</span>}
            </button>
          ))}
        </div>

        {/* List */}
        <div style={{flex:1,overflowY:'auto',padding:7}}>
          {tab==='requests'&&<RequestsTab
            msgRequests={msgRequests}
            friendRequests={friendRequests}
            onApproveMsgReq={async(r)=>{
              await api.approveMsgRequest(r.from.ghost_id);
              setMsgRequests(p=>p.filter(x=>x.id!==r.id));
              // Notify the sender via socket that they can now message
              socket?.emit('msgrequest:approved',{toGhostId:r.from.ghost_id});
              showToast(`${r.from.ghost_id} can now message you`,'success');
              openDM(r.from.ghost_id,r.from.avatar_color,r.from.avatar_photo);
            }}
            onDeclineMsgReq={async(r)=>{
              await api.declineMsgRequest(r.from.ghost_id);
              setMsgRequests(p=>p.filter(x=>x.id!==r.id));
              showToast('Declined','warn');
            }}
            onAcceptFriend={async(r)=>{
              await api.acceptFriendRequest(r.id);
              setFriendRequests(p=>p.filter(x=>x.id!==r.id));
              showToast('Friend added!','success');
            }}
            onDeclineFriend={async(r)=>{
              await api.declineFriendRequest(r.id);
              setFriendRequests(p=>p.filter(x=>x.id!==r.id));
            }}
          />}
          {tab==='dms'&&<>
            {dms.length===0&&<div style={{padding:'18px 8px',textAlign:'center',color:'var(--tx3)',fontSize:12}}>Search a GhostID above<br/>to start chatting</div>}
            {dms.map(dm=>{
              const isActive=activeChat?.ghostId===dm.ghostId&&view==='chat';
              const unread=unreadMap[dm.ghostId]||0;
              return<div key={dm.ghostId} onClick={()=>openDM(dm.ghostId,dm.color,dm.photo)} style={{display:'flex',alignItems:'center',gap:9,padding:'9px 10px',borderRadius:9,cursor:'pointer',background:isActive?'var(--sur2)':'none',borderLeft:`3px solid ${isActive?'var(--ac)':'transparent'}`,marginBottom:2,transition:'background .1s'}} onMouseEnter={e=>!isActive&&(e.currentTarget.style.background='var(--sur)')} onMouseLeave={e=>!isActive&&(e.currentTarget.style.background='none')}>
                <Av ghostId={dm.ghostId} color={dm.color} photo={dm.photo} size={36} online={dm.online||onlineMap[dm.ghostId]}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{dm.ghostId}</div>
                  <div style={{fontSize:10,color:'var(--tx3)',marginTop:1}}>🔒 {dm.online||onlineMap[dm.ghostId]?'online':'offline'}</div>
                </div>
                {unread>0&&<div style={{background:'var(--ac)',color:'white',fontSize:10,fontWeight:700,minWidth:18,height:18,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 5px'}}>{unread}</div>}
              </div>;
            })}
          </>}
          {tab==='rooms'&&<>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'5px 8px 3px'}}>
              <span style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:1,color:'var(--tx3)'}}>Rooms</span>
              <div style={{display:'flex',gap:4}}>
                <button onClick={()=>setModal('create')} title="Create" style={{width:24,height:24,borderRadius:5,background:'var(--sur2)',border:'1px solid var(--brd)',cursor:'pointer',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--tx2)'}}>＋</button>
                <button onClick={()=>setModal('join')} title="Join" style={{width:24,height:24,borderRadius:5,background:'var(--sur2)',border:'1px solid var(--brd)',cursor:'pointer',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--tx2)'}}>→</button>
              </div>
            </div>
            {rooms.length===0&&<div style={{padding:'16px 8px',textAlign:'center',color:'var(--tx3)',fontSize:12}}>No rooms yet.<br/>Create or join one!</div>}
            {rooms.map(r=>{
              const isActive=activeChat?.id===r.id&&view==='chat';
              return<div key={r.id} style={{display:'flex',alignItems:'center',gap:9,padding:'9px 10px',borderRadius:9,cursor:'pointer',background:isActive?'var(--sur2)':'none',borderLeft:`3px solid ${isActive?'var(--ac)':'transparent'}`,marginBottom:2,transition:'background .1s'}} onClick={()=>openRoom(r)} onMouseEnter={e=>!isActive&&(e.currentTarget.style.background='var(--sur)')} onMouseLeave={e=>!isActive&&(e.currentTarget.style.background='none')}>
                <Av ghostId={r.name} color={gColor(r.name)} group size={36}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}># {r.name}</div>
                  <div style={{fontSize:10,color:'var(--tx3)',fontFamily:"'JetBrains Mono',monospace",marginTop:1}}>{r.inviteCode}</div>
                </div>
                <button onClick={e=>{e.stopPropagation();setModal({type:'invite',room:r});}} style={{width:26,height:26,borderRadius:5,background:'var(--sur2)',border:'1px solid var(--brd)',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>🔗</button>
              </div>;
            })}
          </>}
        </div>

        <div style={{padding:'9px',borderTop:'1px solid var(--brd)',display:'flex',gap:7}}>
          <button onClick={()=>{setView('settings');setSidebarOpen(false);}} style={{flex:1,padding:'8px',background:'var(--sur2)',border:'1px solid var(--brd)',borderRadius:7,color:'var(--tx2)',cursor:'pointer',fontSize:11,fontWeight:600,fontFamily:'inherit'}}>⚙️ Settings</button>
          <button onClick={logout} style={{flex:1,padding:'8px',background:'rgba(239,68,68,.07)',border:'1px solid rgba(239,68,68,.18)',borderRadius:7,color:'#ef4444',cursor:'pointer',fontSize:11,fontWeight:600,fontFamily:'inherit'}}>🚪 Sign Out</button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,background:'var(--bg)'}}>
        {view==='settings'&&<Settings user={userData} theme={theme} onTheme={handleTheme} onUpdate={handleUserUpdate} onBack={()=>setView('chat')} showToast={showToast}/>}
        {view==='chat'&&(activeChat
          ?<ChatView key={activeChat.id||activeChat.ghostId} chat={{...activeChat,online:activeChat.type==='dm'?(onlineMap[activeChat.ghostId]||activeChat.online):false}} user={userData} socket={socket} onStartCall={startCall} showToast={showToast} onOpenMsgReqs={()=>setView('settings')}/>
          :<div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:9,color:'var(--tx3)',padding:40,textAlign:'center'}}>
            <div style={{fontSize:52,opacity:.2}}>👻</div>
            <h3 style={{fontSize:19,fontWeight:700,color:'var(--tx2)'}}>Welcome to GhostLink</h3>
            <p style={{fontSize:13,maxWidth:280}}>Search a GhostID to start a private encrypted chat, or create/join a room</p>
            <div style={{display:'flex',flexWrap:'wrap',gap:7,justifyContent:'center',marginTop:10}}>
              {['🔒 E2E Encrypted','💨 Disappears on Read','📵 No phone needed','🌐 Tor Compatible','📞 Voice & Video','📁 5GB files','🤝 Friend Requests','🚫 Block Users'].map(l=><span key={l} style={{padding:'4px 10px',background:'var(--sur)',border:'1px solid var(--brd)',borderRadius:20,fontSize:11,color:'var(--tx2)'}}>{l}</span>)}
            </div>
          </div>
        )}
      </div>

      {/* MODALS */}
      {modal==='create'&&<Modal title="🏠 Create Room" onClose={()=>setModal(null)}><RoomForm mode="create" onDone={r=>{setRooms(p=>[...p,r]);setModal(null);openRoom(r);showToast(`Room #${r.name} created!`);}} onClose={()=>setModal(null)} showToast={showToast}/></Modal>}
      {modal==='join'&&<Modal title="→ Join Room" onClose={()=>setModal(null)}><RoomForm mode="join" onDone={r=>{setRooms(p=>[...p.filter(x=>x.id!==r.id),r]);setModal(null);openRoom(r);showToast(`Joined #${r.name}!`);}} onClose={()=>setModal(null)} showToast={showToast}/></Modal>}
      {modal?.type==='invite'&&<Modal title={`🔗 Invite to #${modal.room.name}`} onClose={()=>setModal(null)}>
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <p style={{fontSize:13,color:'var(--tx2)'}}>Share this code with anyone you want to invite.</p>
          <div onClick={()=>{navigator.clipboard.writeText(modal.room.inviteCode);showToast('Copied!');}} style={{fontFamily:"'JetBrains Mono',monospace",fontSize:22,fontWeight:700,letterSpacing:3,textAlign:'center',padding:14,background:'var(--sur2)',border:'1.5px solid var(--brd)',borderRadius:10,cursor:'pointer',color:'var(--ac)'}}>{modal.room.inviteCode}</div>
          <p style={{textAlign:'center',fontSize:11,color:'var(--tx3)'}}>Click to copy</p>
          <Btn variant="secondary" onClick={()=>setModal(null)} style={{width:'100%'}}>Close</Btn>
        </div>
      </Modal>}

      {roomMembersChat&&<RoomMembers room={roomMembersChat} myUserId={userData.id} myGhostId={userData.ghostId} socket={socket} onClose={()=>setRoomMembersChat(null)} showToast={showToast} onLeave={rid=>{setRooms(p=>p.filter(r=>r.id!==rid));if(activeChat?.id===rid)setActiveChat(null);}} onRoomUpdate={updatedRoom=>{setRooms(p=>p.map(r=>r.id===updatedRoom.id?updatedRoom:r));}}/>}
      {call&&<CallUI call={call} onEnd={()=>endCall(true)} onAccept={acceptCall} onReject={rejectCall} localStream={localStream} remoteStream={remoteStream}/>}
      {toast&&<Toast key={toast.id} msg={toast.msg} type={toast.type} onDone={()=>setToast(null)}/>}
    </div>
  );
}

function RoomForm({mode,onDone,onClose,showToast}){
  const[val,setVal]=useState('');const[loading,setLoading]=useState(false);
  const go=async()=>{setLoading(true);try{const{room}=mode==='create'?await api.createRoom(val.trim()):await api.joinRoom(val.trim());onDone(room);}catch(e){showToast(e.message,'error');}finally{setLoading(false);};};
  return<div style={{display:'flex',flexDirection:'column',gap:14}}>
    <Field label={mode==='create'?'Room Name':'Invite Code'}><Inp autoFocus value={val} onChange={e=>setVal(mode==='create'?e.target.value:e.target.value.toUpperCase())} placeholder={mode==='create'?'e.g. dev-team':'e.g. X7KP2MNQ'} mono={mode==='join'} onKeyDown={e=>e.key==='Enter'&&go()}/></Field>
    <div style={{display:'flex',gap:9}}><Btn variant="secondary" onClick={onClose} style={{flex:1}}>Cancel</Btn><Btn onClick={go} disabled={loading||!val.trim()} style={{flex:1}}>{loading?'…':mode==='create'?'✨ Create':'→ Join'}</Btn></div>
  </div>;
}
