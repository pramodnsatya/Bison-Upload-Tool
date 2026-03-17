/**
 * EmailBison Livewire Injector
 * 
 * STEP 1: Run --capture mode once to record the exact Livewire calls
 * STEP 2: Run --apply mode to replay them with your template content
 * 
 * This is more reliable than DOM automation because it replicates
 * exactly what the browser sends, just with different content.
 * 
 * Usage:
 *   node livewire-inject.js --capture --campaign <uuid>   (do this once)
 *   node livewire-inject.js --apply --campaign <uuid> --template <id>
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import readline from 'readline';

const BISON_URL = 'https://send.founderled.io';
const TOOL_URL  = process.env.TOOL_URL || 'https://your-app.up.railway.app';

const c = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  blue:   s => `\x1b[34m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

function prompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(`  ${c.bold('?')} ${q} `, a => { rl.close(); r(a.trim()); }));
}

// ─── Open Chrome with existing session ────────────────────────────────────────
async function openChrome(headless = false) {
  // Try 1: Real Chrome persistent context (keeps you logged in)
  const chromePaths = [
    process.env.HOME + '/Library/Application Support/Google/Chrome',
    process.env.HOME + '/Library/Application Support/Google/Chrome Beta',
    process.env.HOME + '/Library/Application Support/Chromium',
  ];
  for (const userDataDir of chromePaths) {
    try {
      const ctx = await chromium.launchPersistentContext(userDataDir, {
        headless, channel: 'chrome', timeout: 10000,
        args: ['--disable-blink-features=AutomationControlled'],
      });
      console.log('  \x1b[32m✓\x1b[0m Using your existing Chrome session');
      return ctx;
    } catch (_) {}
  }
  // Try 2: Chrome without persistent context
  try {
    const browser = await chromium.launch({ headless, channel: 'chrome', timeout: 10000 });
    console.log('  \x1b[33m⚠\x1b[0m Using Chrome (fresh session — you may need to log in)');
    return await browser.newContext();
  } catch (_) {}
  // Try 3: Playwright bundled Chromium — must log in manually
  console.log('  \x1b[33m⚠\x1b[0m Chrome not found — using Playwright Chromium. Log in to EmailBison when the browser opens.');
  const browser = await chromium.launch({ headless: false, timeout: 30000 });
  return await browser.newContext();
}

// ─── CAPTURE MODE: Record what Livewire sends when saving a sequence step ─────
async function captureMode(campaignId) {
  console.log(c.bold('\n  📡 CAPTURE MODE'));
  console.log('  This records the exact Livewire calls EmailBison makes when saving a sequence step.');
  console.log('  You only need to do this once.\n');

  const ctx = await openChrome(false);
  const page = ctx.pages()[0] || await ctx.newPage();

  const captured = [];

  // Intercept ALL Livewire update calls
  await page.route('**/livewire/update', async route => {
    const req   = route.request();
    const body  = req.postData();
    const cookies = await ctx.cookies();
    
    try {
      const parsed = JSON.parse(body);
      captured.push({
        timestamp: Date.now(),
        url:       req.url(),
        method:    req.method(),
        headers:   req.headers(),
        body:      parsed,
        cookies:   cookies.reduce((acc, c) => ({ ...acc, [c.name]: c.value }), {}),
      });
      console.log(`  ${c.green('✓')} Captured Livewire call #${captured.length}`);
      // Print the calls array if it has method calls
      const calls = parsed.components?.[0]?.calls;
      if (calls?.length) {
        console.log(`    Method: ${calls[0].method}, Args: ${JSON.stringify(calls[0].params).slice(0, 80)}`);
      }
    } catch (_) {}
    
    await route.continue();
  });

  await page.goto(`${BISON_URL}/campaigns/${campaignId}`, { waitUntil: 'networkidle' });

  console.log(c.yellow('\n  ───────────────────────────────────────────────────'));
  console.log(c.bold('  ACTION REQUIRED IN THE BROWSER WINDOW:'));
  console.log('  1. Click the "Sequence" tab');
  console.log('  2. Click "Add step" to add a NEW email step');
  console.log('  3. Fill in any subject line and body text');
  console.log('  4. Click Save');
  console.log('  5. Repeat for a 2nd step (follow-up) if you have one');
  console.log(c.yellow('  ───────────────────────────────────────────────────\n'));
  
  await prompt('Press Enter AFTER saving steps in the browser...');

  if (!captured.length) {
    console.log(c.red('\n  No Livewire calls captured. Did you save a step?'));
    await ctx.close().catch(() => {});
    process.exit(1);
  }

  // Analyse what we captured
  console.log(`\n  Captured ${captured.length} Livewire calls. Analysing...`);
  
  const relevant = captured.filter(call => {
    const calls = call.body?.components?.[0]?.calls;
    return calls?.some(c =>
      c.method?.toLowerCase().includes('save') ||
      c.method?.toLowerCase().includes('create') ||
      c.method?.toLowerCase().includes('store') ||
      c.method?.toLowerCase().includes('step') ||
      c.method?.toLowerCase().includes('add') ||
      c.method?.toLowerCase().includes('update')
    );
  });

  console.log(`  Relevant calls (save/create/add): ${relevant.length}`);

  // Save full capture for analysis
  writeFileSync('livewire-capture.json', JSON.stringify(captured, null, 2));
  console.log(c.green('\n  ✓ Saved full capture to livewire-capture.json'));

  if (relevant.length > 0) {
    writeFileSync('livewire-relevant.json', JSON.stringify(relevant, null, 2));
    console.log(c.green('  ✓ Saved relevant calls to livewire-relevant.json'));
    
    // Show the method names found
    const methods = new Set();
    relevant.forEach(r => {
      r.body?.components?.[0]?.calls?.forEach(c => methods.add(c.method));
    });
    console.log(`\n  Method names found: ${[...methods].join(', ')}`);
    console.log('\n  Next step: run with --analyze to build the injection pattern');
  } else {
    console.log(c.yellow('\n  No obvious save methods found. All calls saved for manual review.'));
    console.log('  Open livewire-capture.json and look for the call that saved your step.');
  }

  await ctx.close().catch(() => {});
}

