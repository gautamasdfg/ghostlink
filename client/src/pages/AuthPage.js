import React, { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';

function pwStrength(p) {
  if (!p) return { score: 0, label: '', color: '#333' };
  let score = 0;
  const checks = {
    length: p.length >= 10,
    upper: /[A-Z]/.test(p),
    lower: /[a-z]/.test(p),
    number: /[0-9]/.test(p),
    special: /[^A-Za-z0-9]/.test(p),
    long: p.length >= 14,
  };
  score = Object.values(checks).filter(Boolean).length;
  const common = ['password','123456','qwerty','letmein','welcome','admin'];
  if (common.some(c => p.toLowerCase().includes(c))) score = Math.min(score, 1);
  if (score <= 2) return { score, label: 'Weak', color: '#ef4444', checks };
  if (score <= 4) return { score, label: 'Fair', color: '#f59e0b', checks };
  if (score <= 5) return { score, label: 'Strong', color: '#22c55e', checks };
  return { score, label: 'Very Strong', color: '#06b6d4', checks };
}

export default function AuthPage() {
  const { login, register } = useAuth();
  const [tab, setTab] = useState('login');
  const [form, setForm] = useState({ ghostId:'', password:'', confirm:'' });
  const [captcha, setCaptcha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const set = k => e => setForm(f => ({...f, [k]: e.target.value}));
  const strength = useMemo(() => pwStrength(form.password), [form.password]);

  const submit = async e => {
    e.preventDefault(); setError('');
    if (tab === 'register') {
      if (!captcha) return setError('Please confirm you are not a robot');
      if (form.password !== form.confirm) return setError('Passwords do not match');
      if (strength.score < 4) return setError('Please use a stronger password — see requirements below');
    }
    setLoading(true);
    try { tab==='login' ? await login(form.ghostId, form.password) : await register(form.ghostId, form.password); }
    catch(e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const reqItems = [
    ['length', '10+ characters'],
    ['upper', 'Uppercase letter (A-Z)'],
    ['lower', 'Lowercase letter (a-z)'],
    ['number', 'Number (0-9)'],
    ['special', 'Special character (!@#$%...)'],
  ];

  return (
    <div className="auth-wrap">
      <div className="auth-panel">
        <div className="auth-logo">
          <img src="/ghost-logo.png" alt="" style={{width:36,height:36,objectFit:'contain'}} onError={e=>e.target.style.display='none'}/>
          <span className="nm">GhostLink</span>
        </div>
        <div className="auth-tabs">
          <button className={`auth-tab${tab==='login'?' active':''}`} onClick={()=>{setTab('login');setError('');}}>Sign In</button>
          <button className={`auth-tab${tab==='register'?' active':''}`} onClick={()=>{setTab('register');setError('');}}>Create Account</button>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <div className="a-field">
            <label>GhostID</label>
            <input className="a-input" style={{fontFamily:"'JetBrains Mono',monospace",letterSpacing:1}} value={form.ghostId} onChange={set('ghostId')} placeholder="e.g. shadow_wolf" required autoComplete="username"/>
            <span className="a-hint">3–24 chars · letters, numbers, _ and -</span>
          </div>
          <div className="a-field">
            <label>Password</label>
            <input className="a-input" type="password" value={form.password} onChange={set('password')} placeholder={tab==='register'?'Min 10 chars, mixed case + number + symbol':'Your password'} required autoComplete={tab==='login'?'current-password':'new-password'}/>
            {tab==='register' && form.password.length > 0 && (
              <div style={{marginTop:8}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                  <div style={{display:'flex',gap:3,flex:1}}>
                    {[1,2,3,4,5,6].map(i=><div key={i} style={{height:4,flex:1,borderRadius:2,background:i<=strength.score?strength.color:'#2a3450',transition:'all .3s'}}/>)}
                  </div>
                  <span style={{fontSize:11,fontWeight:700,color:strength.color,marginLeft:8,minWidth:70,textAlign:'right'}}>{strength.label}</span>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:2}}>
                  {reqItems.map(([k,l])=><div key={k} style={{fontSize:11,display:'flex',alignItems:'center',gap:5,color:strength.checks?.[k]?'#22c55e':'#4a5a7a'}}>
                    <span>{strength.checks?.[k]?'✓':'○'}</span><span>{l}</span>
                  </div>)}
                </div>
              </div>
            )}
          </div>
          {tab==='register' && <>
            <div className="a-field">
              <label>Confirm Password</label>
              <input className="a-input" type="password" value={form.confirm} onChange={set('confirm')} placeholder="Repeat password" required autoComplete="new-password"/>
              {form.confirm && <span style={{fontSize:11,color:form.password===form.confirm?'#22c55e':'#ef4444'}}>{form.password===form.confirm?'✓ Passwords match':'✗ Passwords do not match'}</span>}
            </div>
            <div className="captcha-row" onClick={()=>setCaptcha(c=>!c)}>
              <div className={`captcha-box${captcha?' ok':''}`}>{captcha?'✓':''}</div>
              <span className="captcha-label">I am not a robot</span>
              <span style={{marginLeft:'auto',fontSize:22}}>👻</span>
            </div>
          </>}
          {error && <div className="auth-error">⚠️ {error}</div>}
          <button className="auth-btn" type="submit" disabled={loading}>
            {loading ? '⏳ Please wait…' : tab==='login' ? '→ Sign In' : '✨ Create GhostID'}
          </button>
        </form>
        <div className="auth-note" style={{marginTop:16}}>
          🔒 <strong>Privacy first:</strong> GhostLink stores only your GhostID and hashed password. No email, no phone number, no IP address ever logged.
        </div>
      </div>
      <div className="auth-hero">
        <h2 className="hero-title">Private.<br/>Encrypted.<br/>Ephemeral.</h2>
        <p className="hero-sub">Your GhostID is all you need.</p>
        <div className="hero-feats">
          {[['🔐','End-to-End Encrypted','New keys every session. Server never reads messages.'],
            ['💨','Disappears on Read','Messages vanish when seen. Your choice to change it.'],
            ['👤','Zero Identity','No phone, no email. Just a GhostID and password.'],
            ['🌐','Tor Compatible','No IP logging. Works perfectly over Tor Browser.'],
            ['🤝','Message Requests','Strangers need your approval before they can chat.'],
            ['👑','Room Admins','Full admin controls — kick, add, promote members.'],
          ].map(([fi,title,desc])=>(
            <div className="hero-feat" key={title}>
              <span className="fi">{fi}</span>
              <div><h4>{title}</h4><p>{desc}</p></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
