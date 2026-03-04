#!/bin/bash

# Quick Stripe Setup - Tradvio Backend
# Run this script with your Stripe secret key as an argument

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔧 Quick Stripe Setup - Tradvio"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if secret key provided
if [ -z "$1" ]; then
  echo "❌ Error: Stripe secret key required"
  echo ""
  echo "Usage:"
  echo "  ./quick-stripe-setup.sh sk_test_YOUR_KEY_HERE"
  echo ""
  echo "Get your key from: https://dashboard.stripe.com/apikeys"
  exit 1
fi

STRIPE_SECRET_KEY="$1"

# Validate key format
if [[ ! $STRIPE_SECRET_KEY =~ ^sk_(test|live)_ ]]; then
  echo "❌ Error: Invalid secret key format"
  echo "   Key should start with sk_test_ or sk_live_"
  exit 1
fi

echo "✅ Stripe secret key validated"
echo ""

# Step 1: Create webhook and get signing secret
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 1: Creating Webhook Endpoint"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

WEBHOOK_OUTPUT=$(STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY node create-webhook.js 2>&1)
WEBHOOK_STATUS=$?

if [ $WEBHOOK_STATUS -ne 0 ]; then
  echo "⚠️  Webhook creation failed (might already exist)"
  echo "$WEBHOOK_OUTPUT"
  echo ""
  echo "Get your webhook signing secret from:"
  echo "https://dashboard.stripe.com/webhooks"
  echo ""
  read -p "Paste webhook signing secret (whsec_...): " WEBHOOK_SECRET
else
  WEBHOOK_SECRET=$(echo "$WEBHOOK_OUTPUT" | grep "whsec_" | head -n1 | tr -d '[:space:]')
  echo "✅ Webhook created!"
  echo "🔐 Signing Secret: $WEBHOOK_SECRET"
fi

echo ""

if [[ ! $WEBHOOK_SECRET =~ ^whsec_ ]]; then
  echo "❌ Error: Invalid webhook secret format (should start with whsec_)"
  exit 1
fi

# Step 2: Configure Cloudflare secrets
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 2: Configuring Cloudflare Worker Secrets"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "🔐 Setting STRIPE_SECRET_KEY..."
echo "$STRIPE_SECRET_KEY" | wrangler secret put STRIPE_SECRET_KEY

echo ""
echo "🔐 Setting STRIPE_WEBHOOK_SECRET..."
echo "$WEBHOOK_SECRET" | wrangler secret put STRIPE_WEBHOOK_SECRET

echo ""
echo "✅ Cloudflare secrets configured!"
echo ""

# Step 3: Deploy
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "STEP 3: Deploy Backend"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

wrangler deploy

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ BACKEND STRIPE SETUP COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Configured:"
echo "  • Stripe Secret Key: Set"
echo "  • Webhook Secret: Set"
echo "  • Price ID: price_1SP9X4HwfRkd7scfq40SmnRL (\$997/mo)"
echo "  • Backend: Deployed"
echo ""
echo "🔄 Next: Update frontend with publishable key"
echo "  Edit: tradvio-replica/.env.production"
echo "  Set: VITE_STRIPE_PUBLIC_KEY=pk_test_YOUR_KEY"
echo ""
echo "Then deploy frontend:"
echo "  cd ../tradvio-replica"
echo "  npm run build"
echo "  wrangler pages deploy dist --project-name=tradvio-frontend"
echo ""
