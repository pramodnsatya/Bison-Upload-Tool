import { useState, useEffect } from 'react';

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Logic helpers ────────────────────────────────────────────────────────────
function calcNeeded(count, type) { return Math.ceil(count / (type === 'outlook' ? 5 : 15)); }

function parseEmailCopy(raw) {
  const blocks = raw.split(/---\s*EMAIL\s*\d+\s*---/i).filter(b => b.trim());
  return blocks.map((block, i) => {
    const subj = block.match(/^Subject:\s*(.+)/im);
    return { subject: subj ? subj[1].trim() : '', body: block.replace(/^Subject:\s*.+\n?/im, '').trim(), delay_days: [0,3,6][i] ?? i*3 };
  });
}

function isGoogleSender(s) {
  const p = (s.email_provider || s.provider || s.smtp_host || '').toLowerCase();
  return p.includes('google') || p.includes('gmail') || p.includes('gsuite') || p.includes('smtp.gmail');
}
function isOutlookSender(s) {
  const p = (s.email_provider || s.provider || s.smtp_host || '').toLowerCase();
  return p.includes('microsoft') || p.includes('outlook') || p.includes('office365') || p.includes('smtp.office');
}

function buildCampaignPlan(base, counts, segments, n) {
  const avail = [];
  if (counts.google > 0) avail.push('google');
  if (counts.outlook > 0) avail.push('outlook');
  if ((counts.seg || 0) + (counts.mimecast || 0) > 0) avail.push('seg');

  if (n === 1) {
    const all = [...(segments.google||[]),...(segments.outlook||[]),...(segments.seg||[])];
    return [{ type:'all', name:`${base}_all`, leads:all, senderType:'google' }];
  }
  if (n === 2) {
    if (avail.includes('google') && avail.includes('outlook') && avail.includes('seg')) {
      return [
        { type:'google_seg', name:`${base}_google`, leads:[...(segments.google||[]),...(segments.seg||[])], senderType:'google' },
        { type:'outlook',    name:`${base}_outlook`, leads:segments.outlook||[], senderType:'outlook' },
      ];
    }
    return avail.map(t => ({ type:t, name:`${base}_${t}`, leads:t==='seg'?segments.seg||[]:segments[t]||[], senderType:t==='outlook'?'outlook':'google' }));
  }
  return avail.map(t => ({ type:t, name:`${base}_${t}`, leads:t==='seg'?segments.seg||[]:segments[t]||[], senderType:t==='outlook'?'outlook':'google' }));
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  // Backgrounds
  bg:       '#F8F9FB',
  surface:  '#FFFFFF',
  surfaceAlt:'#F3F4F6',
  border:   '#E5E7EB',
  borderFocus:'#6366F1',

  // Text
  text:     '#111827',
  textSub:  '#6B7280',
  textMuted:'#9CA3AF',

  // Brand / accent
  indigo:   '#6366F1',
  indigoLight:'#EEF2FF',
  indigoDark: '#4F46E5',

  // Segment colours
  google:  { dot:'#3B82F6', bg:'#EFF6FF', border:'#BFDBFE', text:'#1D4ED8' },
  outlook: { dot:'#F97316', bg:'#FFF7ED', border:'#FED7AA', text:'#C2410C' },
  seg:     { dot:'#10B981', bg:'#ECFDF5', border:'#A7F3D0', text:'#065F46' },
  mimecast:{ dot:'#8B5CF6', bg:'#F5F3FF', border:'#DDD6FE', text:'#5B21B6' },
  all:     { dot:'#6366F1', bg:'#EEF2FF', border:'#C7D2FE', text:'#4338CA' },
  google_seg:{ dot:'#3B82F6', bg:'#EFF6FF', border:'#BFDBFE', text:'#1D4ED8' },

  // Status
  success: '#10B981',
  green: '#2D6A4F',
  greenLight: '#E8F5EE',
  greenBorder: '#B7DEC8',
  warning: '#F59E0B',
  error:   '#EF4444',

  // Shadows
  shadow:  '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
  shadowMd:'0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -1px rgba(0,0,0,0.04)',
  shadowLg:'0 10px 25px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
};

// ─── Tiny UI components ───────────────────────────────────────────────────────

function Pill({ type, children }) {
  const c = T[type] || T.seg;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, background:c.bg, color:c.text, border:`1px solid ${c.border}`, borderRadius:999, padding:'3px 10px', fontSize:12, fontWeight:600, whiteSpace:'nowrap' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:c.dot, flexShrink:0 }} />
      {children || type}
    </span>
  );
}

function Card({ children, style={}, padding=28 }) {
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:16, padding, boxShadow:T.shadow, ...style }}>
      {children}
    </div>
  );
}

function Btn({ onClick, disabled, children, variant='primary', size='md', fullWidth=false, style={} }) {
  const variants = {
    primary: { bg:T.indigo,    hover:T.indigoDark, color:'#fff' },
    success: { bg:'#10B981',   hover:'#059669',    color:'#fff' },
    danger:  { bg:'#EF4444',   hover:'#DC2626',    color:'#fff' },
    ghost:   { bg:'#F9FAFB',   hover:'#F3F4F6',    color:T.text },
    outline: { bg:'transparent',hover:T.indigoLight,color:T.indigo, border:`1.5px solid ${T.indigo}` },
  };
  const v = variants[variant] || variants.primary;
  const pad = size==='sm' ? '6px 14px' : size==='lg' ? '13px 28px' : '10px 20px';
  const fsize = size==='sm' ? 13 : size==='lg' ? 15 : 14;
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{ padding:pad, borderRadius:10, border:v.border||'none', fontWeight:600, fontSize:fsize,
        cursor:disabled?'not-allowed':'pointer', opacity:disabled?0.45:1,
        background:v.bg, color:v.color, transition:'all .15s', fontFamily:'inherit',
        width:fullWidth?'100%':'auto', boxShadow:variant==='primary'?'0 1px 2px rgba(99,102,241,0.2)':'none',
        ...style }}>
      {children}
    </button>
  );
}

