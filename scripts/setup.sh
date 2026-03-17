#!/bin/bash
# EmailBison Copy Applier — Setup Script
# Run this once on your Mac to install dependencies

echo ""
echo "📧 EmailBison Copy Applier — Setup"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found. Install from https://nodejs.org"
  exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
cd "$(dirname "$0")"
npm install

# Install Playwright's Chromium
echo ""
echo "🌐 Installing Playwright Chromium..."
npx playwright install chromium

echo ""
echo "✅ Setup complete!"
echo ""
echo "Usage:"
echo ""
echo "  # Set your Railway URL (do this once):"
echo "  export TOOL_URL=https://your-app.up.railway.app"
echo ""
echo "  # Step 1: Capture Livewire calls from EmailBison (do once)"
echo "  node livewire-inject.js --capture --campaign <paste-campaign-uuid>"
echo ""
echo "  # Step 2: Analyze what was captured"
echo "  node livewire-inject.js --analyze"
echo ""
echo "  # Step 3: Apply a template to a campaign"
echo "  node apply-template.js"
echo ""
