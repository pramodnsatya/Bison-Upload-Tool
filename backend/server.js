import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';

const require = createRequire(import.meta.url);
const Papa = require('papaparse');
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const CLIENTS = [
  { id:'adaptional', name:'Adaptional',   apiKey:'81|wV2V42VWB2RryO8GXu0ySMhbpoxkLFSF3bqX3yE3dc7cbd40' },
  { id:'epsilon3',   name:'Epsilon3',     apiKey:'82|jWrdCp4r6AD5vXiUGpTfQLtyOUt7781RKGvojT7E00b16abf' },
  { id:'arist',      name:'Arist',        apiKey:'83|hw9C81XhxAVE6T64zC02d0HFpIwda8GW0uMlCY7b5a22752d' },
  { id:'dagster',    name:'Dagster Labs',  apiKey:'84|sc4acM0JhmW8W9IdQymnvNZNuRGL6bNlnQS8bqvk8da3c92d' },
  { id:'kastle',     name:'Kastle AI',    apiKey:'85|PLIbnHy2jxKa5HPRhd8hoKPDXKvFxZtVLByTgKwO1e18ba03' },
  { id:'soona',      name:'Soona',        apiKey:'86|8D4ERS7KJmQbmEU69t8aiAJr43VOEy2QepfoiCU4f898d2a3' },
  { id:'sunset',     name:'Sunset',       apiKey:'87|kcdnk0TaaPkTQMhhtoUxHKzlIJu2FMRbFiED0zAb75611237' },
  { id:'upwind',     name:'Upwind',       apiKey:'88|SfBXqTJJaZWqXeExr5t81dC7gvih0VgYjj7PEgu36d566ece' },
  { id:'wisprflow',  name:'WisprFlow',    apiKey:'89|5vPH5Ajl2JDsYRUpRPuujBFdBOKwQ9ZrNJxMs3k0fdb35df3' },
  { id:'founderled',  name:'Founderled',   apiKey:'93|G4WRKr69uHijZerdZvF7vZaVJlGtqLhqcH6lnegH57a3a3bf' },
];

const BASE_URL = process.env.EMAILBISON_URL || 'https://send.founderled.io';

function categorizeMx(raw) {
  if (!raw) return 'seg';
  const mx = raw.toLowerCase();
  if (mx.includes('google') || mx.includes('googlemail') || mx.includes('aspmx') || mx.includes('gmail')) return 'google';
  if (mx.includes('outlook') || mx.includes('microsoft') || mx.includes('hotmail') || mx.includes('office365') || mx.includes('protection.outlook') || mx.includes('exchangelabs') || mx.includes('msv1.net')) return 'outlook';
  if (mx.includes('mimecast')) return 'mimecast';
  return 'seg';
}

