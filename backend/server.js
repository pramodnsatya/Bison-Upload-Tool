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
  { id:'zeroentropy',  name:'ZeroEntropy',  apiKey:'96|9jmnxZu3MWgUlQrCyAzr7qYIbxdv5AsC9ccrGwNn8eaf1df5' },
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

// Sender availability check — single call replaces N paginated schedule lookups
// POST /api/tools/sender-availability-check
// { client_id, sender_ids: [1,2,3,...], date: "2026-04-06" }
// Returns { clean: [ids free today], busy: [ids with sends scheduled today] }
app.post('/api/tools/sender-availability-check', async (req, res) => {
  try {
    const { client_id, sender_ids, date } = req.body;
    if (!client_id || !sender_ids || !sender_ids.length) {
      return res.status(400).json({ error: 'client_id and sender_ids required' });
    }
    const checkDate = date || new Date().toISOString().split('T')[0];
    const senderIdSet = new Set(sender_ids.map(Number));
    const busyIds = new Set();

    // Fetch all active campaigns
    const campFirst = await eb(client_id, '/api/campaigns?page=1');
    let allCamps = campFirst.data || [];
    const campLastPage = campFirst.meta && campFirst.meta.last_page || 1;
    if (campLastPage > 1) {
      const pages = Array.from({length: campLastPage-1}, (_,i) => i+2);
      const results = await Promise.all(pages.map(p => eb(client_id, '/api/campaigns?page='+p).catch(()=>({data:[]}))));
      results.forEach(r => { allCamps = allCamps.concat(r.data||[]); });
    }
    const activeStatuses = ['active','launching','sending','queued','running'];
    const activeCamps = allCamps.filter(c => activeStatuses.includes((c.status||'').toLowerCase()));

    // Check scheduled emails for each active campaign in parallel
    const schedResults = await Promise.allSettled(
      activeCamps.slice(0, 50).map(async camp => {
        const r = await eb(client_id, '/api/campaigns/'+camp.id+'/scheduled-emails?status=scheduled');
        return r.data || [];
      })
    );

    schedResults.forEach(r => {
      if (r.status === 'fulfilled') {
        r.value.forEach(email => {
          const schedDate = (email.scheduled_date_local || email.scheduled_date || '').split('T')[0];
          if (schedDate === checkDate && email.sender_email && email.sender_email.id) {
            const sid = Number(email.sender_email.id);
            if (senderIdSet.has(sid)) busyIds.add(sid);
          }
        });
      }
    });

    const clean = sender_ids.map(Number).filter(id => !busyIds.has(id));
    const busy  = sender_ids.map(Number).filter(id =>  busyIds.has(id));
    res.json({ ok: true, date: checkDate, clean, busy, clean_count: clean.length, busy_count: busy.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
              // Fetch scheduled emails to find next send date per sender
              // API does NOT return next_send_at on campaign object — must check scheduled emails
              try {
                const todayStr = new Date().toISOString().split('T')[0];
                const schedR = await eb(req.params.id, `/api/campaigns/${camp.id}/scheduled-emails?status=scheduled`);
                const schedEmails = schedR.data || [];
                schedEmails.forEach(email => {
                  if (!email.sender_email || !email.sender_email.id) return;
                  const sid = String(email.sender_email.id);
                  const sendDate = (email.scheduled_date_local || email.scheduled_date || '').split('T')[0];
                  if (!sendDate) return;
                  // Track earliest future/today scheduled date per sender
                  if (!senderNextSend[sid] || sendDate < senderNextSend[sid]) {
                    senderNextSend[sid] = sendDate;
                  }
                });
              } catch(_) {}
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
        plain_text: true,
        open_tracking: false,
        can_unsubscribe: false,
        include_auto_replies_in_stats: true,
        max_emails_per_day: 1000,
        max_new_leads_per_day: 1000,
        sequence_prioritization: 'followups',
      });
    } catch (_) {
      // Fallback: try plain PATCH on the campaign
      try {
        await eb(req.params.id, `/api/campaigns/${id}`, 'PATCH', {
          plain_text: true, open_tracking: false, can_unsubscribe: false,
          include_auto_replies_in_stats: true, max_emails_per_day: 1000,
          max_new_leads_per_day: 1000, sequence_prioritization: 'followups',
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
      if (l.company_name) o.company = l.company_name;  // API field is 'company' not 'company_name'
      if (l.company) o.company = l.company;  // also accept 'company' directly
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
      const exFirst = await eb(req.params.id, `/api/campaigns/${req.params.cid}/sequence-steps?page=1`);
      let existingSteps = exFirst.data || (Array.isArray(exFirst) ? exFirst : []);
      const exLastPage = exFirst.meta?.last_page || 1;
      if (exLastPage > 1) {
        const exPages = Array.from({length: exLastPage-1}, (_,i) => i+2);
        const exResults = await Promise.all(exPages.map(p =>
          eb(req.params.id, `/api/campaigns/${req.params.cid}/sequence-steps?page=${p}`).catch(()=>({data:[]}))
        ));
        exResults.forEach(r => { existingSteps = existingSteps.concat(r.data || []); });
      }
      await Promise.all(
        existingSteps.map(s =>
          eb(req.params.id, `/api/campaigns/sequence-steps/${s.id}`, 'DELETE').catch(() => {})
        )
      );
    } catch (_) {}

    // Step 2: Build sequence steps — preserve variants and thread_reply from source
    // Group by order: non-variants define the step, variants are A/B splits
    const firstSubject = steps[0]?.subject || '';

    // Separate main steps and variants
    const mainSteps = steps.filter(s => !s.is_variant);
    const variantSteps = steps.filter(s => s.is_variant);

    const sequence_steps = [];

    mainSteps.forEach((s, i) => {
      const defaultReply = i > 0;
      const isReply = s.reply_to_thread !== undefined ? s.reply_to_thread : defaultReply;
      const subject = s.subject?.trim() ? s.subject : (isReply ? firstSubject : 'Follow-up');
      const order = s.order || (i + 1);
      const waitDays = Math.max(1, i === 0 ? 1 : (s.delay_days ?? i * 3));

      // Push the main step
      sequence_steps.push({
        email_subject:   subject,
        email_body:      s.body,
        wait_in_days:    waitDays,
        order:           order,
        reply_to_thread: isReply,
        variant:         false,
      });

      // Push any variants that belong to this step (matched by variant_of_step_id or same order)
      variantSteps
        .filter(v => v.variant_of_step_id === s.id || v.variant_of_step_id === null && v.order === order)
        .forEach(v => {
          sequence_steps.push({
            email_subject:   v.subject?.trim() ? v.subject : subject,
            email_body:      v.body,
            wait_in_days:    waitDays,
            order:           order,
            reply_to_thread: isReply,
            variant:         true,
            variant_from_step: order, // link to parent by order number
          });
        });
    });

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
    // Sort: non-variants first within each order position, then variants
    const sorted = arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.variant ? 1 : -1));
    return sorted.map(s => ({
      id:                  s.id,
      subject:             s.subject || s.email_subject || '',
      body:                s.body || s.email_body || s.content || '',
      delay_days:          s.delay_days ?? s.wait_in_days ?? s.delay ?? 0,
      is_reply:            s.reply_to_thread ?? s.is_reply ?? false,
      thread_reply:        s.reply_to_thread ?? s.thread_reply ?? false,
      order:               s.order ?? s.position ?? 0,
      is_variant:          s.variant ?? false,
      variant_of_step_id:  s.variant_from_step_id ?? null,
      active:              s.active ?? true,
    }));
  };
  try {
    // Paginate — API ignores per_page, always returns 15/page
    const first = await eb(req.params.id, `/api/campaigns/${req.params.cid}/sequence-steps?page=1`);
    let all = first.data || (Array.isArray(first) ? first : []);
    const lastPage = first.meta?.last_page || 1;
    if (lastPage > 1) {
      const pages = Array.from({length: lastPage-1}, (_,i) => i+2);
      const results = await Promise.all(pages.map(p =>
        eb(req.params.id, `/api/campaigns/${req.params.cid}/sequence-steps?page=${p}`).catch(()=>({data:[]}))
      ));
      results.forEach(r => { all = all.concat(r.data || (Array.isArray(r) ? r : [])); });
    }
    res.json(normalise({data: all}));
  } catch (e) { res.status(500).json({ error: e.message }); }
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

// Debug: see raw sequence steps structure including split variants
app.get('/clients/:id/campaigns/:cid/sequence-raw', async (req, res) => {
  try {
    const data = await eb(req.params.id, `/api/campaigns/${req.params.cid}/sequence-steps?page=1`);
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Helper: fetch fully enriched senders for MCP (same logic as /clients/:id/sender-emails route)
async function mcpFetchEnrichedSenders(clientId) {
  // Fetch all sender pages
  const first = await eb(clientId, '/api/sender-emails?page=1');
  let senders = first.data || [];
  const lastPage = first.meta?.last_page || 1;
  if (lastPage > 1) {
    const pages = Array.from({length: lastPage - 1}, (_, i) => i + 2);
    const results = await Promise.all(pages.map(p => eb(clientId, `/api/sender-emails?page=${p}`).catch(() => ({data:[]}))));
    results.forEach(r => { senders = senders.concat(r.data || []); });
  }

  // Fetch warmup data — requires start_date and end_date (use last 30 days for score accuracy)
  let warmupMap = {};
  try {
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
    const warmupParams = 'start_date=' + thirtyDaysAgo + '&end_date=' + today;

    const wFirst = await eb(clientId, '/api/warmup/sender-emails?page=1&' + warmupParams);
    let wAll = wFirst.data || [];
    const wLast = wFirst.meta?.last_page || 1;
    if (wLast > 1) {
      const wPages = Array.from({length: wLast - 1}, (_, i) => i + 2);
      const wResults = await Promise.all(wPages.map(p =>
        eb(clientId, '/api/warmup/sender-emails?page=' + p + '&' + warmupParams).catch(() => ({data:[]}))
      ));
      wResults.forEach(r => { wAll = wAll.concat(r.data || []); });
    }
    // Warmup response uses: id, warmup_score, warmup_emails_sent
    wAll.forEach(ws => { warmupMap[ws.id] = ws; });
  } catch(_) {}

  return senders.map(s => {
    const wu = warmupMap[s.id] || {};
    const typeField = (s.type || '').toLowerCase();
    let provider = 'other';
    if (typeField.includes('google') || typeField.includes('gmail')) provider = 'google';
    else if (typeField.includes('microsoft') || typeField.includes('outlook') || typeField.includes('office')) provider = 'outlook';
    const bounceTag = (s.tags || []).find(t => t.name?.toLowerCase().includes('bounce'));
    return {
      id: s.id,
      email: s.email,
      name: s.name,
      provider,
      // warmup_score and warmup_emails_sent are the correct field names from the API
      warmup_score: wu.warmup_score ?? null,
      warmup_sent: wu.warmup_emails_sent ?? null,
      emails_sent: s.emails_sent_count ?? null,
      bounce_protection: !!bounceTag,
      status: s.status,
      created_at: s.created_at ?? null,
      active_campaign_count: 0,
    };
  });
}

// ─── MCP SERVER ──────────────────────────────────────────────────────────────
// Streamable HTTP transport — single /mcp endpoint (POST + GET)
// Register in Claude.ai: Settings → Integrations → Add MCP → URL type
// URL: https://bison-upload-tool-production.up.railway.app/mcp

const MCP_TOOLS = [
  {
    name: 'list_clients',
    description: 'List all available EmailBison client workspaces',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_campaigns',
    description: 'List campaigns for a client. Filter by status (active, draft, paused, completed).',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID (e.g. soona, kastle, dagster)' },
        status: { type: 'string', description: 'Filter by status: active, draft, paused, completed. Leave empty for all.' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'list_draft_campaigns',
    description: 'List draft campaigns with their todo status (what still needs doing)',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'list_senders',
    description: 'List sender emails for a client with warmup score, status, and active campaign count',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        provider: { type: 'string', description: 'Filter by provider: google, outlook, all (default: all)' },
        min_warmup_score: { type: 'number', description: 'Minimum warmup score (0-100)' },
        ready_only: { type: 'boolean', description: 'Only show senders with warmup>100 or emails_sent>0 and status Connected' },
        domains: { type: 'array', items: { type: 'string' }, description: 'Filter senders to only these sending domains e.g. ["founderled.io", "acme.com"]' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'get_campaign_sequence',
    description: 'Get the email sequence steps for a campaign',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        campaign_id: { type: 'string', description: 'Campaign numeric ID' },
      },
      required: ['client_id', 'campaign_id'],
    },
  },
  {
    name: 'get_campaign_senders',
    description: 'Get sender emails currently assigned to a campaign',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        campaign_id: { type: 'string', description: 'Campaign numeric ID' },
      },
      required: ['client_id', 'campaign_id'],
    },
  },
  {
    name: 'apply_sequence',
    description: 'Set the full email sequence for a campaign (replaces all existing steps). Supports thread reply per step and split variants (A/B testing with different subject/body).',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        campaign_id: { type: 'string', description: 'Campaign numeric ID' },
        steps: {
          type: 'array',
          description: 'Email steps. Each step can have variants for A/B split testing.',
          items: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: 'Email subject line' },
              body: { type: 'string', description: 'Email body' },
              delay_days: { type: 'number', description: 'Days to wait before sending (min 1). Step 1 is always 1.' },
              thread_reply: { type: 'boolean', description: 'Send as reply in same thread as previous email. Default: true for follow-ups, false for step 1.' },
              variants: {
                type: 'array',
                description: 'Optional A/B split variants for this step. Each variant has its own subject and body.',
                items: {
                  type: 'object',
                  properties: {
                    subject: { type: 'string', description: 'Variant subject line' },
                    body: { type: 'string', description: 'Variant email body' },
                  },
                  required: ['subject', 'body'],
                },
              },
            },
            required: ['subject', 'body'],
          },
        },
      },
      required: ['client_id', 'campaign_id', 'steps'],
    },
  },
  {
    name: 'assign_senders',
    description: 'Manually assign specific sender email IDs to a campaign. Use auto_assign_senders instead if you want the Founderled tier logic applied automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        campaign_id: { type: 'string', description: 'Campaign numeric ID' },
        sender_ids: { type: 'array', items: { type: 'number' }, description: 'Array of sender email numeric IDs' },
      },
      required: ['client_id', 'campaign_id', 'sender_ids'],
    },
  },
  {
    name: 'auto_assign_senders',
    description: `Automatically select and assign the best qualified sender emails to a campaign using Founderled tier logic.

HARD DISQUALIFIERS (never assign):
- bounce_protection = true
- status != Connected

TIER 1 (preferred — idle senders with active_campaigns = 0):
- Seasoned (emails_sent > 0): warmup_score > 90
- New (emails_sent = 0): warmup_score > 95 AND warmup_sent > 130 AND account age >= 14 days

TIER 2 (fallback — active senders with active_campaigns > 0, no sends scheduled today):
- Same warmup score rules as Tier 1

Provider filtering: pass provider='google' to only use Google senders, 'outlook' for Outlook only, or omit for all.
Count: pass count to limit how many senders to assign. Default assigns all qualified Tier 1, then fills with Tier 2 if needed.`,
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        campaign_id: { type: 'string', description: 'Campaign numeric ID to assign senders to' },
        provider: { type: 'string', description: 'Filter by provider: google, outlook, or omit for all' },
        count: { type: 'number', description: 'Max number of senders to assign. Omit for all qualified.' },
        allow_tier2: { type: 'boolean', description: 'Whether to use Tier 2 senders if not enough Tier 1. Default: true' },
        dry_run: { type: 'boolean', description: 'If true, returns who would be assigned without actually assigning. Useful for previewing.' },
      },
      required: ['client_id', 'campaign_id'],
    },
  },
  {
    name: 'apply_settings',
    description: 'Apply schedule (Mon-Fri 8AM-5PM ET) and plain text settings to a campaign',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        campaign_id: { type: 'string', description: 'Campaign numeric ID' },
      },
      required: ['client_id', 'campaign_id'],
    },
  },
  {
    name: 'copy_sequence_to_campaign',
    description: 'Copy the email sequence from one campaign and apply it to another campaign',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        source_campaign_id: { type: 'string', description: 'Campaign to copy sequence FROM' },
        target_campaign_id: { type: 'string', description: 'Campaign to apply sequence TO' },
      },
      required: ['client_id', 'source_campaign_id', 'target_campaign_id'],
    },
  },
  {
    name: 'search_campaigns',
    description: 'Search campaigns by name for a client',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        query: { type: 'string', description: 'Search term to find in campaign names' },
      },
      required: ['client_id'],
    },
  },
  {
    name: 'get_campaign_leads',
    description: 'Get leads from a campaign with their email status',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        campaign_id: { type: 'string', description: 'Campaign numeric ID' },
        page: { type: 'number', description: 'Page number (default 1)' },
      },
      required: ['client_id', 'campaign_id'],
    },
  },
  {
    name: 'create_campaign',
    description: 'Create a new draft campaign with schedule and plain text settings applied automatically',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        name: { type: 'string', description: 'Campaign name' },
        type: { type: 'string', description: 'Campaign type: google, outlook, seg (default: google)' },
      },
      required: ['client_id', 'name'],
    },
  },
  {
    name: 'pause_campaign',
    description: 'Pause an active campaign',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        campaign_id: { type: 'string', description: 'Campaign numeric ID' },
      },
      required: ['client_id', 'campaign_id'],
    },
  },
  {
    name: 'resume_campaign',
    description: 'Resume a paused campaign',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        campaign_id: { type: 'string', description: 'Campaign numeric ID' },
      },
      required: ['client_id', 'campaign_id'],
    },
  },
  {
    name: 'get_campaign_stats',
    description: 'Get sending statistics for a campaign (sent, opened, replied, bounced)',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        campaign_id: { type: 'string', description: 'Campaign numeric ID' },
      },
      required: ['client_id', 'campaign_id'],
    },
  },
  {
    name: 'remove_senders',
    description: 'Remove/detach sender emails from a campaign',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        campaign_id: { type: 'string', description: 'Campaign numeric ID' },
        sender_ids: { type: 'array', items: { type: 'number' }, description: 'Sender email IDs to remove' },
      },
      required: ['client_id', 'campaign_id', 'sender_ids'],
    },
  },
  {
    name: 'move_senders',
    description: 'Move sender emails from one campaign to another (removes from source, adds to target)',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        source_campaign_id: { type: 'string', description: 'Campaign to remove senders FROM' },
        target_campaign_id: { type: 'string', description: 'Campaign to assign senders TO' },
        sender_ids: { type: 'array', items: { type: 'number' }, description: 'Specific sender IDs to move. If empty, moves ALL senders from source.' },
      },
      required: ['client_id', 'source_campaign_id', 'target_campaign_id'],
    },
  },
  {
    name: 'compare_campaign_senders',
    description: 'Compare sender emails across multiple campaigns — shows overlaps and unique senders',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        campaign_ids: { type: 'array', items: { type: 'string' }, description: 'List of campaign IDs to compare' },
      },
      required: ['client_id', 'campaign_ids'],
    },
  },
  // ── Lead management tools ────────────────────────────────────────────────
  {
    name: 'get_leads',
    description: 'Get leads from a campaign with pagination',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign numeric ID' },
      page: { type:'number', description:'Page number (default 1)' },
      per_page: { type:'number', description:'Results per page (default 50, max 100)' },
    }, required:['client_id','campaign_id'] },
  },
  {
    name: 'add_leads',
    description: 'Add leads to a campaign. Supports three duplicate handling modes: skip (default — do not add leads already in the workspace), update (refresh their fields and add to campaign), replace (same as update but fully replaces all fields). Matches the Skip/Update/Replace existing behaviour from the web upload tool.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign numeric ID' },
      duplicate_mode: { type:'string', description:'How to handle leads that already exist in the workspace: skip (default) = do not add them to campaign at all; update = refresh their fields with new data and add to campaign; replace = fully replace all their fields and add to campaign' },
      leads: { type:'array', description:'Array of lead objects. Minimum: email field.', items: { type:'object', properties: { email:{type:'string'}, first_name:{type:'string'}, last_name:{type:'string'}, company_name:{type:'string'}, title:{type:'string'}, custom_variables:{type:'array'} }, required:['email'] } },
    }, required:['client_id','campaign_id','leads'] },
  },
  {
    name: 'move_leads',
    description: 'Move ALL leads (or filtered subset) from one campaign to another in a single API call. Uses POST /api/campaigns/{id}/leads/move-to-another-campaign — removes from source automatically.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      source_campaign_id: { type:'string', description:'Campaign to move leads FROM' },
      target_campaign_id: { type:'string', description:'Campaign to move leads TO' },
      limit: { type:'number', description:'Max number of leads to move (default: all)' },
      status_filter: { type:'string', description:'Only move leads matching this lead_campaign_data.status (e.g. in_sequence, sequence_finished, replied, never_contacted). Default: all.' },
      include_bounced: { type:'boolean', description:'Include bounced and unsubscribed leads in the move (default: false)' },
    }, required:['client_id','source_campaign_id','target_campaign_id'] },
  },

  {
    name: 'remove_leads',
    description: 'Remove leads from a campaign by their lead IDs',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign numeric ID' },
      lead_ids: { type:'array', items:{type:'number'}, description:'Array of lead numeric IDs to remove' },
    }, required:['client_id','campaign_id','lead_ids'] },
  },
  {
    name: 'import_leads_to_campaign',
    description: 'Import all leads from one campaign directly into another using the native EmailBison import API — no manual selection needed',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      target_campaign_id: { type:'string', description:'Campaign to import leads INTO' },
      source_campaign_id: { type:'string', description:'Campaign to copy leads FROM' },
    }, required:['client_id','target_campaign_id','source_campaign_id'] },
  },

  // ── Replies ──────────────────────────────────────────────────────────────
  {
    name: 'get_replies',
    description: 'Get all replies/inbox for a client. Filter by campaign, folder (inbox/sent/spam/bounced/all), status (interested/automated_reply/not_automated_reply), read status.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'number', description:'Optional: filter by campaign ID' },
      folder: { type:'string', description:'inbox, sent, spam, bounced, all (default: inbox)' },
      status: { type:'string', description:'interested, automated_reply, not_automated_reply' },
      read: { type:'boolean', description:'Filter by read/unread status' },
      search: { type:'string', description:'Search term' },
      page: { type:'number', description:'Page number' },
    }, required:['client_id'] },
  },
  {
    name: 'get_campaign_replies',
    description: 'Get all replies for a specific campaign',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign numeric ID' },
      folder: { type:'string', description:'inbox, sent, spam, bounced, all' },
      status: { type:'string', description:'interested, automated_reply, not_automated_reply' },
      page: { type:'number' },
    }, required:['client_id','campaign_id'] },
  },
  {
    name: 'mark_reply_interested',
    description: 'Mark a reply as interested (positive reply)',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      reply_id: { type:'number', description:'Reply ID' },
    }, required:['client_id','reply_id'] },
  },
  {
    name: 'mark_reply_not_interested',
    description: 'Mark a reply as not interested',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      reply_id: { type:'number', description:'Reply ID' },
    }, required:['client_id','reply_id'] },
  },
  {
    name: 'mark_reply_read',
    description: 'Mark a reply as read or unread',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      reply_id: { type:'number', description:'Reply ID' },
      read: { type:'boolean', description:'true = mark as read, false = mark as unread' },
    }, required:['client_id','reply_id','read'] },
  },

  // ── Leads (global, not campaign-scoped) ─────────────────────────────────
  {
    name: 'get_all_leads',
    description: 'Get all leads in the workspace (not campaign-scoped). Filter by search, tag_ids (e.g. Google/Outlook tag IDs), or status.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      search: { type:'string', description:'Search by name or email' },
      tag_ids: { type:'array', items:{type:'number'}, description:'Filter leads by tag IDs (e.g. pass Google tag ID to get all Google leads)' },
      page: { type:'number', description:'Page number' },
    }, required:['client_id'] },
  },
  {
    name: 'get_lead',
    description: 'Get a single lead by their ID or email address',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      lead_id: { type:'string', description:'Lead numeric ID or email address' },
    }, required:['client_id','lead_id'] },
  },
  {
    name: 'create_lead',
    description: 'Create a single new lead/contact in the workspace',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      first_name: { type:'string' },
      last_name: { type:'string' },
      email: { type:'string' },
      title: { type:'string' },
      company: { type:'string' },
      notes: { type:'string' },
      custom_variables: { type:'array', description:'Array of {name, value} objects', items: { type:'object' } },
    }, required:['client_id','first_name','email'] },
  },
  {
    name: 'update_lead',
    description: 'Update a lead record. Use patch_mode:true to only update fields passed (others unchanged). Default replaces all fields.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      lead_id: { type:'string', description:'Lead ID or email' },
      patch_mode: { type:'boolean', description:'true = only update passed fields; false = replace all (default false)' },
      first_name: { type:'string' },
      last_name: { type:'string' },
      email: { type:'string' },
      title: { type:'string' },
      company: { type:'string' },
      notes: { type:'string' },
      custom_variables: { type:'array', items: { type:'object' } },
    }, required:['client_id','lead_id'] },
  },
  {
    name: 'bulk_update_leads',
    description: 'Update multiple leads at once — useful for updating company name, title, or any field on leads already in a campaign without re-adding them. Pass an array of leads each with an email (used as identifier) plus any fields to update. Uses PATCH so only fields you pass are changed, everything else stays the same.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      leads: {
        type:'array',
        description:'Array of leads to update. Each must have email as identifier, plus any fields to update (company, first_name, last_name, title, notes, custom_variables)',
        items: { type:'object', properties: {
          email: { type:'string', description:'Email address — used to identify the lead' },
          company: { type:'string', description:'Company name to update' },
          first_name: { type:'string' },
          last_name: { type:'string' },
          title: { type:'string' },
          notes: { type:'string' },
          custom_variables: { type:'array', items:{type:'object'} },
        }, required:['email'] },
      },
    }, required:['client_id','leads'] },
  },
  {
    name: 'update_lead_status',
    description: 'Update a lead status: verified, unverified, unknown, unsubscribed, risky, inactive',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      lead_id: { type:'string', description:'Lead ID or email' },
      status: { type:'string', description:'verified, unverified, unknown, unsubscribed, risky, inactive' },
    }, required:['client_id','lead_id','status'] },
  },
  {
    name: 'unsubscribe_lead',
    description: 'Unsubscribe a lead from all future emails',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      lead_id: { type:'string', description:'Lead ID or email' },
    }, required:['client_id','lead_id'] },
  },
  {
    name: 'stop_future_emails',
    description: 'Stop future emails for specific leads in a campaign (softer than removing them)',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign numeric ID' },
      lead_ids: { type:'array', items:{type:'number'}, description:'Array of lead IDs' },
    }, required:['client_id','campaign_id','lead_ids'] },
  },
  {
    name: 'bulk_create_leads',
    description: 'Create up to 500 leads at once',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      leads: { type:'array', description:'Array of lead objects (max 500)', items: { type:'object', properties: { first_name:{type:'string'}, last_name:{type:'string'}, email:{type:'string'}, title:{type:'string'}, company:{type:'string'} }, required:['first_name','email'] } },
    }, required:['client_id','leads'] },
  },
  {
    name: 'bulk_update_lead_status',
    description: 'Update the status of multiple leads at once',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      lead_ids: { type:'array', items:{type:'number'}, description:'Array of lead IDs' },
      status: { type:'string', description:'verified, unverified, unknown, unsubscribed, risky, inactive' },
    }, required:['client_id','lead_ids','status'] },
  },

  // ── Custom Tags ──────────────────────────────────────────────────────────
  {
    name: 'get_tags',
    description: 'Get all custom tags in the workspace',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
    }, required:['client_id'] },
  },
  {
    name: 'create_tag',
    description: 'Create a new custom tag',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      name: { type:'string', description:'Tag name' },
    }, required:['client_id','name'] },
  },
  {
    name: 'attach_tags_to_campaigns',
    description: 'Attach tags to one or more campaigns',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      tag_ids: { type:'array', items:{type:'number'}, description:'Tag IDs to attach' },
      campaign_ids: { type:'array', items:{type:'number'}, description:'Campaign IDs' },
    }, required:['client_id','tag_ids','campaign_ids'] },
  },
  {
    name: 'attach_tags_to_leads',
    description: 'Attach tags to one or more leads',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      tag_ids: { type:'array', items:{type:'number'}, description:'Tag IDs to attach' },
      lead_ids: { type:'array', items:{type:'number'}, description:'Lead IDs' },
    }, required:['client_id','tag_ids','lead_ids'] },
  },

  // ── Warmup ───────────────────────────────────────────────────────────────
  {
    name: 'get_warmup_stats',
    description: 'Get warmup statistics for all sender emails in a client workspace',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      start_date: { type:'string', description:'YYYY-MM-DD (defaults to 10 days ago)' },
      end_date: { type:'string', description:'YYYY-MM-DD (defaults to today)' },
      search: { type:'string', description:'Filter by email/domain' },
      page: { type:'number' },
    }, required:['client_id'] },
  },
  {
    name: 'enable_warmup',
    description: 'Enable warmup for selected sender email accounts',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      sender_email_ids: { type:'array', items:{type:'number'}, description:'Array of sender email IDs' },
    }, required:['client_id','sender_email_ids'] },
  },
  {
    name: 'disable_warmup',
    description: 'Disable warmup for selected sender email accounts',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      sender_email_ids: { type:'array', items:{type:'number'}, description:'Array of sender email IDs' },
    }, required:['client_id','sender_email_ids'] },
  },
  {
    name: 'update_warmup_limits',
    description: 'Update daily warmup sending limits for selected sender emails',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      sender_email_ids: { type:'array', items:{type:'number'}, description:'Array of sender email IDs' },
      daily_limit: { type:'number', description:'Daily warmup email limit' },
    }, required:['client_id','sender_email_ids','daily_limit'] },
  },

  // ── Email Blacklist / Domain Blacklist ───────────────────────────────────
  {
    name: 'get_blacklisted_emails',
    description: 'Get all blacklisted emails in the workspace',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
    }, required:['client_id'] },
  },
  {
    name: 'blacklist_email',
    description: 'Add an email address to the global blacklist',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      email: { type:'string', description:'Email address to blacklist' },
    }, required:['client_id','email'] },
  },
  {
    name: 'get_blacklisted_domains',
    description: 'Get all blacklisted domains in the workspace',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
    }, required:['client_id'] },
  },
  {
    name: 'blacklist_domain',
    description: 'Add a domain to the global blacklist',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      domain: { type:'string', description:'Domain to blacklist e.g. competitor.com' },
    }, required:['client_id','domain'] },
  },

  // ── Campaign Stats ───────────────────────────────────────────────────────
  {
    name: 'get_campaign_stats_by_date',
    description: 'Get detailed campaign stats (sent, opens, replies, bounces etc.) broken down by date range',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign numeric ID' },
      start_date: { type:'string', description:'YYYY-MM-DD' },
      end_date: { type:'string', description:'YYYY-MM-DD' },
    }, required:['client_id','campaign_id','start_date','end_date'] },
  },
  {
    name: 'get_events_breakdown',
    description: 'Get breakdown of email events (sent, opens, replies, bounces) by date across campaigns. Can filter by campaign IDs and/or sender IDs.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      start_date: { type:'string', description:'YYYY-MM-DD' },
      end_date: { type:'string', description:'YYYY-MM-DD' },
      campaign_ids: { type:'array', items:{type:'number'}, description:'Optional: filter to specific campaigns' },
      sender_email_ids: { type:'array', items:{type:'number'}, description:'Optional: filter to specific senders' },
    }, required:['client_id','start_date','end_date'] },
  },

  // ── Webhooks ─────────────────────────────────────────────────────────────
  {
    name: 'get_webhooks',
    description: 'List all webhooks configured for the workspace',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
    }, required:['client_id'] },
  },
  {
    name: 'create_webhook',
    description: 'Create a new webhook for email events. Events: email_sent, lead_replied, lead_interested, email_opened, email_bounced, lead_unsubscribed, etc.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      name: { type:'string', description:'Webhook name' },
      url: { type:'string', description:'URL to POST events to' },
      events: { type:'array', items:{type:'string'}, description:'Event types to subscribe to' },
    }, required:['client_id','name','url','events'] },
  },
  {
    name: 'delete_webhook',
    description: 'Delete a webhook by ID',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      webhook_id: { type:'number', description:'Webhook ID' },
    }, required:['client_id','webhook_id'] },
  },

  // ── Reply Templates ──────────────────────────────────────────────────────
  {
    name: 'get_reply_templates',
    description: 'Get all reply templates in the workspace',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      search: { type:'string', description:'Optional search term' },
    }, required:['client_id'] },
  },
  {
    name: 'create_reply_template',
    description: 'Create a new reply template for responding to leads',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      name: { type:'string', description:'Template name' },
      body: { type:'string', description:'Template message body (HTML or plain text)' },
    }, required:['client_id','name','body'] },
  },

  // ── Scheduled Emails ─────────────────────────────────────────────────────
  {
    name: 'get_scheduled_emails',
    description: 'Get scheduled emails across all campaigns. Filter by status, campaign, lead, or date.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      status: { type:'string', description:'sent, scheduled, failed, paused, stopped, bounced, unsubscribed' },
      campaign_ids: { type:'string', description:'Campaign IDs to filter by (comma-separated)' },
      page: { type:'number' },
    }, required:['client_id'] },
  },

  // ── Custom Variables ─────────────────────────────────────────────────────
  {
    name: 'get_custom_variables',
    description: 'Get all custom lead variables defined in the workspace',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
    }, required:['client_id'] },
  },
  {
    name: 'create_custom_variable',
    description: 'Create a new custom lead variable for the workspace',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      name: { type:'string', description:'Variable name (e.g. linkedin_url, phone_number)' },
    }, required:['client_id','name'] },
  },

  // ── Ignore Phrases ────────────────────────────────────────────────────────
  {
    name: 'get_ignore_phrases',
    description: 'Get all ignore phrases (used to filter warmup emails from inbox)',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
    }, required:['client_id'] },
  },
  {
    name: 'create_ignore_phrase',
    description: 'Create a new ignore phrase to filter warmup emails',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      phrase: { type:'string', description:'The phrase to ignore (e.g. warmup381)' },
    }, required:['client_id','phrase'] },
  },

  // ── Sender Email Management ──────────────────────────────────────────────
  {
    name: 'update_sender_email',
    description: 'Update settings for a sender email (daily limit, name, signature)',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      sender_email_id: { type:'number', description:'Sender email ID' },
      daily_limit: { type:'number', description:'New daily sending limit' },
      name: { type:'string', description:'Display name' },
      email_signature: { type:'string', description:'HTML email signature' },
    }, required:['client_id','sender_email_id'] },
  },
  {
    name: 'bulk_update_sender_limits',
    description: 'Update the daily sending limit for multiple sender emails at once',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      sender_email_ids: { type:'array', items:{type:'number'}, description:'Array of sender email IDs' },
      daily_limit: { type:'number', description:'New daily limit to set for all' },
    }, required:['client_id','sender_email_ids','daily_limit'] },
  },
  {
    name: 'bulk_update_sender_signatures',
    description: 'Update the email signature for multiple sender emails at once',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      sender_email_ids: { type:'array', items:{type:'number'}, description:'Array of sender email IDs' },
      email_signature: { type:'string', description:'HTML signature to apply to all' },
    }, required:['client_id','sender_email_ids','email_signature'] },
  },

  // ── Campaign Actions ─────────────────────────────────────────────────────
  {
    name: 'duplicate_campaign',
    description: 'Duplicate an existing campaign (creates a copy as a draft)',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign ID to duplicate' },
    }, required:['client_id','campaign_id'] },
  },
  {
    name: 'archive_campaign',
    description: 'Archive a campaign',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign ID' },
    }, required:['client_id','campaign_id'] },
  },
  {
    name: 'delete_campaign',
    description: 'Permanently delete a campaign (irreversible)',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign ID' },
    }, required:['client_id','campaign_id'] },
  },
  {
    name: 'update_campaign_settings',
    description: 'Update campaign settings like name, max_emails_per_day, plain_text, open_tracking etc.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign ID' },
      name: { type:'string' },
      max_emails_per_day: { type:'number' },
      max_new_leads_per_day: { type:'number' },
      plain_text: { type:'boolean' },
      open_tracking: { type:'boolean' },
      can_unsubscribe: { type:'boolean' },
    }, required:['client_id','campaign_id'] },
  },

  // ── Replies (compose/reply/forward/delete/thread) ────────────────────────
  {
    name: 'compose_email',
    description: 'Compose and send a brand new one-off email from a sender email account',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      sender_email_id: { type:'number', description:'Sender email ID to send from' },
      to_emails: { type:'array', description:'Recipients [{name, email_address}]', items:{type:'object'} },
      subject: { type:'string', description:'Email subject' },
      message: { type:'string', description:'Email body (HTML or plain text)' },
      content_type: { type:'string', description:'html or text (default: text)' },
      cc_emails: { type:'array', items:{type:'object'}, description:'CC recipients [{name, email_address}]' },
      bcc_emails: { type:'array', items:{type:'object'}, description:'BCC recipients [{name, email_address}]' },
    }, required:['client_id','sender_email_id','to_emails','message'] },
  },
  {
    name: 'reply_to_email',
    description: 'Reply to an existing email/conversation by reply ID',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      reply_id: { type:'number', description:'ID of the reply/email to respond to' },
      message: { type:'string', description:'Reply message body' },
      sender_email_id: { type:'number', description:'Sender email ID (not needed if reply_all is true)' },
      reply_all: { type:'boolean', description:'Auto-select sender and recipients from original email' },
      content_type: { type:'string', description:'html or text' },
      cc_emails: { type:'array', items:{type:'object'} },
      inject_previous_email_body: { type:'boolean', description:'Include previous email body in reply' },
    }, required:['client_id','reply_id','message'] },
  },
  {
    name: 'forward_email',
    description: 'Forward an existing email to new recipients',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      reply_id: { type:'number', description:'ID of the reply/email to forward' },
      to_emails: { type:'array', description:'Forward recipients [{name, email_address}]', items:{type:'object'} },
      sender_email_id: { type:'number', description:'Sender email ID to forward from' },
      message: { type:'string', description:'Optional message to prepend' },
    }, required:['client_id','reply_id','sender_email_id'] },
  },
  {
    name: 'delete_reply',
    description: 'Delete a reply/email by ID',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      reply_id: { type:'number', description:'Reply ID to delete' },
    }, required:['client_id','reply_id'] },
  },
  {
    name: 'get_conversation_thread',
    description: 'Get the full conversation thread for a reply (older + newer messages)',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      reply_id: { type:'number', description:'Reply ID' },
    }, required:['client_id','reply_id'] },
  },
  {
    name: 'push_to_followup_campaign',
    description: 'Push a reply (and its lead) into a reply-followup campaign to continue the conversation in an automated sequence',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      reply_id: { type:'number', description:'Reply ID' },
      campaign_id: { type:'number', description:'ID of the followup campaign to push into' },
      force_add_reply: { type:'boolean', description:'Ignore unsubscribed/bounced status and add anyway' },
    }, required:['client_id','reply_id','campaign_id'] },
  },
  {
    name: 'unsubscribe_reply_contact',
    description: 'Unsubscribe the contact associated with a specific reply from all future emails',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      reply_id: { type:'number', description:'Reply ID' },
    }, required:['client_id','reply_id'] },
  },

  // ── Lead extras ──────────────────────────────────────────────────────────
  {
    name: 'delete_lead',
    description: 'Permanently delete a lead and all associated data (irreversible — consider unsubscribing instead)',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      lead_id: { type:'string', description:'Lead ID or email address' },
    }, required:['client_id','lead_id'] },
  },
  {
    name: 'bulk_delete_leads',
    description: 'Permanently delete multiple leads by ID (irreversible)',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      lead_ids: { type:'array', items:{type:'number'}, description:'Array of lead IDs to delete' },
    }, required:['client_id','lead_ids'] },
  },
  {
    name: 'add_lead_to_blacklist',
    description: 'Add a lead to the global email blacklist',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      lead_id: { type:'string', description:'Lead ID or email address' },
    }, required:['client_id','lead_id'] },
  },
  {
    name: 'get_lead_scheduled_emails',
    description: 'Get all scheduled campaign emails for a specific lead',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      lead_id: { type:'string', description:'Lead ID or email address' },
      page: { type:'number' },
    }, required:['client_id','lead_id'] },
  },
  {
    name: 'get_lead_sent_emails',
    description: 'Get all sent campaign emails for a specific lead',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      lead_id: { type:'string', description:'Lead ID or email address' },
    }, required:['client_id','lead_id'] },
  },
  {
    name: 'get_lead_replies',
    description: 'Get all replies/conversations for a specific lead',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      lead_id: { type:'string', description:'Lead ID or email address' },
      page: { type:'number' },
    }, required:['client_id','lead_id'] },
  },
  {
    name: 'upsert_lead',
    description: 'Update a lead if it exists, create it if not. Use patch_mode to only update passed fields.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      email: { type:'string', description:'Lead email (used as identifier)' },
      first_name: { type:'string' },
      last_name: { type:'string' },
      title: { type:'string' },
      company: { type:'string' },
      notes: { type:'string' },
      custom_variables: { type:'array', items:{type:'object'} },
      patch_mode: { type:'boolean', description:'true = only update passed fields; false = replace all' },
    }, required:['client_id','email','first_name'] },
  },

  // ── Campaign scheduled emails ─────────────────────────────────────────────
  {
    name: 'get_campaign_scheduled_emails',
    description: 'Get all scheduled emails for a specific campaign, with lead and sender details',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign ID' },
      status: { type:'string', description:'scheduled, sent, failed, paused, stopped, bounced, unsubscribed' },
      page: { type:'number' },
    }, required:['client_id','campaign_id'] },
  },

  // ── Sender email extras ───────────────────────────────────────────────────
  {
    name: 'get_sender_campaigns',
    description: 'Get all campaigns a specific sender email account is assigned to',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      sender_email_id: { type:'number', description:'Sender email ID or email address' },
    }, required:['client_id','sender_email_id'] },
  },
  {
    name: 'get_sender_replies',
    description: 'Get all replies received by a specific sender email account',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      sender_email_id: { type:'number', description:'Sender email ID or email address' },
      folder: { type:'string', description:'inbox, sent, spam, bounced, all' },
      page: { type:'number' },
    }, required:['client_id','sender_email_id'] },
  },
  {
    name: 'get_warmup_detail',
    description: 'Get warmup details for a single sender email account for a date range',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      sender_email_id: { type:'number', description:'Sender email ID' },
      start_date: { type:'string', description:'YYYY-MM-DD' },
      end_date: { type:'string', description:'YYYY-MM-DD' },
    }, required:['client_id','sender_email_id','start_date','end_date'] },
  },

  // ── Webhooks extras ───────────────────────────────────────────────────────
  {
    name: 'get_webhook',
    description: 'Get details of a single webhook by ID',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      webhook_id: { type:'number', description:'Webhook ID' },
    }, required:['client_id','webhook_id'] },
  },
  {
    name: 'update_webhook',
    description: 'Update a webhook (name, URL, or event subscriptions)',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      webhook_id: { type:'number', description:'Webhook ID' },
      name: { type:'string' },
      url: { type:'string' },
      events: { type:'array', items:{type:'string'}, description:'Full list of events to subscribe to (replaces existing)' },
    }, required:['client_id','webhook_id','name','url','events'] },
  },
  {
    name: 'get_webhook_event_types',
    description: 'Get all valid webhook event types supported by EmailBison',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
    }, required:['client_id'] },
  },

  // ── Reply templates extras ────────────────────────────────────────────────
  {
    name: 'get_reply_template',
    description: 'Get details of a single reply template by ID',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      template_id: { type:'number', description:'Reply template ID' },
    }, required:['client_id','template_id'] },
  },
  {
    name: 'update_reply_template',
    description: 'Update an existing reply template (replaces content entirely)',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      template_id: { type:'number', description:'Reply template ID' },
      name: { type:'string', description:'Template name' },
      body: { type:'string', description:'Template message body' },
    }, required:['client_id','template_id','name','body'] },
  },
  {
    name: 'delete_reply_template',
    description: 'Delete a reply template permanently',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      template_id: { type:'number', description:'Reply template ID' },
    }, required:['client_id','template_id'] },
  },

  // ── Tags extras ───────────────────────────────────────────────────────────
  {
    name: 'remove_tags_from_campaigns',
    description: 'Remove/detach tags from campaigns',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      tag_ids: { type:'array', items:{type:'number'} },
      campaign_ids: { type:'array', items:{type:'number'} },
    }, required:['client_id','tag_ids','campaign_ids'] },
  },
  {
    name: 'remove_tags_from_leads',
    description: 'Remove/detach tags from leads',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      tag_ids: { type:'array', items:{type:'number'} },
      lead_ids: { type:'array', items:{type:'number'} },
    }, required:['client_id','tag_ids','lead_ids'] },
  },
  {
    name: 'attach_tags_to_senders',
    description: 'Attach tags to sender email accounts',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      tag_ids: { type:'array', items:{type:'number'} },
      sender_email_ids: { type:'array', items:{type:'number'} },
    }, required:['client_id','tag_ids','sender_email_ids'] },
  },
  {
    name: 'remove_tags_from_senders',
    description: 'Remove tags from sender email accounts',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      tag_ids: { type:'array', items:{type:'number'} },
      sender_email_ids: { type:'array', items:{type:'number'} },
    }, required:['client_id','tag_ids','sender_email_ids'] },
  },
  {
    name: 'delete_tag',
    description: 'Delete a tag from the workspace',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      tag_id: { type:'number', description:'Tag ID' },
    }, required:['client_id','tag_id'] },
  },

  // ── Blacklist extras ──────────────────────────────────────────────────────
  {
    name: 'remove_blacklisted_email',
    description: 'Remove an email address from the blacklist',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      email: { type:'string', description:'Email address or blacklist record ID' },
    }, required:['client_id','email'] },
  },
  {
    name: 'remove_blacklisted_domain',
    description: 'Remove a domain from the blacklist',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      domain: { type:'string', description:'Domain or blacklist record ID' },
    }, required:['client_id','domain'] },
  },

  // ── Ignore phrases extras ─────────────────────────────────────────────────
  {
    name: 'delete_ignore_phrase',
    description: 'Remove an ignore phrase',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      phrase_id: { type:'string', description:'Ignore phrase ID or the phrase itself' },
    }, required:['client_id','phrase_id'] },
  },

  // ── Campaign sequence extras ──────────────────────────────────────────────
  {
    name: 'activate_sequence_step',
    description: 'Activate or deactivate a specific sequence step variant',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      sequence_step_id: { type:'number', description:'Sequence step ID' },
      active: { type:'boolean', description:'true = activate, false = deactivate' },
    }, required:['client_id','sequence_step_id','active'] },
  },
  {
    name: 'import_leads_by_ids',
    description: 'Import specific leads (by their global lead IDs) into a campaign',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign ID' },
      lead_ids: { type:'array', items:{type:'number'}, description:'Array of lead IDs to import' },
      allow_parallel_sending: { type:'boolean', description:'Force add leads already in other campaigns' },
    }, required:['client_id','campaign_id','lead_ids'] },
  },
  {
    name: 'get_campaign_sending_schedule',
    description: 'Get the sending schedule for a specific campaign (how many emails scheduled for today/tomorrow)',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign ID' },
      day: { type:'string', description:'today, tomorrow, or day_after_tomorrow (default: today)' },
    }, required:['client_id','campaign_id'] },
  },

  {
    name: 'add_sequence_step',
    description: 'Add a single new step to an existing campaign sequence without replacing the whole sequence. Use this to append a follow-up email.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign numeric ID' },
      subject: { type:'string', description:'Email subject line' },
      body: { type:'string', description:'Email body' },
      delay_days: { type:'number', description:'Days to wait before sending this step (min 1)' },
      thread_reply: { type:'boolean', description:'Send as reply in same thread. Default: true for follow-ups.' },
      order: { type:'number', description:'Position in sequence (1-based). If omitted, appends to end.' },
    }, required:['client_id','campaign_id','subject','body'] },
  },
  {
    name: 'add_sequence_variant',
    description: 'Add an A/B split variant to an existing sequence step. The variant will have a different subject and/or body than the original step.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      campaign_id: { type:'string', description:'Campaign numeric ID' },
      step_id: { type:'number', description:'ID of the existing sequence step to create a variant of' },
      subject: { type:'string', description:'Variant email subject' },
      body: { type:'string', description:'Variant email body' },
      delay_days: { type:'number', description:'Days to wait (should match parent step)' },
      thread_reply: { type:'boolean', description:'Send as thread reply (should match parent step)' },
    }, required:['client_id','campaign_id','step_id','subject','body'] },
  },

  {
    name: 'check_sender_availability',
    description: 'Check which senders from a list have sends scheduled today (busy) vs none (clean/free). Single optimised call — use this instead of checking campaign schedules one by one. Essential for Tier 2 sender assignment.',
    inputSchema: { type:'object', properties: {
      client_id: { type:'string', description:'Client ID' },
      sender_ids: { type:'array', items:{type:'number'}, description:'Array of sender email IDs to check' },
      date: { type:'string', description:'Date to check in YYYY-MM-DD format. Defaults to today.' },
    }, required:['client_id','sender_ids'] },
  },

  // ── Passthrough tools — direct access to any EmailBison API endpoint ──────
  {
    name: 'eb_get',
    description: 'Make any GET request to the EmailBison API. Use this for any operation not covered by the specific tools above. Example endpoints: /api/campaigns, /api/sender-emails, /api/campaigns/{id}/leads, /api/campaigns/{id}/statistics',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID (e.g. soona, kastle, dagster, adaptional, epsilon3, arist, sunset, upwind, wisprflow, founderled)' },
        endpoint: { type: 'string', description: 'EmailBison API endpoint path, e.g. /api/campaigns?per_page=50 or /api/campaigns/791/leads' },
      },
      required: ['client_id', 'endpoint'],
    },
  },
  {
    name: 'eb_post',
    description: 'Make any POST request to the EmailBison API. Use for creating resources or triggering actions. Example: POST /api/campaigns to create a campaign, POST /api/campaigns/{id}/pause to pause it.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        endpoint: { type: 'string', description: 'EmailBison API endpoint path, e.g. /api/campaigns/{id}/pause' },
        body: { type: 'object', description: 'Request body as JSON object' },
      },
      required: ['client_id', 'endpoint'],
    },
  },
  {
    name: 'eb_patch',
    description: 'Make any PATCH request to the EmailBison API. Use for updating existing resources. Example: PATCH /api/campaigns/{id}/update to change campaign settings.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        endpoint: { type: 'string', description: 'EmailBison API endpoint path' },
        body: { type: 'object', description: 'Fields to update as JSON object' },
      },
      required: ['client_id', 'endpoint'],
    },
  },
  {
    name: 'eb_delete',
    description: 'Make any DELETE request to the EmailBison API. Use for removing resources. Example: DELETE /api/campaigns/sequence-steps/{id} to delete a sequence step.',
    inputSchema: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client ID' },
        endpoint: { type: 'string', description: 'EmailBison API endpoint path' },
      },
      required: ['client_id', 'endpoint'],
    },
  },
];

