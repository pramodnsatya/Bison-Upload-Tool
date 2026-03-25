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
    // Fetch ALL sender emails — API always returns 15/page, paginate using meta.last_page
    let senders = [];
    const first = await eb(req.params.id, '/api/sender-emails?page=1');
    const firstArr = first.data || (Array.isArray(first) ? first : []);
    senders = firstArr;
    const lastPage = first.meta?.last_page || 1;
    // Fetch remaining pages in parallel for speed
    if (lastPage > 1) {
      const pageNums = Array.from({length: lastPage - 1}, (_, i) => i + 2);
      const results = await Promise.all(
        pageNums.map(p => eb(req.params.id, `/api/sender-emails?page=${p}`).catch(() => ({data:[]})))
      );
      results.forEach(r => { senders = senders.concat(r.data || []); });
    }

    // Fetch warmup data and merge
    let warmupMap = {};
    try {
      // Paginate warmup data same way
      let wAll = [];
      const wFirst = await eb(req.params.id, '/api/warmup/sender-emails?page=1');
      wAll = wFirst.data || (Array.isArray(wFirst) ? wFirst : []);
      const wLastPage = wFirst.meta?.last_page || 1;
      if (wLastPage > 1) {
        const wPages = Array.from({length: wLastPage - 1}, (_, i) => i + 2);
        const wResults = await Promise.all(
          wPages.map(p => eb(req.params.id, `/api/warmup/sender-emails?page=${p}`).catch(() => ({data:[]})))
        );
        wResults.forEach(r => { wAll = wAll.concat(r.data || []); });
      }
      const w = wAll;
      const warmupArr = Array.isArray(w) ? w : (w.data || []);
      warmupArr.forEach(ws => { warmupMap[ws.sender_email_id ?? ws.id] = ws; });
    } catch (_) {}

    // Fetch latest 20 campaigns and count sender appearances
    // (max ~8 active at once, 20 gives comfortable buffer without latency)
    let activeCampaignSenders = new Set();
    const senderCampaignCount = {};
    const senderNextSend = {};
    const senderNextSend = {};
    try {
      // Fetch all campaigns to find the active ones specifically
      // Use status filter if API supports it, otherwise fetch recent and filter
      const listRes = await eb(req.params.id, '/api/campaigns?per_page=50&sort=created_at&order=desc');
      const allCamps = Array.isArray(listRes) ? listRes : (listRes.data || []);
      // Only process campaigns that are actually active — skip everything else
      const campList = allCamps.filter(camp => {
        const st = (camp.status || '').toLowerCase();
        return st === 'active' || st === 'running' || st === 'sending' || st === 'launched';
      });

      // Step 2: fetch all sender emails per campaign (paginated, same 15/page structure)
      await Promise.all(
        campList.map(async camp => {
          const st = (camp.status || '').toLowerCase();
          const isActive = st === 'active' || st === 'running' || st === 'sending' || st === 'launched';
          try {
            // Fetch first page to get last_page
            const first = await eb(req.params.id, `/api/campaigns/${camp.id}/sender-emails?page=1`);
            const firstData = first.data || [];
            const lastPage = first.meta?.last_page || 1;

            // Fetch remaining pages in parallel
            let allSnds = [...firstData];
            if (lastPage > 1) {
              const pages = Array.from({length: lastPage - 1}, (_, i) => i + 2);
              const results = await Promise.all(
                pages.map(p => eb(req.params.id, `/api/campaigns/${camp.id}/sender-emails?page=${p}`).catch(() => ({data:[]})))
              );
              results.forEach(r => { allSnds = allSnds.concat(r.data || []); });
            }

            // Only count senders from ACTIVE campaigns — skip completed/paused/draft
            if (isActive) {
              allSnds.forEach(s => {
                const sid = String(s.id);
                senderCampaignCount[sid] = (senderCampaignCount[sid] || 0) + 1;
                activeCampaignSenders.add(sid);
              });
              // Track next scheduled send date from campaign data
              const nextDate = camp.next_send_at || camp.next_scheduled_at || camp.next_email_at || null;
              if (nextDate) {
                allSnds.forEach(s => {
                  const sid = String(s.id);
                  if (!senderNextSend[sid] || nextDate < senderNextSend[sid]) senderNextSend[sid] = nextDate;
                });
              }
            }
          } catch(_) {}
        })
      );

        } catch (_) {}

    const enriched = senders.map(s => {
      const wu = warmupMap[s.id] || {};

      // Provider from confirmed 'type' field: 'google_oauth', 'microsoft_oauth', etc.
      const typeField = (s.type || '').toLowerCase();
      const emailDomain = (s.email||'').includes('@') ? s.email.split('@')[1].toLowerCase() : '';
      let provider = 'other';
      if (typeField.includes('google') || typeField.includes('gmail') || emailDomain === 'gmail.com') {
        provider = 'google';
      } else if (typeField.includes('microsoft') || typeField.includes('outlook') ||
                 typeField.includes('office') || emailDomain === 'outlook.com' ||
                 emailDomain === 'hotmail.com' || emailDomain === 'live.com') {
        provider = 'outlook';
      }

      // Bounce protection is a tag named "Bounce Protection" in the tags array
      const tags = Array.isArray(s.tags) ? s.tags : [];
      const bounceProtection = tags.some(t => (t.name||'').toLowerCase().includes('bounce protection'));

      return {
        id:                    s.id,
        name:                  s.name || '',
        email:                 s.email,
        provider,
        type:                  s.type || '',
        status:                s.status || 'Connected',
        warmup_enabled:        s.warmup_enabled ?? wu.warmup_enabled ?? false,
        warmup_score:          wu.score ?? wu.warmup_score ?? wu.reputation_score ?? null,
        warmup_sent:           wu.total_warmup_sent ?? wu.warmup_emails_sent ?? null,
        emails_sent:           s.emails_sent_count ?? null,
        bounced:               s.bounced_count ?? null,
        leads_contacted:       s.total_leads_contacted_count ?? null,
        bounce_protection:     bounceProtection,
        active_campaigns:      activeCampaignSenders.has(String(s.id)),
        active_campaign_count: senderCampaignCount[String(s.id)] || 0,
        next_send_at: senderNextSend[String(s.id)] || null,
        next_send_at: senderNextSend[String(s.id)] || null,
        daily_limit:           s.daily_limit ?? null,
        tags:                  tags.map(t => t.name),
      };
    });

    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug: see what a campaign's schedule looks like
