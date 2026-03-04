#!/usr/bin/env node
/**
 * Script to update Stripe pricing to $97/month
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_xxx node update-stripe-price.js
 *
 * Or run interactively and it will prompt you.
 */

const readline = require('readline');

async function main() {
  let STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

  if (!STRIPE_SECRET_KEY) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    STRIPE_SECRET_KEY = await new Promise((resolve) => {
      rl.question('Enter your Stripe Secret Key (sk_live_xxx or sk_test_xxx): ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  if (!STRIPE_SECRET_KEY || !STRIPE_SECRET_KEY.startsWith('sk_')) {
    console.error('❌ Invalid Stripe Secret Key');
    process.exit(1);
  }

  const isLive = STRIPE_SECRET_KEY.startsWith('sk_live_');
  console.log(`\n🔑 Using ${isLive ? 'LIVE' : 'TEST'} mode\n`);

  // List existing prices
  console.log('📋 Fetching existing prices...\n');

  const pricesResponse = await fetch('https://api.stripe.com/v1/prices?limit=20&active=true', {
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
    }
  });

  const pricesData = await pricesResponse.json();

  if (pricesData.error) {
    console.error('❌ Error fetching prices:', pricesData.error.message);
    process.exit(1);
  }

  console.log('Current active prices:');
  console.log('─'.repeat(80));

  for (const price of pricesData.data) {
    const amount = (price.unit_amount / 100).toFixed(2);
    const interval = price.recurring?.interval || 'one-time';
    console.log(`  ${price.id}`);
    console.log(`    Product: ${price.product}`);
    console.log(`    Amount: $${amount}/${interval}`);
    console.log(`    Active: ${price.active}`);
    console.log('');
  }

  // Check if $97 price already exists
  const existingPrice = pricesData.data.find(p => p.unit_amount === 9700 && p.recurring?.interval === 'month');

  if (existingPrice) {
    console.log(`✅ Found existing $97/month price: ${existingPrice.id}`);
    console.log('\n📝 To update your Cloudflare Worker, run:');
    console.log(`   cd /Users/ivanjackson/Desktop/Futurevision/tradvio-backend`);
    console.log(`   echo "${existingPrice.id}" | npx wrangler secret put STRIPE_PRICE_ID`);
    return;
  }

  // Find the product ID from an existing price
  const monthlyPrice = pricesData.data.find(p => p.recurring?.interval === 'month');

  if (!monthlyPrice) {
    console.error('❌ No monthly subscription price found. Please create a product in Stripe first.');
    process.exit(1);
  }

  const productId = monthlyPrice.product;
  console.log(`\n🏷️  Creating new $97/month price for product: ${productId}\n`);

  // Create new price at $97
  const createResponse = await fetch('https://api.stripe.com/v1/prices', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'unit_amount': '9700',
      'currency': 'usd',
      'recurring[interval]': 'month',
      'product': productId,
      'metadata[name]': 'Professional Monthly - $97',
    }).toString()
  });

  const newPrice = await createResponse.json();

  if (newPrice.error) {
    console.error('❌ Error creating price:', newPrice.error.message);
    process.exit(1);
  }

  console.log(`✅ Created new price: ${newPrice.id}`);
  console.log(`   Amount: $${(newPrice.unit_amount / 100).toFixed(2)}/${newPrice.recurring.interval}`);

  console.log('\n' + '═'.repeat(80));
  console.log('📝 NEXT STEPS:');
  console.log('═'.repeat(80));
  console.log('\n1. Update Cloudflare Worker secret:');
  console.log(`   cd /Users/ivanjackson/Desktop/Futurevision/tradvio-backend`);
  console.log(`   echo "${newPrice.id}" | npx wrangler secret put STRIPE_PRICE_ID`);
  console.log('\n2. (Optional) Deactivate the old $49.99 price in Stripe Dashboard');
  console.log('   https://dashboard.stripe.com/prices\n');
}

main().catch(console.error);
