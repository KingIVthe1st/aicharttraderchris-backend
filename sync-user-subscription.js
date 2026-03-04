#!/usr/bin/env node
/**
 * Sync User Subscription from Stripe
 *
 * This script looks up a user by email in Stripe, finds their subscription,
 * and outputs the SQL to update their record in the database.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_xxx node sync-user-subscription.js EMAIL
 */

const Stripe = require("stripe");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const userEmail = process.argv[2];

if (!STRIPE_SECRET_KEY) {
  console.error("❌ Error: STRIPE_SECRET_KEY environment variable is required");
  process.exit(1);
}

if (!userEmail) {
  console.error("❌ Error: Email address required");
  console.log("\nUsage:");
  console.log(
    "  STRIPE_SECRET_KEY=sk_live_xxx node sync-user-subscription.js EMAIL",
  );
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

async function syncUserSubscription() {
  console.log(`\n🔍 Looking up customer: ${userEmail}\n`);

  try {
    // Find customer by email
    const customers = await stripe.customers.list({
      email: userEmail,
      limit: 1,
    });

    if (customers.data.length === 0) {
      console.error(`❌ No Stripe customer found for email: ${userEmail}`);
      process.exit(1);
    }

    const customer = customers.data[0];
    console.log("✅ Found customer:");
    console.log(`   ID: ${customer.id}`);
    console.log(`   Email: ${customer.email}`);
    console.log(
      `   Created: ${new Date(customer.created * 1000).toISOString()}`,
    );

    // Get subscriptions for this customer
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      limit: 10,
    });

    if (subscriptions.data.length === 0) {
      console.error(`\n❌ No subscriptions found for customer: ${customer.id}`);
      process.exit(1);
    }

    console.log(`\n📋 Found ${subscriptions.data.length} subscription(s):\n`);

    // Show all subscriptions
    for (const sub of subscriptions.data) {
      const price = sub.items.data[0]?.price;
      console.log(`   Subscription: ${sub.id}`);
      console.log(`   Status: ${sub.status}`);
      console.log(
        `   Current Period End: ${new Date(sub.current_period_end * 1000).toISOString()}`,
      );
      if (price) {
        console.log(`   Price ID: ${price.id}`);
        console.log(
          `   Amount: $${(price.unit_amount / 100).toFixed(2)}/${price.recurring?.interval || "one-time"}`,
        );
      }
      console.log("");
    }

    // Use the first active subscription (or most recent)
    const activeSubscription =
      subscriptions.data.find((s) => s.status === "active") ||
      subscriptions.data[0];

    console.log("\n═".repeat(60));
    console.log("📊 SUBSCRIPTION DETAILS TO SYNC");
    console.log("═".repeat(60));
    console.log(`Customer ID:        ${customer.id}`);
    console.log(`Subscription ID:    ${activeSubscription.id}`);
    console.log(`Status:             ${activeSubscription.status}`);
    console.log(
      `Period End:         ${activeSubscription.current_period_end} (Unix timestamp)`,
    );
    console.log(
      `Price ID:           ${activeSubscription.items.data[0]?.price?.id || "N/A"}`,
    );
    console.log("═".repeat(60));

    // Generate SQL update
    console.log("\n📝 SQL to update user:\n");
    console.log(`UPDATE users SET
  subscription_status = '${activeSubscription.status}',
  stripe_customer_id = '${customer.id}',
  stripe_subscription_id = '${activeSubscription.id}',
  subscription_end_date = ${activeSubscription.current_period_end},
  price_id = '${activeSubscription.items.data[0]?.price?.id || ""}',
  updated_at = unixepoch()
WHERE LOWER(email) = LOWER('${userEmail}');`);

    console.log(
      "\n✅ Run this SQL in your D1 database to sync the user's subscription.\n",
    );
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

syncUserSubscription();
