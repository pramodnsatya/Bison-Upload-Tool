import { useState, useEffect } from 'react';

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Strip HTML tags from email body pulled from EmailBison (which stores as HTML)
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')   // <br> → newline
    .replace(/<\/p>/gi, '\n')         // </p> → newline
    .replace(/<[^>]+>/g, '')           // strip all other tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n\n+/g, '\n\n')     // collapse excess newlines
    .trim();
}

// ─── Logic helpers ────────────────────────────────────────────────────────────
function calcNeeded(count, type) { return Math.ceil(count / (type === 'outlook' ? 5 : 15)); }


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

function StepBar({ current, onStepClick }) {
  return (
    <div style={{ display:'flex', alignItems:'center', overflowX:'auto', paddingBottom:4, marginBottom:36, gap:0 }}>
      {STEPS.map((label, i) => {
        const n=i+1, done=n<current, active=n===current;
        const clickable = done && onStepClick && n < 8; // can't go back to Done
        return (
          <div key={n} style={{ display:'flex', alignItems:'center', flexShrink:0 }}>
            <div
              onClick={clickable ? ()=>onStepClick(n) : undefined}
              style={{ display:'flex', flexDirection:'column', alignItems:'center', minWidth:68,
                cursor: clickable ? 'pointer' : 'default' }}
              title={clickable ? `Go back to ${label}` : undefined}>
              <div style={{ width:32, height:32, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                fontWeight:700, fontSize:13, transition:'all .2s',
                background: done?T.success : active?T.indigo : T.surfaceAlt,
                color: done||active ? '#fff' : T.textMuted,
                boxShadow: active?`0 0 0 4px ${T.indigoLight}`: clickable?`0 0 0 2px ${T.success}33`:'none',
                border: `2px solid ${done?T.success:active?T.indigo:T.border}`,
                transform: clickable ? 'scale(1.05)' : 'scale(1)' }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontSize:11, marginTop:5, fontWeight:active?600:400,
                color:active?T.indigo:done?T.success:T.textMuted, whiteSpace:'nowrap',
                textDecoration: clickable?'underline':'none', textDecorationColor: T.success }}>
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
  const [activeTab, setActiveTab] = useState('deploy'); // 'deploy' | 'templates'
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
  const [planMode, setPlanMode] = useState('auto'); // 'auto' | 'manual'
  const [manualRows, setManualRows] = useState([]); // [{type, name, count}]

  // Email copy steps
  const [emailSteps, setEmailSteps] = useState([
    { subject: '', body: '', delay_days: 1 },
  ]);
  const [copyApplied, setCopyApplied] = useState(false);

  const [allSenders,   setAllSenders]   = useState([]);
  const [selSenders,   setSelSenders]   = useState({});
  const [senderFilters, setSenderFilters] = useState({}); // per campaign: {provider:'all'|'google'|'outlook', search:''}

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
    if (!campaignBase.trim()) { setError('Enter a campaign name.'); return; }
    clearErr();

    if (planMode === 'manual') {
      if (!manualRows.length) { setError('Add at least one campaign row.'); return; }
      // Build plan from manual rows — slice leads from the appropriate segment pool
      const pools = {
        google:  [...(segments?.google || [])],
        outlook: [...(segments?.outlook || [])],
        seg:     [...(segments?.seg || [])],
      };
      const usedCounts = { google: 0, outlook: 0, seg: 0 };
      // Count how many times each type appears total — to decide if we need _1, _2 suffixes
      const typeTotals = { google: 0, outlook: 0, seg: 0 };
      manualRows.forEach(r => { typeTotals[r.type] = (typeTotals[r.type] || 0) + 1; });
      const typeIndex = { google: 0, outlook: 0, seg: 0 };

      const plan = manualRows.map(row => {
        const type = row.type;
        const pool = pools[type] || [];
        const start = usedCounts[type] || 0;
        const count = Math.min(parseInt(row.count) || pool.length, pool.length - start);
        usedCounts[type] = (usedCounts[type] || 0) + count;
        typeIndex[type] = (typeIndex[type] || 0) + 1;
        const leads = pool.slice(start, start + count);

        // If this type appears more than once, append _1, _2 etc.
        // If only once, just use the type name (e.g. _google, _outlook)
        const suffix = typeTotals[type] > 1
          ? `${type}_${typeIndex[type]}`
          : type;

        return {
          type,
          name: `${campaignBase.trim()}_${suffix}`,
          leads,
          senderType: type === 'outlook' ? 'outlook' : 'google',
        };
      }).filter(p => p.leads.length > 0);
      setCampaignPlan(plan);
    } else {
      if (!numCampaigns) { setError('Select the number of campaigns.'); return; }
      setCampaignPlan(buildCampaignPlan(campaignBase.trim(), counts, segments, numCampaigns));
    }
    setStep(4);
  }

  function addManualRow() {
    setManualRows(prev => [...prev, { type: 'google', count: '', suffix: '' }]);
  }
  function updateManualRow(i, field, val) {
    setManualRows(prev => prev.map((r, j) => j === i ? { ...r, [field]: val } : r));
  }
  function removeManualRow(i) {
    setManualRows(prev => prev.filter((_, j) => j !== i));
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
      // Fetch senders now so Step 6 loads immediately
      addLog('Fetching sender accounts...');
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
      setSelSenders(sel);
      setStep(6); // Go to Copy step first
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Step 6: Email copy
  async function applyEmailCopy() {
    setLoading(true); clearErr();
    try {
      const validSteps = emailSteps.filter(s => s.subject.trim() || s.body.trim());
      if (!validSteps.length) { setError('Add at least one email step.'); setLoading(false); return; }
      for (const c of created) {
        addLog(`Applying copy to ${c.name}...`);
        const r = await api(`/clients/${clientId}/campaigns/${c.id}/sequence`, {
          method: 'POST',
          body: JSON.stringify({ steps: validSteps }),
        });
        addLog(`✓ ${c.name}: copy applied`, 'success');
      }
      setCopyApplied(true);
      setStep(7); // → Senders step
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Step 7: Assign senders
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
    setNumCampaigns(null); setCampaignPlan([]); setCreated([]);
    setAllSenders([]); setSelSenders({}); setLog([]); clearErr();
    setCopyApplied(false);
    setEmailSteps([{subject:'',body:'',delay_days:1}]);
    setPlanMode('auto'); setManualRows([]);
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
          <div style={{ display:'flex', alignItems:'center', gap:24 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:32, height:32, background:T.indigo, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>📧</div>
              <div>
                <div style={{ fontWeight:700, fontSize:15, color:T.text, lineHeight:1.2 }}>Campaign Deployer</div>
                <div style={{ fontSize:11, color:T.textMuted }}>Founderled</div>
              </div>
            </div>
            {/* Tab nav */}
            <div style={{ display:'flex', gap:4 }}>
              {[['deploy','🚀 Deploy'],['templates','📋 Templates']].map(([id,label])=>(
                <button key={id} onClick={()=>setActiveTab(id)}
                  style={{ padding:'6px 14px', borderRadius:8, border:'none', cursor:'pointer', fontFamily:'inherit',
                    fontSize:13, fontWeight:activeTab===id?600:400, transition:'all .15s',
                    background:activeTab===id?T.indigoLight:T.surface,
                    color:activeTab===id?T.indigo:T.textSub }}>
                  {label}
                </button>
              ))}
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

        {/* ── TEMPLATES TAB ──────────────────────────────────────────────── */}
        {activeTab==='templates' && <TemplatesTab clientId={clientId} clients={clients} onUseTemplate={tpl => {
          // Strip HTML from bodies, populate emailSteps, switch to deploy/copy
          const steps = tpl.steps.map(s => ({
            subject:    s.subject || s.email_subject || '',
            body:       stripHtml(s.body || s.email_body || ''),
            delay_days: Math.max(1, s.delay_days ?? s.wait_in_days ?? 1),
          }));
          setEmailSteps(steps);
          setActiveTab('deploy');
          setStep(6); // go straight to copy step with it pre-filled
        }} />}

        {/* ── DEPLOY TAB ─────────────────────────────────────────────────── */}
        {activeTab==='deploy' && <>
        <StepBar current={step} onStepClick={n => {
          // Steps 1-3: always safe to go back
          // Steps 4+: campaigns may already exist in EmailBison — warn but allow
          setStep(n);
          clearErr();
        }} />

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
              <p style={{ fontSize:14, color:T.textSub, marginBottom:20 }}>Name your campaign set and choose how to split leads.</p>

              <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
                <Input label="Campaign base name" placeholder="e.g. Acme_Q2_2024 → creates _google, _outlook, _seg" value={campaignBase} onChange={e=>setCampaignBase(e.target.value)} />

                {/* Mode toggle */}
                <div>
                  <label style={{ display:'block', fontSize:13, fontWeight:500, color:T.textSub, marginBottom:10 }}>Campaign split</label>
                  <div style={{ display:'flex', gap:8, marginBottom:16 }}>
                    {[['auto','⚡ Auto suggestions'],['manual','✏️ Manual allocation']].map(([mode, label])=>(
                      <button key={mode} onClick={()=>{ setPlanMode(mode); if(mode==='manual'&&!manualRows.length) addManualRow(); }}
                        style={{ padding:'8px 18px', borderRadius:10, border:`2px solid ${planMode===mode?T.indigo:T.border}`,
                          background:planMode===mode?T.indigoLight:T.surface, color:planMode===mode?T.indigo:T.textSub,
                          fontWeight:planMode===mode?600:400, fontSize:13, cursor:'pointer', fontFamily:'inherit', transition:'all .15s' }}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* AUTO mode */}
                  {planMode==='auto' && (
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
                  )}

                  {/* MANUAL mode */}
                  {planMode==='manual' && (
                    <div>
                      {/* Available pool summary */}
                      <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
                        {[
                          { type:'google',  label:'Google',  avail: counts.google },
                          { type:'outlook', label:'Outlook', avail: counts.outlook },
                          { type:'seg',     label:'SEG',     avail: (counts.seg||0)+(counts.mimecast||0) },
                        ].map(({type,label,avail})=>(
                          <div key={type} style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px',
                            background:T.surfaceAlt, borderRadius:8, border:`1px solid ${T.border}` }}>
                            <Pill type={type}>{label}</Pill>
                            <span style={{ fontSize:12, color:T.textSub }}>{avail} available</span>
                          </div>
                        ))}
                      </div>

                      {/* Campaign rows */}
                      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                        {manualRows.map((row, i) => {
                          const typeAvail = { google: counts.google, outlook: counts.outlook, seg: (counts.seg||0)+(counts.mimecast||0) };
                          const usedBefore = manualRows.slice(0, i).filter(r=>r.type===row.type).reduce((s,r)=>s+(parseInt(r.count)||0),0);
                          const remaining = (typeAvail[row.type]||0) - usedBefore;
                          const typeCountSoFar = manualRows.filter((r,j)=>j<=i&&r.type===row.type).length;
                          const typeTotalInRows = manualRows.filter(r=>r.type===row.type).length;
                          const nameSuffix = typeTotalInRows > 1 ? `${row.type}_${typeCountSoFar}` : row.type;
                          const autoName = campaignBase ? `${campaignBase}_${nameSuffix}` : `NAME_${nameSuffix}`;

                          return (
                            <div key={i} style={{ display:'grid', gridTemplateColumns:'140px 1fr 130px 36px', gap:8, alignItems:'center',
                              padding:'12px 14px', background:T.surfaceAlt, borderRadius:10, border:`1px solid ${T.border}` }}>
                              {/* Type selector */}
                              <select value={row.type} onChange={e=>updateManualRow(i,'type',e.target.value)}
                                style={{ padding:'7px 10px', border:`1.5px solid ${T.border}`, borderRadius:8, fontSize:13,
                                  fontFamily:'inherit', background:T.surface, outline:'none', cursor:'pointer' }}>
                                <option value="google">Google</option>
                                <option value="outlook">Outlook</option>
                                <option value="seg">SEG</option>
                              </select>

                              {/* Campaign name preview */}
                              <div style={{ fontSize:12, color:T.textSub, fontFamily:'monospace', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                {autoName}
                              </div>

                              {/* Lead count input */}
                              <div style={{ position:'relative' }}>
                                <input type="number" min={1} max={remaining}
                                  value={row.count}
                                  onChange={e=>updateManualRow(i,'count',e.target.value)}
                                  placeholder={`max ${remaining}`}
                                  style={{ width:'100%', padding:'7px 10px', border:`1.5px solid ${parseInt(row.count)>remaining?T.error:T.border}`,
                                    borderRadius:8, fontSize:13, fontFamily:'inherit', outline:'none', background:T.surface }} />
                                {remaining < (typeAvail[row.type]||0) && (
                                  <div style={{ fontSize:10, color:T.textMuted, marginTop:2 }}>{remaining} left</div>
                                )}
                              </div>

                              {/* Remove */}
                              <button onClick={()=>removeManualRow(i)}
                                style={{ width:32, height:32, border:`1px solid ${T.border}`, borderRadius:8, background:T.surface,
                                  cursor:'pointer', fontSize:16, color:T.textMuted, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {/* Add row button */}
                      <button onClick={addManualRow}
                        style={{ marginTop:10, width:'100%', padding:'10px', border:`2px dashed ${T.border}`,
                          borderRadius:10, background:'transparent', cursor:'pointer', fontSize:13,
                          color:T.textSub, fontWeight:600, fontFamily:'inherit', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
                        <span style={{ fontSize:18, lineHeight:1 }}>+</span> Add campaign
                      </button>

                      {/* Total check */}
                      {manualRows.length > 0 && (
                        <div style={{ marginTop:12, fontSize:12, color:T.textMuted }}>
                          {['google','outlook','seg'].map(type => {
                            const allocated = manualRows.filter(r=>r.type===type).reduce((s,r)=>s+(parseInt(r.count)||0),0);
                            const avail = type==='seg'?(counts.seg||0)+(counts.mimecast||0):(counts[type]||0);
                            if (!avail) return null;
                            return <span key={type} style={{ marginRight:16, color: allocated>avail?T.error:allocated<avail?T.warning:T.success }}>
                              {type}: {allocated}/{avail} allocated{allocated<avail?` (${avail-allocated} unallocated)`:''}
                            </span>;
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <Btn onClick={confirmPlan} disabled={planMode==='auto'?(!numCampaigns||!campaignBase.trim()):!campaignBase.trim()} size="lg">
                  Confirm Plan →
                </Btn>
              </div>
            </Card>
          </div>
        )}

        {/* ── STEP 4 ────────────────────────────────────────────────────── */}
        {step===4 && (
          <Card>
            <div style={{ display:'flex', justifyContent:'flex-start', marginBottom:20 }}>
              <Btn variant="ghost" size="sm" onClick={()=>setStep(3)}>← Back</Btn>
            </div>
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
            <div style={{ display:'flex', justifyContent:'flex-start', marginBottom:20 }}>
              <Btn variant="ghost" size="sm" onClick={()=>setStep(3)}>← Back</Btn>
            </div>
            <div style={{ background:'#FFFBEB', border:'1px solid #FDE68A', borderRadius:10, padding:'10px 16px',
              fontSize:13, color:'#92400E', marginBottom:16, display:'flex', gap:8, alignItems:'center' }}>
              <span>⚠</span><span>Campaigns are already created in EmailBison. Going back to change the plan will not delete them — you may need to remove them manually in EmailBison first.</span>
            </div>
            <h2 style={{ fontSize:22, fontWeight:700, marginBottom:6 }}>Upload leads</h2>
            <p style={{ fontSize:14, color:T.textSub, marginBottom:24 }}>Campaigns are ready. Choose how to handle existing leads, then upload.</p>

            {/* Duplicate mode selector */}
            <div style={{ marginBottom:24 }}>
              <label style={{ fontSize:13, fontWeight:600, color:T.textSub, display:'block', marginBottom:10 }}>
                If a lead already exists in EmailBison…
              </label>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
                {[
                  { val:'skip',    icon:'⏭', title:'Skip',    desc:'Existing workspace leads are excluded from this campaign entirely' },
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

        {/* ── STEP 6: Email Copy ───────────────────────────────────────── */}
        {step===6 && (
          <Card>
            <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Email copy</h2>
            <p style={{ fontSize:14, color:T.textSub, marginBottom:20 }}>
              Enter your sequence. Each email is a separate card. Follow-ups send as replies in the same thread.
            </p>

            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {emailSteps.map((s, i) => (
                <div key={i} style={{ border:`1.5px solid ${i===0?T.border:'#D1FAE5'}`, borderRadius:14, overflow:'hidden' }}>
                  {/* Header */}
                  <div style={{ padding:'10px 18px', background:i===0?T.surfaceAlt:'#ECFDF5',
                    borderBottom:`1px solid ${i===0?T.border:'#A7F3D0'}`,
                    display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ width:26, height:26, borderRadius:'50%', flexShrink:0,
                      background:i===0?T.indigo:T.success, color:'#fff',
                      display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700 }}>
                      {i+1}
                    </div>
                    <span style={{ fontWeight:700, fontSize:14, flex:1 }}>
                      {i===0 ? 'Email 1 — Initial outreach' : `Follow-up ${i} — Reply in same thread`}
                    </span>
                    {i > 0 && (
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:12, color:T.textSub }}>Send on day</span>
                        <input type="number" min={1} max={30} value={s.delay_days}
                          onChange={e=>setEmailSteps(prev=>prev.map((x,j)=>j===i?{...x,delay_days:parseInt(e.target.value)||1}:x))}
                          style={{ width:52, padding:'4px 8px', border:`1.5px solid ${T.border}`, borderRadius:8,
                            fontSize:13, textAlign:'center', fontFamily:'inherit', outline:'none', background:T.surface }} />
                        <button onClick={()=>setEmailSteps(prev=>prev.filter((_,j)=>j!==i))}
                          style={{ background:'none', border:'none', cursor:'pointer', color:T.textMuted, fontSize:18, lineHeight:1 }}>×</button>
                      </div>
                    )}
                  </div>
                  {/* Subject + Body */}
                  <div style={{ padding:'14px 18px 16px', display:'flex', flexDirection:'column', gap:10 }}>
                    <div>
                      <label style={{ fontSize:11, fontWeight:600, color:T.textMuted, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:5 }}>
                        Subject{i>0?' (usually Re: [original subject])':''}
                      </label>
                      <input value={s.subject}
                        onChange={e=>setEmailSteps(prev=>prev.map((x,j)=>j===i?{...x,subject:e.target.value}:x))}
                        placeholder={i===0?'e.g. Quick question about {company}':'e.g. Re: Quick question about {company}'}
                        style={{ width:'100%', padding:'9px 12px', border:`1.5px solid ${T.border}`, borderRadius:9,
                          fontSize:14, fontFamily:'inherit', color:T.text, background:T.surface, outline:'none' }} />
                    </div>
                    <div>
                      <label style={{ fontSize:11, fontWeight:600, color:T.textMuted, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:5 }}>
                        Body
                      </label>
                      <textarea rows={7} value={s.body}
                        onChange={e=>setEmailSteps(prev=>prev.map((x,j)=>j===i?{...x,body:e.target.value}:x))}
                        placeholder={i===0?'Hi {first_name},\n\n[your message]\n\nBest,\n[Your name]':'[follow-up body]'}
                        style={{ width:'100%', padding:'10px 12px', border:`1.5px solid ${T.border}`, borderRadius:9,
                          fontSize:13, fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace', color:T.text,
                          background:T.surface, outline:'none', resize:'vertical', lineHeight:1.7 }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Add follow-up */}
            {emailSteps.length < 5 && (
              <button onClick={()=>setEmailSteps(prev=>[...prev,{subject:'',body:'',delay_days:prev.length*3}])}
                style={{ marginTop:12, width:'100%', padding:'11px', border:`2px dashed ${T.border}`,
                  borderRadius:12, background:'transparent', cursor:'pointer', fontSize:13,
                  color:T.textSub, fontWeight:600, fontFamily:'inherit' }}>
                + Add follow-up email
              </button>
            )}

            {/* Also load from template */}
            <div style={{ marginTop:16, padding:'12px 16px', background:T.surfaceAlt, borderRadius:10,
              display:'flex', alignItems:'center', gap:12, fontSize:13 }}>
              <span style={{ color:T.textMuted }}>💡</span>
              <span style={{ color:T.textSub }}>Want to reuse copy from a previous campaign?</span>
              <button onClick={()=>setActiveTab('templates')}
                style={{ marginLeft:'auto', padding:'6px 14px', background:T.indigoLight, color:T.indigo,
                  border:`1px solid ${T.indigo}30`, borderRadius:8, cursor:'pointer', fontFamily:'inherit',
                  fontSize:12, fontWeight:600 }}>
                Open Templates →
              </button>
            </div>

            <div style={{ marginTop:20, display:'flex', gap:10 }}>
              <Btn variant="ghost" size="sm" onClick={()=>setStep(5)}>← Back</Btn>
              <Btn onClick={applyEmailCopy} disabled={loading || !emailSteps.some(s=>s.subject.trim()||s.body.trim())} size="lg">
                {loading ? <><Spinner color="#fff" /> &nbsp;Applying...</> : 'Apply Copy to All Campaigns →'}
              </Btn>
            </div>
          </Card>
        )}

        {/* ── STEP 7: Senders ─────────────────────────────────────────── */}
        {step===7 && (
          <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
            <div style={{ display:'flex', justifyContent:'flex-start', marginBottom:4 }}>
              <Btn variant="ghost" size="sm" onClick={()=>setStep(6)}>← Back</Btn>
            </div>
            <div>
              <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Select sender emails</h2>
              <p style={{ fontSize:14, color:T.textSub }}>
                Select senders for each campaign. ★ = auto-recommended based on warmup score and lifetime sent.
                Senders marked <span style={{ color:'#F59E0B', fontWeight:600 }}>● Active</span> are already assigned to a running campaign.
              </p>
            </div>

            {created.map(camp => {
              const filt = senderFilters[camp.name] || { provider: 'all', search: '' };
              const setFilt = (f) => setSenderFilters(prev => ({ ...prev, [camp.name]: { ...filt, ...f } }));

              // Base pool — match by provider, but also include 'other' since detection may miss some
              const basePool = allSenders
                .filter(s => {
                  if (camp.senderType === 'outlook') return s.provider === 'outlook' || s.provider === 'other';
                  return s.provider === 'google' || s.provider === 'other'; // google + seg both use google senders
                })
                .sort((a,b) => {
                  const sa = a.warmup_score ?? 0, sb = b.warmup_score ?? 0;
                  return sb !== sa ? sb - sa : (a.total_sent ?? 0) - (b.total_sent ?? 0);
                });

              // All tabs show all senders — tabs only highlight the type, search filters by email
              const pool = basePool
                .filter(s => !filt.search || s.email.toLowerCase().includes(filt.search.toLowerCase()));

              const needed = calcNeeded(camp.leads.length, camp.senderType);
              const sel = selSenders[camp.name] || new Set();
              const toggle = id => setSelSenders(prev => {
                const s = new Set(prev[camp.name]); s.has(id) ? s.delete(id) : s.add(id);
                return { ...prev, [camp.name]: s };
              });
              const selAll  = () => setSelSenders(prev => ({ ...prev, [camp.name]: new Set(pool.map(s=>s.id)) }));
              const selNone = () => setSelSenders(prev => ({ ...prev, [camp.name]: new Set() }));
              const enough  = sel.size >= needed;

              return (
                <Card key={camp.name}>
                  {/* Campaign header */}
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, flexWrap:'wrap' }}>
                    <Pill type={camp.type}>{camp.type==='google_seg'?'Google+SEG':(camp.type||'').toUpperCase()}</Pill>
                    <span style={{ fontWeight:700, fontSize:15 }}>{camp.name}</span>
                    <span style={{ fontSize:13, color:T.textSub }}>
                      {camp.leads.length} leads ÷ {camp.senderType==='outlook'?5:15}/day =
                      <strong> {needed} senders needed</strong>
                    </span>
                    <span style={{ marginLeft:'auto', fontSize:13, fontWeight:700,
                      color: sel.size===0?T.textMuted : enough?T.success:T.warning }}>
                      {sel.size} / {needed} selected
                    </span>
                  </div>

                  {/* Filters row */}
                  <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap', alignItems:'center' }}>
                    {/* Tabs show all senders — just visual grouping, not a filter */}
                    {[
                      ['all',     'All',     allSenders.length],
                      ['google',  'Google',  allSenders.length],
                      ['outlook', 'Outlook', allSenders.length],
                    ].map(([v,l,cnt])=>(
                      <button key={v} onClick={()=>setFilt({provider:v})}
                        style={{ padding:'5px 12px', borderRadius:8, border:`1.5px solid ${filt.provider===v?T.indigo:T.border}`,
                          background:filt.provider===v?T.indigoLight:T.surface, color:filt.provider===v?T.indigo:T.textSub,
                          fontSize:12, fontWeight:filt.provider===v?600:400, cursor:'pointer', fontFamily:'inherit' }}>
                        {l} ({cnt})
                      </button>
                    ))}
                    {/* Search */}
                    <input placeholder="Search email..." value={filt.search} onChange={e=>setFilt({search:e.target.value})}
                      style={{ padding:'5px 12px', border:`1.5px solid ${T.border}`, borderRadius:8, fontSize:12,
                        fontFamily:'inherit', outline:'none', background:T.surface, minWidth:180 }} />
                    {/* Select all / none */}
                    <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
                      <button onClick={selAll}  style={{ padding:'5px 10px', borderRadius:7, border:`1px solid ${T.border}`, background:T.surface, cursor:'pointer', fontSize:11, color:T.textSub, fontFamily:'inherit' }}>All</button>
                      <button onClick={selNone} style={{ padding:'5px 10px', borderRadius:7, border:`1px solid ${T.border}`, background:T.surface, cursor:'pointer', fontSize:11, color:T.textSub, fontFamily:'inherit' }}>None</button>
                    </div>
                  </div>

                  {pool.length===0
                    ? <Alert type="warning">No senders found matching your filters. Try selecting "All".</Alert>
                    : (
                      <div style={{ border:`1px solid ${T.border}`, borderRadius:10, overflowX:'auto' }}>
                        <table style={{ minWidth:900 }}>
                          <thead>
                            <tr>
                              <th style={{width:36}}></th>
                              <th>Email</th>
                              <th>Provider</th>
                              <th>Warmup Score</th>
                              <th>Warmup Sent</th>
                              <th>Total Sent</th>
                              <th>Bounce Guard</th>
                              <th>Status</th>
                              <th># Campaigns</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pool.map((s, idx) => {
                              const checked = sel.has(s.id);
                              const score = s.warmup_score;
                              const scoreColor = score==null ? T.textMuted : score>=80 ? T.success : score>=50 ? T.warning : T.error;
                              const isRec = idx < needed;
                              return (
                                <tr key={s.id} onClick={()=>toggle(s.id)}
                                  style={{ cursor:'pointer', opacity: checked?1:0.5, transition:'opacity .1s',
                                    background: checked ? (s.provider==='google'?'#F0F7FF':'#FFF8F0') : 'transparent' }}>
                                  <td>
                                    <div style={{ width:18, height:18, borderRadius:5, flexShrink:0,
                                      border:`2px solid ${checked?T.indigo:T.border}`,
                                      background:checked?T.indigo:'transparent',
                                      display:'flex', alignItems:'center', justifyContent:'center' }}>
                                      {checked && <span style={{color:'#fff',fontSize:10,fontWeight:700}}>✓</span>}
                                    </div>
                                  </td>
                                  <td>
                                    <span style={{fontSize:13, fontWeight:checked?600:400}}>{s.email}</span>
                                    {isRec && <span style={{marginLeft:6,fontSize:10,color:T.success,fontWeight:700}}>★ rec</span>}
                                  </td>
                                  <td>
                                    <span style={{ fontSize:11, fontWeight:600, padding:'2px 7px', borderRadius:5,
                                      background: s.provider==='google'?'#EFF6FF':s.provider==='outlook'?'#FFF7ED':'#F3F4F6',
                                      color: s.provider==='google'?T.indigo:s.provider==='outlook'?'#C2410C':'#6B7280' }}>
                                      {s.provider==='google'?'Google':s.provider==='outlook'?'Outlook':s.type||'Other'}
                                    </span>
                                  </td>
                                  <td style={{fontWeight:600, color:scoreColor}}>{score??'—'}</td>
                                  <td style={{color:T.textSub}}>{s.warmup_sent!=null ? Number(s.warmup_sent).toLocaleString() : '—'}</td>
                                  <td style={{color:T.textSub}}>{s.emails_sent!=null ? s.emails_sent.toLocaleString() : '—'}</td>
                                  <td>
                                    <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:999,
                                      background:s.bounce_protection?'#DCFCE7':'#F3F4F6',
                                      color:s.bounce_protection?'#15803D':'#9CA3AF'}}>
                                      {s.bounce_protection?'✓ On':'—'}
                                    </span>
                                  </td>
                                  <td>
                                    {(() => {
                                      const st = (s.status || 'connected').toLowerCase().trim();
                                      const isGreen = st === 'active' || st === 'connected' || st === 'enabled' || st === 'ok' || st === 'running';
                                      return (
                                        <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:999, whiteSpace:'nowrap',
                                          background: isGreen ? '#DCFCE7' : '#FEF2F2',
                                          color:      isGreen ? '#15803D' : '#DC2626' }}>
                                          {s.status || 'Connected'}
                                        </span>
                                      );
                                    })()}
                                  </td>
                                  <td style={{textAlign:'center'}}>
                                    {(s.active_campaign_count||0) > 0
                                      ? <span style={{fontSize:12,fontWeight:700,color:'#D97706',background:'#FEF3C7',padding:'2px 9px',borderRadius:999}}>
                                          {s.active_campaign_count}
                                        </span>
                                      : <span style={{fontSize:11,color:T.textMuted}}>0</span>
                                    }
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

        {/* ── STEP 8: Done ──────────────────────────────────────────────── */}
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
        </> /* end deploy tab */ }
      </div>
    </div>
  );
}

// ─── Templates Tab ────────────────────────────────────────────────────────────
function TemplatesTab({ clientId, clients, onUseTemplate }) {
  const [templates,    setTemplates]    = useState([]);
  const [tab,          setTab]          = useState('saved'); // 'saved' | 'pull'
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [success,      setSuccess]      = useState('');

  // Pull-from-campaign state
  const [pullClientId, setPullClientId] = useState(clientId || '');
  const [campaigns,    setCampaigns]    = useState([]);
  const [loadingCamps, setLoadingCamps] = useState(false);
  const [selectedCamp, setSelectedCamp] = useState(null);
  const [fetchedSteps, setFetchedSteps] = useState(null);
  const [templateName, setTemplateName] = useState('');

  // Manual template state
  const [manualName,   setManualName]   = useState('');
  const [manualSteps,  setManualSteps]  = useState([
    { subject:'', body:'', delay_days:0, is_reply:false },
  ]);
  const [showManual,   setShowManual]   = useState(false);

  useEffect(()=>{ loadTemplates(); }, []);
  useEffect(()=>{
    if(clientId) { setPullClientId(clientId); loadAllCampaigns(clientId); }
  }, [clientId]);

  async function loadTemplates() {
    try { const d = await api('/templates'); setTemplates(d); } catch(_) {}
  }

  async function loadAllCampaigns(cid) {
    if (!cid) { setCampaigns([]); setSelectedCamp(null); setFetchedSteps(null); return; }
    setLoadingCamps(true); setError('');
    try {
      // Fetch up to 200 campaigns — paginate if needed
      const d = await api(`/clients/${cid}/campaigns/search?q=&per_page=200`);
      setCampaigns(d);
      setSelectedCamp(null); setFetchedSteps(null);
    } catch(e) { setError(e.message); }
    finally { setLoadingCamps(false); }
  }

  async function fetchSteps(camp) {
    setSelectedCamp(camp);
    setFetchedSteps(null); setTemplateName(camp.name);
    setLoading(true); setError('');
    try {
      const steps = await api(`/clients/${pullClientId}/campaigns/${camp.id}/sequence`);
      if (!steps.length) { setError('No sequence steps found in this campaign.'); setLoading(false); return; }
      setFetchedSteps(steps);
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function saveFromCampaign() {
    if (!templateName.trim() || !fetchedSteps) return;
    setLoading(true); setError('');
    try {
      await api('/templates', { method:'POST', body:JSON.stringify({
        name: templateName.trim(),
        clientId: pullClientId,
        sourceCampaignId: selectedCamp.id,
        sourceCampaignName: selectedCamp.name,
        steps: fetchedSteps,
      })});
      setSuccess(`Template "${templateName}" saved!`);
      setFetchedSteps(null); setSelectedCamp(null); setTemplateName(''); setCampaigns([]);
      loadTemplates();
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function saveManual() {
    if (!manualName.trim()) { setError('Enter a template name'); return; }
    const validSteps = manualSteps.filter(s => s.subject || s.body);
    if (!validSteps.length) { setError('At least one email step is required'); return; }
    setLoading(true); setError('');
    try {
      await api('/templates', { method:'POST', body:JSON.stringify({
        name: manualName.trim(), steps: manualSteps,
      })});
      setSuccess(`Template "${manualName}" saved!`);
      setManualName(''); setManualSteps([{subject:'',body:'',delay_days:0,is_reply:false}]);
      setShowManual(false); loadTemplates();
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function deleteTemplate(id, name) {
    if (!window.confirm(`Delete template "${name}"?`)) return;
    try { await api(`/templates/${id}`, { method:'DELETE' }); loadTemplates(); } catch(e) { setError(e.message); }
  }

  const T2 = {
    ...{ border:'#E5E7EB', surface:'#FFFFFF', bg:'#F9FAFB', text:'#111827',
         textSub:'#6B7280', textMuted:'#9CA3AF', indigo:'#6366F1', indigoLight:'#EEF2FF',
         success:'#10B981', warning:'#F59E0B', error:'#EF4444', surfaceAlt:'#F3F4F6' }
  };

  return (
    <div>
      <div style={{ marginBottom:24 }}>
        <h2 style={{ fontSize:22, fontWeight:700, marginBottom:4 }}>Email Copy Templates</h2>
        <p style={{ fontSize:14, color:T2.textSub }}>
          Save email sequences as reusable templates. Pull from any existing EmailBison campaign or create manually.
        </p>
      </div>

      {error && <div style={{ background:'#FEF2F2', border:'1px solid #FECACA', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#991B1B', marginBottom:12, display:'flex', gap:8 }}><span>✕</span>{error}</div>}
      {success && <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:10, padding:'10px 14px', fontSize:13, color:'#166534', marginBottom:12, display:'flex', gap:8, alignItems:'center' }}><span>✓</span>{success}<button onClick={()=>setSuccess('')} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'#166534',fontSize:16}}>×</button></div>}

      {/* Sub-tabs */}
      <div style={{ display:'flex', gap:8, marginBottom:24, borderBottom:`1px solid ${T2.border}`, paddingBottom:0 }}>
        {[['saved','📁 Saved Templates'],['pull','🔗 Pull from Campaign'],['manual','✏️ Create Manually']].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{ padding:'8px 16px', border:'none', cursor:'pointer', fontFamily:'inherit', fontSize:13,
              fontWeight:tab===id?600:400, background:'none', borderBottom:tab===id?`2px solid ${T2.indigo}`:'2px solid transparent',
              color:tab===id?T2.indigo:T2.textSub, marginBottom:-1, transition:'all .15s' }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Saved Templates ───────────────────────────────────────────────── */}
      {tab==='saved' && (
        <div>
          {templates.length === 0
            ? (
              <div style={{ textAlign:'center', padding:'48px 24px', border:`2px dashed ${T2.border}`, borderRadius:12 }}>
                <div style={{ fontSize:32, marginBottom:12 }}>📋</div>
                <div style={{ fontWeight:600, color:T2.text, marginBottom:6 }}>No templates saved yet</div>
                <div style={{ fontSize:13, color:T2.textSub }}>Pull from an existing campaign or create one manually.</div>
              </div>
            )
            : (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                {templates.map(tpl=>(
                  <div key={tpl.id} style={{ background:T2.surface, border:`1px solid ${T2.border}`, borderRadius:12, overflow:'hidden' }}>
                    <div style={{ padding:'16px 20px', display:'flex', alignItems:'flex-start', gap:12 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>{tpl.name}</div>
                        <div style={{ fontSize:12, color:T2.textMuted, display:'flex', gap:12, flexWrap:'wrap' }}>
                          {tpl.sourceCampaignName && <span>From: {tpl.sourceCampaignName}</span>}
                          <span>{tpl.steps.length} email{tpl.steps.length>1?'s':''}</span>
                          <span>Saved {new Date(tpl.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                        {onUseTemplate && (
                          <button onClick={()=>onUseTemplate(tpl)}
                            style={{ background:T2.indigo, border:'none', borderRadius:8, padding:'6px 14px',
                              cursor:'pointer', fontSize:12, color:'#fff', fontFamily:'inherit', fontWeight:600 }}>
                            Use Template →
                          </button>
                        )}
                        <button onClick={()=>deleteTemplate(tpl.id, tpl.name)}
                          style={{ background:'none', border:`1px solid ${T2.border}`, borderRadius:8, padding:'5px 10px',
                            cursor:'pointer', fontSize:12, color:T2.textMuted, fontFamily:'inherit' }}>
                          Delete
                        </button>
                      </div>
                    </div>
                    {/* Step preview */}
                    <div style={{ borderTop:`1px solid ${T2.border}`, background:T2.bg }}>
                      {tpl.steps.map((s,i)=>(
                        <div key={i} style={{ padding:'10px 20px', borderBottom: i<tpl.steps.length-1?`1px solid ${T2.border}`:'none', display:'grid', gridTemplateColumns:'auto 1fr', gap:'0 12px' }}>
                          <div style={{ width:22, height:22, borderRadius:'50%', background:i===0?T2.indigo:'#E5E7EB', color:i===0?'#fff':T2.textSub, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0, marginTop:1 }}>{i+1}</div>
                          <div>
                            <div style={{ fontSize:13, fontWeight:600, color:T2.text }}>{s.subject || '(no subject)'}</div>
                            <div style={{ fontSize:12, color:T2.textMuted, marginTop:2, display:'flex', gap:10 }}>
                              {i>0 && <span>Day {s.delay_days} · Reply in thread</span>}
                              <span>{(()=>{ const t=stripHtml(s.body||''); const w=t.split(/\s+/); return w.slice(0,8).join(' ')+(w.length>8?'…':''); })()}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </div>
      )}

      {/* ── Pull from Campaign ────────────────────────────────────────────── */}
      {tab==='pull' && (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          <div style={{ background:T2.surface, border:`1px solid ${T2.border}`, borderRadius:12, padding:24 }}>
            <h3 style={{ fontSize:15, fontWeight:700, marginBottom:16 }}>Pull sequence steps from an existing campaign</h3>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
              {/* Client dropdown */}
              <div>
                <label style={{ fontSize:12, fontWeight:600, color:T2.textSub, display:'block', marginBottom:6 }}>Client</label>
                <select value={pullClientId}
                  onChange={e=>{ setPullClientId(e.target.value); loadAllCampaigns(e.target.value); }}
                  style={{ width:'100%', padding:'9px 12px', border:`1.5px solid ${T2.border}`, borderRadius:9, fontSize:13, fontFamily:'inherit', background:T2.surface, outline:'none', cursor:'pointer' }}>
                  <option value="">Select client...</option>
                  {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {/* Campaign dropdown */}
              <div>
                <label style={{ fontSize:12, fontWeight:600, color:T2.textSub, display:'block', marginBottom:6 }}>
                  Campaign
                  {loadingCamps && <span style={{ marginLeft:8, fontSize:11, color:T2.indigo }}>Loading...</span>}
                </label>
                <select
                  value={selectedCamp?.id || ''}
                  disabled={!pullClientId || loadingCamps || campaigns.length===0}
                  onChange={e=>{
                    const camp = campaigns.find(c=>String(c.id)===e.target.value);
                    if(camp) fetchSteps(camp);
                  }}
                  style={{ width:'100%', padding:'9px 12px', border:`1.5px solid ${selectedCamp?T2.indigo:T2.border}`,
                    borderRadius:9, fontSize:13, fontFamily:'inherit', background:T2.surface, outline:'none',
                    cursor:(!pullClientId||loadingCamps)?'not-allowed':'pointer', opacity:(!pullClientId||loadingCamps)?0.5:1 }}>
                  <option value="">{campaigns.length===0 ? (pullClientId?'No campaigns found':'Select client first') : `Select campaign (${campaigns.length})...`}</option>
                  {campaigns.map(c=><option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
              </div>
            </div>

            {selectedCamp && loading && (
              <div style={{ marginTop:12, display:'flex', alignItems:'center', gap:8, fontSize:13, color:T2.indigo }}>
                <span style={{ display:'inline-block', width:14, height:14, border:`2px solid ${T2.indigo}`, borderTopColor:'transparent', borderRadius:'50%', animation:'spin .7s linear infinite' }} />
                Fetching sequence steps from "{selectedCamp.name}"...
              </div>
            )}
          </div>

          {fetchedSteps && (
            <div style={{ background:T2.surface, border:`1px solid ${T2.border}`, borderRadius:12, padding:24 }}>
              <h3 style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>Sequence from "{selectedCamp.name}"</h3>
              <p style={{ fontSize:13, color:T2.textSub, marginBottom:16 }}>{fetchedSteps.length} email steps pulled successfully.</p>

              <div style={{ border:`1px solid ${T2.border}`, borderRadius:10, overflow:'hidden', marginBottom:20 }}>
                {fetchedSteps.map((s,i)=>(
                  <div key={i} style={{ padding:'12px 18px', borderBottom:i<fetchedSteps.length-1?`1px solid ${T2.border}`:'none', background:i%2===0?T2.bg:T2.surface }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
                      <div style={{ width:20, height:20, borderRadius:'50%', background:i===0?T2.indigo:'#6B7280', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, flexShrink:0 }}>{i+1}</div>
                      <span style={{ fontWeight:600, fontSize:13 }}>{s.subject || '(no subject)'}</span>
                      {i>0 && <span style={{ fontSize:11, color:T2.textMuted, marginLeft:'auto' }}>Day {s.delay_days} · Reply</span>}
                    </div>
                    <div style={{ fontSize:12, color:T2.textMuted, marginLeft:30, fontFamily:'monospace', whiteSpace:'pre-wrap', maxHeight:60, overflow:'hidden' }}>
                      {stripHtml(s.body||'').slice(0,200)}{stripHtml(s.body||'').length>200?'…':''}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display:'flex', gap:10, alignItems:'flex-end' }}>
                <div style={{ flex:1 }}>
                  <label style={{ fontSize:12, fontWeight:600, color:T2.textSub, display:'block', marginBottom:6 }}>Save as template named</label>
                  <input value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="e.g. Epsilon3 — Insurance ICP v2"
                    style={{ width:'100%', padding:'9px 12px', border:`1.5px solid ${T2.border}`, borderRadius:9, fontSize:13, fontFamily:'inherit', outline:'none', background:T2.surface }} />
                </div>
                <button onClick={saveFromCampaign} disabled={loading||!templateName.trim()}
                  style={{ padding:'9px 20px', background:T2.success, color:'#fff', border:'none', borderRadius:9, cursor:'pointer', fontFamily:'inherit', fontWeight:600, fontSize:13, opacity:!templateName.trim()?0.5:1, whiteSpace:'nowrap' }}>
                  {loading ? 'Saving...' : '💾 Save Template'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Create Manually ───────────────────────────────────────────────── */}
      {tab==='manual' && (
        <div style={{ background:T2.surface, border:`1px solid ${T2.border}`, borderRadius:12, padding:24 }}>
          <h3 style={{ fontSize:15, fontWeight:700, marginBottom:16 }}>Create a template manually</h3>

          <div style={{ marginBottom:20 }}>
            <label style={{ fontSize:12, fontWeight:600, color:T2.textSub, display:'block', marginBottom:6 }}>Template Name</label>
            <input value={manualName} onChange={e=>setManualName(e.target.value)} placeholder="e.g. Soona — Ecommerce Outreach v1"
              style={{ width:'100%', maxWidth:420, padding:'9px 12px', border:`1.5px solid ${T2.border}`, borderRadius:9, fontSize:13, fontFamily:'inherit', outline:'none', background:T2.surface }} />
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {manualSteps.map((s,i)=>(
              <div key={i} style={{ border:`1.5px solid ${i===0?T2.border:'#D1FAE5'}`, borderRadius:12, overflow:'hidden' }}>
                <div style={{ padding:'10px 16px', background:i===0?T2.bg:'#ECFDF5', borderBottom:`1px solid ${i===0?T2.border:'#A7F3D0'}`, display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:22, height:22, borderRadius:'50%', background:i===0?T2.indigo:T2.success, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700 }}>{i+1}</div>
                  <span style={{ fontWeight:600, fontSize:13 }}>{i===0?'Email 1 — Initial outreach':`Follow-up ${i} — Reply in thread`}</span>
                  {i>0 && (
                    <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:12, color:T2.textSub }}>Send on day</span>
                      <input type="number" min={1} max={30} value={s.delay_days}
                        onChange={e=>setManualSteps(prev=>prev.map((x,j)=>j===i?{...x,delay_days:parseInt(e.target.value)||1}:x))}
                        style={{ width:50, padding:'4px 8px', border:`1.5px solid ${T2.border}`, borderRadius:8, fontSize:12, textAlign:'center', fontFamily:'inherit', outline:'none' }} />
                      <button onClick={()=>setManualSteps(prev=>prev.filter((_,j)=>j!==i))}
                        style={{ background:'none', border:'none', cursor:'pointer', color:T2.textMuted, fontSize:16, padding:'0 4px' }}>✕</button>
                    </div>
                  )}
                </div>
                <div style={{ padding:'12px 16px 14px', display:'flex', flexDirection:'column', gap:10 }}>
                  <input value={s.subject} onChange={e=>setManualSteps(prev=>prev.map((x,j)=>j===i?{...x,subject:e.target.value}:x))}
                    placeholder={i===0?'Subject line':'Re: [original subject]'}
                    style={{ width:'100%', padding:'8px 12px', border:`1.5px solid ${T2.border}`, borderRadius:8, fontSize:13, fontFamily:'inherit', outline:'none', background:T2.surface }} />
                  <textarea rows={5} value={s.body} onChange={e=>setManualSteps(prev=>prev.map((x,j)=>j===i?{...x,body:e.target.value}:x))}
                    placeholder={i===0?'Hi {first_name},\n\n[email body]\n\nBest,\n[Your name]':'[follow-up body]'}
                    style={{ width:'100%', padding:'8px 12px', border:`1.5px solid ${T2.border}`, borderRadius:8, fontSize:12, fontFamily:'monospace', outline:'none', resize:'vertical', lineHeight:1.7, background:T2.surface }} />
                </div>
              </div>
            ))}
          </div>

          {manualSteps.length < 5 && (
            <button onClick={()=>setManualSteps(prev=>[...prev,{subject:'',body:'',delay_days:prev.length*3,is_reply:true}])}
              style={{ marginTop:12, width:'100%', padding:'10px', border:`2px dashed ${T2.border}`, borderRadius:10, background:'transparent', cursor:'pointer', fontSize:13, color:T2.textSub, fontFamily:'inherit' }}>
              + Add follow-up email
            </button>
          )}

          <div style={{ marginTop:20, display:'flex', gap:10 }}>
            <button onClick={saveManual} disabled={loading||!manualName.trim()}
              style={{ padding:'10px 22px', background:T2.indigo, color:'#fff', border:'none', borderRadius:9, cursor:'pointer', fontFamily:'inherit', fontWeight:600, fontSize:13, opacity:!manualName.trim()?0.5:1 }}>
              {loading ? 'Saving...' : '💾 Save Template'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