async function eb(clientId, path, method = 'GET', body = null) {
  const client = CLIENTS.find(c => c.id === clientId);
  if (!client) throw new Error('Unknown client');
  const opts = { method, headers: { 'Authorization': `Bearer ${client.apiKey}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`EB ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

// ── API routes ────────────────────────────────────────────────────────────────
app.get('/clients', (_req, res) => res.json(CLIENTS.map(c => ({ id: c.id, name: c.name }))));

app.get('/clients/:id/test', async (req, res) => {
  try {
    await eb(req.params.id, '/api/sender-emails?per_page=1');
    res.json({ ok: true, message: CLIENTS.find(c => c.id === req.params.id)?.name });
  } catch (e) { res.status(400).json({ ok: false, message: e.message }); }
});

app.post('/parse-csv', upload.single('file'), (req, res) => {
  try {
    const { data } = Papa.parse(req.file.buffer.toString('utf8'), { header: true, skipEmptyLines: true });
    if (!data.length) return res.status(400).json({ error: 'CSV is empty' });
    res.json({ columns: Object.keys(data[0]), totalRows: data.length, preview: data.slice(0, 3), rows: data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/map-and-segment', (req, res) => {
  try {
    const { rows, mapping } = req.body;
    if (!mapping.email) return res.status(400).json({ error: 'Email mapping required' });
    if (!mapping.mx_record) return res.status(400).json({ error: 'MX Record mapping required' });
    const segs = { google: [], outlook: [], mimecast: [], pure_seg: [] };
    for (const row of rows) {
      const cat = categorizeMx(row[mapping.mx_record] || '');
      const lead = { email: (row[mapping.email] || '').trim(), first_name: mapping.first_name ? (row[mapping.first_name] || '') : '', last_name: mapping.last_name ? (row[mapping.last_name] || '') : '', company_name: mapping.company_name ? (row[mapping.company_name] || '') : '', job_title: mapping.job_title ? (row[mapping.job_title] || '') : '', linkedin_url: mapping.linkedin ? (row[mapping.linkedin] || '') : '', mx_raw: row[mapping.mx_record] || '', mx_category: cat };
      lead.full_name = [lead.first_name, lead.last_name].filter(Boolean).join(' ');
      if (!lead.email) continue;
      if (cat === 'google') segs.google.push(lead);
      else if (cat === 'outlook') segs.outlook.push(lead);
      else if (cat === 'mimecast') segs.mimecast.push(lead);
      else segs.pure_seg.push(lead);
    }
    res.json({
      counts: { google: segs.google.length, outlook: segs.outlook.length, mimecast: segs.mimecast.length, seg: segs.pure_seg.length, total: segs.google.length + segs.outlook.length + segs.mimecast.length + segs.pure_seg.length },
      segments: { google: segs.google, outlook: segs.outlook, seg: [...segs.mimecast, ...segs.pure_seg] },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug: see raw fields from EmailBison sender-emails API response
app.get('/clients/:id/sender-emails/raw', async (req, res) => {
  try {
    const base = await eb(req.params.id, '/api/sender-emails?per_page=5');
    const senders = Array.isArray(base) ? base : (base.data || []);
    res.json({ count: senders.length, first: senders[0] || null, keys: senders[0] ? Object.keys(senders[0]) : [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/clients/:id/sender-emails', async (req, res) => {
  try {
    // Fetch base sender emails
    const base = await eb(req.params.id, '/api/sender-emails?per_page=200');
    const senders = Array.isArray(base) ? base : (base.data || []);

    // Fetch warmup data and merge
    let warmupMap = {};
    try {
      const w = await eb(req.params.id, '/api/warmup/sender-emails?per_page=200');
      const warmupArr = Array.isArray(w) ? w : (w.data || []);
      warmupArr.forEach(ws => { warmupMap[ws.sender_email_id ?? ws.id] = ws; });
    } catch (_) {}

    // Fetch active campaigns to know which senders are already in use
    let activeCampaignSenders = new Set();
    const senderCampaignCount = {};
    try {
      const camps = await eb(req.params.id, '/api/campaigns?per_page=200');
      const campArr = Array.isArray(camps) ? camps : (camps.data || []);
      campArr.forEach(c => {
        // Count active/running campaigns only
        const isActive = !c.status || c.status === 'active' || c.status === 'running' || c.status === 'sending';
        const ids = c.sender_email_ids || c.sender_emails?.map(s => s.id) || [];
        ids.forEach(id => {
          const sid = String(id);
          senderCampaignCount[sid] = (senderCampaignCount[sid] || 0) + 1;
          if (isActive) activeCampaignSenders.add(sid);
        });
      });
    } catch (_) {}
    activeCampaignSenders.count = senderCampaignCount;

    const enriched = senders.map(s => {
      const wu = warmupMap[s.id] || {};

      // Provider detection — check every field EmailBison might use
      const emailAddr  = (s.email || '').toLowerCase();
      const smtpHost   = (s.smtp_host || s.host || s.smtp || '').toLowerCase();
      const provField  = (s.email_provider || s.provider || s.type || s.service || '').toLowerCase();
      const emailDomain = emailAddr.includes('@') ? emailAddr.split('@')[1] : '';

      const isGoogle = smtpHost.includes('google') || smtpHost.includes('gmail') ||
                       provField.includes('google') || provField.includes('gmail') || provField.includes('gsuite') ||
                       emailDomain === 'gmail.com' || emailDomain.endsWith('.google.com');

      const isOutlook = smtpHost.includes('outlook') || smtpHost.includes('microsoft') ||
                        smtpHost.includes('office365') || smtpHost.includes('hotmail') ||
                        provField.includes('microsoft') || provField.includes('outlook') ||
                        provField.includes('office365') || provField.includes('exchange') ||
                        emailDomain === 'outlook.com' || emailDomain === 'hotmail.com' ||
                        emailDomain === 'live.com' || emailDomain.endsWith('.onmicrosoft.com');

      const provider = isGoogle ? 'google' : isOutlook ? 'outlook' : 'other';

      const bounceProtection = s.bounce_protection ?? s.bounce_guard ?? s.is_bounce_protected ??
                               wu.bounce_protection ?? wu.bounce_guard ?? null;

      return {
        id:               s.id,
        email:            s.email,
        provider,
        status:           s.status || 'active',
        warmup_enabled:   wu.warmup_enabled ?? s.warmup_enabled ?? false,
        warmup_score:     wu.score ?? wu.warmup_score ?? s.warmup_score ?? s.reputation_score ?? null,
        warmup_sent:      wu.total_warmup_sent ?? wu.warmup_emails_sent ?? wu.emails_sent ?? null,
        total_sent:       s.total_sent ?? s.emails_sent ?? s.sent_count ?? null,
        bounce_protection: bounceProtection,
        active_campaigns:       activeCampaignSenders.has(String(s.id)),
        active_campaign_count:  activeCampaignSenders.count ? (activeCampaignSenders.count[String(s.id)] || 0) : 0,
        daily_limit:      s.daily_limit ?? s.max_daily_sends ?? s.daily_send_limit ?? null,
        raw:              s,
      };
    });

    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/clients/:id/campaigns', async (req, res) => {
  try {
    // Create campaign with all known plain text / tracking field names
    // (EmailBison field names vary slightly across instances)
    const d = await eb(req.params.id, '/api/campaigns', 'POST', {
      name:              req.body.name,
      // Plain text — try all known variants
      plain_text:        true,
      plain_text_emails: true,
      is_plain_text:     true,
      // Tracking — off for deliverability
      track_opens:       false,
      track_clicks:      false,
      tracking_opens:    false,
      tracking_clicks:   false,
    });
    const id = d.id || d.data?.id || d.campaign?.id;

    // Apply schedule + settings via PATCH (more reliable than creation payload)
    try {
      await eb(req.params.id, `/api/campaigns/${id}`, 'PATCH', {
        // Schedule
        sending_days:         ['monday','tuesday','wednesday','thursday','friday'],
        sending_hours_start:  '08:00',
        sending_hours_end:    '19:00',
        timezone:             'America/New_York',
        // Plain text + tracking — re-apply in PATCH in case POST ignored them
        plain_text:           true,
        plain_text_emails:    true,
        is_plain_text:        true,
        track_opens:          false,
        track_clicks:         false,
        tracking_opens:       false,
        tracking_clicks:      false,
      });
    } catch (_) {}

    res.json({ id, name: req.body.name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/clients/:id/campaigns/:cid/leads', async (req, res) => {
  try {
    const { leads, duplicateMode = 'skip' } = req.body;
    // duplicateMode: 'skip' | 'update' | 'replace'

    const mapped = leads.filter(l => l.email).map(l => {
      const o = { email: l.email };
      if (l.first_name)   o.first_name   = l.first_name;
      if (l.last_name)    o.last_name    = l.last_name;
      if (l.company_name) o.company_name = l.company_name;
      if (l.job_title)    o.job_title    = l.job_title;
      if (l.linkedin_url) o.linkedin_url = l.linkedin_url;
      return o;
    });

    const allLeadIds = [];
    let skipped = 0;
    const BATCH = 50;

    for (let i = 0; i < mapped.length; i += BATCH) {
      const batch = mapped.slice(i, i + BATCH);
      for (const lead of batch) {
        try {
          // Try to create the lead — succeeds only if they are NEW to this workspace
          const created = await eb(req.params.id, '/api/leads', 'POST', lead);
          const leadId = created.id || created.data?.id || created.lead?.id;
          if (leadId) allLeadIds.push(leadId); // Brand new lead — always add to campaign
        } catch (err) {
          // Lead already exists in this workspace
          try {
            const found = await eb(req.params.id, `/api/leads?search=${encodeURIComponent(lead.email)}&per_page=1`);
            const arr = Array.isArray(found) ? found : (found.data || []);
            const existing = arr.find(l => l.email === lead.email);

            if (existing) {
              if (duplicateMode === 'skip') {
                // SKIP: do NOT add this lead to the campaign at all
                skipped++;
              } else if (duplicateMode === 'update' || duplicateMode === 'replace') {
                // UPDATE/REPLACE: refresh their fields and add to campaign
                await eb(req.params.id, `/api/leads/${existing.id}`, 'PUT', lead);
                allLeadIds.push(existing.id);
              }
            }
          } catch (_) { /* silently skip on lookup failure */ }
        }
      }
    }

    // Attach all collected lead IDs to the campaign
    for (let i = 0; i < allLeadIds.length; i += 100) {
      await eb(req.params.id, `/api/campaigns/${req.params.cid}/leads/attach-leads`, 'POST', {
        lead_ids: allLeadIds.slice(i, i + 100),
      });
    }

    res.json({ ok: true, uploaded: allLeadIds.length, skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});



// Create sequence steps — confirmed endpoint from EmailBison support
// POST /api/campaigns/{campaign_id}/sequence-steps
// Body: { title, sequence_steps: [{email_subject, email_body, wait_in_days, order}] }
app.post('/clients/:id/campaigns/:cid/sequence', async (req, res) => {
  try {
    const { steps } = req.body;
    if (!steps?.length) return res.status(400).json({ error: 'steps required' });

    // Format payload as EmailBison support documented
    // wait_in_days must be >= 1 for all steps (EmailBison requirement)
    const sequence_steps = steps.map((s, i) => ({
      email_subject: s.subject,
      email_body:    s.body,
      wait_in_days:  Math.max(1, i === 0 ? 1 : (s.delay_days ?? i * 3)),
      order:         i + 1,
    }));

    const data = await eb(req.params.id,
      `/api/campaigns/${req.params.cid}/sequence-steps`,
      'POST',
      { title: 'Main Sequence', sequence_steps }
    );
    res.json({ ok: true, data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Assign sender emails — confirmed endpoint from EmailBison support
// POST /api/campaigns/{campaign_id}/attach-sender-emails
// Body: array of sender email IDs
app.post('/clients/:id/campaigns/:cid/senders', async (req, res) => {
  const { senderIds } = req.body;
  const errors = [];

  // Try 1: { sender_email_ids: [...] } on attach-sender-emails
  try {
    await eb(req.params.id, `/api/campaigns/${req.params.cid}/attach-sender-emails`, 'POST', { sender_email_ids: senderIds });
    return res.json({ ok: true, method: 'attach-sender-emails-obj' });
  } catch (e1) { errors.push(`attach-obj: ${e1.message}`); }

  // Try 2: raw array on attach-sender-emails
  try {
    await eb(req.params.id, `/api/campaigns/${req.params.cid}/attach-sender-emails`, 'POST', senderIds);
    return res.json({ ok: true, method: 'attach-sender-emails-arr' });
  } catch (e2) { errors.push(`attach-arr: ${e2.message}`); }

  // Try 3: PATCH with sender_email_ids
  try {
    await eb(req.params.id, `/api/campaigns/${req.params.cid}`, 'PATCH', { sender_email_ids: senderIds });
    return res.json({ ok: true, method: 'patch-sender-ids' });
  } catch (e3) { errors.push(`patch: ${e3.message}`); }

  // Try 4: PATCH with sender_emails
  try {
    await eb(req.params.id, `/api/campaigns/${req.params.cid}`, 'PATCH', { sender_emails: senderIds });
    return res.json({ ok: true, method: 'patch-sender-emails' });
  } catch (e4) { errors.push(`patch-emails: ${e4.message}`); }

  res.status(500).json({ error: 'All sender assignment methods failed', errors });
});


// ── Template library ─────────────────────────────────────────────────────────
const TEMPLATES_FILE = join(__dirname, 'templates.json');

function loadTemplates() {
  try { return JSON.parse(readFileSync(TEMPLATES_FILE, 'utf8')); } catch { return []; }
}
function saveTemplates(t) {
  writeFileSync(TEMPLATES_FILE, JSON.stringify(t, null, 2));
}

// List all saved templates
app.get('/templates', (_req, res) => res.json(loadTemplates()));

// Save a new template
app.post('/templates', (req, res) => {
  try {
    const { name, clientId, sourceCampaignId, sourceCampaignName, steps } = req.body;
    if (!name || !steps?.length) return res.status(400).json({ error: 'name and steps required' });
    const templates = loadTemplates();
    const id = `tpl_${Date.now()}`;
    const tpl = { id, name, clientId, sourceCampaignId, sourceCampaignName, steps, createdAt: new Date().toISOString() };
    templates.push(tpl);
    saveTemplates(templates);
    res.json(tpl);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete a template
app.delete('/templates/:id', (req, res) => {
  try {
    const templates = loadTemplates().filter(t => t.id !== req.params.id);
    saveTemplates(templates);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fetch sequence steps from an existing EmailBison campaign
// Try both URL patterns — support docs use /{id}/sequence-steps, public docs use ?campaign_id=
app.get('/clients/:id/campaigns/:cid/sequence', async (req, res) => {
  const normalise = raw => {
    const arr = Array.isArray(raw) ? raw : (raw.data || raw.sequence_steps || []);
    return arr.map(s => ({
      id:         s.id,
      subject:    s.subject || s.email_subject || '',
      body:       s.body || s.email_body || s.content || '',
      delay_days: s.delay_days ?? s.wait_in_days ?? s.delay ?? 0,
      is_reply:   s.reply_to_thread ?? s.is_reply ?? false,
      order:      s.order ?? s.position ?? 0,
    })).sort((a, b) => a.order - b.order);
  };
  try {
    // Try primary: /api/campaigns/{id}/sequence-steps
    const data = await eb(req.params.id, `/api/campaigns/${req.params.cid}/sequence-steps?per_page=20`);
    res.json(normalise(data));
  } catch (_) {
    try {
      // Fallback: /api/campaigns/sequence-steps?campaign_id=
      const data = await eb(req.params.id, `/api/campaigns/sequence-steps?campaign_id=${req.params.cid}&per_page=20`);
      res.json(normalise(data));
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
});

// List/search campaigns (used for template library dropdown)
app.get('/clients/:id/campaigns/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const perPage = req.query.per_page || 200;
    const qs = q ? `search=${encodeURIComponent(q)}&per_page=${perPage}` : `per_page=${perPage}`;
    const data = await eb(req.params.id, `/api/campaigns?${qs}`);
    const campaigns = (Array.isArray(data) ? data : (data.data || [])).map(c => ({
      id: c.id, name: c.name, created_at: c.created_at,
    }));
    // Sort newest first
    campaigns.sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));
    res.json(campaigns);
  } catch (e) { res.status(500).json({ error: e.message }); }
});



// ── Serve React build (production / Railway) ──────────────────────────────────
const buildPath = join(__dirname, '../frontend/build');
if (existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.get('*', (_req, res) => res.sendFile(join(buildPath, 'index.html')));
}

const PORT = process.env.PORT || 3847;
app.listen(PORT, () => console.log(`✅ Server on port ${PORT}`));