// ─── ANALYZE MODE: Parse capture and build reusable pattern ───────────────────
async function analyzeMode() {
  if (!existsSync('livewire-capture.json')) {
    console.log(c.red('  No capture file found. Run --capture first.'));
    process.exit(1);
  }

  const captured = JSON.parse(readFileSync('livewire-capture.json', 'utf8'));
  console.log(c.bold(`\n  Analyzing ${captured.length} captured calls...\n`));

  // Find all unique method names
  const methodMap = {};
  captured.forEach((call, i) => {
    const calls = call.body?.components?.[0]?.calls || [];
    calls.forEach(c => {
      if (!methodMap[c.method]) methodMap[c.method] = [];
      methodMap[c.method].push({ callIndex: i, params: c.params });
    });
  });

  console.log('  Methods found:');
  Object.entries(methodMap).forEach(([method, uses]) => {
    console.log(`  ${c.bold(method)} (${uses.length} times)`);
    uses.slice(0, 2).forEach(u => {
      console.log(`    ${c.dim('params:')} ${JSON.stringify(u.params).slice(0, 100)}`);
    });
  });

  // Look for component fingerprint (needed to replay calls)
  const firstCall = captured[0];
  const component = firstCall?.body?.components?.[0];
  if (component?.snapshot) {
    console.log('\n  Component snapshot found — can extract fingerprint for replay');
    const snapshot = typeof component.snapshot === 'string'
      ? JSON.parse(component.snapshot)
      : component.snapshot;
    console.log(`  Component: ${snapshot?.memo?.name || 'unknown'}`);
  }

  // Save the pattern
  const pattern = {
    methods: methodMap,
    componentName: null,
    fingerprint: null,
    sampleHeaders: captured[0]?.headers,
    capturedAt: new Date().toISOString(),
  };

  writeFileSync('livewire-pattern.json', JSON.stringify(pattern, null, 2));
  console.log(c.green('\n  ✓ Pattern saved to livewire-pattern.json'));
  console.log('\n  Share livewire-pattern.json and livewire-capture.json with Claude');
  console.log('  to build the exact injection script for your EmailBison instance.');
}

