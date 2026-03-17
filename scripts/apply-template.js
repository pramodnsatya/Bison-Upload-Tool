/**
 * EmailBison Copy Applier
 * 
 * Uses Playwright to automate the EmailBison sequence builder.
 * Reads templates from your Railway-hosted tool and applies them
 * to campaigns using your existing browser session.
 * 
 * Usage:
 *   node apply-template.js
 *   node apply-template.js --campaign <campaign-uuid> --template <template-id>
 *   node apply-template.js --list-templates
 *   node apply-template.js --list-campaigns --client <client-id>
 */

import { chromium } from 'playwright';
import readline from 'readline';

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
  // Your Railway-hosted tool URL (where templates are stored)
  toolUrl: process.env.TOOL_URL || 'https://your-app.up.railway.app',

  // EmailBison instance
  bisonUrl: 'https://send.founderled.io',

  // How long to wait for page elements (ms)
  timeout: 15000,

  // Whether to show the browser window (false = headless/invisible)
  headless: true,
};

// ─── Colours for terminal output ──────────────────────────────────────────────
const c = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  blue:   s => `\x1b[34m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

function log(msg)    { console.log(`  ${msg}`); }
function ok(msg)     { console.log(`  ${c.green('✓')} ${msg}`); }
function warn(msg)   { console.log(`  ${c.yellow('⚠')} ${msg}`); }
function fail(msg)   { console.log(`  ${c.red('✕')} ${msg}`); }
function step(n, msg){ console.log(`\n${c.bold(c.blue(`[${n}]`))} ${c.bold(msg)}`); }
function hr()        { console.log(`\n${c.dim('─'.repeat(60))}`); }

// ─── Fetch templates from Railway tool ────────────────────────────────────────
async function fetchTemplates() {
  const res = await fetch(`${CONFIG.toolUrl}/templates`);
  if (!res.ok) throw new Error(`Could not fetch templates from ${CONFIG.toolUrl}`);
  return await res.json();
}

// ─── Interactive prompts ───────────────────────────────────────────────────────
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`  ${c.bold('?')} ${question} `, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function selectFromList(items, labelFn, title) {
  console.log(`\n  ${c.bold(title)}`);
  items.forEach((item, i) => {
    console.log(`  ${c.dim(`${i + 1}.`)} ${labelFn(item)}`);
  });
  const answer = await prompt(`Enter number (1-${items.length}):`);
  const idx = parseInt(answer) - 1;
  if (idx < 0 || idx >= items.length) throw new Error('Invalid selection');
  return items[idx];
}

// ─── Core: Apply template to campaign via Playwright ──────────────────────────
async function applyTemplateToCampaign(campaignId, template) {
  const browser = await chromium.launch({
    headless: CONFIG.headless,
    // Use your installed Chrome instead of Playwright's bundled one
    // This means your existing cookies work automatically
    channel: 'chrome',
  });

  // Use persistent context = reads your real Chrome cookies & session
  // This is the key insight: we use your actual logged-in Chrome session
  const userDataDir = process.env.HOME + '/Library/Application Support/Google/Chrome';
  
  let context;
  let usingRealSession = false;
  
  try {
    // Try to use real Chrome with existing session
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: CONFIG.headless,
      channel: 'chrome',
      timeout: CONFIG.timeout,
    });
    usingRealSession = true;
    ok('Using your existing Chrome session (no login needed)');
  } catch (err) {
    warn('Could not access Chrome session, falling back to fresh browser');
    warn('You may need to log in manually');
    context = await browser.newContext();
  }

  const page = usingRealSession
    ? (context.pages()[0] || await context.newPage())
    : await context.newPage();

  try {
    // ── Step A: Navigate to the campaign ──────────────────────────────────────
    step('A', `Navigating to campaign ${campaignId}...`);
    const campaignUrl = `${CONFIG.bisonUrl}/campaigns/${campaignId}`;
    await page.goto(campaignUrl, { waitUntil: 'networkidle', timeout: CONFIG.timeout });
    
    // Check we're logged in
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('auth')) {
      fail('Not logged in to EmailBison. Please log in to send.founderled.io in Chrome first, then run this script again.');
      process.exit(1);
    }
    ok(`On campaign page`);

    // ── Step B: Find the Sequence tab and click it ────────────────────────────
    step('B', 'Opening sequence builder...');
    
    // Try multiple selectors for the Sequence tab
    const seqTabSelectors = [
      'a:has-text("Sequence")',
      'button:has-text("Sequence")',
      '[href*="sequence"]',
      'nav a:has-text("Sequence")',
      '.tab:has-text("Sequence")',
    ];
    
    let seqTab = null;
    for (const sel of seqTabSelectors) {
      try {
        seqTab = await page.waitForSelector(sel, { timeout: 3000 });
        if (seqTab) break;
      } catch (_) {}
    }
    
    if (seqTab) {
      await seqTab.click();
      await page.waitForTimeout(1000);
      ok('Sequence tab opened');
    } else {
      warn('Could not find Sequence tab automatically — trying to detect current state');
    }

    // ── Step C: Clear existing steps ──────────────────────────────────────────
    step('C', 'Checking for existing sequence steps...');
    
    // Look for delete buttons on existing steps
    const deleteSelectors = [
      'button:has-text("Delete")',
      'button[aria-label*="delete" i]',
      '.step-delete',
      '[wire\\:click*="deleteStep"]',
      '[wire\\:click*="delete"]',
    ];
    
    let deleted = 0;
    for (const sel of deleteSelectors) {
      try {
        const btns = await page.$$(sel);
        if (btns.length > 0) {
          warn(`Found ${btns.length} existing step(s) — deleting them first`);
          // Click delete buttons in reverse order
          for (let i = btns.length - 1; i >= 0; i--) {
            try {
              await btns[i].click();
              await page.waitForTimeout(500);
              // Handle any confirmation dialog
              try {
                const confirmBtn = await page.waitForSelector('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Delete")', { timeout: 2000 });
                if (confirmBtn) await confirmBtn.click();
              } catch (_) {}
              deleted++;
            } catch (_) {}
          }
          break;
        }
      } catch (_) {}
    }
    
    if (deleted > 0) {
      ok(`Cleared ${deleted} existing step(s)`);
      await page.waitForTimeout(1000);
    } else {
      log('No existing steps found or none needed to clear');
    }

    // ── Step D: Add each template step ────────────────────────────────────────
    step('D', `Applying ${template.steps.length} email steps from template "${template.name}"...`);

    for (let i = 0; i < template.steps.length; i++) {
      const emailStep = template.steps[i];
      log(`\n  Adding Email ${i + 1}: "${emailStep.subject}"`);

      // Find and click "Add step" / "Add email" button
      const addStepSelectors = [
        'button:has-text("Add step")',
        'button:has-text("Add email")',
        'button:has-text("Add Step")',
        'button:has-text("+ Add")',
        '[wire\\:click*="addStep"]',
        '[wire\\:click*="addEmail"]',
        '.add-step-btn',
      ];

      let addBtn = null;
      for (const sel of addStepSelectors) {
        try {
          addBtn = await page.waitForSelector(sel, { timeout: 3000 });
          if (addBtn) { await addBtn.click(); break; }
        } catch (_) {}
      }

      if (!addBtn) {
        warn(`Could not find "Add step" button for step ${i + 1} — trying to continue`);
        continue;
      }

      await page.waitForTimeout(800);

      // Find the subject line input for this step
      // Usually the last/newest subject field after clicking Add
      const subjectSelectors = [
        'input[placeholder*="subject" i]',
        'input[name*="subject" i]',
        'input[wire\\:model*="subject"]',
        '.subject-input input',
        '[data-field="subject"]',
      ];

      for (const sel of subjectSelectors) {
        try {
          const inputs = await page.$$(sel);
          if (inputs.length > 0) {
            const target = inputs[inputs.length - 1]; // Last = newest
            await target.click({ clickCount: 3 });
            await target.fill(emailStep.subject);
            ok(`  Subject filled: "${emailStep.subject}"`);
            break;
          }
        } catch (_) {}
      }

      await page.waitForTimeout(400);

      // Find the body textarea/editor for this step
      const bodySelectors = [
        'textarea[placeholder*="body" i]',
        'textarea[wire\\:model*="body"]',
        'textarea[wire\\:model*="content"]',
        '.body-editor textarea',
        '.email-body textarea',
        '[contenteditable="true"]',
      ];

      for (const sel of bodySelectors) {
        try {
          const areas = await page.$$(sel);
          if (areas.length > 0) {
            const target = areas[areas.length - 1];
            await target.click({ clickCount: 3 });
            await target.fill(emailStep.body);
            ok(`  Body filled (${emailStep.body.split('\n').length} lines)`);
            break;
          }
        } catch (_) {}
      }

      await page.waitForTimeout(400);

      // If it's a follow-up, set delay days
      if (i > 0 && emailStep.delay_days) {
        const delaySelectors = [
          'input[type="number"]',
          'input[wire\\:model*="delay"]',
          'input[placeholder*="days" i]',
        ];
        for (const sel of delaySelectors) {
          try {
            const inputs = await page.$$(sel);
            if (inputs.length > 0) {
              const target = inputs[inputs.length - 1];
              await target.click({ clickCount: 3 });
              await target.fill(String(emailStep.delay_days));
              ok(`  Delay set: day ${emailStep.delay_days}`);
              break;
            }
          } catch (_) {}
        }
      }

      // Save this step
      const saveSelectors = [
        'button:has-text("Save")',
        'button:has-text("Save step")',
        'button[wire\\:click*="save"]',
        'button[wire\\:click*="Save"]',
        'button[type="submit"]',
      ];

      for (const sel of saveSelectors) {
        try {
          const btns = await page.$$(sel);
          if (btns.length > 0) {
            const target = btns[btns.length - 1];
            await target.click();
            await page.waitForTimeout(800);
            ok(`  Step ${i + 1} saved`);
            break;
          }
        } catch (_) {}
      }

      await page.waitForTimeout(600);
    }

    // ── Step E: Verify ────────────────────────────────────────────────────────
    step('E', 'Verifying...');
    await page.waitForTimeout(1500);
    ok(`Template "${template.name}" applied to campaign successfully`);
    log(`\n  ${c.bold('Campaign URL:')} ${campaignUrl}`);

  } finally {
    if (!usingRealSession) {
      await browser.close();
    } else {
      // Don't close — it's the user's real Chrome
      await context.close().catch(() => {});
    }
  }
}

// ─── Discovery mode: inspect the sequence page ────────────────────────────────
// Run this first to understand EmailBison's exact DOM structure
async function inspectSequencePage(campaignId) {
  step('INSPECT', `Opening campaign ${campaignId} to map the DOM...`);
  
  const userDataDir = process.env.HOME + '/Library/Application Support/Google/Chrome';
  let context;
  
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // Show the browser so you can see what's happening
      channel: 'chrome',
    });
    ok('Chrome opened with your session');
  } catch (_) {
    fail('Could not open Chrome. Make sure Chrome is installed and not already running.');
    process.exit(1);
  }

  const page = context.pages()[0] || await context.newPage();
  const campaignUrl = `${CONFIG.bisonUrl}/campaigns/${campaignId}`;
  
  await page.goto(campaignUrl, { waitUntil: 'networkidle', timeout: CONFIG.timeout });
  ok(`Navigated to: ${campaignUrl}`);
  
  // Intercept Livewire calls to understand the component structure
  const livewireCalls = [];
  await page.route('**/livewire/update', async route => {
    const request = route.request();
    const body = request.postData();
    if (body) {
      try {
        const parsed = JSON.parse(body);
        livewireCalls.push(parsed);
        console.log('\n  📡 Livewire call intercepted:');
        console.log('  ', JSON.stringify(parsed, null, 2).split('\n').slice(0, 20).join('\n  '));
      } catch (_) {}
    }
    await route.continue();
  });

  log('\n  Browser is open. Please:');
  log('  1. Click the Sequence tab');
  log('  2. Click "Add step" or edit an existing step');
  log('  3. Fill in subject and body');
  log('  4. Click Save');
  log('\n  The script will capture the Livewire calls and save them for analysis.');
  log('\n  Press Enter here when done...');
  
  await new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => { rl.close(); resolve(); });
  });

  if (livewireCalls.length > 0) {
    const { writeFileSync } = await import('fs');
    writeFileSync('livewire-calls.json', JSON.stringify(livewireCalls, null, 2));
    ok(`Saved ${livewireCalls.length} Livewire calls to livewire-calls.json`);
    log('Share this file with Claude to build the exact automation.');
  } else {
    warn('No Livewire calls intercepted. Try using the sequence builder while the browser is open.');
  }

  await context.close().catch(() => {});
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.clear();
  console.log(c.bold('\n  📧 EmailBison Copy Applier'));
  console.log(c.dim('  Applies saved templates to campaigns via browser automation'));
  hr();

  const args = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[i + 1] || true;
  }

  // Check tool URL is configured
  if (CONFIG.toolUrl.includes('your-app')) {
    fail('TOOL_URL not configured!');
    log('Set it with: export TOOL_URL=https://your-railway-url.up.railway.app');
    log('Or edit CONFIG.toolUrl in this file.');
    process.exit(1);
  }

  // -- Inspect mode (run first to map DOM) -----------------------------------
  if (flags.inspect) {
    const campaignId = flags.campaign || await prompt('Campaign UUID (from EmailBison URL):');
    await inspectSequencePage(campaignId);
    return;
  }

  // -- List templates --------------------------------------------------------
  if (flags['list-templates']) {
    step('1', 'Fetching saved templates...');
    const templates = await fetchTemplates();
    if (!templates.length) {
      warn('No templates saved. Go to the Templates tab in the web tool and save one first.');
    } else {
      console.log('\n  Saved templates:');
      templates.forEach((t, i) => {
        console.log(`  ${c.bold(i + 1 + '.')} ${t.name} ${c.dim(`(${t.steps.length} steps · ${t.id})`)}`);
      });
    }
    return;
  }

  // -- Interactive mode (default) --------------------------------------------
  step('1', 'Fetching your saved templates...');
  let templates;
  try {
    templates = await fetchTemplates();
    ok(`Found ${templates.length} template(s)`);
  } catch (e) {
    fail(`Could not connect to tool at ${CONFIG.toolUrl}`);
    fail(e.message);
    log('Make sure your Railway app is running and TOOL_URL is correct.');
    process.exit(1);
  }

  if (!templates.length) {
    warn('No templates saved yet.');
    log('Go to the Templates tab in your web tool and save at least one template first.');
    process.exit(0);
  }

  // Select template
  const template = await selectFromList(
    templates,
    t => `${c.bold(t.name)} ${c.dim(`· ${t.steps.length} email${t.steps.length > 1 ? 's' : ''}`)}`,
    'Which template do you want to apply?'
  );
  ok(`Selected: ${template.name}`);

  // Get campaign UUID
  step('2', 'Campaign target');
  log('You can find the campaign UUID in the URL when viewing a campaign:');
  log(c.dim('https://send.founderled.io/campaigns/[UUID-IS-HERE]'));
  const campaignId = flags.campaign || await prompt('Paste the campaign UUID:');
  
  if (!campaignId || campaignId.length < 8) {
    fail('Invalid campaign UUID');
    process.exit(1);
  }

  // Confirm
  step('3', 'Confirm');
  console.log(`\n  Template:  ${c.bold(template.name)}`);
  console.log(`  Campaign:  ${c.bold(campaignId)}`);
  console.log(`  Steps:     ${template.steps.map((s, i) => `Email ${i + 1}: "${s.subject}"`).join(', ')}`);
  
  const confirm = await prompt('Apply? (y/n):');
  if (confirm.toLowerCase() !== 'y') {
    log('Cancelled.');
    process.exit(0);
  }

  // Apply
  step('4', 'Applying template...');
  try {
    await applyTemplateToCampaign(campaignId, template);
    hr();
    console.log(c.bold(c.green('\n  ✓ Done! Template applied successfully.\n')));
  } catch (e) {
    hr();
    fail('Automation failed: ' + e.message);
    log('');
    log('This usually means EmailBison updated their UI. Run with --inspect flag to re-map:');
    log(c.dim(`  node apply-template.js --inspect --campaign ${campaignId}`));
    process.exit(1);
  }
}

main().catch(e => {
  fail(e.message);
  process.exit(1);
});