function Input({ label, ...props }) {
  return (
    <div>
      {label && <label style={{ display:'block', fontSize:13, fontWeight:500, color:T.textSub, marginBottom:6 }}>{label}</label>}
      <input {...props} style={{ width:'100%', background:T.surface, color:T.text, border:`1.5px solid ${T.border}`, borderRadius:10, padding:'10px 14px', fontSize:14, outline:'none', fontFamily:'inherit', transition:'border-color .15s', boxSizing:'border-box', ...props.style }} />
    </div>
  );
}

function Select({ label, children, ...props }) {
  return (
    <div>
      {label && <label style={{ display:'block', fontSize:13, fontWeight:500, color:T.textSub, marginBottom:6 }}>{label}</label>}
      <select {...props} style={{ width:'100%', background:T.surface, color:props.value?T.text:T.textMuted, border:`1.5px solid ${T.border}`, borderRadius:10, padding:'10px 14px', fontSize:14, outline:'none', cursor:'pointer', fontFamily:'inherit', appearance:'none', backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat:'no-repeat', backgroundPosition:'right 12px center', paddingRight:40, boxSizing:'border-box', ...props.style }}>
        {children}
      </select>
    </div>
  );
}

function Textarea({ label, ...props }) {
  return (
    <div>
      {label && <label style={{ display:'block', fontSize:13, fontWeight:500, color:T.textSub, marginBottom:6 }}>{label}</label>}
      <textarea {...props} style={{ width:'100%', background:T.surface, color:T.text, border:`1.5px solid ${T.border}`, borderRadius:10, padding:'12px 14px', fontSize:13, outline:'none', fontFamily:'ui-monospace, "SF Mono", Menlo, monospace', lineHeight:1.7, resize:'vertical', boxSizing:'border-box', ...props.style }} />
    </div>
  );
}