async function handleMcpTool(name, args) {
  switch (name) {

    case 'list_clients':
      return CLIENTS.map(c => ({ id: c.id, name: c.name }));

    case 'list_campaigns': {
      // API always returns 15/page regardless of per_page param — must paginate
      const first = await eb(args.client_id, '/api/campaigns?page=1');
      let camps = Array.isArray(first) ? first : (first.data || []);
      const lastPage = first.meta?.last_page || 1;
      if (lastPage > 1) {
        const pages = Array.from({length: lastPage-1}, (_,i) => i+2);
        const results = await Promise.all(pages.map(p => eb(args.client_id, `/api/campaigns?page=${p}`).catch(()=>({data:[]}))));
        results.forEach(r => { camps = camps.concat(Array.isArray(r) ? r : (r.data||[])); });
      }
      if (args.status) camps = camps.filter(c => c.status?.toLowerCase() === args.status.toLowerCase());
      return camps.map(c => ({ id: c.id, name: c.name, status: c.status, leads: c.total_leads, created: c.created_at }));
    }

    case 'list_draft_campaigns': {
      const first = await eb(args.client_id, '/api/campaigns?page=1');
      let allCamps = Array.isArray(first) ? first : (first.data || []);
      const lastPage = first.meta?.last_page || 1;
      if (lastPage > 1) {
        const pages = Array.from({length: lastPage-1}, (_,i) => i+2);
        const results = await Promise.all(pages.map(p => eb(args.client_id, `/api/campaigns?page=${p}`).catch(()=>({data:[]}))));
        results.forEach(r => { allCamps = allCamps.concat(Array.isArray(r) ? r : (r.data||[])); });
      }
      const camps = allCamps.filter(c => c.status?.toLowerCase() === 'draft');
      return camps.map(c => {
        const todo = [];
        if (!c.total_leads) todo.push('upload leads');
        if (!c.sending_days && !c.monday) todo.push('set schedule');
        return { id: c.id, name: c.name, leads: c.total_leads || 0, todo };
      });
    }

    case 'list_senders': {
      // Use the enriched sender endpoint which merges warmup scores, warmup sent, bounce protection etc.
      const enriched = await mcpFetchEnrichedSenders(args.client_id);
      let filtered = enriched;
      if (args.provider && args.provider !== 'all') {
        filtered = filtered.filter(s => s.provider === args.provider);
      }
      if (args.min_warmup_score) {
        filtered = filtered.filter(s => (s.warmup_score || 0) >= args.min_warmup_score);
      }
      if (args.ready_only) {
        filtered = filtered.filter(s =>
          s.status?.toLowerCase() === 'connected' &&
          ((s.warmup_sent || 0) > 100 || (s.emails_sent || 0) > 0)
        );
      }
      // Filter by single domain
      if (args.domain) {
        const d = args.domain.toLowerCase().replace(/^@/, '');
        filtered = filtered.filter(s => (s.email || '').toLowerCase().endsWith('@' + d) || (s.email || '').toLowerCase().endsWith('.' + d));
      }
      // Filter by multiple domains
      if (args.domains?.length) {
        const ds = args.domains.map(d => d.toLowerCase().replace(/^@/, ''));
        filtered = filtered.filter(s => ds.some(d => (s.email || '').toLowerCase().endsWith('@' + d) || (s.email || '').toLowerCase().endsWith('.' + d)));
      }
      return filtered.map(s => ({
        id: s.id,
        email: s.email,
        name: s.name,
        provider: s.provider,
        warmup_score: s.warmup_score,
        warmup_sent: s.warmup_sent,
        emails_sent: s.emails_sent,
        bounce_protection: s.bounce_protection,
        status: s.status,
        active_campaigns: s.active_campaign_count,
      }));
    }

    case 'get_campaign_sequence': {
      const data = await eb(args.client_id, `/api/campaigns/${args.campaign_id}/sequence-steps`);
      const arr = Array.isArray(data) ? data : (data.data || []);
      return arr.sort((a,b) => (a.order - b.order) || (a.id - b.id)).map(s => ({
        id: s.id,
        order: s.order,
        subject: s.email_subject || s.subject,
        body: s.email_body || s.body,
        delay_days: s.wait_in_days || s.delay_days,
        thread_reply: s.reply_to_thread ?? s.thread_reply ?? false,
        is_variant: s.variant ?? false,
        variant_of_step_id: s.variant_from_step_id || null,
        active: s.active ?? true,
      }));
    }

    case 'get_campaign_senders': {
      const first = await eb(args.client_id, `/api/campaigns/${args.campaign_id}/sender-emails?page=1`);
      let senders = first.data || [];
      const lastPage = first.meta?.last_page || 1;
      if (lastPage > 1) {
        const pages = Array.from({length: lastPage-1}, (_,i) => i+2);
        const results = await Promise.all(pages.map(p => eb(args.client_id, `/api/campaigns/${args.campaign_id}/sender-emails?page=${p}`).catch(()=>({data:[]}))));
        results.forEach(r => { senders = senders.concat(r.data||[]); });
      }
      return senders.map(s => ({ id: s.id, email: s.email, name: s.name, status: s.status }));
    }

    case 'apply_sequence': {
      // Delete existing steps first
      try {
        const ex = await eb(args.client_id, `/api/campaigns/${args.campaign_id}/sequence-steps`);
        const exArr = ex.data || (Array.isArray(ex) ? ex : []);
        await Promise.all(exArr.map(s => eb(args.client_id, `/api/campaigns/sequence-steps/${s.id}`, 'DELETE').catch(()=>{})));
      } catch(_) {}
      // Build sequence steps — supports thread_reply per step and split variants
      const firstSubject1 = args.steps[0]?.subject || '';
      const sequence_steps = [];
      args.steps.forEach((s, i) => {
        const defaultThreadReply = i > 0; // follow-ups default to thread reply
        const threadReply = s.thread_reply !== undefined ? s.thread_reply : defaultThreadReply;
        // Main step
        sequence_steps.push({
          email_subject: s.subject?.trim() ? s.subject : (i > 0 ? firstSubject1 : 'Follow-up'),
          email_body: s.body,
          wait_in_days: Math.max(1, i === 0 ? 1 : (s.delay_days ?? i * 3)),
          order: i + 1,
          reply_to_thread: threadReply,
          variant: false,
        });
        // Split variants for this step (A/B testing)
        if (s.variants?.length) {
          s.variants.forEach(v => {
            sequence_steps.push({
              email_subject: v.subject,
              email_body: v.body,
              wait_in_days: Math.max(1, i === 0 ? 1 : (s.delay_days ?? i * 3)),
              order: i + 1,
              reply_to_thread: threadReply,
              variant: true,
              variant_from_step: i + 1, // links variant to the parent step by order number
            });
          });
        }
      });
      await eb(args.client_id, `/api/campaigns/${args.campaign_id}/sequence-steps`, 'POST', { title: 'Main Sequence', sequence_steps });
      return { ok: true, steps_created: args.steps.length, total_including_variants: sequence_steps.length };
    }

    case 'auto_assign_senders': {
      // Founderled Sender Assignment Logic — matches SKILL.md exactly

      // STEP 1: Fetch all enriched senders
      const allSenders = await mcpFetchEnrichedSenders(args.client_id);

      // STEP 2: Fetch all campaigns + build active campaign count per sender
      const campFirst = await eb(args.client_id, '/api/campaigns?page=1');
      let allCamps = campFirst.data || [];
      const campLastPage = campFirst.meta?.last_page || 1;
      if (campLastPage > 1) {
        const campPages = Array.from({length: campLastPage-1}, (_,i) => i+2);
        const campRes = await Promise.all(campPages.map(p => eb(args.client_id, '/api/campaigns?page='+p).catch(()=>({data:[]}))));
        campRes.forEach(r => { allCamps = allCamps.concat(r.data||[]); });
      }
      const activeStatuses = ['active','launching','sending','queued','running'];
      const activeCamps = allCamps.filter(camp => activeStatuses.includes((camp.status||'').toLowerCase()));

      const senderActiveCampCount = {};
      const campSenderResults = await Promise.allSettled(
        activeCamps.slice(0, 50).map(async camp => {
          const r = await eb(args.client_id, '/api/campaigns/'+camp.id+'/sender-emails?page=1');
          return (r.data || []).map(s => s.id);
        })
      );
      campSenderResults.forEach(r => {
        if (r.status === 'fulfilled') r.value.forEach(id => { senderActiveCampCount[id] = (senderActiveCampCount[id]||0)+1; });
      });

      // STEP 3: Build "busy today" sender set using optimised single-call endpoint
      const todayStr = new Date().toISOString().split('T')[0];
      const busyTodaySenderIds = new Set();
      try {
        const allSenderIds = allSenders.map(s => s.id);
        const availResp = await fetch(
          (process.env.RAILWAY_PUBLIC_DOMAIN
            ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
            : 'http://localhost:' + (process.env.PORT || 3000))
          + '/api/tools/sender-availability-check',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: args.client_id, sender_ids: allSenderIds, date: todayStr }),
          }
        );
        const availData = await availResp.json();
        if (availData.busy) availData.busy.forEach(id => busyTodaySenderIds.add(Number(id)));
      } catch (_) {
        // Fallback: check schedule the old way if self-call fails
        const schedResults = await Promise.allSettled(
          activeCamps.slice(0, 50).map(async camp => {
            const r = await eb(args.client_id, '/api/campaigns/'+camp.id+'/scheduled-emails?status=scheduled');
            return (r.data || []);
          })
        );
        schedResults.forEach(r => {
          if (r.status === 'fulfilled') {
            r.value.forEach(email => {
              const schedDate = (email.scheduled_date_local || email.scheduled_date || '').split('T')[0];
              if (schedDate === todayStr && email.sender_email && email.sender_email.id) {
                busyTodaySenderIds.add(email.sender_email.id);
              }
            });
          }
        });
      }

      // STEP 4: Apply hard disqualifiers + classify Tier 1 / Tier 2
      const today = new Date();
      const tier1 = [];
      const tier2 = [];
      const disqualified = [];
      const flaggedForReview = [];

      for (const s of allSenders) {
        // Provider filter
        if (args.provider && args.provider !== 'all') {
          const prov = (s.provider || s.type || '').toLowerCase();
          const isGoogle = prov.includes('google') || prov.includes('gmail');
          const isOutlook = prov.includes('microsoft') || prov.includes('outlook');
          if (args.provider === 'google' && !isGoogle) continue;
          if (args.provider === 'outlook' && !isOutlook) continue;
        }

        // Hard disqualifier 1: bounce_protection must be OFF
        if (s.bounce_protection) { disqualified.push({id:s.id, email:s.email, reason:'bounce_protection'}); continue; }

        // Hard disqualifier 2: must be Connected
        const status = (s.status || '').toLowerCase();
        if (!status.includes('connected')) { disqualified.push({id:s.id, email:s.email, reason:'not_connected:'+status}); continue; }

        // Null warmup_score — skill says flag for manual review, do NOT assign
        if (s.warmup_score === null || s.warmup_score === undefined) {
          flaggedForReview.push({id:s.id, email:s.email, reason:'warmup_score_null_needs_manual_review'});
          continue;
        }

        const activeCampCount = senderActiveCampCount[s.id] || 0;
        const warmupScore = s.warmup_score;
        const warmupSent = s.warmup_sent || 0;
        const emailsSent = s.emails_sent || 0;
        const isSeasoned = emailsSent > 0;

        let qualifies = false;
        let disqualReason = '';

        if (isSeasoned) {
          // Seasoned: only warmup_score > 90 required
          qualifies = warmupScore > 90;
          if (!qualifies) disqualReason = 'seasoned_warmup_'+warmupScore+'_not_above_90';
        } else {
          // New sender: ALL THREE must pass
          // created_at is NOT returned by list_senders — use enriched data or flag
          let ageInDays = null;
          if (s.created_at) {
            ageInDays = Math.floor((today - new Date(s.created_at)) / (1000*60*60*24));
          }
          if (ageInDays === null) {
            // Skill: do NOT assume old enough — flag for review
            flaggedForReview.push({id:s.id, email:s.email, reason:'new_sender_age_unknown_cannot_confirm_14_days'});
            continue;
          }
          const scoreOk = warmupScore > 95;
          const warmupOk = warmupSent > 130;
          const ageOk = ageInDays >= 14;
          qualifies = scoreOk && warmupOk && ageOk;
          if (!qualifies) {
            disqualReason = !scoreOk ? 'new_score_'+warmupScore+'_not_above_95'
              : !warmupOk ? 'new_warmup_sent_'+warmupSent+'_not_above_130'
              : 'new_age_'+ageInDays+'_days_under_14';
          }
        }

        if (!qualifies) { disqualified.push({id:s.id, email:s.email, reason:disqualReason}); continue; }

        // Tier classification
        if (activeCampCount === 0) {
          tier1.push({id:s.id, email:s.email, warmup_score:warmupScore, warmup_sent:warmupSent, emails_sent:emailsSent, active_campaigns:activeCampCount, tier:1});
        } else {
          // Tier 2: active campaigns but NOT sending today
          if (!busyTodaySenderIds.has(s.id)) {
            tier2.push({id:s.id, email:s.email, warmup_score:warmupScore, warmup_sent:warmupSent, emails_sent:emailsSent, active_campaigns:activeCampCount, tier:2});
          } else {
            disqualified.push({id:s.id, email:s.email, reason:'tier2_has_sends_scheduled_today'});
          }
        }
      }

      // STEP 5: Select — Tier 1 first sorted by score desc, then Tier 2
      const allowTier2 = args.allow_tier2 !== false;
      tier1.sort((a,b) => b.warmup_score - a.warmup_score);
      tier2.sort((a,b) => b.warmup_score - a.warmup_score);
      let selected = allowTier2 ? [...tier1, ...tier2] : [...tier1];
      if (args.count) selected = selected.slice(0, args.count);

      if (!selected.length) {
        return {
          ok: false,
          error: 'No qualified senders found',
          tier1_count: tier1.length,
          tier2_count: tier2.length,
          disqualified_count: disqualified.length,
          flagged_for_review: flaggedForReview,
          disqualified_sample: disqualified.slice(0, 10),
        };
      }

      // STEP 6: Assign or dry run
      if (args.dry_run) {
        return {
          ok: true, dry_run: true,
          would_assign: selected.length,
          tier1_selected: selected.filter(s=>s.tier===1).length,
          tier2_selected: selected.filter(s=>s.tier===2).length,
          senders: selected,
          disqualified_count: disqualified.length,
          flagged_for_review: flaggedForReview,
          busy_today_count: busyTodaySenderIds.size,
        };
      }

      await eb(args.client_id, '/api/campaigns/'+args.campaign_id+'/attach-sender-emails', 'POST', {
        sender_email_ids: selected.map(s => s.id),
      });

      return {
        ok: true,
        assigned: selected.length,
        tier1_assigned: selected.filter(s=>s.tier===1).length,
        tier2_assigned: selected.filter(s=>s.tier===2).length,
        senders: selected.map(s => ({id:s.id, email:s.email, warmup_score:s.warmup_score, tier:s.tier, active_campaigns:s.active_campaigns})),
        disqualified_count: disqualified.length,
        flagged_for_review: flaggedForReview,
        busy_today_count: busyTodaySenderIds.size,
      };
    }

            case 'assign_senders': {
      await eb(args.client_id, `/api/campaigns/${args.campaign_id}/attach-sender-emails`, 'POST', { sender_email_ids: args.sender_ids });
      return { ok: true, assigned: args.sender_ids.length };
    }

    case 'apply_settings': {
      const schedulePayload = { monday:true, tuesday:true, wednesday:true, thursday:true, friday:true, saturday:false, sunday:false, start_time:'08:00:00', end_time:'17:00:00', timezone:'America/New_York' };
      try { await eb(args.client_id, `/api/campaigns/${args.campaign_id}/schedule`, 'POST', schedulePayload); } catch(_) {
        try { await eb(args.client_id, `/api/campaigns/${args.campaign_id}/schedule`, 'PUT', schedulePayload); } catch(_) {}
      }
      try { await eb(args.client_id, `/api/campaigns/${args.campaign_id}/update`, 'PATCH', {
          plain_text: true,
          open_tracking: false,
          can_unsubscribe: false,
          include_auto_replies_in_stats: true,
          max_emails_per_day: 1000,
          max_new_leads_per_day: 1000,
          sequence_prioritization: 'followups',
        }); } catch(_) {}
      return { ok: true, schedule: 'Mon-Fri 8AM-5PM ET', plain_text: true, open_tracking: false, can_unsubscribe: false, include_auto_replies_in_stats: true, max_emails_per_day: 1000, max_new_leads_per_day: 1000, sequence_prioritization: 'followups' };
    }

    case 'copy_sequence_to_campaign': {
      // Fetch source steps preserving ALL fields: thread_reply, variant, order
      const data = await eb(args.client_id, `/api/campaigns/${args.source_campaign_id}/sequence-steps`);
      const arr = Array.isArray(data) ? data : (data.data || []);
      if (!arr.length) throw new Error('Source campaign has no sequence steps');
      // Sort: non-variants first, then variants, within same order
      const sorted = arr.sort((a,b) => (a.order - b.order) || (a.variant ? 1 : -1));
      // Delete existing steps in target
      try {
        const ex = await eb(args.client_id, `/api/campaigns/${args.target_campaign_id}/sequence-steps`);
        const exArr = ex.data || (Array.isArray(ex) ? ex : []);
        await Promise.all(exArr.map(s => eb(args.client_id, `/api/campaigns/sequence-steps/${s.id}`, 'DELETE').catch(()=>{})));
      } catch(_) {}
      // Rebuild: main steps first, variants linked by order number
      const sequence_steps = sorted.map(s => ({
        email_subject: s.email_subject || s.subject || '',
        email_body: s.email_body || s.body || '',
        wait_in_days: Math.max(1, s.wait_in_days || 1),
        order: s.order,
        reply_to_thread: s.reply_to_thread ?? s.thread_reply ?? (s.order > 1),
        variant: s.variant ?? false,
        ...(s.variant && s.variant_from_step_id ? { variant_from_step: sorted.find(p => p.id === s.variant_from_step_id && !p.variant)?.order || s.order } : {}),
      }));
      await eb(args.client_id, `/api/campaigns/${args.target_campaign_id}/sequence-steps`, 'POST', { title: 'Main Sequence', sequence_steps });
      const mainSteps = sequence_steps.filter(s => !s.variant).length;
      const variants = sequence_steps.filter(s => s.variant).length;
      return { ok: true, steps_copied: mainSteps, variants_copied: variants };
    }

    case 'search_campaigns': {
      // API supports search param natively — use it, then paginate
      const searchParam = args.query ? `&search=${encodeURIComponent(args.query)}` : '';
      const first = await eb(args.client_id, `/api/campaigns?page=1${searchParam}`);
      let camps = Array.isArray(first) ? first : (first.data || []);
      const lastPage = first.meta?.last_page || 1;
      if (lastPage > 1) {
        const pages = Array.from({length: lastPage-1}, (_,i) => i+2);
        const results = await Promise.all(pages.map(p => eb(args.client_id, `/api/campaigns?page=${p}${searchParam}`).catch(()=>({data:[]}))));
        results.forEach(r => { camps = camps.concat(Array.isArray(r) ? r : (r.data||[])); });
      }
      return camps.map(c => ({ id: c.id, name: c.name, status: c.status, leads: c.total_leads }));
    }

    case 'get_campaign_leads': {
      const page = args.page || 1;
      const data = await eb(args.client_id, `/api/campaigns/${args.campaign_id}/leads?page=${page}`);
      const leads = data.data || (Array.isArray(data) ? data : []);
      return {
        page, total: data.meta?.total || leads.length, last_page: data.meta?.last_page || 1,
        leads: leads.map(l => ({ id: l.id, email: l.email, first_name: l.first_name, last_name: l.last_name, company: l.company_name, status: l.status })),
      };
    }

    case 'create_campaign': {
      const payload = { name: args.name, type: args.type || 'google' };
      const created = await eb(args.client_id, '/api/campaigns', 'POST', payload);
      const id = created.data?.id || created.id;
      // Auto-apply schedule + plain text
      const schedulePayload = { monday:true, tuesday:true, wednesday:true, thursday:true, friday:true, saturday:false, sunday:false, start_time:'08:00:00', end_time:'17:00:00', timezone:'America/New_York' };
      try { await eb(args.client_id, `/api/campaigns/${id}/schedule`, 'POST', schedulePayload); } catch(_) {}
      try { await eb(args.client_id, `/api/campaigns/${id}/update`, 'PATCH', {
          plain_text: true,
          open_tracking: false,
          can_unsubscribe: false,
          include_auto_replies_in_stats: true,
          max_emails_per_day: 1000,
          max_new_leads_per_day: 1000,
          sequence_prioritization: 'followups',
        }); } catch(_) {}
      return { ok: true, id, name: args.name };
    }

    case 'pause_campaign': {
      await eb(args.client_id, `/api/campaigns/${args.campaign_id}/pause`, 'PATCH', {});
      return { ok: true, campaign_id: args.campaign_id, status: 'paused' };
    }

    case 'resume_campaign': {
      await eb(args.client_id, `/api/campaigns/${args.campaign_id}/resume`, 'PATCH', {});
      return { ok: true, campaign_id: args.campaign_id, status: 'resumed' };
    }

    case 'get_campaign_stats': {
      const data = await eb(args.client_id, `/api/campaigns/${args.campaign_id}`);
      const camp = data.data || data;
      return {
        id: camp.id, name: camp.name, status: camp.status,
        total_leads: camp.total_leads,
        emails_sent: camp.emails_sent,
        opened: camp.opened, unique_opens: camp.unique_opens,
        replied: camp.replied, unique_replies: camp.unique_replies,
        bounced: camp.bounced,
        unsubscribed: camp.unsubscribed,
        interested: camp.interested,
        completion_percentage: camp.completion_percentage,
      };
    }

    case 'remove_senders': {
      // Try detach endpoint
      try {
        await eb(args.client_id, `/api/campaigns/${args.campaign_id}/remove-sender-emails`, 'DELETE', { sender_email_ids: args.sender_ids });
        return { ok: true, removed: args.sender_ids.length };
      } catch(_) {}
      // Fallback: try DELETE
      await Promise.all(args.sender_ids.map(id =>
        eb(args.client_id, `/api/campaigns/${args.campaign_id}/sender-emails/${id}`, 'DELETE').catch(()=>{})
      ));
      return { ok: true, removed: args.sender_ids.length };
    }

    case 'move_senders': {
      // Get senders from source campaign
      const first = await eb(args.client_id, `/api/campaigns/${args.source_campaign_id}/sender-emails?page=1`);
      let allSnds = first.data || [];
      const lp = first.meta?.last_page || 1;
      if (lp > 1) {
        const pages = Array.from({length: lp-1}, (_,i)=>i+2);
        const results = await Promise.all(pages.map(p => eb(args.client_id, `/api/campaigns/${args.source_campaign_id}/sender-emails?page=${p}`).catch(()=>({data:[]}))));
        results.forEach(r => { allSnds = allSnds.concat(r.data||[]); });
      }
      const ids = args.sender_ids?.length ? args.sender_ids : allSnds.map(s => s.id);
      if (!ids.length) return { ok: false, error: 'No senders found in source campaign' };
      // Remove from source
      try { await eb(args.client_id, `/api/campaigns/${args.source_campaign_id}/remove-sender-emails`, 'DELETE', { sender_email_ids: ids }); } catch(_) {}
      // Add to target
      await eb(args.client_id, `/api/campaigns/${args.target_campaign_id}/attach-sender-emails`, 'POST', { sender_email_ids: ids });
      const movedEmails = allSnds.filter(s => ids.includes(s.id)).map(s => s.email);
      return { ok: true, moved: ids.length, emails: movedEmails };
    }

    case 'compare_campaign_senders': {
      const results = await Promise.all(
        args.campaign_ids.map(async cid => {
          const first = await eb(args.client_id, `/api/campaigns/${cid}/sender-emails?page=1`);
          let snds = first.data || [];
          const lp = first.meta?.last_page || 1;
          if (lp > 1) {
            const pages = Array.from({length: lp-1}, (_,i)=>i+2);
            const rs = await Promise.all(pages.map(p => eb(args.client_id, `/api/campaigns/${cid}/sender-emails?page=${p}`).catch(()=>({data:[]}))));
            rs.forEach(r => { snds = snds.concat(r.data||[]); });
          }
          return { campaign_id: cid, senders: snds.map(s => ({ id: s.id, email: s.email })) };
        })
      );
      // Find overlaps
      const emailMap = {};
      results.forEach(r => r.senders.forEach(s => {
        if (!emailMap[s.email]) emailMap[s.email] = [];
        emailMap[s.email].push(r.campaign_id);
      }));
      const shared = Object.entries(emailMap).filter(([,camps]) => camps.length > 1).map(([email, camps]) => ({ email, in_campaigns: camps }));
      const unique = results.map(r => ({
        campaign_id: r.campaign_id,
        total: r.senders.length,
        unique_only: r.senders.filter(s => emailMap[s.email].length === 1).map(s => s.email),
      }));
      return { shared_senders: shared, shared_count: shared.length, per_campaign: unique };
    }

    // ── Lead management ─────────────────────────────────────────────────────
    case 'get_leads': {
      const page = args.page || 1;
      const perPage = args.per_page || 50;
      const data = await eb(args.client_id, `/api/campaigns/${args.campaign_id}/leads?page=${page}&per_page=${perPage}`);
      const leads = data.data || (Array.isArray(data) ? data : []);
      return {
        page, per_page: perPage,
        total: data.meta?.total || leads.length,
        last_page: data.meta?.last_page || 1,
        leads: leads.map(l => ({ id:l.id, email:l.email, first_name:l.first_name, last_name:l.last_name, company:l.company_name, status:l.status })),
      };
    }

    case 'add_leads': {
      const duplicateMode = args.duplicate_mode || 'skip'; // skip | update | replace
      const mapped = args.leads.filter(l => l.email).map(l => {
        const o = { email: l.email };
        if (l.first_name) o.first_name = l.first_name;
        if (l.last_name) o.last_name = l.last_name;
        if (l.company_name) o.company = l.company_name;  // API field is 'company'
        if (l.company) o.company = l.company;  // also accept 'company' directly
        if (l.title) o.title = l.title;
        if (l.custom_variables) o.custom_variables = l.custom_variables;
        return o;
      });

      const allLeadIds = [];
      let skipped = 0;
      let updated = 0;
      let created = 0;
      const BATCH = 50;

      for (let i = 0; i < mapped.length; i += BATCH) {
        const batch = mapped.slice(i, i + BATCH);
        for (const lead of batch) {
          try {
            // Try to create — succeeds only if brand new to the workspace
            const res = await eb(args.client_id, '/api/leads', 'POST', lead);
            const leadId = res.id || res.data?.id;
            if (leadId) { allLeadIds.push(leadId); created++; }
          } catch (_) {
            // Lead already exists in this workspace
            try {
              const found = await eb(args.client_id, '/api/leads?search=' + encodeURIComponent(lead.email));
              const arr = Array.isArray(found) ? found : (found.data || []);
              const existing = arr.find(l => l.email === lead.email);
              if (existing) {
                if (duplicateMode === 'skip') {
                  skipped++;
                } else {
                  // update = PATCH (keep fields not passed), replace = PUT (clear fields not passed)
                  const method = duplicateMode === 'replace' ? 'PUT' : 'PATCH';
                  await eb(args.client_id, '/api/leads/' + existing.id, method, lead);
                  allLeadIds.push(existing.id);
                  updated++;
                }
              }
            } catch (_2) { skipped++; }
          }
        }
      }

      // Attach collected lead IDs to the campaign in batches of 100
      for (let i = 0; i < allLeadIds.length; i += 100) {
        await eb(args.client_id, '/api/campaigns/' + args.campaign_id + '/leads/attach-leads', 'POST', {
          lead_ids: allLeadIds.slice(i, i + 100),
        });
      }

      return { ok: true, total: mapped.length, added_to_campaign: allLeadIds.length, created, updated, skipped, duplicate_mode: duplicateMode };
    }

    case 'move_leads': {
      // Step 1: Fetch ALL leads from source (paginated, 15/page since per_page is ignored by API)
      const first = await eb(args.client_id, `/api/campaigns/${args.source_campaign_id}/leads?page=1`);
      let allLeads = first.data || [];
      const lastPage = first.meta?.last_page || 1;
      if (lastPage > 1) {
        const pages = Array.from({length: lastPage-1}, (_,i) => i+2);
        const results = await Promise.all(pages.map(p =>
          eb(args.client_id, `/api/campaigns/${args.source_campaign_id}/leads?page=${p}`).catch(()=>({data:[]}))
        ));
        results.forEach(r => { allLeads = allLeads.concat(r.data||[]); });
      }
      if (args.status_filter) allLeads = allLeads.filter(l => l.status?.toLowerCase() === args.status_filter.toLowerCase());
      if (args.limit) allLeads = allLeads.slice(0, args.limit);
      if (!allLeads.length) return { ok:false, error:'No leads found matching criteria in source campaign' };

      const leadIds = allLeads.map(l => l.id);

      // Step 2: Correct endpoint from API spec:
      // POST /api/campaigns/{id}/leads/move-to-another-campaign
      const moveResult = await eb(args.client_id,
        `/api/campaigns/${args.source_campaign_id}/leads/move-to-another-campaign`,
        'POST',
        {
          target_campaign_id: parseInt(args.target_campaign_id),
          lead_ids: leadIds,
          include_bounced_and_unsubscribed: args.include_bounced || false,
        }
      );
      return { ok:true, moved: leadIds.length, result: moveResult };
    }

    case 'remove_leads': {
      const result = await eb(args.client_id,
        `/api/campaigns/${args.campaign_id}/leads`,
        'DELETE',
        { lead_ids: args.lead_ids }
      );
      return { ok:true, removed: args.lead_ids.length, result };
    }

    case 'import_leads_to_campaign': {
      // Use EmailBison's "Import leads from existing list" endpoint
      const result = await eb(args.client_id,
        `/api/campaigns/${args.target_campaign_id}/leads/attach-lead-list`,
        'POST',
        { lead_list_id: parseInt(args.source_campaign_id) }
      );
      return { ok:true, result };
    }

    // ── Replies ────────────────────────────────────────────────────────────
    case 'get_replies': {
      const params = new URLSearchParams();
      if (args.folder) params.set('folder', args.folder);
      if (args.status) params.set('status', args.status);
      if (args.search) params.set('search', args.search);
      if (args.read !== undefined) params.set('read', args.read);
      if (args.campaign_id) params.set('campaign_id', args.campaign_id);
      if (args.page) params.set('page', args.page);
      return await eb(args.client_id, `/api/replies?${params.toString()}`);
    }
    case 'get_campaign_replies': {
      const params = new URLSearchParams();
      if (args.folder) params.set('folder', args.folder);
      if (args.status) params.set('status', args.status);
      if (args.page) params.set('page', args.page);
      return await eb(args.client_id, `/api/campaigns/${args.campaign_id}/replies?${params.toString()}`);
    }
    case 'mark_reply_interested': {
      return await eb(args.client_id, `/api/replies/${args.reply_id}/mark-as-interested`, 'PATCH', {});
    }
    case 'mark_reply_not_interested': {
      return await eb(args.client_id, `/api/replies/${args.reply_id}/mark-as-not-interested`, 'PATCH', {});
    }
    case 'mark_reply_read': {
      return await eb(args.client_id, `/api/replies/${args.reply_id}/mark-as-read-or-unread`, 'PATCH', { read: args.read });
    }

    // ── Leads (global) ─────────────────────────────────────────────────────
    case 'get_all_leads': {
      const params = new URLSearchParams();
      if (args.search) params.set('search', args.search);
      if (args.page) params.set('page', args.page);
      // tag_ids filter — API accepts repeated params: filters[tag_ids][]=1&filters[tag_ids][]=2
      if (args.tag_ids && args.tag_ids.length) {
        args.tag_ids.forEach(id => params.append('filters[tag_ids][]', id));
      }
      return await eb(args.client_id, '/api/leads?' + params.toString());
    }
    case 'get_lead': {
      return await eb(args.client_id, `/api/leads/${args.lead_id}`);
    }
    case 'create_lead': {
      const body = { first_name: args.first_name, email: args.email };
      if (args.last_name) body.last_name = args.last_name;
      if (args.title) body.title = args.title;
      if (args.company) body.company = args.company;
      if (args.notes) body.notes = args.notes;
      if (args.custom_variables) body.custom_variables = args.custom_variables;
      return await eb(args.client_id, '/api/leads', 'POST', body);
    }
    case 'bulk_update_leads': {
      // Update many leads at once using email as identifier — PATCH only, never touches campaign membership
      const results = { updated: 0, not_found: 0, errors: 0, details: [] };
      const CONCURRENCY = 5; // run 5 at a time to avoid rate limiting

      for (let i = 0; i < args.leads.length; i += CONCURRENCY) {
        const batch = args.leads.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(async lead => {
          try {
            // Build PATCH body — only include fields that were passed
            const body = {};
            if (lead.first_name !== undefined) body.first_name = lead.first_name;
            if (lead.last_name !== undefined) body.last_name = lead.last_name;
            if (lead.company !== undefined) body.company = lead.company;
            if (lead.title !== undefined) body.title = lead.title;
            if (lead.notes !== undefined) body.notes = lead.notes;
            if (lead.custom_variables !== undefined) body.custom_variables = lead.custom_variables;

            // Use email directly as the lead identifier — API accepts email or ID
            await eb(args.client_id, '/api/leads/' + encodeURIComponent(lead.email), 'PATCH', body);
            results.updated++;
            results.details.push({ email: lead.email, status: 'updated' });
          } catch (err) {
            const msg = err.message || '';
            if (msg.includes('404') || msg.includes('not found')) {
              results.not_found++;
              results.details.push({ email: lead.email, status: 'not_found' });
            } else {
              results.errors++;
              results.details.push({ email: lead.email, status: 'error', error: msg.slice(0, 100) });
            }
          }
        }));
      }

      return {
        ok: true,
        total: args.leads.length,
        updated: results.updated,
        not_found: results.not_found,
        errors: results.errors,
        details: results.details,
      };
    }

    case 'update_lead': {
      const method = args.patch_mode ? 'PATCH' : 'PUT';
      const body = {};
      if (args.first_name !== undefined) body.first_name = args.first_name;
      if (args.last_name !== undefined) body.last_name = args.last_name;
      if (args.email !== undefined) body.email = args.email;
      if (args.title !== undefined) body.title = args.title;
      if (args.company !== undefined) body.company = args.company;
      if (args.notes !== undefined) body.notes = args.notes;
      if (args.custom_variables !== undefined) body.custom_variables = args.custom_variables;
      return await eb(args.client_id, `/api/leads/${args.lead_id}`, method, body);
    }
    case 'update_lead_status': {
      return await eb(args.client_id, `/api/leads/${args.lead_id}/update-status`, 'PATCH', { status: args.status });
    }
    case 'unsubscribe_lead': {
      return await eb(args.client_id, `/api/leads/${args.lead_id}/unsubscribe`, 'PATCH', {});
    }
    case 'stop_future_emails': {
      return await eb(args.client_id, `/api/campaigns/${args.campaign_id}/leads/stop-future-emails`, 'POST', { lead_ids: args.lead_ids });
    }
    case 'bulk_create_leads': {
      return await eb(args.client_id, '/api/leads/multiple', 'POST', { leads: args.leads });
    }
    case 'bulk_update_lead_status': {
      return await eb(args.client_id, '/api/leads/bulk-update-status', 'PATCH', { lead_ids: args.lead_ids, status: args.status });
    }

    // ── Custom Tags ────────────────────────────────────────────────────────
    case 'get_tags': {
      return await eb(args.client_id, '/api/tags');
    }
    case 'create_tag': {
      return await eb(args.client_id, '/api/tags', 'POST', { name: args.name });
    }
    case 'attach_tags_to_campaigns': {
      return await eb(args.client_id, '/api/tags/attach-to-campaigns', 'POST', { tag_ids: args.tag_ids, campaign_ids: args.campaign_ids });
    }
    case 'attach_tags_to_leads': {
      return await eb(args.client_id, '/api/tags/attach-to-leads', 'POST', { tag_ids: args.tag_ids, lead_ids: args.lead_ids });
    }

    // ── Warmup ─────────────────────────────────────────────────────────────
    case 'get_warmup_stats': {
      const today = new Date().toISOString().split('T')[0];
      const tenDaysAgo = new Date(Date.now() - 10*24*60*60*1000).toISOString().split('T')[0];
      const params = new URLSearchParams();
      params.set('start_date', args.start_date || tenDaysAgo);
      params.set('end_date', args.end_date || today);
      if (args.search) params.set('search', args.search);
      if (args.page) params.set('page', args.page);
      // Fetch all pages
      const first = await eb(args.client_id, `/api/warmup/sender-emails?${params.toString()}`);
      return first;
    }
    case 'enable_warmup': {
      return await eb(args.client_id, '/api/warmup/sender-emails/enable', 'PATCH', { sender_email_ids: args.sender_email_ids });
    }
    case 'disable_warmup': {
      return await eb(args.client_id, '/api/warmup/sender-emails/disable', 'PATCH', { sender_email_ids: args.sender_email_ids });
    }
    case 'update_warmup_limits': {
      return await eb(args.client_id, '/api/warmup/sender-emails/update-daily-warmup-limits', 'PATCH', { sender_email_ids: args.sender_email_ids, daily_limit: args.daily_limit });
    }

    // ── Blacklists ─────────────────────────────────────────────────────────
    case 'get_blacklisted_emails': {
      return await eb(args.client_id, '/api/blacklisted-emails');
    }
    case 'blacklist_email': {
      return await eb(args.client_id, '/api/blacklisted-emails', 'POST', { email: args.email });
    }
    case 'get_blacklisted_domains': {
      return await eb(args.client_id, '/api/blacklisted-domains');
    }
    case 'blacklist_domain': {
      return await eb(args.client_id, '/api/blacklisted-domains', 'POST', { domain: args.domain });
    }

    // ── Campaign Stats ─────────────────────────────────────────────────────
    case 'get_campaign_stats_by_date': {
      return await eb(args.client_id, `/api/campaigns/${args.campaign_id}/stats`, 'POST', { start_date: args.start_date, end_date: args.end_date });
    }
    case 'get_events_breakdown': {
      const params = new URLSearchParams();
      params.set('start_date', args.start_date);
      params.set('end_date', args.end_date);
      if (args.campaign_ids) args.campaign_ids.forEach(id => params.append('campaign_ids[]', id));
      if (args.sender_email_ids) args.sender_email_ids.forEach(id => params.append('sender_email_ids[]', id));
      return await eb(args.client_id, `/api/campaign-events/stats?${params.toString()}`);
    }

    // ── Webhooks ───────────────────────────────────────────────────────────
    case 'get_webhooks': {
      return await eb(args.client_id, '/api/webhook-url');
    }
    case 'create_webhook': {
      return await eb(args.client_id, '/api/webhook-url', 'POST', { name: args.name, url: args.url, events: args.events });
    }
    case 'delete_webhook': {
      return await eb(args.client_id, `/api/webhook-url/${args.webhook_id}`, 'DELETE');
    }

    // ── Reply Templates ────────────────────────────────────────────────────
    case 'get_reply_templates': {
      const params = args.search ? `?search=${encodeURIComponent(args.search)}` : '';
      return await eb(args.client_id, `/api/reply-templates${params}`);
    }
    case 'create_reply_template': {
      return await eb(args.client_id, '/api/reply-templates', 'POST', { name: args.name, body: args.body });
    }

    // ── Scheduled Emails ───────────────────────────────────────────────────
    case 'get_scheduled_emails': {
      const params = new URLSearchParams();
      if (args.status) params.set('status', args.status);
      if (args.campaign_ids) params.set('campaign_ids', args.campaign_ids);
      if (args.page) params.set('page', args.page);
      return await eb(args.client_id, `/api/scheduled-emails?${params.toString()}`);
    }

    // ── Custom Variables ───────────────────────────────────────────────────
    case 'get_custom_variables': {
      return await eb(args.client_id, '/api/custom-variables');
    }
    case 'create_custom_variable': {
      return await eb(args.client_id, '/api/custom-variables', 'POST', { name: args.name });
    }

    // ── Ignore Phrases ─────────────────────────────────────────────────────
    case 'get_ignore_phrases': {
      return await eb(args.client_id, '/api/ignore-phrases');
    }
    case 'create_ignore_phrase': {
      return await eb(args.client_id, '/api/ignore-phrases', 'POST', { phrase: args.phrase });
    }

    // ── Sender Email Management ────────────────────────────────────────────
    case 'update_sender_email': {
      const body = {};
      if (args.daily_limit !== undefined) body.daily_limit = args.daily_limit;
      if (args.name !== undefined) body.name = args.name;
      if (args.email_signature !== undefined) body.email_signature = args.email_signature;
      return await eb(args.client_id, `/api/sender-emails/${args.sender_email_id}`, 'PATCH', body);
    }
    case 'bulk_update_sender_limits': {
      return await eb(args.client_id, '/api/sender-emails/daily-limits/bulk', 'PATCH', { sender_email_ids: args.sender_email_ids, daily_limit: args.daily_limit });
    }
    case 'bulk_update_sender_signatures': {
      return await eb(args.client_id, '/api/sender-emails/signatures/bulk', 'PATCH', { sender_email_ids: args.sender_email_ids, email_signature: args.email_signature });
    }

    // ── Campaign Actions ───────────────────────────────────────────────────
    case 'duplicate_campaign': {
      return await eb(args.client_id, `/api/campaigns/${args.campaign_id}/duplicate`, 'POST', {});
    }
    case 'archive_campaign': {
      return await eb(args.client_id, `/api/campaigns/${args.campaign_id}/archive`, 'PATCH', {});
    }
    case 'delete_campaign': {
      return await eb(args.client_id, `/api/campaigns/${args.campaign_id}`, 'DELETE');
    }
    case 'update_campaign_settings': {
      const body = {};
      if (args.name !== undefined) body.name = args.name;
      if (args.max_emails_per_day !== undefined) body.max_emails_per_day = args.max_emails_per_day;
      if (args.max_new_leads_per_day !== undefined) body.max_new_leads_per_day = args.max_new_leads_per_day;
      if (args.plain_text !== undefined) body.plain_text = args.plain_text;
      if (args.open_tracking !== undefined) body.open_tracking = args.open_tracking;
      if (args.can_unsubscribe !== undefined) body.can_unsubscribe = args.can_unsubscribe;
      return await eb(args.client_id, `/api/campaigns/${args.campaign_id}/update`, 'PATCH', body);
    }

    // ── Replies (compose/reply/forward/delete/thread) ──────────────────────
    case 'compose_email': {
      const body = { sender_email_id: args.sender_email_id, to_emails: args.to_emails, message: args.message };
      if (args.subject) body.subject = args.subject;
      if (args.content_type) body.content_type = args.content_type;
      if (args.cc_emails) body.cc_emails = args.cc_emails;
      if (args.bcc_emails) body.bcc_emails = args.bcc_emails;
      return await eb(args.client_id, '/api/replies/new', 'POST', body);
    }
    case 'reply_to_email': {
      const body = { message: args.message };
      if (args.sender_email_id) body.sender_email_id = args.sender_email_id;
      if (args.reply_all !== undefined) body.reply_all = args.reply_all;
      if (args.content_type) body.content_type = args.content_type;
      if (args.cc_emails) body.cc_emails = args.cc_emails;
      if (args.inject_previous_email_body !== undefined) body.inject_previous_email_body = args.inject_previous_email_body;
      return await eb(args.client_id, `/api/replies/${args.reply_id}/reply`, 'POST', body);
    }
    case 'forward_email': {
      const body = { sender_email_id: args.sender_email_id };
      if (args.to_emails) body.to_emails = args.to_emails;
      if (args.message) body.message = args.message;
      return await eb(args.client_id, `/api/replies/${args.reply_id}/forward`, 'POST', body);
    }
    case 'delete_reply': {
      return await eb(args.client_id, `/api/replies/${args.reply_id}`, 'DELETE');
    }
    case 'get_conversation_thread': {
      return await eb(args.client_id, `/api/replies/${args.reply_id}/conversation-thread`);
    }
    case 'push_to_followup_campaign': {
      const body = { campaign_id: args.campaign_id };
      if (args.force_add_reply !== undefined) body.force_add_reply = args.force_add_reply;
      return await eb(args.client_id, `/api/replies/${args.reply_id}/followup-campaign/push`, 'POST', body);
    }
    case 'unsubscribe_reply_contact': {
      return await eb(args.client_id, `/api/replies/${args.reply_id}/unsubscribe`, 'PATCH', {});
    }

    // ── Lead extras ────────────────────────────────────────────────────────
    case 'delete_lead': {
      return await eb(args.client_id, `/api/leads/${args.lead_id}`, 'DELETE');
    }
    case 'bulk_delete_leads': {
      return await eb(args.client_id, '/api/leads/bulk', 'DELETE', { lead_ids: args.lead_ids });
    }
    case 'add_lead_to_blacklist': {
      return await eb(args.client_id, `/api/leads/${args.lead_id}/blacklist`, 'POST', {});
    }
    case 'get_lead_scheduled_emails': {
      const p = args.page ? `?page=${args.page}` : '';
      return await eb(args.client_id, `/api/leads/${args.lead_id}/scheduled-emails${p}`);
    }
    case 'get_lead_sent_emails': {
      return await eb(args.client_id, `/api/leads/${args.lead_id}/sent-emails`);
    }
    case 'get_lead_replies': {
      const p = args.page ? `?page=${args.page}` : '';
      return await eb(args.client_id, `/api/leads/${args.lead_id}/replies${p}`);
    }
    case 'upsert_lead': {
      const behavior = args.patch_mode ? 'patch' : 'put';
      const body = { first_name: args.first_name, email: args.email, existing_lead_behavior: behavior };
      if (args.last_name) body.last_name = args.last_name;
      if (args.title) body.title = args.title;
      if (args.company) body.company = args.company;
      if (args.notes) body.notes = args.notes;
      if (args.custom_variables) body.custom_variables = args.custom_variables;
      return await eb(args.client_id, `/api/leads/create-or-update/${encodeURIComponent(args.email)}`, 'POST', body);
    }

    // ── Campaign scheduled emails ─────────────────────────────────────────
    case 'get_campaign_scheduled_emails': {
      const params = new URLSearchParams();
      if (args.status) params.set('status', args.status);
      if (args.page) params.set('page', args.page);
      return await eb(args.client_id, `/api/campaigns/${args.campaign_id}/scheduled-emails?${params.toString()}`);
    }

    // ── Sender email extras ───────────────────────────────────────────────
    case 'get_sender_campaigns': {
      return await eb(args.client_id, `/api/sender-emails/${args.sender_email_id}/campaigns`);
    }
    case 'get_sender_replies': {
      const params = new URLSearchParams();
      if (args.folder) params.set('folder', args.folder);
      if (args.page) params.set('page', args.page);
      return await eb(args.client_id, `/api/sender-emails/${args.sender_email_id}/replies?${params.toString()}`);
    }
    case 'get_warmup_detail': {
      return await eb(args.client_id, `/api/warmup/sender-emails/${args.sender_email_id}?start_date=${args.start_date}&end_date=${args.end_date}`);
    }

    // ── Webhooks extras ───────────────────────────────────────────────────
    case 'get_webhook': {
      return await eb(args.client_id, `/api/webhook-url/${args.webhook_id}`);
    }
    case 'update_webhook': {
      return await eb(args.client_id, `/api/webhook-url/${args.webhook_id}`, 'PUT', { name: args.name, url: args.url, events: args.events });
    }
    case 'get_webhook_event_types': {
      return await eb(args.client_id, '/api/webhook-events/event-types');
    }

    // ── Reply templates extras ────────────────────────────────────────────
    case 'get_reply_template': {
      return await eb(args.client_id, `/api/reply-templates/${args.template_id}`);
    }
    case 'update_reply_template': {
      return await eb(args.client_id, `/api/reply-templates/${args.template_id}`, 'PUT', { name: args.name, body: args.body });
    }
    case 'delete_reply_template': {
      return await eb(args.client_id, `/api/reply-templates/${args.template_id}`, 'DELETE');
    }

    // ── Tags extras ───────────────────────────────────────────────────────
    case 'remove_tags_from_campaigns': {
      return await eb(args.client_id, '/api/tags/remove-from-campaigns', 'POST', { tag_ids: args.tag_ids, campaign_ids: args.campaign_ids });
    }
    case 'remove_tags_from_leads': {
      return await eb(args.client_id, '/api/tags/remove-from-leads', 'POST', { tag_ids: args.tag_ids, lead_ids: args.lead_ids });
    }
    case 'attach_tags_to_senders': {
      return await eb(args.client_id, '/api/tags/attach-to-sender-emails', 'POST', { tag_ids: args.tag_ids, sender_email_ids: args.sender_email_ids });
    }
    case 'remove_tags_from_senders': {
      return await eb(args.client_id, '/api/tags/remove-from-sender-emails', 'POST', { tag_ids: args.tag_ids, sender_email_ids: args.sender_email_ids });
    }
    case 'delete_tag': {
      return await eb(args.client_id, `/api/tags/${args.tag_id}`, 'DELETE');
    }

    // ── Blacklist extras ──────────────────────────────────────────────────
    case 'remove_blacklisted_email': {
      return await eb(args.client_id, `/api/blacklisted-emails/${encodeURIComponent(args.email)}`, 'DELETE');
    }
    case 'remove_blacklisted_domain': {
      return await eb(args.client_id, `/api/blacklisted-domains/${encodeURIComponent(args.domain)}`, 'DELETE');
    }

    // ── Ignore phrases extras ─────────────────────────────────────────────
    case 'delete_ignore_phrase': {
      return await eb(args.client_id, `/api/ignore-phrases/${encodeURIComponent(args.phrase_id)}`, 'DELETE');
    }

    // ── Campaign sequence extras ──────────────────────────────────────────
    case 'activate_sequence_step': {
      return await eb(args.client_id, `/api/campaigns/sequence-steps/${args.sequence_step_id}/activate-or-deactivate`, 'PATCH', { active: args.active });
    }
    case 'import_leads_by_ids': {
      const body = { lead_ids: args.lead_ids };
      if (args.allow_parallel_sending !== undefined) body.allow_parallel_sending = args.allow_parallel_sending;
      return await eb(args.client_id, `/api/campaigns/${args.campaign_id}/leads/attach-leads`, 'POST', body);
    }
    case 'get_campaign_sending_schedule': {
      const day = args.day || 'today';
      return await eb(args.client_id, `/api/campaigns/${args.campaign_id}/sending-schedule`, 'GET', { day: day });
    }

    case 'add_sequence_step': {
      // Fetch existing steps to determine order if not specified
      const ex = await eb(args.client_id, `/api/campaigns/${args.campaign_id}/sequence-steps`);
      const exArr = ex.data || (Array.isArray(ex) ? ex : []);
      // Find max order across ALL steps including variants (variants share order with parent)
      const nonVariants = exArr.filter(s => !s.variant);
      const nextOrder = args.order || (nonVariants.length > 0 ? Math.max(...nonVariants.map(s => s.order || 0)) + 1 : 1);
      const isFollowup = nextOrder > 1;
      const threadReply = args.thread_reply !== undefined ? args.thread_reply : isFollowup;
      const sequence_steps = [{
        email_subject: args.subject,
        email_body: args.body,
        wait_in_days: Math.max(1, args.delay_days || 1),
        order: nextOrder,
        reply_to_thread: threadReply,
        variant: false,
      }];
      const result = await eb(args.client_id, `/api/campaigns/${args.campaign_id}/sequence-steps`, 'POST', { title: 'Main Sequence', sequence_steps });
      return { ok: true, order: nextOrder, thread_reply: threadReply, result };
    }

    case 'add_sequence_variant': {
      // Get parent step details to match delay_days and order
      const ex = await eb(args.client_id, `/api/campaigns/${args.campaign_id}/sequence-steps`);
      const exArr = ex.data || (Array.isArray(ex) ? ex : []);
      const parentStep = exArr.find(s => s.id === args.step_id);
      if (!parentStep) return { ok: false, error: `Step ID ${args.step_id} not found in campaign` };
      const sequence_steps = [{
        email_subject: args.subject,
        email_body: args.body,
        wait_in_days: args.delay_days || parentStep.wait_in_days || 1,
        order: parentStep.order,
        reply_to_thread: args.thread_reply !== undefined ? args.thread_reply : parentStep.thread_reply,
        variant: true,
        variant_from_step_id: args.step_id, // link to parent step by ID
      }];
      const result = await eb(args.client_id, `/api/campaigns/${args.campaign_id}/sequence-steps`, 'POST', { title: 'Main Sequence', sequence_steps });
      return { ok: true, variant_of_step_id: args.step_id, result };
    }

    case 'check_sender_availability': {
      const checkDate = args.date || new Date().toISOString().split('T')[0];
      const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
        ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
        : 'http://localhost:' + (process.env.PORT || 3000);
      const resp = await fetch(baseUrl + '/api/tools/sender-availability-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: args.client_id, sender_ids: args.sender_ids, date: checkDate }),
      });
      return await resp.json();
    }

    // ── Passthrough tools ───────────────────────────────────────────────────
    case 'eb_get': {
      const data = await eb(args.client_id, args.endpoint);
      return data;
    }
    case 'eb_post': {
      const data = await eb(args.client_id, args.endpoint, 'POST', args.body || {});
      return data;
    }
    case 'eb_patch': {
      const data = await eb(args.client_id, args.endpoint, 'PATCH', args.body || {});
      return data;
    }
    case 'eb_delete': {
      const data = await eb(args.client_id, args.endpoint, 'DELETE');
      return data;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// MCP endpoint — handles both POST (tool calls) and GET (capability discovery)
app.get('/mcp', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // Send server capabilities
  const caps = {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {}
  };
  res.write(`data: ${JSON.stringify(caps)}\n\n`);
  req.on('close', () => res.end());
});

app.post('/mcp', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body;

  // Initialize handshake
  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'emailbison-mcp', version: '1.0.0' },
      },
    });
  }

  // List available tools
  if (method === 'tools/list') {
    return res.json({ jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } });
  }

  // Execute a tool
  if (method === 'tools/call') {
    const { name, arguments: args } = params;
    try {
      const result = await handleMcpTool(name, args || {});
      return res.json({
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        },
      });
    } catch (e) {
      return res.json({
        jsonrpc: '2.0', id,
        result: {
          content: [{ type: 'text', text: `Error: ${e.message}` }],
          isError: true,
        },
      });
    }
  }

  // Ping / other notifications
  if (method === 'notifications/initialized' || method === 'ping') {
    return res.json({ jsonrpc: '2.0', id, result: {} });
  }

  res.status(400).json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
});


  app.use(express.static(buildPath));
  app.get('*', (_req, res) => res.sendFile(join(buildPath, 'index.html')));
}

const PORT = process.env.PORT || 3847;
app.listen(PORT, () => console.log(`✅ Server on port ${PORT}`));
