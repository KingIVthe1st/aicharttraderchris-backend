#!/usr/bin/env node
/**
 * Create VIP20 Coupon for AI Chart Trader
 *
 * This script creates a $77 off coupon that brings $97 → $20
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_xxx node create-vip20-coupon.js
 *
 * Or get key from wrangler:
 *   npx wrangler secret list
 */

const Stripe = require("stripe");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

if (!STRIPE_SECRET_KEY) {
  console.error("❌ Error: STRIPE_SECRET_KEY environment variable is required");
  console.log("\nUsage:");
  console.log("  STRIPE_SECRET_KEY=sk_live_xxx node create-vip20-coupon.js");
  console.log("\nTo get your key, check:");
  console.log("  - Stripe Dashboard → Developers → API keys");
  console.log(
    "  - Or: npx wrangler secret list (shows secret names, not values)",
  );
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

async function createVIP20Coupon() {
  console.log("🎫 Creating VIP20 coupon for AI Chart Trader...\n");

  try {
    // Step 1: Create the coupon ($77 off to bring $97 → $20)
    console.log("1️⃣  Creating coupon...");
    const coupon = await stripe.coupons.create({
      id: "VIP20_DISCOUNT",
      name: "VIP20 - Special $20 Pricing",
      amount_off: 7700, // $77 in cents
      currency: "usd",
      duration: "forever", // Applies to all future invoices
      metadata: {
        description: "Brings Professional Access from $97 to $20/month",
        created_by: "create-vip20-coupon.js",
      },
    });
    console.log(`   ✅ Coupon created: ${coupon.id}`);
    console.log(`   💰 Discount: $${coupon.amount_off / 100} off`);

    // Step 2: Create the promotion code (what users enter)
    console.log('\n2️⃣  Creating promotion code "VIP20"...');
    const promoCode = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: "VIP20",
      active: true,
      metadata: {
        description: "Public promo code for VIP pricing",
      },
    });
    console.log(`   ✅ Promotion code created: ${promoCode.code}`);
    console.log(`   🔗 ID: ${promoCode.id}`);

    // Summary
    console.log("\n" + "═".repeat(50));
    console.log("🎉 SUCCESS! Coupon created successfully!\n");
    console.log("📋 Summary:");
    console.log(`   Coupon ID:     ${coupon.id}`);
    console.log(`   Promo Code:    ${promoCode.code}`);
    console.log(`   Discount:      $77 off (${coupon.duration})`);
    console.log(`   Final Price:   $97 → $20/month`);
    console.log("═".repeat(50));
    console.log('\n✨ Users can now enter "VIP20" at checkout!\n');
  } catch (error) {
    if (error.code === "resource_already_exists") {
      console.log("⚠️  Coupon or promo code already exists!");
      console.log(
        "   To recreate, first delete the existing one in Stripe Dashboard.",
      );
    } else {
      console.error("❌ Error:", error.message);
    }
    process.exit(1);
  }
}

createVIP20Coupon();