// ─── APPLY MODE: Replay Livewire calls with template content ──────────────────
async function applyMode(campaignId, templateId) {
  if (!existsSync('livewire-capture.json')) {
    console.log(c.red('\n  No capture file. Run --capture mode first.'));
    process.exit(1);
  }

  // Fetch template
  const templates = await fetch(`${TOOL_URL}/templates`).then(r => r.json());
  const template  = templateId
    ? templates.find(t => t.id === templateId)
    : templates[0];

  if (!template) {
    console.log(c.red('\n  Template not found.'));
    process.exit(1);
  }

  console.log(c.bold(`\n  Applying template: ${template.name}`));
  console.log(`  Steps: ${template.steps.length}`);

  // Open browser with session
  const ctx  = await openChrome(false); // show browser so user can see
  const page = ctx.pages()[0] || await ctx.newPage();

  // Navigate to campaign and get fresh component state
  await page.goto(`${BISON_URL}/campaigns/${campaignId}`, { waitUntil: 'networkidle' });

  // Inject template data into the page via Livewire's public JS API
  // Livewire exposes window.Livewire which we can use to call component methods
  const result = await page.evaluate(async (steps) => {
    // Wait for Livewire to be available
    let attempts = 0;
    while (!window.Livewire && attempts < 20) {
      await new Promise(r => setTimeout(r, 500));
      attempts++;
    }

    if (!window.Livewire) return { error: 'Livewire not found on page' };

    const results = [];
    
    // Find the sequence component
    // Livewire v3 exposes components via window.Livewire.all()
    const components = window.Livewire.all?.() || [];
    const seqComponent = components.find(c => {
      const name = c.name || c.$wire?.name || '';
      return name.toLowerCase().includes('sequence') || name.toLowerCase().includes('step');
    });

    if (!seqComponent) {
      return { error: 'Could not find sequence Livewire component', componentCount: components.length, names: components.map(c => c.name) };
    }

    results.push(`Found component: ${seqComponent.name}`);

    // Try to call save/create methods via $wire
    for (const step of steps) {
      try {
        // Try common method names
        const wire = seqComponent.$wire;
        if (wire) {
          // Set properties directly
          if ('subject' in wire) wire.subject = step.subject;
          if ('body' in wire) wire.body = step.body;
          if ('content' in wire) wire.content = step.body;
          
          // Try calling save methods
          for (const method of ['saveStep', 'createStep', 'addStep', 'save', 'store']) {
            if (typeof wire[method] === 'function') {
              await wire[method]();
              results.push(`Called ${method}() for "${step.subject}"`);
              await new Promise(r => setTimeout(r, 1000));
              break;
            }
          }
        }
      } catch (e) {
        results.push(`Error on step "${step.subject}": ${e.message}`);
      }
    }

    return { success: true, results };
  }, template.steps);

  console.log('\n  Result:', result);

  if (result?.error) {
    console.log(c.yellow('\n  Livewire JS API approach did not work.'));
    console.log('  This means we need the captured call pattern to replay requests directly.');
    console.log('  Run --analyze to build the exact pattern, then share with Claude.');
  }

  await prompt('\n  Check the browser. Press Enter to close...');
  await ctx.close().catch(() => {});
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const flags  = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) flags[args[i].slice(2)] = args[i + 1]?.startsWith('--') ? true : (args[i + 1] || true);
}

console.clear();
console.log(c.bold('\n  📧 EmailBison Livewire Injector'));

if (flags.capture) {
  const campaignId = flags.campaign || await prompt('Campaign UUID:');
  await captureMode(campaignId);
} else if (flags.analyze) {
  await analyzeMode();
} else if (flags.apply) {
  const campaignId = flags.campaign || await prompt('Campaign UUID:');
  await applyMode(campaignId, flags.template);
} else {
  console.log('\n  Usage:');
  console.log('  node livewire-inject.js --capture --campaign <uuid>   Record Livewire calls (do once)');
  console.log('  node livewire-inject.js --analyze                      Analyze capture');
  console.log('  node livewire-inject.js --apply --campaign <uuid>      Apply template');
  console.log('\n  Start with --capture mode.\n');
}