app.get('/clients/:id/campaigns/:cid/schedule-debug', async (req, res) => {
  try {
    const d = await eb(req.params.id, `/api/campaigns/${req.params.cid}/schedule`);
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Debug: see raw fields from a campaign GET to learn correct field names
app.get('/clients/:id/campaigns/debug', async (req, res) => {
  try {
    const d = await eb(req.params.id, '/api/campaigns?per_page=1');
    const camps = Array.isArray(d) ? d : (d.data || []);
    if (!camps.length) return res.json({ error: 'No campaigns found' });
    const camp = camps[0];
    // Also fetch the full single campaign to see all settings fields
    let full = null;
    try { full = await eb(req.params.id, `/api/campaigns/${camp.id}`); } catch(_) {}
    res.json({
      keys_from_list:   Object.keys(camp),
      keys_from_detail: full ? Object.keys(full.data || full) : [],
      sample_list:      camp,
      sample_detail:    full?.data || full,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/clients/:id/campaigns', async (req, res) => {
  try {
    // Step 1: Create campaign
    const d = await eb(req.params.id, '/api/campaigns', 'POST', { name: req.body.name });
    const id = d.id || d.data?.id || d.campaign?.id;
    if (!id) throw new Error('No campaign ID returned from create');

    // Step 2: Update settings via confirmed PATCH /api/campaigns/{id}/update endpoint
    try {
      await eb(req.params.id, `/api/campaigns/${id}/update`, 'PATCH', {
        plain_text:  true,
        track_opens: false,
        track_clicks: false,
      });
    } catch (_) {
      // Fallback: try plain PATCH on the campaign
      try {
        await eb(req.params.id, `/api/campaigns/${id}`, 'PATCH', {
          plain_text: true, track_opens: false, track_clicks: false,
        });
      } catch (_) {}
    }

    // Step 3: Set schedule — confirmed field names from API debug
    try {
      await eb(req.params.id, `/api/campaigns/${id}/schedule`, 'POST', {
        monday: true, tuesday: true, wednesday: true,
        thursday: true, friday: true, saturday: false, sunday: false,
        start_time: '08:00:00', end_time: '17:00:00', timezone: 'America/New_York',
      });
    } catch(e1) {
      try { await eb(req.params.id, `/api/campaigns/${id}/schedule`, 'PUT', {
        monday: true, tuesday: true, wednesday: true,
        thursday: true, friday: true, saturday: false, sunday: false,
        start_time: '08:00:00', end_time: '17:00:00', timezone: 'America/New_York',
      }); } catch(_) {}
    }

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



// Create/Replace sequence steps — deletes existing steps first to prevent duplication
app.post('/clients/:id/campaigns/:cid/sequence', async (req, res) => {
  try {
    const { steps } = req.body;
    if (!steps?.length) return res.status(400).json({ error: 'steps required' });

    // Step 1: Delete all existing sequence steps first
    try {
      const existing = await eb(req.params.id, `/api/campaigns/${req.params.cid}/sequence-steps?per_page=20`);
      const existingSteps = existing.data || (Array.isArray(existing) ? existing : []);
      await Promise.all(
        existingSteps.map(s =>
          eb(req.params.id, `/api/campaigns/sequence-steps/${s.id}`, 'DELETE').catch(() => {})
        )
      );
    } catch (_) {}

    // Step 2: Create new sequence steps
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
// ── Draft Campaign Manager ────────────────────────────────────────────────────
// Fetch all draft campaigns and inspect what's done vs missing
app.get('/clients/:id/draft-campaigns', async (req, res) => {
  try {
    // Get all campaigns, filter to drafts
    const d = await eb(req.params.id, '/api/campaigns?per_page=200');
    const all = Array.isArray(d) ? d : (d.data || []);
    const drafts = all.filter(c => {
      const s = (c.status || '').toLowerCase();
      return s === 'draft' || s === '' || s === 'inactive' || !c.status;
    });

    // Fetch details for each draft in parallel (cap at 50)
    const slice = drafts.slice(0, 50);
    const details = await Promise.all(
      slice.map(c => eb(req.params.id, `/api/campaigns/${c.id}`).catch(() => ({ data: c })))
    );

    const result = details.map(raw => {
      const c = raw.data || raw;

      // Inspect what's already configured
      const hasLeads     = (c.leads_count ?? c.total_leads ?? 0) > 0;
      const hasSequence  = (c.sequence_steps_count ?? c.sequence_steps?.length ?? 0) > 0;
      const hasSenders   = (c.sender_email_ids?.length ?? c.sender_emails?.length ?? 0) > 0;
      const hasSchedule  = !!(c.sending_days?.length || c.sending_hours_start);
      const isPlainText  = !!(c.plain_text || c.plain_text_emails || c.is_plain_text);
      const trackingOff  = !c.track_opens && !c.track_clicks;

      // What still needs doing
      const todo = [];
      if (!hasSequence) todo.push('sequence');
      if (!hasSenders)  todo.push('senders');
      if (!hasSchedule) todo.push('schedule');
      if (!isPlainText) todo.push('plain_text');

      return {
        id:           c.id,
        name:         c.name,
        status:       c.status || 'draft',
        created_at:   c.created_at,
        // What's done
        has_leads:    hasLeads,
        has_sequence: hasSequence,
        has_senders:  hasSenders,
        has_schedule: hasSchedule,
        is_plain_text: isPlainText,
        tracking_off: trackingOff,
        leads_count:  c.leads_count ?? c.total_leads ?? 0,
        sender_count: c.sender_email_ids?.length ?? c.sender_emails?.length ?? 0,
        sequence_count: c.sequence_steps_count ?? c.sequence_steps?.length ?? 0,
        // What still needs doing
        todo,
        // Raw for reference
        sending_days: c.sending_days,
        sending_hours_start: c.sending_hours_start,
        sending_hours_end: c.sending_hours_end,
      };
    });

    // Sort: most todo first, then alphabetical
    result.sort((a, b) => b.todo.length - a.todo.length || a.name.localeCompare(b.name));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Apply settings to an existing draft campaign
app.patch('/clients/:id/draft-campaigns/:cid/settings', async (req, res) => {
  try {
    const patch = {};
    if (req.body.schedule) {
      // Try dedicated schedule endpoint first, then fallback to PATCH fields
      // Confirmed field names from API — individual day booleans + start_time/end_time
      try {
        await eb(req.params.id, `/api/campaigns/${req.params.cid}/schedule`, 'POST', {
        monday: true, tuesday: true, wednesday: true,
        thursday: true, friday: true, saturday: false, sunday: false,
        start_time: '08:00:00', end_time: '17:00:00', timezone: 'America/New_York',
      });
      } catch(_) {
        try { await eb(req.params.id, `/api/campaigns/${req.params.cid}/schedule`, 'PUT', {
        monday: true, tuesday: true, wednesday: true,
        thursday: true, friday: true, saturday: false, sunday: false,
        start_time: '08:00:00', end_time: '17:00:00', timezone: 'America/New_York',
      }); } catch(_) {}
      }
    }
    if (req.body.plain_text) {
      patch.plain_text        = true;
      patch.plain_text_emails = true;
      patch.is_plain_text     = true;
      patch.track_opens       = false;
      patch.track_clicks      = false;
    }
    const errors = [];
    // Try /api/campaigns/{id}/update first (confirmed working)
    try {
      await eb(req.params.id, `/api/campaigns/${req.params.cid}/update`, 'PATCH', patch);
      return res.json({ ok: true, method: 'update' });
    } catch(e1) { errors.push(e1.message); }
    // Fallback: POST to /api/campaigns/{id}
    try {
      await eb(req.params.id, `/api/campaigns/${req.params.cid}`, 'POST', patch);
      return res.json({ ok: true, method: 'post' });
    } catch(e2) { errors.push(e2.message); }
    // Fallback: PUT
    try {
      await eb(req.params.id, `/api/campaigns/${req.params.cid}`, 'PUT', patch);
      return res.json({ ok: true, method: 'put' });
    } catch(e3) { errors.push(e3.message); }
    res.status(500).json({ error: 'All methods failed', errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// Debug: see raw pagination structure from sender-emails API
app.get('/clients/:id/sender-emails/pagination-debug', async (req, res) => {
  try {
    const r1 = await eb(req.params.id, '/api/sender-emails?per_page=5');
    const r2 = await eb(req.params.id, '/api/sender-emails?per_page=5&page=2');
    const r3 = await eb(req.params.id, '/api/sender-emails?per_page=100');
    res.json({
      page1_keys: Object.keys(r1),
      page1_is_array: Array.isArray(r1),
      page1_count: (Array.isArray(r1) ? r1 : r1.data || []).length,
      page1_meta: r1.meta || r1.pagination || r1.links || r1.total || null,
      page2_count: (Array.isArray(r2) ? r2 : r2.data || []).length,
      per100_count: (Array.isArray(r3) ? r3 : r3.data || []).length,
      per100_meta: r3.meta || r3.pagination || null,
      raw_top_level: typeof r1 === 'object' && !Array.isArray(r1) ? Object.keys(r1) : 'is array',
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Debug: find campaign by slug/name and inspect sender fields
app.get('/clients/:id/campaigns/:cid/detail-debug', async (req, res) => {
  try {
    // First try direct lookup (works if numeric ID)
    let camp = null;
    try {
      const d = await eb(req.params.id, `/api/campaigns/${req.params.cid}`);
      camp = d.data || d;
    } catch(_) {}

    // If not found, search campaigns list for matching UUID or name
    if (!camp || !camp.id) {
      const list = await eb(req.params.id, '/api/campaigns?per_page=200');
      const arr = Array.isArray(list) ? list : (list.data || []);
      // Match by UUID slug or name
      const found = arr.find(c => 
        String(c.id) === String(req.params.cid) ||
        c.uuid === req.params.cid ||
        c.slug === req.params.cid
      );
      if (found) {
        // Now fetch full detail with numeric ID
        const d2 = await eb(req.params.id, `/api/campaigns/${found.id}`);
        camp = d2.data || d2;
      } else {
        // Just return first active campaign as sample
        const active = arr.find(c => c.status === 'active' || c.status === 'running') || arr[0];
        if (active) {
          const d3 = await eb(req.params.id, `/api/campaigns/${active.id}`);
          camp = d3.data || d3;
        }
      }
    }

    if (!camp) return res.json({ error: 'No campaigns found' });
    res.json({
      id: camp.id,
      name: camp.name,
      status: camp.status,
      all_keys: Object.keys(camp),
      sender_email_ids: camp.sender_email_ids,
      sender_emails: camp.sender_emails?.slice(0,3),
      senders: camp.senders?.slice(0,3),
      email_accounts: camp.email_accounts?.slice(0,3),
      // Show any key that might contain sender info
      sender_related: Object.entries(camp).filter(([k]) => 
        k.toLowerCase().includes('sender') || k.toLowerCase().includes('email_account') || k.toLowerCase().includes('inbox')
      ).reduce((acc, [k,v]) => ({...acc, [k]:v}), {}),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Debug: check /api/campaigns/{id}/sender-emails endpoint
app.get('/clients/:id/campaigns/:cid/senders-debug', async (req, res) => {
  try {
    // Find numeric ID first
    const list = await eb(req.params.id, '/api/campaigns?per_page=200');
    const arr = Array.isArray(list) ? list : (list.data || []);
    const camp = arr.find(c => c.uuid === req.params.cid || String(c.id) === req.params.cid) || arr.find(c=>c.status==='active');
    if (!camp) return res.json({error:'no campaign found'});
    const r = await eb(req.params.id, `/api/campaigns/${camp.id}/sender-emails`);
    res.json({ campaign_id: camp.id, campaign_name: camp.name, response_keys: Object.keys(r), data: Array.isArray(r)?r.slice(0,3):(r.data||[]).slice(0,3) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

  app.use(express.static(buildPath));
  app.get('*', (_req, res) => res.sendFile(join(buildPath, 'index.html')));
}

const PORT = process.env.PORT || 3847;
app.listen(PORT, () => console.log(`✅ Server on port ${PORT}`));