function Alert({ type='info', title, children }) {
  const styles = {
    info:    { bg:'#EFF6FF', border:'#BFDBFE', icon:'ℹ️',  color:'#1E40AF' },
    success: { bg:'#F0FDF4', border:'#BBF7D0', icon:'✓',   color:'#166534' },
    warning: { bg:'#FFFBEB', border:'#FDE68A', icon:'⚠',   color:'#92400E' },
    error:   { bg:'#FEF2F2', border:'#FECACA', icon:'✕',   color:'#991B1B' },
  };
  const s = styles[type] || styles.info;
  return (
    <div style={{ background:s.bg, border:`1px solid ${s.border}`, borderRadius:10, padding:'12px 16px', display:'flex', gap:10, marginBottom:12 }}>
      <span style={{ color:s.color, fontWeight:700, fontSize:14, flexShrink:0, marginTop:1 }}>{s.icon}</span>
      <div style={{ fontSize:13, color:s.color, lineHeight:1.5 }}>
        {title && <div style={{ fontWeight:600, marginBottom:2 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

function Spinner({ color=T.indigo }) {
  return <span style={{ display:'inline-block', width:16, height:16, border:`2px solid ${color}30`, borderTopColor:color, borderRadius:'50%', animation:'spin .65s linear infinite', verticalAlign:'middle' }} />;
}

function Divider() {
  return <div style={{ height:1, background:T.border, margin:'24px 0' }} />;
}

// ─── Step bar ──────────────────────────────────────────────────────────────────
const STEPS = ['Client','Upload CSV','Breakdown','Campaigns','Leads','Copy','Senders','Done'];

function StepBar({ current }) {
  return (
    <div style={{ display:'flex', alignItems:'center', overflowX:'auto', paddingBottom:4, marginBottom:36, gap:0 }}>
      {STEPS.map((label, i) => {
        const n=i+1, done=n<current, active=n===current;
        return (
          <div key={n} style={{ display:'flex', alignItems:'center', flexShrink:0 }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', minWidth:68 }}>
              <div style={{ width:32, height:32, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                fontWeight:700, fontSize:13, transition:'all .2s',
                background: done?T.success : active?T.indigo : T.surfaceAlt,
                color: done||active ? '#fff' : T.textMuted,
                boxShadow: active?`0 0 0 4px ${T.indigoLight}`:'none',
                border: `2px solid ${done?T.success:active?T.indigo:T.border}` }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontSize:11, marginTop:5, fontWeight:active?600:400, color:active?T.indigo:done?T.success:T.textMuted, whiteSpace:'nowrap' }}>
                {label}
              </span>
            </div>
            {i < STEPS.length-1 && (
              <div style={{ width:24, height:2, background:done?T.success:T.border, margin:'0 2px', marginBottom:18, flexShrink:0, transition:'background .3s' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Mapping dialog ────────────────────────────────────────────────────────────
const MAPPING_FIELDS = [
  { key:'email',        label:'Email Address',    required:true },
  { key:'first_name',   label:'First Name',       required:false },
  { key:'last_name',    label:'Last Name',         required:false },
  { key:'company_name', label:'Company Name',     required:false },
  { key:'job_title',    label:'Job Title',         required:false },
  { key:'linkedin',     label:"Person's LinkedIn", required:false },
  { key:'mx_record',    label:'MX Record Column',  required:true },
];

function MappingDialog({ columns, onConfirm, onCancel }) {
  const [mapping, setMapping] = useState(() => {
    const guess = {};
    const n = s => s.toLowerCase().replace(/[\s_\-]/g,'');
    MAPPING_FIELDS.forEach(f => {
      const m = { email:['email','emailaddress','mail'], first_name:['firstname','fname','first'], last_name:['lastname','lname','last','surname'], company_name:['company','companyname','organization','org','account'], job_title:['jobtitle','title','position','role'], linkedin:['linkedin','linkedinurl','personlinkedin'], mx_record:['mxrecord','mx','mxcategory','mxrecordcategory','emailprovider','provider','mailprovider'] };
      const match = columns.find(c => (m[f.key]||[]).includes(n(c)));
      if (match) guess[f.key] = match;
    });
    return guess;
  });

  const valid = MAPPING_FIELDS.filter(f=>f.required).every(f=>mapping[f.key]);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.35)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200, padding:16 }}>
      <div style={{ background:T.surface, borderRadius:20, padding:32, width:'100%', maxWidth:540, maxHeight:'90vh', overflowY:'auto', boxShadow:T.shadowLg }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
          <h3 style={{ fontSize:19, fontWeight:700, color:T.text }}>Map Your Columns</h3>
          <button onClick={onCancel} style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:T.textMuted, lineHeight:1 }}>×</button>
        </div>
        <p style={{ fontSize:13, color:T.textSub, marginBottom:24, lineHeight:1.5 }}>
          Match your CSV column headers to the fields below.<br />
          <span style={{ color:T.error }}>*</span> Required fields must be mapped.
        </p>

        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {MAPPING_FIELDS.map(f => (
            <div key={f.key} style={{ display:'grid', gridTemplateColumns:'1fr 1fr', alignItems:'center', gap:12 }}>
              <div style={{ fontSize:13, fontWeight:500, color:f.required?T.text:T.textSub }}>
                {f.label} {f.required && <span style={{ color:T.error }}>*</span>}
              </div>
              <Select value={mapping[f.key]||''} onChange={e => setMapping(m=>({...m,[f.key]:e.target.value}))}>
                <option value="">— not mapped —</option>
                {columns.map(c=><option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
          ))}
        </div>

        {!valid && <Alert type="warning" style={{ marginTop:16 }}>Map Email and MX Record to continue.</Alert>}

        <div style={{ display:'flex', gap:10, marginTop:28, justifyContent:'flex-end' }}>
          <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
          <Btn onClick={()=>onConfirm(mapping)} disabled={!valid}>Confirm Mapping →</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep]     = useState(1);
  const [log,  setLog]      = useState([]);
  const addLog = (msg, t='info') => setLog(l=>[...l,{msg,t,time:new Date().toLocaleTimeString()}]);

  const [clients,      setClients]      = useState([]);
  const [clientId,     setClientId]     = useState('');
  const [connStatus,   setConnStatus]   = useState(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const clearErr = () => setError('');

  const [csvData,      setCsvData]      = useState(null);
  const [showMapping,  setShowMapping]  = useState(false);
  const [counts,       setCounts]       = useState(null);
  const [segments,     setSegments]     = useState(null);

  const [campaignBase, setCampaignBase] = useState('');
  const [numCampaigns, setNumCampaigns] = useState(null);
  const [campaignPlan, setCampaignPlan] = useState([]);
  const [created,      setCreated]      = useState([]);

  const [duplicateMode, setDuplicateMode] = useState('skip');
  // emailSteps: array of {subject, body, delay_days, isReply}
  const [emailSteps, setEmailSteps] = useState([
    { subject: '', body: '', delay_days: 0, isReply: false },
  ]);

  const [allSenders,   setAllSenders]   = useState([]);
  const [selSenders,   setSelSenders]   = useState({});

  useEffect(()=>{ api('/clients').then(setClients).catch(()=>{}); },[]);

  // Step 1
  async function connect() {
    setLoading(true); clearErr();
    try {
      const r = await api(`/clients/${clientId}/test`);
      setConnStatus('ok'); addLog(`Connected — ${r.message}`,'success'); setStep(2);
    } catch(e) { setError(e.message); setConnStatus('error'); }
    finally { setLoading(false); }
  }

  // Step 2
  async function handleFile(file) {
    if (!file) return;
    setLoading(true); clearErr();
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/parse-csv', { method:'POST', body:fd });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCsvData(data); setShowMapping(true);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function onMappingConfirm(mapping) {
    setShowMapping(false); setLoading(true); clearErr();
    try {
      const r = await api('/map-and-segment', { method:'POST', body:JSON.stringify({ rows:csvData.rows, mapping }) });
      setCounts(r.counts); setSegments(r.segments);
      addLog(`Segmented ${r.counts.total} leads — Google:${r.counts.google} Outlook:${r.counts.outlook} Mimecast:${r.counts.mimecast} SEG:${r.counts.seg}`);
      setStep(3);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Step 3
  function confirmPlan() {
    if (!numCampaigns || !campaignBase.trim()) { setError('Enter a campaign name and select the number of campaigns.'); return; }
    clearErr();
    setCampaignPlan(buildCampaignPlan(campaignBase.trim(), counts, segments, numCampaigns));
    setStep(4);
  }

  // Step 4
  async function createCampaigns() {
    setLoading(true); clearErr();
    try {
      const c = [];
      for (const p of campaignPlan) {
        addLog(`Creating "${p.name}"...`);
        const r = await api(`/clients/${clientId}/campaigns`, { method:'POST', body:JSON.stringify({ name:p.name }) });
        c.push({ ...p, id:r.id });
        addLog(`✓ "${p.name}" created (ID: ${r.id})`,'success');
      }
      setCreated(c); setStep(5);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Step 5
  async function uploadLeads() {
    setLoading(true); clearErr();
    try {
      for (const c of created) {
        addLog(`Uploading ${c.leads.length} leads → ${c.name} (${duplicateMode} duplicates)...`);
        const r = await api(`/clients/${clientId}/campaigns/${c.id}/leads`, {
          method:'POST',
          body:JSON.stringify({ leads:c.leads, duplicateMode }),
        });
        const skipMsg = r.skipped > 0 ? `, ${r.skipped} duplicates ${duplicateMode}ped` : '';
        addLog(`✓ ${c.name}: ${r.uploaded} uploaded${skipMsg}`,'success');
      }
      setStep(6);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Step 6 — email copy is UI-only in EmailBison; we save it for reference and move to senders
  async function proceedFromCopy() {
    setLoading(true); clearErr();
    try {
      addLog('Email copy saved. Fetching sender accounts...');
      const senders = await api(`/clients/${clientId}/sender-emails`);
      const list = Array.isArray(senders) ? senders : [];
      setAllSenders(list);
      const sel = {};
      for (const c of created) {
        const pool = list.filter(c.senderType==='outlook'?isOutlookSender:isGoogleSender).sort((a,b)=>{
          const sa=a.warmup_score??a.reputation_score??0, sb=b.warmup_score??b.reputation_score??0;
          return sb!==sa ? sb-sa : (a.total_sent??0)-(b.total_sent??0);
        });
        sel[c.name] = new Set(pool.slice(0, calcNeeded(c.leads.length, c.senderType)).map(s=>s.id));
      }
      setSelSenders(sel); setStep(7);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function addEmailStep() {
    setEmailSteps(prev => [...prev, { subject: '', body: '', delay_days: prev.length * 3, isReply: true }]);
  }
  function removeEmailStep(idx) {
    setEmailSteps(prev => prev.filter((_, i) => i !== idx));
  }
  function updateStep(idx, field, val) {
    setEmailSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: val } : s));
  }

  // Step 7
  async function assignSenders() {
    setLoading(true); clearErr();
    try {
      for (const c of created) {
        const ids = [...(selSenders[c.name]||[])];
        if (!ids.length) { addLog(`⚠ No senders for ${c.name}`,'warning'); continue; }
        addLog(`Assigning ${ids.length} senders → ${c.name}...`);
        await api(`/clients/${clientId}/campaigns/${c.id}/senders`, { method:'POST', body:JSON.stringify({ senderIds:ids }) });
        addLog(`✓ ${c.name}: ${ids.length} senders assigned`,'success');
      }
      setStep(8);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function reset() {
    setStep(1); setClientId(''); setConnStatus(null); setCsvData(null);
    setShowMapping(false); setCounts(null); setSegments(null); setCampaignBase('');
    setNumCampaigns(null); setCampaignPlan([]); setCreated([]); setRawCopy('');
    setParsedSteps(null); setAllSenders([]); setSelSenders([]); setLog([]); clearErr();
  }

  const clientName = clients.find(c=>c.id===clientId)?.name || '';

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:T.bg, fontFamily:'-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif', color:T.text }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        input[type=file] { cursor: pointer; }
        input:focus, select:focus, textarea:focus { border-color: ${T.borderFocus} !important; box-shadow: 0 0 0 3px ${T.indigoLight}; }
        ::placeholder { color: ${T.textMuted}; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: ${T.surfaceAlt}; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 99px; }
        table { width: 100%; border-collapse: collapse; }
        th { font-size: 12px; font-weight: 600; color: ${T.textSub}; text-align: left; padding: 10px 14px; background: ${T.surfaceAlt}; border-bottom: 1px solid ${T.border}; text-transform: uppercase; letter-spacing: 0.04em; }
        td { padding: 10px 14px; border-bottom: 1px solid ${T.border}; font-size: 13px; color: ${T.text}; }
        tr:last-child td { border-bottom: none; }
        tr:hover td { background: ${T.bg}; }
        a { color: ${T.indigo}; text-decoration: none; }
      `}</style>

      {showMapping && csvData && (
        <MappingDialog columns={csvData.columns} onConfirm={onMappingConfirm} onCancel={()=>setShowMapping(false)} />
      )}

      {/* Top nav */}
      <div style={{ background:T.surface, borderBottom:`1px solid ${T.border}`, padding:'0 24px' }}>
        <div style={{ maxWidth:920, margin:'0 auto', height:60, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:32, height:32, background:T.indigo, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>📧</div>
            <div>
              <div style={{ fontWeight:700, fontSize:15, color:T.text, lineHeight:1.2 }}>Campaign Deployer</div>
              <div style={{ fontSize:11, color:T.textMuted }}>Founderled</div>
            </div>
          </div>
          {connStatus==='ok' && (
            <div style={{ display:'flex', alignItems:'center', gap:8, background:T.surfaceAlt, border:`1px solid ${T.border}`, borderRadius:999, padding:'5px 12px' }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:T.success }} />
              <span style={{ fontSize:12, fontWeight:500, color:T.text }}>{clientName}</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth:920, margin:'0 auto', padding:'32px 20px 60px' }}>
        <StepBar current={step} />

        {error && <Alert type="error">{error}</Alert>}

        {/* ── STEP 1 ────────────────────────────────────────────────────── */}
        {step===1 && (
          <Card>
            <div style={{ maxWidth:440 }}>
              <h2 style={{ fontSize:22, fontWeight:700, marginBottom:6 }}>Select client</h2>
              <p style={{ fontSize:14, color:T.textSub, marginBottom:28 }}>Choose which client's EmailBison account to deploy campaigns to.</p>
              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                <Select label="Client" value={clientId} onChange={e=>{setClientId(e.target.value);setConnStatus(null);}}>
                  <option value="">Choose a client...</option>
                  {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Btn onClick={connect} disabled={loading||!clientId} size="lg" fullWidth>
                  {loading ? <><Spinner color="#fff" /> &nbsp;Connecting...</> : 'Connect & Verify →'}
                </Btn>
                {connStatus==='error' && <Alert type="error">Connection failed. Check if this client's EmailBison account is active.</Alert>}
              </div>
            </div>
          </Card>
        )}

        {/* ── STEP 2 ────────────────────────────────────────────────────── */}
        {step===2 && (
          <Card>
            <h2 style={{ fontSize:22, fontWeight:700, marginBottom:6 }}>Upload lead list</h2>
            <p style={{ fontSize:14, color:T.textSub, marginBottom:24 }}>
              Upload your CSV file. A column mapping dialog will appear right after so you can match your columns to the correct fields.
            </p>
            <label style={{ display:'block', background:T.surfaceAlt, border:`2px dashed ${T.border}`, borderRadius:12, padding:'36px 24px', textAlign:'center', cursor:'pointer', transition:'border-color .15s' }}
              onMouseOver={e=>e.currentTarget.style.borderColor=T.indigo}
              onMouseOut={e=>e.currentTarget.style.borderColor=T.border}>
              <input type="file" accept=".csv" style={{ display:'none' }} onChange={e=>handleFile(e.target.files[0])} />
              <div style={{ fontSize:32, marginBottom:8 }}>📂</div>
              {loading
                ? <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, color:T.textSub }}><Spinner/> Parsing CSV...</div>
                : <>
                    <div style={{ fontWeight:600, fontSize:15, color:T.text, marginBottom:4 }}>Click to upload CSV</div>
                    <div style={{ fontSize:13, color:T.textMuted }}>or drag and drop</div>
                  </>}
            </label>
            <div style={{ marginTop:16, padding:'12px 16px', background:T.surfaceAlt, borderRadius:10, fontSize:12, color:T.textSub }}>
              <strong>Required columns:</strong> email, MX record &nbsp;·&nbsp; <strong>Optional:</strong> first name, last name, company, job title, LinkedIn
            </div>
          </Card>
        )}

        {/* ── STEP 3 ────────────────────────────────────────────────────── */}
        {step===3 && counts && (
          <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
            {/* Count cards */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
              {[
                { key:'google',   label:'Google',   count:counts.google,   note:null },
                { key:'outlook',  label:'Outlook',  count:counts.outlook,  note:null },
                { key:'mimecast', label:'Mimecast', count:counts.mimecast, note:'→ SEG campaign' },
                { key:'seg',      label:'Pure SEG', count:counts.seg,      note:null },
              ].map(({ key, label, count, note }) => {
                const c = T[key] || T.seg;
                return (
                  <Card key={key} padding={20}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                      <Pill type={key}>{label}</Pill>
                      {note && <span style={{ fontSize:10, color:T.textMuted }}>{note}</span>}
                    </div>
                    <div style={{ fontSize:36, fontWeight:800, color:count?c.dot:'#D1D5DB', lineHeight:1 }}>{count}</div>
                    <div style={{ fontSize:12, color:T.textMuted, marginTop:4 }}>leads</div>
                  </Card>
                );
              })}
            </div>

            <Card>
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24, padding:'12px 16px', background:T.surfaceAlt, borderRadius:10 }}>
                <span style={{ fontSize:13, color:T.textSub }}>
                  <strong style={{ color:T.text }}>{counts.total}</strong> total leads &nbsp;·&nbsp;
                  SEG campaign = <strong style={{ color:T.seg.text }}>{(counts.seg||0)+(counts.mimecast||0)}</strong> leads (pure SEG + Mimecast)
                </span>
              </div>

              <h2 style={{ fontSize:18, fontWeight:700, marginBottom:4 }}>Configure campaigns</h2>
              <p style={{ fontSize:14, color:T.textSub, marginBottom:20 }}>Name your campaign set and choose how many campaigns to create.</p>

              <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                <Input label="Campaign base name" placeholder="e.g. Acme_Q2_2024 → creates _google, _outlook, _seg" value={campaignBase} onChange={e=>setCampaignBase(e.target.value)} />

                <div>
                  <label style={{ display:'block', fontSize:13, fontWeight:500, color:T.textSub, marginBottom:10 }}>Number of campaigns</label>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
                    {[1,2,3].map(n => {
                      const preview = buildCampaignPlan(campaignBase||'NAME', counts, segments||{google:[],outlook:[],seg:[]}, n);
                      const active = numCampaigns===n;
                      return (
                        <div key={n} onClick={()=>setNumCampaigns(n)}
                          style={{ border:`2px solid ${active?T.indigo:T.border}`, borderRadius:12, padding:16, cursor:'pointer',
                            background:active?T.indigoLight:T.surface, transition:'all .15s' }}>
                          <div style={{ fontWeight:700, fontSize:16, color:active?T.indigo:T.text, marginBottom:10 }}>
                            {n} Campaign{n>1?'s':''}
                          </div>
                          {preview.map(p=>(
                            <div key={p.name} style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                              <div style={{ width:6, height:6, borderRadius:'50%', background:(T[p.type]||T.seg).dot, flexShrink:0 }} />
                              <span style={{ fontSize:12, color:T.textSub, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                {campaignBase ? p.name : `NAME_${p.type}`}
                              </span>
                              <span style={{ fontSize:11, color:T.textMuted, marginLeft:'auto', flexShrink:0 }}>
                                {p.leads?.length ?? '?'}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <Btn onClick={confirmPlan} disabled={!numCampaigns||!campaignBase.trim()} size="lg">
                  Confirm Plan →
                </Btn>
              </div>
            </Card>
          </div>
        )}

        {/* ── STEP 4 ────────────────────────────────────────────────────── */}
        {step===4 && (
          <Card>
            <h2 style={{ fontSize:22, fontWeight:700, marginBottom:6 }}>Create campaigns</h2>
            <p style={{ fontSize:14, color:T.textSub, marginBottom:24 }}>Review the plan below then create all campaigns in EmailBison.</p>
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:24 }}>
              {campaignPlan.map(p=>(
                <div key={p.name} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 18px', background:T.surfaceAlt, borderRadius:12, border:`1px solid ${T.border}` }}>
                  <Pill type={p.type}>{p.type==='google_seg'?'Google + SEG':(T[p.type]?.text?p.type:p.type).toUpperCase()}</Pill>
                  <span style={{ fontWeight:600, fontSize:14, flex:1 }}>{p.name}</span>
                  <span style={{ fontSize:13, color:T.textSub }}>{p.leads.length} leads</span>
                  <span style={{ fontSize:12, color:T.textMuted }}>→ {p.senderType} senders</span>
                </div>
              ))}
            </div>
            <Btn onClick={createCampaigns} disabled={loading} size="lg">
              {loading ? <><Spinner color="#fff" /> &nbsp;Creating...</> : '🚀 Create in EmailBison'}
            </Btn>
          </Card>
        )}

        {/* ── STEP 5 ────────────────────────────────────────────────────── */}
        {step===5 && (
          <Card>
            <h2 style={{ fontSize:22, fontWeight:700, marginBottom:6 }}>Upload leads</h2>
            <p style={{ fontSize:14, color:T.textSub, marginBottom:24 }}>Campaigns are ready. Choose how to handle existing leads, then upload.</p>

            {/* Duplicate mode selector */}
            <div style={{ marginBottom:24 }}>
              <label style={{ fontSize:13, fontWeight:600, color:T.textSub, display:'block', marginBottom:10 }}>
                If a lead already exists in EmailBison…
              </label>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
                {[
                  { val:'skip',    icon:'⏭', title:'Skip',    desc:'Keep existing data unchanged, still add to campaign' },
                  { val:'update',  icon:'✏️', title:'Update',  desc:'Overwrite fields with new data from CSV' },
                  { val:'replace', icon:'🔄', title:'Replace', desc:'Full replace — same as update via API' },
                ].map(opt=>(
                  <div key={opt.val} onClick={()=>setDuplicateMode(opt.val)}
                    style={{ border:`2px solid ${duplicateMode===opt.val?T.green:T.border}`, borderRadius:12, padding:'14px 16px',
                      cursor:'pointer', background:duplicateMode===opt.val?T.greenLight:T.surface, transition:'all .15s' }}>
                    <div style={{ fontSize:18, marginBottom:6 }}>{opt.icon}</div>
                    <div style={{ fontWeight:700, fontSize:13, color:duplicateMode===opt.val?T.green:T.text, marginBottom:4 }}>{opt.title}</div>
                    <div style={{ fontSize:11, color:T.textMuted, lineHeight:1.4 }}>{opt.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:16 }}>
              {created.map(c=>(
                <div key={c.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 18px', background:T.surfaceAlt, borderRadius:12, border:`1px solid ${T.border}` }}>
                  <Pill type={c.type}>{c.type==='google_seg'?'G+SEG':c.type}</Pill>
                  <span style={{ flex:1, fontWeight:500, fontSize:14 }}>{c.name}</span>
                  <span style={{ fontWeight:700, fontSize:14, color:T.indigo }}>{c.leads.length}</span>
                  <span style={{ fontSize:13, color:T.textMuted }}>leads</span>
                  <span style={{ fontSize:11, color:T.textMuted, background:T.surface, border:`1px solid ${T.border}`, borderRadius:6, padding:'2px 8px' }}>ID {c.id}</span>
                </div>
              ))}
            </div>
            <div style={{ padding:'10px 16px', background:T.surfaceAlt, borderRadius:10, fontSize:13, color:T.textSub, marginBottom:20 }}>
              Total: <strong style={{ color:T.text }}>{created.reduce((a,c)=>a+c.leads.length,0)}</strong> leads across {created.length} campaign{created.length>1?'s':''}
            </div>
            <Btn onClick={uploadLeads} disabled={loading} size="lg">
              {loading ? <><Spinner color="#fff" /> &nbsp;Uploading...</> : '📤 Upload All Leads'}
            </Btn>
          </Card>
        )}

        {/* ── STEP 6 ────────────────────────────────────────────────────── */}
        {step===6 && (
          <Card>
            <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Email copy</h2>
            <p style={{ fontSize:14, color:T.textSub, marginBottom:8 }}>
              Enter your email sequence below. This is for your reference — you'll add the copy directly in EmailBison after this step.
            </p>
            <Alert type="warning">
              <strong>Note:</strong> EmailBison's sequence builder is not available via API. After completing this tool, open each campaign in EmailBison and paste the copy shown here into the sequence builder manually.
            </Alert>

            <div style={{ display:'flex', flexDirection:'column', gap:16, marginTop:8 }}>
              {emailSteps.map((step, idx) => (
                <div key={idx} style={{ border:`1.5px solid ${idx===0?T.border:T.greenBorder}`, borderRadius:14, overflow:'hidden' }}>
                  {/* Step header */}
                  <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 18px',
                    background: idx===0 ? T.surfaceAlt : T.greenLight,
                    borderBottom:`1px solid ${idx===0?T.border:T.greenBorder}` }}>
                    <div style={{ width:26, height:26, borderRadius:'50%', background:idx===0?T.indigo:T.green,
                      color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, flexShrink:0 }}>
                      {idx+1}
                    </div>
                    <span style={{ fontWeight:700, fontSize:14, color:T.text, flex:1 }}>
                      {idx===0 ? 'Email 1 — Initial outreach' : `Follow-up ${idx} — Reply in same thread`}
                    </span>
                    {idx > 0 && (
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <label style={{ fontSize:12, color:T.textSub, fontWeight:500 }}>Send on day</label>
                        <input
                          type="number" min={1} max={30}
                          value={step.delay_days}
                          onChange={e => updateStep(idx, 'delay_days', parseInt(e.target.value)||1)}
                          style={{ width:56, padding:'5px 8px', border:`1.5px solid ${T.border}`, borderRadius:8,
                            fontSize:13, fontFamily:'inherit', textAlign:'center', outline:'none' }}
                        />
                        <button onClick={()=>removeEmailStep(idx)}
                          style={{ background:'transparent', border:'none', cursor:'pointer', color:T.textMuted, fontSize:16, padding:'2px 4px' }}>✕</button>
                      </div>
                    )}
                  </div>

                  {/* Subject */}
                  <div style={{ padding:'14px 18px 0' }}>
                    <label style={{ fontSize:11, fontWeight:600, color:T.textMuted, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:6 }}>
                      Subject line{idx > 0 ? ' (usually "Re: [original subject]")' : ''}
                    </label>
                    <input
                      type="text"
                      placeholder={idx===0 ? 'e.g. Quick question about {company}' : 'e.g. Re: Quick question about {company}'}
                      value={step.subject}
                      onChange={e => updateStep(idx, 'subject', e.target.value)}
                      style={{ width:'100%', padding:'9px 12px', border:`1.5px solid ${T.border}`, borderRadius:9,
                        fontSize:14, fontFamily:'inherit', color:T.text, background:T.surface, outline:'none' }}
                    />
                  </div>

                  {/* Body */}
                  <div style={{ padding:'12px 18px 18px' }}>
                    <label style={{ fontSize:11, fontWeight:600, color:T.textMuted, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:6 }}>
                      Email body
                    </label>
                    <textarea
                      rows={7}
                      placeholder={idx===0
                        ? 'Hi {first_name},

[your opening email body here]

Best,
[Your name]'
                        : '[follow-up body — this sends as a reply in the same thread]'}
                      value={step.body}
                      onChange={e => updateStep(idx, 'body', e.target.value)}
                      style={{ width:'100%', padding:'10px 12px', border:`1.5px solid ${T.border}`, borderRadius:9,
                        fontSize:13, fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace', color:T.text,
                        background:T.surface, outline:'none', resize:'vertical', lineHeight:1.7 }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Add follow-up button */}
            {emailSteps.length < 5 && (
              <button onClick={addEmailStep}
                style={{ marginTop:12, width:'100%', padding:'11px', border:`2px dashed ${T.greenBorder}`,
                  borderRadius:12, background:'transparent', cursor:'pointer', fontSize:13,
                  color:T.green, fontWeight:600, fontFamily:'inherit', transition:'all .15s' }}>
                + Add follow-up email
              </button>
            )}

            <div style={{ marginTop:20 }}>
              <Btn onClick={proceedFromCopy} disabled={loading}>
                {loading ? <><Spinner color="#fff" /> &nbsp;Loading senders...</> : 'Continue to Sender Selection →'}
              </Btn>
            </div>
          </Card>
        )}

        {/* ── STEP 7 ────────────────────────────────────────────────────── */}
        {step===7 && (
          <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
            <div>
              <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Select senders</h2>
              <p style={{ fontSize:14, color:T.textSub }}>★ = auto-recommended. Ranked by warmup score (high → low), then lifetime total sent (low → high).</p>
            </div>

            {created.map(camp=>{
              const pool = allSenders.filter(camp.senderType==='outlook'?isOutlookSender:isGoogleSender).sort((a,b)=>{
                const sa=a.warmup_score??a.reputation_score??0, sb=b.warmup_score??b.reputation_score??0;
                return sb!==sa?sb-sa:(a.total_sent??0)-(b.total_sent??0);
              });
              const needed = calcNeeded(camp.leads.length, camp.senderType);
              const sel = selSenders[camp.name]||new Set();
              const toggle = id => setSelSenders(prev=>{ const s=new Set(prev[camp.name]); s.has(id)?s.delete(id):s.add(id); return{...prev,[camp.name]:s}; });
              const enough = sel.size >= needed;

              return (
                <Card key={camp.name}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, flexWrap:'wrap' }}>
                    <Pill type={camp.type}>{camp.type==='google_seg'?'Google+SEG':camp.type}</Pill>
                    <span style={{ fontWeight:600, fontSize:15 }}>{camp.name}</span>
                    <span style={{ fontSize:13, color:T.textSub }}>{camp.leads.length} leads ÷ {camp.senderType==='outlook'?5:15}/day = {needed} needed</span>
                    <span style={{ marginLeft:'auto', fontSize:13, fontWeight:600, color:enough?T.success:T.warning }}>
                      {sel.size} / {needed} selected
                    </span>
                  </div>

                  {pool.length===0
                    ? <Alert type="warning">No {camp.senderType} senders found in this client's EmailBison account.</Alert>
                    : (
                      <div style={{ border:`1px solid ${T.border}`, borderRadius:10, overflow:'hidden' }}>
                        <table>
                          <thead><tr>
                            <th style={{ width:40 }}></th>
                            <th>Email</th>
                            <th>Warmup Score</th>
                            <th>Total Sent (lifetime)</th>
                            <th>Status</th>
                          </tr></thead>
                          <tbody>
                            {pool.map((s,idx)=>{
                              const checked=sel.has(s.id);
                              const score=s.warmup_score??s.reputation_score;
                              const scoreColor = score==null?T.textMuted:score>=80?T.success:score>=50?T.warning:T.error;
                              return (
                                <tr key={s.id} style={{ opacity:checked?1:0.45, cursor:'pointer' }} onClick={()=>toggle(s.id)}>
                                  <td>
                                    <div style={{ width:18, height:18, borderRadius:5, border:`2px solid ${checked?T.indigo:T.border}`, background:checked?T.indigo:'transparent', display:'flex', alignItems:'center', justifyContent:'center' }}>
                                      {checked && <span style={{ color:'#fff', fontSize:11, fontWeight:700 }}>✓</span>}
                                    </div>
                                  </td>
                                  <td>
                                    {s.email}
                                    {idx<needed && <span style={{ marginLeft:6, fontSize:11, color:T.success, fontWeight:700 }}>★</span>}
                                  </td>
                                  <td style={{ fontWeight:600, color:scoreColor }}>{score??'—'}</td>
                                  <td style={{ color:T.textSub }}>{(s.total_sent??s.emails_sent??0).toLocaleString()}</td>
                                  <td>
                                    <span style={{ display:'inline-block', padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:600,
                                      background:(!s.status||s.status==='active')?'#ECFDF5':'#FEF2F2',
                                      color:(!s.status||s.status==='active')?T.success:T.error }}>
                                      {s.status||'active'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                </Card>
              );
            })}

            <Btn onClick={assignSenders} disabled={loading} size="lg" variant="success">
              {loading ? <><Spinner color="#fff" /> &nbsp;Assigning...</> : '✓ Assign Senders to All Campaigns'}
            </Btn>
          </div>
        )}

        {/* ── STEP 8 ────────────────────────────────────────────────────── */}
        {step===8 && (
          <Card>
            <div style={{ textAlign:'center', padding:'32px 0 24px' }}>
              <div style={{ width:72, height:72, borderRadius:'50%', background:'#ECFDF5', border:`2px solid #A7F3D0`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:32, margin:'0 auto 20px' }}>🎉</div>
              <h2 style={{ fontSize:24, fontWeight:700, color:T.success, marginBottom:6 }}>Deployment complete</h2>
              <p style={{ fontSize:14, color:T.textSub, marginBottom:28 }}>All campaigns configured. Complete the pre-launch checklist in EmailBison before activating.</p>

              <div style={{ display:'flex', flexDirection:'column', gap:8, maxWidth:520, margin:'0 auto 24px', textAlign:'left' }}>
                {created.map(c=>(
                  <div key={c.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 16px', background:T.surfaceAlt, borderRadius:10, border:`1px solid ${T.border}` }}>
                    <div style={{ width:20, height:20, borderRadius:'50%', background:T.success, display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <span style={{ color:'#fff', fontSize:11, fontWeight:700 }}>✓</span>
                    </div>
                    <Pill type={c.type}>{c.type==='google_seg'?'G+SEG':c.type}</Pill>
                    <span style={{ fontSize:13, fontWeight:500, flex:1 }}>{c.name}</span>
                    <span style={{ fontSize:12, color:T.textMuted }}>{c.leads.length} leads · {selSenders[c.name]?.size??0} senders</span>
                  </div>
                ))}
              </div>

              <Alert type="warning" title="Pre-launch checklist — do this in EmailBison before activating">
                <div style={{ fontSize:13, lineHeight:2, marginTop:4 }}>
                  ☐ Send test email — verify formatting looks correct<br/>
                  ☐ Email 2 &amp; 3 are replies (not new threads)<br/>
                  ☐ Plain text ON · Open tracking OFF · Link tracking OFF<br/>
                  ☐ Sending schedule Mon–Fri 8 AM – 7 PM ET on all campaigns<br/>
                  ☐ All senders have completed 2-week warmup
                </div>
              </Alert>

              <Btn variant="outline" onClick={reset} style={{ marginTop:16 }}>↩ Deploy another campaign</Btn>
            </div>
          </Card>
        )}

        {/* ── Activity log ──────────────────────────────────────────────── */}
        {log.length > 0 && (
          <div style={{ marginTop:24 }}>
            <div style={{ fontSize:11, fontWeight:600, color:T.textMuted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>Activity</div>
            <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, padding:'10px 14px', maxHeight:160, overflowY:'auto' }}>
              {log.map((e,i)=>(
                <div key={i} style={{ fontSize:12, fontFamily:'ui-monospace,"SF Mono",Menlo,monospace', lineHeight:1.9,
                  color:e.t==='success'?T.success:e.t==='warning'?T.warning:T.textMuted }}>
                  <span style={{ color:T.border, marginRight:10 }}>{e.time}</span>{e.msg}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
