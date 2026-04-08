import { useState, useEffect } from 'react';

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  let data;
  try { data = await res.json(); }
  catch(_) { throw new Error(`Server error (HTTP ${res.status}) — Railway may be restarting, please retry`); }
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
  if (n === 3) {
    return avail.map(t => ({ type:t, name:`${base}_${t}`, leads:t==='seg'?segments.seg||[]:segments[t]||[], senderType:t==='outlook'?'outlook':'google' }));
  }
  // n === 4: separate SEG campaign sent via Outlook senders
  const base3 = avail.map(t => ({ type:t, name:`${base}_${t}`, leads:t==='seg'?segments.seg||[]:segments[t]||[], senderType:t==='outlook'?'outlook':'google' }));
  if (avail.includes('seg')) {
    // Replace seg (google senders) with two: seg_google + seg_outlook
    return [
      ...base3.filter(p => p.type !== 'seg'),
      { type:'seg', name:`${base}_seg_google`, leads:segments.seg||[], senderType:'google' },
      { type:'seg_outlook', name:`${base}_seg_outlook`, leads:segments.seg||[], senderType:'outlook' },
    ].filter(p=>p.leads.length>0);
  }
  return base3;
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


// ─── Inline campaign sequence picker ─────────────────────────────────────────
function CampaignSequencePicker({ clientId, onSelect }) {
  const [camps, setCamps] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  if (!loaded) return (
    <button onClick={async ()=>{
        setLoaded(true); setLoading(true);
        try { setCamps(await api('/clients/'+clientId+'/campaigns/search')); } catch(_){}
        finally { setLoading(false); }
      }}
      style={{padding:'5px 12px',border:'1.5px solid #E5E0D8',borderRadius:7,fontSize:12,
        fontFamily:'inherit',background:'#fff',cursor:'pointer',color:'#6B7280'}}>
      🔗 Pull from campaign
    </button>
  );
  if (loading) return <span style={{fontSize:12,color:'#9CA3AF'}}>Loading campaigns...</span>;
  if (!camps.length) return <span style={{fontSize:12,color:'#9CA3AF'}}>No campaigns found</span>;
  return (
    <select defaultValue=""
      onChange={async e=>{
        const id=e.target.value; e.target.value='';
        if(!id) return;
        try {
          const steps=await api('/clients/'+clientId+'/campaigns/'+id+'/sequence');
          if(steps.length) onSelect(steps.map(s=>({
            subject:s.subject||'',
            body:stripHtml(s.body||''),
            delay_days:Math.max(1,s.delay_days||1),
            thread_reply:s.thread_reply??s.is_reply??false,
            is_variant:s.is_variant??false,
            variant_of_step_id:s.variant_of_step_id??null,
          })));
        } catch(_){}
      }}
      style={{padding:'5px 12px',border:'1.5px solid #E5E0D8',borderRadius:7,fontSize:12,
        fontFamily:'inherit',background:'#fff',cursor:'pointer',outline:'none'}}>
      <option value="" disabled>🔗 Pull from campaign...</option>
      {camps.slice(0,60).map(camp=><option key={camp.id} value={camp.id}>{camp.name}</option>)}
    </select>
  );
}

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
  const [deployPages, setDeployPages] = useState({}); // per campaign: current page number

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
        const senderSet = selSenders[c.name];
        const ids = senderSet instanceof Set ? [...senderSet] : Array.isArray(senderSet) ? senderSet : [];
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
            <div onClick={()=>{ setActiveTab('deploy'); setStep(1); }}
              style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }}>
              <div style={{ width:32, height:32, background:T.indigo, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>📧</div>
              <div>
                <div style={{ fontWeight:700, fontSize:15, color:T.text, lineHeight:1.2 }}>Campaign Deployer</div>
                <div style={{ fontSize:11, color:T.textMuted }}>Founderled</div>
              </div>
            </div>
            {/* Tab nav */}
            <div style={{ display:'flex', gap:4 }}>
              {[['deploy','🚀 Deploy'],['drafts','✏️ Manage Drafts']].map(([id,label])=>(
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
        {activeTab==='drafts' && (() => {
          try { return <DraftsTab clientId={clientId} clients={clients} allSenders={allSenders} />; }
          catch(e) { return <div style={{padding:20,color:'red'}}>DraftsTab error: {e.message}</div>; }
        })()}


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
            {/* Sender availability summary */}
            {allSenders.length > 0 && (() => {
              const activeSenders = allSenders.filter(s => {
                const st = (s.status||'').toLowerCase();
                return st === 'connected' || st === 'active';
              });
              const readyG = activeSenders.filter(s =>
                (s.provider === 'google' || s.provider === 'other') &&
                (s.warmup_sent > 100 || s.emails_sent > 0)
              );
              const readyO = activeSenders.filter(s =>
                (s.provider === 'outlook') &&
                (s.warmup_sent > 100 || s.emails_sent > 0)
              );
              const capG = readyG.length * 15;
              const capO = readyO.length * 5;
              return (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <div style={{ background:'#EFF6FF', border:'1.5px solid #BFDBFE', borderRadius:10, padding:'12px 16px' }}>
                    <div style={{ fontSize:11, fontWeight:600, color:'#1E40AF', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:6 }}>
                      Google senders ready
                    </div>
                    <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
                      <span style={{ fontSize:28, fontWeight:800, color:'#1D4ED8' }}>{readyG.length}</span>
                      <span style={{ fontSize:12, color:'#3B82F6' }}>senders · {capG.toLocaleString()} leads/day capacity</span>
                    </div>
                    <div style={{ fontSize:11, color:'#60A5FA', marginTop:3 }}>
                      Connected + warmup &gt;100 or have sent emails
                    </div>
                  </div>
                  <div style={{ background:'#FFF7ED', border:'1.5px solid #FED7AA', borderRadius:10, padding:'12px 16px' }}>
                    <div style={{ fontSize:11, fontWeight:600, color:'#C2410C', textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:6 }}>
                      Outlook senders ready
                    </div>
                    <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
                      <span style={{ fontSize:28, fontWeight:800, color:'#EA580C' }}>{readyO.length}</span>
                      <span style={{ fontSize:12, color:'#F97316' }}>senders · {capO.toLocaleString()} leads/day capacity</span>
                    </div>
                    <div style={{ fontSize:11, color:'#FDBA74', marginTop:3 }}>
                      Connected + warmup &gt;100 or have sent emails
                    </div>
                  </div>
                </div>
              );
            })()}

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

            {(() => {
              // Group steps: main steps with their variants nested underneath
              const mainSteps = emailSteps.filter(s => !s.is_variant);
              const variantSteps = emailSteps.filter(s => s.is_variant);
              return (
                <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                  {mainSteps.map((s, i) => {
                    const globalIdx = emailSteps.indexOf(s);
                    const stepOrder = s.order || (i + 1);
                    // Find variants belonging to this step
                    const myVariants = variantSteps.filter(v =>
                      v.variant_of_step_id === s.id ||
                      (v.order != null && v.order === stepOrder)
                    );
                    return (
                      <div key={globalIdx}>
                        {/* Main step card */}
                        <div style={{ border:`1.5px solid ${i===0?T.border:'#D1FAE5'}`, borderRadius:14, overflow:'hidden' }}>
                          <div style={{ padding:'10px 18px', background:i===0?T.surfaceAlt:'#ECFDF5',
                            borderBottom:`1px solid ${i===0?T.border:'#A7F3D0'}`,
                            display:'flex', alignItems:'center', gap:12 }}>
                            <div style={{ width:26, height:26, borderRadius:'50%', flexShrink:0,
                              background:i===0?T.indigo:T.success, color:'#fff',
                              display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700 }}>
                              {i+1}
                            </div>
                            <span style={{ fontWeight:700, fontSize:14, flex:1 }}>
                              {i===0 ? 'Email 1 — Initial outreach' : `Follow-up ${i}`}
                              {myVariants.length > 0 && <span style={{ fontSize:11, marginLeft:8, color:'#7C3AED', fontWeight:600 }}>+ {myVariants.length} variant{myVariants.length>1?'s':''}</span>}
                            </span>
                            {i > 0 && (
                              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                                <span style={{ fontSize:12, color:T.textSub }}>Day</span>
                                <input type="number" min={1} max={90} value={s.delay_days}
                                  onChange={e=>setEmailSteps(prev=>prev.map((x,j)=>j===globalIdx?{...x,delay_days:parseInt(e.target.value)||1}:x))}
                                  style={{ width:52, padding:'4px 8px', border:`1.5px solid ${T.border}`, borderRadius:8,
                                    fontSize:13, textAlign:'center', fontFamily:'inherit', outline:'none', background:T.surface }} />
                                <label style={{ display:'flex', alignItems:'center', gap:5, cursor:'pointer', fontSize:12, color:T.textSub, userSelect:'none' }}>
                                  <input type="checkbox" checked={s.reply_to_thread !== false}
                                    onChange={e=>setEmailSteps(prev=>prev.map((x,j)=>j===globalIdx?{...x,reply_to_thread:e.target.checked}:x))}
                                    style={{ cursor:'pointer', width:14, height:14 }} />
                                  Thread reply
                                </label>
                                <button onClick={()=>setEmailSteps(prev=>prev.filter((_,j)=>j!==globalIdx && !myVariants.map(v=>emailSteps.indexOf(v)).includes(j)))}
                                  style={{ background:'none', border:'none', cursor:'pointer', color:T.textMuted, fontSize:18, lineHeight:1 }}>×</button>
                              </div>
                            )}
                          </div>
                          <div style={{ padding:'14px 18px 16px', display:'flex', flexDirection:'column', gap:10 }}>
                            <div>
                              <label style={{ fontSize:11, fontWeight:600, color:T.textMuted, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:5 }}>
                                Subject{myVariants.length>0?' (A)':''}
                              </label>
                              <input value={s.subject}
                                onChange={e=>setEmailSteps(prev=>prev.map((x,j)=>j===globalIdx?{...x,subject:e.target.value}:x))}
                                placeholder={i===0?'e.g. Quick question about {company}':'Re: [original subject]'}
                                style={{ width:'100%', padding:'9px 12px', border:`1.5px solid ${T.border}`, borderRadius:9,
                                  fontSize:14, fontFamily:'inherit', color:T.text, background:T.surface, outline:'none' }} />
                            </div>
                            <div>
                              <label style={{ fontSize:11, fontWeight:600, color:T.textMuted, textTransform:'uppercase', letterSpacing:'0.05em', display:'block', marginBottom:5 }}>
                                Body{myVariants.length>0?' (A)':''}
                              </label>
                              <textarea rows={8} value={s.body}
                                onChange={e=>setEmailSteps(prev=>prev.map((x,j)=>j===globalIdx?{...x,body:e.target.value}:x))}
                                placeholder={i===0?'Hi {first_name},\n\n[your message]\n\nBest,\n[Your name]':'[follow-up body]'}
                                style={{ width:'100%', padding:'10px 12px', border:`1.5px solid ${T.border}`, borderRadius:9,
                                  fontSize:13, fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace', color:T.text,
                                  background:T.surface, outline:'none', resize:'vertical', lineHeight:1.7 }} />
                            </div>
                          </div>
                        </div>

                        {/* Variant cards — nested under parent step */}
                        {myVariants.map((v, vi) => {
                          const vIdx = emailSteps.indexOf(v);
                          return (
                            <div key={vIdx} style={{ marginLeft:24, marginTop:6, border:'1.5px solid #DDD6FE', borderRadius:12, overflow:'hidden' }}>
                              <div style={{ padding:'8px 16px', background:'#F5F3FF', borderBottom:'1px solid #DDD6FE',
                                display:'flex', alignItems:'center', gap:8 }}>
                                <span style={{ fontSize:11, fontWeight:700, color:'#7C3AED', background:'#EDE9FE', borderRadius:6, padding:'2px 8px' }}>
                                  Variant {String.fromCharCode(66+vi)}
                                </span>
                                <span style={{ fontSize:12, color:'#7C3AED', flex:1 }}>Split test variant of Email {i+1}</span>
                                <button onClick={()=>setEmailSteps(prev=>prev.filter((_,j)=>j!==vIdx))}
                                  style={{ background:'none', border:'none', cursor:'pointer', color:'#9CA3AF', fontSize:16, lineHeight:1 }}>×</button>
                              </div>
                              <div style={{ padding:'12px 16px', display:'flex', flexDirection:'column', gap:8, background:'#FAFAFF' }}>
                                <input value={v.subject}
                                  onChange={e=>setEmailSteps(prev=>prev.map((x,j)=>j===vIdx?{...x,subject:e.target.value}:x))}
                                  placeholder='Variant subject line'
                                  style={{ width:'100%', padding:'8px 12px', border:'1.5px solid #DDD6FE', borderRadius:8,
                                    fontSize:13, fontFamily:'inherit', color:T.text, background:'#fff', outline:'none' }} />
                                <textarea rows={6} value={v.body}
                                  onChange={e=>setEmailSteps(prev=>prev.map((x,j)=>j===vIdx?{...x,body:e.target.value}:x))}
                                  placeholder='Variant email body'
                                  style={{ width:'100%', padding:'8px 12px', border:'1.5px solid #DDD6FE', borderRadius:8,
                                    fontSize:12, fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace', color:T.text,
                                    background:'#fff', outline:'none', resize:'vertical', lineHeight:1.6 }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Add follow-up — no limit */}
            <button onClick={()=>setEmailSteps(prev=>[...prev,{subject:'',body:'',delay_days:prev.filter(s=>!s.is_variant).length*3,reply_to_thread:true,is_variant:false}])}
              style={{ marginTop:12, width:'100%', padding:'11px', border:`2px dashed ${T.border}`,
                borderRadius:12, background:'transparent', cursor:'pointer', fontSize:13,
                color:T.textSub, fontWeight:600, fontFamily:'inherit' }}>
              + Add follow-up email
            </button>

            {/* Inline template/campaign picker */}
            <div style={{ marginTop:16, padding:'12px 16px', background:T.surfaceAlt, borderRadius:10,
              display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
              <span style={{ fontSize:13, color:T.textSub, fontWeight:600 }}>Load copy from:</span>
              {/* Pull from existing campaign */}
              {clientId && (
                <CampaignSequencePicker clientId={clientId} onSelect={steps => setEmailSteps(steps)} />
              )}
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
                Select senders for each campaign. ★ = auto-recommended by warmup score. Free = not in any active campaign.
              </p>
            </div>

            {created.map(camp => {
              const filt = senderFilters[camp.name] || { provider: 'all', search: '' };
              const setFilt = (f) => { setSenderFilters(prev => ({ ...prev, [camp.name]: { ...filt, ...f } })); };
              const campPage = deployPages[camp.name] || 0;
              const setCampPage = (p) => setDeployPages(prev => ({ ...prev, [camp.name]: p }));

              const needed = Math.ceil(camp.leads.length / (camp.senderType === 'outlook' ? 5 : 15));
              const sel = selSenders[camp.name] || new Set();
              const toggle = id => setSelSenders(prev => {
                const s = new Set(prev[camp.name]); s.has(id) ? s.delete(id) : s.add(id);
                return { ...prev, [camp.name]: s };
              });

              // Filter
              const filtered = allSenders
                .filter(s => {
                  if (filt.provider === 'google') return s.provider === 'google' || s.provider === 'other';
                  if (filt.provider === 'outlook') return s.provider === 'outlook' || s.provider === 'other';
                  return true;
                })
                .filter(s => {
                  if (!filt.search) return true;
                  const q = filt.search.toLowerCase().trim();
                  const em = s.email.toLowerCase();
                  const domain = em.includes('@') ? em.split('@')[1] : '';
                  return em.includes(q) || domain.includes(q);
                })
                .sort((a,b) => {
                  const sa = a.warmup_score ?? 0, sb = b.warmup_score ?? 0;
                  return sb !== sa ? sb - sa : (a.emails_sent ?? 0) - (b.emails_sent ?? 0);
                });

              const PAGE_SIZE = 15;
              const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
              const pageSenders = filtered.slice(campPage * PAGE_SIZE, (campPage + 1) * PAGE_SIZE);
              const pageAllChecked = pageSenders.length > 0 && pageSenders.every(s => sel.has(s.id));
              const enough = sel.size >= needed;

              return (
                <Card key={camp.name}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
                    <Pill type={camp.type}>{camp.type==='google_seg'?'Google+SEG':(camp.type||'').toUpperCase()}</Pill>
                    <span style={{ fontWeight:700, fontSize:15 }}>{camp.name}</span>
                    <span style={{ fontSize:13, color:T.textSub }}>
                      {camp.leads.length} leads ÷ {camp.senderType==='outlook'?5:15}/day = <strong>{needed} needed</strong>
                    </span>
                    <span style={{ marginLeft:'auto', fontSize:13, fontWeight:700,
                      color: sel.size===0?T.textMuted : enough?T.success:T.warning }}>
                      {sel.size} / {needed} selected
                    </span>
                  </div>

                  {/* Filters */}
                  <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap', alignItems:'center' }}>
                    {[
                      ['all',     'All',     allSenders.length],
                      ['google',  'Google',  allSenders.filter(s=>s.provider==='google'||s.provider==='other').length],
                      ['outlook', 'Outlook', allSenders.filter(s=>s.provider==='outlook'||s.provider==='other').length],
                    ].map(([v,l,cnt]) => (
                      <button key={v} onClick={()=>{ setFilt({provider:v}); setCampPage(0); }}
                        style={{ padding:'4px 10px', borderRadius:7, fontSize:11, fontFamily:'inherit', cursor:'pointer',
                          fontWeight:filt.provider===v?600:400,
                          border:`1.5px solid ${filt.provider===v?T.indigo:T.border}`,
                          background:filt.provider===v?T.indigoLight:T.surface,
                          color:filt.provider===v?T.indigo:T.textSub }}>
                        {l} ({cnt})
                      </button>
                    ))}
                    <input placeholder="Email or domain (e.g. soona.com)" value={filt.search}
                      onChange={e=>{ setFilt({search:e.target.value}); setCampPage(0); }}
                      style={{ flex:1, minWidth:180, padding:'4px 10px', border:`1.5px solid ${T.border}`,
                        borderRadius:7, fontSize:11, fontFamily:'inherit', outline:'none', background:T.surface }} />
                  </div>

                  {/* Sender needed counter */}
                  <div style={{ display:'flex', gap:12, marginBottom:8, padding:'10px 14px', background: enough?'#F0FDF4':'#FFFBEB',
                    border:`1.5px solid ${enough?'#A7F3D0':'#FDE68A'}`, borderRadius:8, alignItems:'center', flexWrap:'wrap' }}>
                    <span style={{ fontSize:13, fontWeight:600, color: enough?T.success:T.warning }}>
                      {enough ? '✓ Enough senders selected' : `Need ${Math.max(0,needed-sel.size)} more sender${needed-sel.size!==1?'s':''}`}
                    </span>
                    <span style={{ fontSize:12, color:T.textSub }}>
                      {camp.leads.length} leads ÷ {camp.senderType==='outlook'?5:15}/day/sender = <strong>{needed} senders needed</strong>
                    </span>
                    <span style={{ marginLeft:'auto', fontSize:13, fontWeight:700, color:sel.size>0?T.indigo:T.textMuted }}>
                      {sel.size} selected
                    </span>
                  </div>
                  <div style={{ border:`1px solid ${T.border}`, borderRadius:8, overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', minWidth:580 }}>
                      <thead>
                        <tr style={{ background:T.surfaceAlt, borderBottom:`2px solid ${T.border}` }}>
                          <th style={{ width:36, padding:'8px 12px', textAlign:'center' }}>
                            <div onClick={()=>{
                                const ns = new Set(sel);
                                pageAllChecked ? pageSenders.forEach(s=>ns.delete(s.id)) : pageSenders.forEach(s=>ns.add(s.id));
                                setSelSenders(prev => ({...prev, [camp.name]: ns}));
                              }}
                              style={{ width:15, height:15, borderRadius:3, margin:'0 auto', cursor:'pointer',
                                border:'2px solid '+(pageAllChecked?T.indigo:'#D1D5DB'),
                                background:pageAllChecked?T.indigo:'transparent',
                                display:'flex', alignItems:'center', justifyContent:'center' }}>
                              {pageAllChecked && <span style={{color:'#fff',fontSize:8,fontWeight:700}}>✓</span>}
                            </div>
                          </th>
                          <th style={{ padding:'8px 12px', textAlign:'left', fontSize:11, fontWeight:600, color:T.textMuted }}>
                            EMAIL
                            <span style={{ marginLeft:8, fontSize:10, color:T.textMuted, fontWeight:400 }}>
                              {filtered.length>0?campPage*PAGE_SIZE+1:0}–{Math.min((campPage+1)*PAGE_SIZE,filtered.length)} of {filtered.length}
                              {filt.provider!=='all'||filt.search?' (filtered)':''}
                            </span>
                          </th>
                          <th style={{ padding:'8px 8px', textAlign:'right', fontSize:11, fontWeight:600, color:T.textMuted, whiteSpace:'nowrap' }}>WU SCORE</th>
                          <th style={{ padding:'8px 8px', textAlign:'right', fontSize:11, fontWeight:600, color:T.textMuted, whiteSpace:'nowrap' }}>WU SENT</th>
                          <th style={{ padding:'8px 8px', textAlign:'right', fontSize:11, fontWeight:600, color:T.textMuted, whiteSpace:'nowrap' }}>TOTAL SENT</th>
                          <th style={{ padding:'8px 8px', textAlign:'center', fontSize:11, fontWeight:600, color:T.textMuted }}>BOUNCE</th>
                          <th style={{ padding:'8px 8px', textAlign:'center', fontSize:11, fontWeight:600, color:T.textMuted }}>STATUS</th>
                          <th style={{ padding:'8px 12px', textAlign:'center', fontSize:11, fontWeight:600, color:T.textMuted }}>ACTIVE IN</th>
                          <th style={{ padding:'8px 12px', textAlign:'center', fontSize:11, fontWeight:600, color:T.textMuted }}>NEXT SEND</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageSenders.map((s, idx) => {
                          const checked = sel.has(s.id);
                          const isOk = (s.status||'').toLowerCase().includes('connect') || (s.status||'').toLowerCase()==='active';
                          const sc = s.warmup_score;
                          const scColor = sc==null?T.textMuted:sc>=80?T.success:sc>=50?T.warning:T.error;
                          const campCount = s.active_campaign_count || 0;
                          return (
                            <tr key={s.id} onClick={()=>toggle(s.id)}
                              style={{ cursor:'pointer', background:checked?T.indigoLight:'transparent',
                                borderBottom:`1px solid ${T.surfaceAlt}` }}>
                              <td style={{ padding:'8px 12px', textAlign:'center' }}>
                                <div style={{ width:15, height:15, borderRadius:3, margin:'0 auto',
                                  border:'2px solid '+(checked?T.indigo:'#D1D5DB'),
                                  background:checked?T.indigo:'transparent',
                                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                                  {checked && <span style={{color:'#fff',fontSize:8,fontWeight:700}}>✓</span>}
                                </div>
                              </td>
                              <td style={{ padding:'8px 12px', fontSize:12 }}>
                                {s.name && <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:2}}>{s.name}</div>}
                                <div style={{fontSize:11,color:T.textSub}}>{s.email}</div>
                              </td>
                              <td style={{ padding:'8px 8px', textAlign:'right', fontWeight:600, fontSize:12, color:scColor }}>{sc??'—'}</td>
                              <td style={{ padding:'8px 8px', textAlign:'right', fontSize:12, color:T.textSub }}>{s.warmup_sent!=null?Number(s.warmup_sent).toLocaleString():'—'}</td>
                              <td style={{ padding:'8px 8px', textAlign:'right', fontSize:12, color:T.textSub }}>{s.emails_sent!=null?Number(s.emails_sent).toLocaleString():'—'}</td>
                              <td style={{ padding:'8px 8px', textAlign:'center' }}>
                                {s.bounce_protection
                                  ? <span style={{fontSize:11,fontWeight:600,color:'#DC2626',background:'#FEF2F2',padding:'2px 7px',borderRadius:999}}>✓</span>
                                  : <span style={{fontSize:11,color:T.textMuted}}>—</span>}
                              </td>
                              <td style={{ padding:'8px 8px', textAlign:'center' }}>
                                <span style={{ fontSize:11, fontWeight:600, padding:'2px 8px', borderRadius:999, whiteSpace:'nowrap',
                                  background:isOk?'#DCFCE7':'#FEF2F2', color:isOk?'#15803D':'#DC2626' }}>
                                  {s.status||'Connected'}
                                </span>
                              </td>
                              <td style={{ padding:'8px 12px', textAlign:'center' }}>
                                {campCount > 0
                                  ? <span style={{fontSize:12,fontWeight:700,color:'#D97706',background:'#FEF3C7',padding:'2px 9px',borderRadius:999}}>{campCount}</span>
                                  : <span style={{fontSize:11,color:T.textMuted}}>free</span>}
                              </td>
                              <td style={{ padding:'8px 12px', textAlign:'center', fontSize:11, color:T.textSub }}>
                                {s.next_send_at
                                  ? (() => {
                                      const today = new Date().toISOString().split('T')[0];
                                      const d = s.next_send_at.split('T')[0];
                                      if (d === today) return <span style={{color:'#F59E0B',fontWeight:600}}>Today</span>;
                                      return new Date(d + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
                                    })()
                                  : <span style={{color:T.textMuted}}>—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {/* Pagination */}
                    {totalPages > 1 && (
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'center',
                        gap:6, padding:'8px', borderTop:`1px solid ${T.border}`, background:T.surfaceAlt }}>
                        <button onClick={()=>setCampPage(Math.max(0,campPage-1))} disabled={campPage===0}
                          style={{ width:28,height:28,border:`1px solid ${T.border}`,borderRadius:6,
                            background:T.surface,cursor:campPage===0?'default':'pointer',
                            fontSize:14,opacity:campPage===0?0.4:1,fontFamily:'inherit' }}>←</button>
                        {Array.from({length:Math.min(totalPages,7)},(_,i)=>{
                          let pg = i;
                          if(totalPages>7){ const s=Math.max(0,campPage-3); pg=s+i; if(pg>=totalPages) return null; }
                          return (
                            <button key={pg} onClick={()=>setCampPage(pg)}
                              style={{ width:28,height:28,border:`1px solid ${pg===campPage?T.indigo:T.border}`,
                                borderRadius:6,background:pg===campPage?T.indigoLight:T.surface,
                                color:pg===campPage?T.indigo:T.textSub,cursor:'pointer',
                                fontSize:12,fontWeight:pg===campPage?700:400,fontFamily:'inherit' }}>
                              {pg+1}
                            </button>
                          );
                        })}
                        <button onClick={()=>setCampPage(Math.min(totalPages-1,campPage+1))} disabled={campPage===totalPages-1}
                          style={{ width:28,height:28,border:`1px solid ${T.border}`,borderRadius:6,
                            background:T.surface,cursor:campPage===totalPages-1?'default':'pointer',
                            fontSize:14,opacity:campPage===totalPages-1?0.4:1,fontFamily:'inherit' }}>→</button>
                      </div>
                    )}
                  </div>
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
// ─── Drafts Tab ───────────────────────────────────────────────────────────────
function DraftsTab({ clientId, clients, allSenders }) {
  const [drafts, setDrafts] = useState([]);
  const [loadingDrafts, setLoadingDrafts] = useState(false);
  const [localSenders, setLocalSenders] = useState([]);
  const [sendersLoading, setSendersLoading] = useState(false);

  const [selClient, setSelClient] = useState(clientId || '');
  const [selDraftId, setSelDraftId] = useState('');
  const [err, setErr] = useState('');

  // Per-draft working state
  const [steps, setSteps] = useState([{subject:'',body:'',delay_days:1}]);
  const [selSend, setSelSend] = useState(new Set());
  const [senderPage, setSenderPage] = useState(0);
  const [senderFilter, setSenderFilter] = useState({provider:'all', search:''});
  const [applying, setApplying] = useState({});
  const [actionDone, setActionDone] = useState({});

  useEffect(() => {
    if (!selClient) return;
    setLoadingDrafts(true);
    setDrafts([]); setSelDraftId(''); setErr('');
    api('/clients/' + selClient + '/draft-campaigns')
      .then(d => setDrafts(Array.isArray(d) ? d : []))
      .catch(e => setErr(e.message))
      .finally(() => setLoadingDrafts(false));
    setSendersLoading(true);
    api('/clients/' + selClient + '/sender-emails')
      .then(d => setLocalSenders(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setSendersLoading(false));
  }, [selClient]);

  // Reset working state when draft changes
  useEffect(() => {
    setSteps([{subject:'',body:'',delay_days:1}]);
    setSelSend(new Set());
    setSenderPage(0);
    setSenderFilter({provider:'all', search:''});
    setActionDone({});
    setErr('');
  }, [selDraftId]);

  const draft = drafts.find(d => String(d.id) === String(selDraftId));
  const sndList = (allSenders && allSenders.length > 0) ? allSenders : localSenders;

  async function applySettings() {
    if (!draft) return;
    setApplying(p => ({...p, cfg:true}));
    try {
      await api('/clients/' + selClient + '/draft-campaigns/' + draft.id + '/settings', {
        method: 'PATCH',
        body: JSON.stringify({ schedule: !draft.has_schedule, plain_text: !draft.is_plain_text }),
      });
      setActionDone(p => ({...p, cfg:true}));
      // Refresh drafts list
      const d = await api('/clients/' + selClient + '/draft-campaigns');
      setDrafts(Array.isArray(d) ? d : []);
    } catch(e) { setErr(e.message); }
    finally { setApplying(p => ({...p, cfg:false})); }
  }

  async function applySequence() {
    if (!draft) return;
    const valid = steps.filter(s => s.subject.trim() || s.body.trim());
    if (!valid.length) { setErr('Add at least one email step.'); return; }
    setApplying(p => ({...p, seq:true}));
    try {
      await api('/clients/' + selClient + '/campaigns/' + draft.id + '/sequence', {
        method: 'POST', body: JSON.stringify({ steps: valid }),
      });
      setActionDone(p => ({...p, seq:true}));
      const d = await api('/clients/' + selClient + '/draft-campaigns');
      setDrafts(Array.isArray(d) ? d : []);
    } catch(e) { setErr(e.message); }
    finally { setApplying(p => ({...p, seq:false})); }
  }

  async function applySenders() {
    if (!draft) return;
    const ids = [...selSend];
    if (!ids.length) { setErr('Select at least one sender.'); return; }
    setApplying(p => ({...p, snd:true}));
    try {
      await api('/clients/' + selClient + '/campaigns/' + draft.id + '/senders', {
        method: 'POST', body: JSON.stringify({ senderIds: ids }),
      });
      setActionDone(p => ({...p, snd:true}));
      const d = await api('/clients/' + selClient + '/draft-campaigns');
      setDrafts(Array.isArray(d) ? d : []);
    } catch(e) { setErr(e.message); }
    finally { setApplying(p => ({...p, snd:false})); }
  }

  function loadTemplate(tpl) {
    const s = (tpl.steps || []).map(s => ({
      subject: s.subject || s.email_subject || '',
      body: stripHtml(s.body || s.email_body || ''),
      delay_days: Math.max(1, s.delay_days || 1),
      thread_reply: s.thread_reply ?? s.is_reply ?? false,
      is_variant: s.is_variant ?? false,
      variant_of_step_id: s.variant_of_step_id ?? null,
    }));
    if (s.length) setSteps(s);
  }

  // Filtered senders
  const filteredSenders = sndList.filter(s => {
    if (senderFilter.provider === 'google') return s.provider === 'google' || s.provider === 'other';
    if (senderFilter.provider === 'outlook') return s.provider === 'outlook' || s.provider === 'other';
    return true;
  }).filter(s => {
    if (!senderFilter.search) return true;
    const q = senderFilter.search.toLowerCase().trim();
    const em = s.email.toLowerCase();
    const domain = em.includes('@') ? em.split('@')[1] : '';
    return em.includes(q) || domain.includes(q);
  });

  const PAGE_SIZE = 10;
  const totalPages = Math.ceil(filteredSenders.length / PAGE_SIZE);
  const pageSenders = filteredSenders.slice(senderPage * PAGE_SIZE, (senderPage + 1) * PAGE_SIZE);
  const pageAllChecked = pageSenders.length > 0 && pageSenders.every(s => selSend.has(s.id));

  function setFilt(f) {
    setSenderFilter(p => ({...p, ...f}));
    setSenderPage(0);
  }

  const chip = (ok, okText, noText) => (
    <span style={{fontSize:11,fontWeight:600,padding:'2px 7px',borderRadius:999,flexShrink:0,
      background:ok?'#DCFCE7':'#FEF3C7',color:ok?'#15803D':'#92400E'}}>
      {ok ? '✓ '+okText : '! '+noText}
    </span>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      {/* ── Header / selectors ── */}
      <div style={{display:'flex',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
        <div style={{flex:1}}>
          <h2 style={{fontSize:20,fontWeight:700,marginBottom:4}}>Manage Draft Campaigns</h2>
          <p style={{fontSize:13,color:T.textSub,margin:0}}>
            Select a client, pick a draft campaign, and configure whatever still needs doing.
          </p>
        </div>
      </div>

      {/* Client + Campaign selectors */}
      <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
        <select value={selClient} onChange={e=>setSelClient(e.target.value)}
          style={{padding:'8px 12px',border:'1.5px solid '+T.border,borderRadius:8,fontSize:13,
            fontFamily:'inherit',background:T.surface,outline:'none',cursor:'pointer',minWidth:180}}>
          <option value="">Select client...</option>
          {(clients||[]).map(cl=><option key={cl.id} value={cl.id}>{cl.name}</option>)}
        </select>

        <select value={selDraftId} onChange={e=>setSelDraftId(e.target.value)}
          disabled={!selClient||loadingDrafts||drafts.length===0}
          style={{padding:'8px 12px',border:'1.5px solid '+T.border,borderRadius:8,fontSize:13,
            fontFamily:'inherit',background:T.surface,outline:'none',cursor:'pointer',flex:1,minWidth:220,
            opacity:(!selClient||loadingDrafts)?0.5:1}}>
          <option value="">{loadingDrafts?'Loading drafts...':(drafts.length===0&&selClient)?'No draft campaigns found':'Select a draft campaign...'}</option>
          {drafts.map(d=>(
            <option key={d.id} value={d.id}>
              {d.name} {d.todo.length>0?'('+d.todo.length+' actions needed)':'(ready)'}
            </option>
          ))}
        </select>

        {selClient && !loadingDrafts && (
          <button onClick={()=>{
            setLoadingDrafts(true);
            api('/clients/'+selClient+'/draft-campaigns')
              .then(d=>setDrafts(Array.isArray(d)?d:[]))
              .catch(e=>setErr(e.message))
              .finally(()=>setLoadingDrafts(false));
          }}
            style={{padding:'8px 14px',background:T.indigo,color:'#fff',border:'none',
              borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
            Refresh
          </button>
        )}
      </div>

      {err && (
        <div style={{background:'#FEF2F2',border:'1px solid #FECACA',borderRadius:10,
          padding:'10px 16px',fontSize:13,color:T.error}}>
          {err}
        </div>
      )}

      {/* ── Campaign detail ── */}
      {draft && (
        <div style={{display:'flex',flexDirection:'column',gap:16}}>

          {/* Campaign status summary */}
          <div style={{background:T.surface,border:'1.5px solid '+T.border,borderRadius:12,padding:'14px 18px'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <span style={{fontWeight:700,fontSize:16,marginRight:4}}>{draft.name}</span>
              {chip(draft.has_leads, 'Leads ('+draft.leads_count+')', 'No leads')}
              {chip(draft.has_sequence, 'Sequence ('+draft.sequence_count+' steps)', 'No sequence')}
              {chip(draft.has_senders, 'Senders ('+draft.sender_count+')', 'No senders')}
              {chip(draft.has_schedule, 'Schedule set', 'No schedule')}
              {chip(draft.is_plain_text, 'Plain text on', 'Plain text off')}
              {draft.todo.length > 0
                ? <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:999,
                    background:'#FEF2F2',color:T.error,marginLeft:'auto',flexShrink:0}}>
                    {draft.todo.length} action{draft.todo.length>1?'s':''} needed
                  </span>
                : <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:999,
                    background:'#DCFCE7',color:'#15803D',marginLeft:'auto',flexShrink:0}}>
                    Ready to launch
                  </span>
              }
            </div>
          </div>

          {/* ── Settings ── */}
          <div style={{background:T.surface,border:'1.5px solid '+T.border,borderRadius:12,padding:'16px 18px'}}>
            <div style={{fontWeight:700,fontSize:15,marginBottom:12}}>Settings</div>
            <div style={{display:'flex',gap:20,alignItems:'center',flexWrap:'wrap'}}>
              <span style={{fontSize:13,color:T.textSub}}>
                Schedule: <strong style={{color:draft.has_schedule?T.success:T.warning}}>
                  {draft.has_schedule?'Mon–Fri 8AM–7PM ET':'Not set'}
                </strong>
              </span>
              <span style={{fontSize:13,color:T.textSub}}>
                Plain text: <strong style={{color:draft.is_plain_text?T.success:T.warning}}>
                  {draft.is_plain_text?'On':'Off'}
                </strong>
              </span>
              {(!draft.has_schedule||!draft.is_plain_text) && (
                <button disabled={!!applying.cfg} onClick={applySettings}
                  style={{marginLeft:'auto',padding:'7px 16px',background:T.indigo,color:'#fff',
                    border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',
                    fontFamily:'inherit',opacity:applying.cfg?0.6:1}}>
                  {applying.cfg?'Applying...':'Apply Missing Settings'}
                </button>
              )}
              {actionDone.cfg && <span style={{fontSize:12,color:T.success,fontWeight:600}}>Applied</span>}
            </div>
          </div>

          {/* ── Email Sequence ── */}
          <div style={{background:T.surface,border:'1.5px solid '+T.border,borderRadius:12,padding:'16px 18px'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap'}}>
              <span style={{fontWeight:700,fontSize:15}}>Email Sequence</span>
              <span style={{fontSize:11,fontWeight:600,color:draft.has_sequence?T.success:T.warning}}>
                {draft.has_sequence?'Has '+draft.sequence_count+' steps — editing will replace them':'Not configured'}
              </span>
              <div style={{marginLeft:'auto',display:'flex',gap:6}}>

                {selClient && (
                  <select defaultValue=""
                    onChange={async e=>{
                      const campId=e.target.value; e.target.value='';
                      if(!campId) return;
                      try { const s=await api('/clients/'+selClient+'/campaigns/'+campId+'/sequence'); if(s.length) loadTemplate({steps:s}); }
                      catch(_){}
                    }}
                    onFocus={async e=>{
                      if(e.target.options.length<=1){
                        try {
                          const camps=await api('/clients/'+selClient+'/campaigns/search');
                          Array.from(e.target.options).slice(1).forEach(o=>o.remove());
                          camps.slice(0,50).forEach(camp=>{const o=document.createElement('option');o.value=camp.id;o.text=camp.name;e.target.appendChild(o);});
                        } catch(_){}
                      }
                    }}
                    style={{padding:'5px 10px',border:'1.5px solid '+T.border,borderRadius:7,fontSize:12,
                      fontFamily:'inherit',background:T.surface,outline:'none',cursor:'pointer'}}>
                    <option value="" disabled>Pull from campaign...</option>
                  </select>
                )}
              </div>
            </div>

            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {steps.map((s,i)=>(
                <div key={i} style={{border:'1px solid '+T.border,borderRadius:9,overflow:'hidden'}}>
                  <div style={{padding:'7px 12px',background:i===0?T.indigoLight:'#F0FDF4',
                    borderBottom:'1px solid '+T.border,display:'flex',alignItems:'center',gap:8}}>
                    <span style={{fontWeight:700,fontSize:12,color:i===0?T.indigo:T.success}}>
                      {i===0?'Email 1 — Initial outreach':'Follow-up '+i}
                    </span>
                    {i>0 && (
                      <div style={{display:'flex',alignItems:'center',gap:6,marginLeft:'auto',flexWrap:'wrap'}}>
                        <span style={{fontSize:11,color:T.textMuted}}>Day</span>
                        <input type="number" min={1} value={s.delay_days}
                          onChange={e=>setSteps(prev=>prev.map((x,j)=>j===i?{...x,delay_days:parseInt(e.target.value)||1}:x))}
                          style={{width:44,padding:'2px 6px',border:'1px solid '+T.border,
                            borderRadius:5,fontSize:12,textAlign:'center',fontFamily:'inherit',outline:'none'}} />
                        <label style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer',fontSize:11,color:T.textSub,userSelect:'none'}}>
                          <input type="checkbox" checked={s.reply_to_thread !== false}
                            onChange={e=>setSteps(prev=>prev.map((x,j)=>j===i?{...x,reply_to_thread:e.target.checked}:x))}
                            style={{cursor:'pointer',width:13,height:13}} />
                          Thread reply
                        </label>
                        <button onClick={()=>setSteps(prev=>prev.filter((_,j)=>j!==i))}
                          style={{background:'none',border:'none',cursor:'pointer',fontSize:18,
                            color:T.textMuted,lineHeight:1,padding:0}}>×</button>
                      </div>
                    )}
                  </div>
                  <div style={{padding:'10px 12px',display:'flex',flexDirection:'column',gap:7}}>
                    <input value={s.subject} placeholder="Subject line..."
                      onChange={e=>setSteps(prev=>prev.map((x,j)=>j===i?{...x,subject:e.target.value}:x))}
                      style={{width:'100%',padding:'7px 10px',border:'1px solid '+T.border,
                        borderRadius:7,fontSize:13,fontFamily:'inherit',outline:'none'}} />
                    <textarea rows={18} value={s.body} placeholder="Email body..."
                      onChange={e=>setSteps(prev=>prev.map((x,j)=>j===i?{...x,body:e.target.value}:x))}
                      style={{width:'100%',padding:'7px 10px',border:'1px solid '+T.border,
                        borderRadius:7,fontSize:12,fontFamily:'ui-monospace,monospace',
                        outline:'none',resize:'vertical',lineHeight:1.6}} />
                  </div>
                </div>
              ))}
            </div>

            <div style={{display:'flex',gap:8,marginTop:12,alignItems:'center'}}>
              {steps.length<5 && (
                <button onClick={()=>setSteps(prev=>[...prev,{subject:'',body:'',delay_days:prev.length*3,reply_to_thread:true}])}
                  style={{padding:'7px 14px',border:'1.5px dashed '+T.border,borderRadius:8,
                    background:'transparent',fontSize:12,cursor:'pointer',
                    color:T.textSub,fontFamily:'inherit',fontWeight:600}}>
                  + Follow-up
                </button>
              )}
              <button disabled={!!applying.seq||!steps.some(s=>s.subject.trim()||s.body.trim())}
                onClick={applySequence}
                style={{marginLeft:'auto',padding:'7px 16px',background:T.indigo,color:'#fff',
                  border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',
                  fontFamily:'inherit',
                  opacity:(applying.seq||!steps.some(s=>s.subject.trim()||s.body.trim()))?0.5:1}}>
                {applying.seq?'Applying...':draft.has_sequence?'Update Sequence':'Apply Sequence'}
              </button>
              {actionDone.seq && <span style={{fontSize:12,color:T.success,fontWeight:600}}>Applied</span>}
            </div>
          </div>

          {/* ── Sender Emails ── */}
          <div style={{background:T.surface,border:'1.5px solid '+T.border,borderRadius:12,padding:'16px 18px'}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,flexWrap:'wrap'}}>
              <span style={{fontWeight:700,fontSize:15}}>Sender Emails</span>
              <span style={{fontSize:11,fontWeight:600,color:draft.has_senders?T.success:T.warning}}>
                {draft.has_senders?draft.sender_count+' currently assigned':'None assigned yet'}
              </span>
              <span style={{marginLeft:'auto',fontSize:12,color:T.textMuted}}>{selSend.size} selected</span>
            </div>

            {/* Filters */}
            <div style={{display:'flex',gap:6,marginBottom:8,flexWrap:'wrap',alignItems:'center'}}>
              {[['all','All',sndList.length],
                ['google','Google',sndList.filter(s=>s.provider==='google'||s.provider==='other').length],
                ['outlook','Outlook',sndList.filter(s=>s.provider==='outlook'||s.provider==='other').length]
              ].map(([v,l,cnt])=>(
                <button key={v} onClick={()=>setFilt({provider:v})}
                  style={{padding:'4px 10px',borderRadius:7,fontSize:11,fontFamily:'inherit',cursor:'pointer',
                    fontWeight:senderFilter.provider===v?600:400,
                    border:'1.5px solid '+(senderFilter.provider===v?T.indigo:T.border),
                    background:senderFilter.provider===v?T.indigoLight:T.surface,
                    color:senderFilter.provider===v?T.indigo:T.textSub}}>
                  {l} ({cnt})
                </button>
              ))}
              <input placeholder="Email or domain (e.g. soona.com)" value={senderFilter.search}
                onChange={e=>setFilt({search:e.target.value})}
                style={{flex:1,minWidth:180,padding:'4px 10px',border:'1.5px solid '+T.border,
                  borderRadius:7,fontSize:11,fontFamily:'inherit',outline:'none',background:T.surface}} />
            </div>

            {sendersLoading ? (
              <div style={{fontSize:12,color:T.textMuted,padding:'12px 0',textAlign:'center'}}>
                Loading senders...
              </div>
            ) : sndList.length === 0 ? (
              <div style={{fontSize:12,color:T.textMuted,padding:'8px 0'}}>
                No senders found for this client.
              </div>
            ) : (
              <div style={{border:'1px solid '+T.border,borderRadius:8,overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',minWidth:600}}>
                  <thead>
                    <tr style={{background:T.surfaceAlt,borderBottom:'2px solid '+T.border}}>
                      <th style={{width:36,padding:'8px 12px',textAlign:'center'}}>
                        <div onClick={()=>{
                            const ns=new Set(selSend);
                            pageAllChecked?pageSenders.forEach(s=>ns.delete(s.id)):pageSenders.forEach(s=>ns.add(s.id));
                            setSelSend(ns);
                          }}
                          style={{width:15,height:15,borderRadius:3,border:'2px solid '+(pageAllChecked?T.indigo:'#D1D5DB'),
                            background:pageAllChecked?T.indigo:'transparent',cursor:'pointer',
                            display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto'}}>
                          {pageAllChecked&&<span style={{color:'#fff',fontSize:8,fontWeight:700}}>✓</span>}
                        </div>
                      </th>
                      <th style={{padding:'8px 12px',textAlign:'left',fontSize:11,fontWeight:600,color:T.textMuted}}>
                        EMAIL
                        <span style={{marginLeft:8,fontSize:10,color:T.textMuted,fontWeight:400}}>
                          {filteredSenders.length>0?senderPage*PAGE_SIZE+1:0}–{Math.min((senderPage+1)*PAGE_SIZE,filteredSenders.length)} of {filteredSenders.length}
                          {senderFilter.provider!=='all'||senderFilter.search?' (filtered)':''}
                        </span>
                      </th>
                      <th style={{padding:'8px 8px',textAlign:'right',fontSize:11,fontWeight:600,color:T.textMuted,whiteSpace:'nowrap'}}>WU SCORE</th>
                      <th style={{padding:'8px 8px',textAlign:'right',fontSize:11,fontWeight:600,color:T.textMuted,whiteSpace:'nowrap'}}>WU SENT</th>
                      <th style={{padding:'8px 8px',textAlign:'right',fontSize:11,fontWeight:600,color:T.textMuted,whiteSpace:'nowrap'}}>TOTAL SENT</th>
                      <th style={{padding:'8px 8px',textAlign:'center',fontSize:11,fontWeight:600,color:T.textMuted}}>BOUNCE</th>
                      <th style={{padding:'8px 8px',textAlign:'center',fontSize:11,fontWeight:600,color:T.textMuted}}>STATUS</th>
                      <th style={{padding:'8px 12px',textAlign:'center',fontSize:11,fontWeight:600,color:T.textMuted}}>ACTIVE IN</th>
                      <th style={{padding:'8px 12px',textAlign:'center',fontSize:11,fontWeight:600,color:T.textMuted}}>NEXT SEND</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageSenders.map(s=>{
                      const checked=selSend.has(s.id);
                      const isOk=((s.status||'').toLowerCase()==='connected'||(s.status||'').toLowerCase()==='active')&&!(s.status||'').toLowerCase().includes('not');
                      const sc=s.warmup_score;
                      const scColor=sc==null?T.textMuted:sc>=80?T.success:sc>=50?T.warning:T.error;
                      const campCount=s.active_campaign_count||0;
                      return (
                        <tr key={s.id} onClick={()=>{const ns=new Set(selSend);checked?ns.delete(s.id):ns.add(s.id);setSelSend(ns);}}
                          style={{cursor:'pointer',background:checked?T.indigoLight:'transparent',
                            borderBottom:'1px solid '+T.surfaceAlt}}>
                          <td style={{padding:'8px 12px',textAlign:'center'}}>
                            <div style={{width:15,height:15,borderRadius:3,border:'2px solid '+(checked?T.indigo:'#D1D5DB'),
                              background:checked?T.indigo:'transparent',margin:'0 auto',
                              display:'flex',alignItems:'center',justifyContent:'center'}}>
                              {checked&&<span style={{color:'#fff',fontSize:8,fontWeight:700}}>✓</span>}
                            </div>
                          </td>
                          <td style={{padding:'8px 12px',fontSize:12}}>
                            {s.name && <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:2}}>{s.name}</div>}
                            <div style={{fontSize:11,color:T.textSub}}>{s.email}</div>
                          </td>
                          <td style={{padding:'8px 8px',textAlign:'right',fontWeight:600,fontSize:12,color:scColor}}>{sc??'—'}</td>
                          <td style={{padding:'8px 8px',textAlign:'right',fontSize:12,color:T.textSub}}>{s.warmup_sent!=null?Number(s.warmup_sent).toLocaleString():'—'}</td>
                          <td style={{padding:'8px 8px',textAlign:'right',fontSize:12,color:T.textSub}}>{s.emails_sent!=null?Number(s.emails_sent).toLocaleString():'—'}</td>
                          <td style={{padding:'8px 8px',textAlign:'center'}}>
                            {s.bounce_protection
                              ?<span style={{fontSize:11,fontWeight:600,color:'#DC2626',background:'#FEF2F2',padding:'2px 7px',borderRadius:999}}>✓</span>
                              :<span style={{fontSize:11,color:T.textMuted}}>—</span>
                            }
                          </td>
                          <td style={{padding:'8px 8px',textAlign:'center'}}>
                            <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:999,whiteSpace:'nowrap',
                              background:isOk?'#DCFCE7':'#FEF2F2',color:isOk?'#15803D':'#DC2626'}}>
                              {s.status||'Connected'}
                            </span>
                          </td>
                          <td style={{padding:'8px 12px',textAlign:'center'}}>
                            {campCount>0
                              ?<span style={{fontSize:12,fontWeight:700,color:'#D97706',background:'#FEF3C7',padding:'2px 9px',borderRadius:999}}>{campCount}</span>
                              :<span style={{fontSize:11,color:T.textMuted}}>free</span>
                            }
                          </td>
                          <td style={{padding:'8px 12px',textAlign:'center',fontSize:11,color:T.textSub}}>
                            {s.next_send_at
                              ? (() => {
                                  const today = new Date().toISOString().split('T')[0];
                                  const d = s.next_send_at.split('T')[0];
                                  if (d === today) return <span style={{color:'#F59E0B',fontWeight:600}}>Today</span>;
                                  return new Date(d + 'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
                                })()
                              :<span style={{color:T.textMuted}}>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {/* Pagination */}
                {totalPages>1 && (
                  <div style={{display:'flex',alignItems:'center',justifyContent:'center',
                    gap:6,padding:'8px',borderTop:'1px solid '+T.border,background:T.surfaceAlt}}>
                    <button onClick={()=>setSenderPage(p=>Math.max(0,p-1))} disabled={senderPage===0}
                      style={{width:28,height:28,border:'1px solid '+T.border,borderRadius:6,
                        background:T.surface,cursor:senderPage===0?'default':'pointer',
                        fontSize:14,opacity:senderPage===0?0.4:1,fontFamily:'inherit'}}>←</button>
                    {Array.from({length:Math.min(totalPages,7)},(_,i)=>{
                      // Show pages around current
                      let pg = i;
                      if(totalPages>7) {
                        const start=Math.max(0,senderPage-3);
                        pg=start+i;
                        if(pg>=totalPages) return null;
                      }
                      return (
                        <button key={pg} onClick={()=>setSenderPage(pg)}
                          style={{width:28,height:28,border:'1px solid '+(pg===senderPage?T.indigo:T.border),
                            borderRadius:6,background:pg===senderPage?T.indigoLight:T.surface,
                            color:pg===senderPage?T.indigo:T.textSub,cursor:'pointer',
                            fontSize:12,fontWeight:pg===senderPage?700:400,fontFamily:'inherit'}}>
                          {pg+1}
                        </button>
                      );
                    })}
                    <button onClick={()=>setSenderPage(p=>Math.min(totalPages-1,p+1))} disabled={senderPage===totalPages-1}
                      style={{width:28,height:28,border:'1px solid '+T.border,borderRadius:6,
                        background:T.surface,cursor:senderPage===totalPages-1?'default':'pointer',
                        fontSize:14,opacity:senderPage===totalPages-1?0.4:1,fontFamily:'inherit'}}>→</button>
                  </div>
                )}
              </div>
            )}

            <div style={{display:'flex',gap:8,marginTop:12,alignItems:'center'}}>
              <button disabled={!!applying.snd||selSend.size===0} onClick={applySenders}
                style={{marginLeft:'auto',padding:'7px 16px',background:T.success,color:'#fff',
                  border:'none',borderRadius:8,fontSize:13,fontWeight:600,cursor:'pointer',
                  fontFamily:'inherit',opacity:(applying.snd||selSend.size===0)?0.5:1}}>
                {applying.snd?'Assigning...':draft.has_senders?'Update Senders':'Assign Senders'}
              </button>
              {actionDone.snd && <span style={{fontSize:12,color:T.success,fontWeight:600}}>Assigned</span>}
            </div>
          </div>

        </div>
      )}

      {!draft && selClient && !loadingDrafts && drafts.length > 0 && (
        <div style={{textAlign:'center',padding:'48px',color:T.textMuted,fontSize:14,
          background:T.surface,borderRadius:12,border:'1px solid '+T.border}}>
          Select a draft campaign from the dropdown above to get started.
        </div>
      )}
    </div>
  );
}

