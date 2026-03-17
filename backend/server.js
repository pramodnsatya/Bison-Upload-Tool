import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

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

app.get('/clients/:id/sender-emails', async (req, res) => {
  try { const d = await eb(req.params.id, '/api/sender-emails?per_page=200'); res.json(Array.isArray(d) ? d : (d.data || [])); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/clients/:id/campaigns', async (req, res) => {
  try {
    const d = await eb(req.params.id, '/api/campaigns', 'POST', { name: req.body.name, track_opens: false, track_clicks: false, plain_text: true });
    const id = d.id || d.data?.id || d.campaign?.id;
    try { await eb(req.params.id, `/api/campaigns/${id}`, 'PATCH', { sending_days: ['monday','tuesday','wednesday','thursday','friday'], sending_hours_start: '08:00', sending_hours_end: '19:00', timezone: 'America/New_York' }); } catch (_) {}
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
          // Try to create the lead
          const created = await eb(req.params.id, '/api/leads', 'POST', lead);
          const leadId = created.id || created.data?.id || created.lead?.id;
          if (leadId) allLeadIds.push(leadId);
        } catch (err) {
          // Lead likely already exists — look it up
          try {
            const found = await eb(req.params.id, `/api/leads?search=${encodeURIComponent(lead.email)}&per_page=1`);
            const arr = Array.isArray(found) ? found : (found.data || []);
            const existing = arr.find(l => l.email === lead.email);

            if (existing) {
              if (duplicateMode === 'skip') {
                skipped++;
                // Still attach existing lead to campaign
                allLeadIds.push(existing.id);
              } else if (duplicateMode === 'update' || duplicateMode === 'replace') {
                // Update the lead fields via PUT
                await eb(req.params.id, `/api/leads/${existing.id}`, 'PUT', lead);
                allLeadIds.push(existing.id);
              }
            }
          } catch (_) { /* truly skip */ }
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

// NOTE: EmailBison API does not expose a POST endpoint to create sequence steps.
// The sequence builder is UI-only. This endpoint is intentionally left as a no-op
// so the frontend can proceed past the copy step gracefully.
app.post('/clients/:id/campaigns/:cid/sequence', async (req, res) => {
  res.json({ ok: true, uiOnly: true });
});

app.post('/clients/:id/campaigns/:cid/senders', async (req, res) => {
  try { await eb(req.params.id, `/api/campaigns/${req.params.cid}`, 'PATCH', { sender_email_ids: req.body.senderIds }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Serve React build (production / Railway) ──────────────────────────────────
const buildPath = join(__dirname, '../frontend/build');
if (existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.get('*', (_req, res) => res.sendFile(join(buildPath, 'index.html')));
}

const PORT = process.env.PORT || 3847;
app.listen(PORT, () => console.log(`✅ Server on port ${PORT}`));
