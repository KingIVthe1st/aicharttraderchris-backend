const crypto = require('crypto');

// Hash password using SHA-256 (same as backend)
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Generate user ID
const userId = `user_${crypto.randomBytes(16).toString('hex')}`;
const email = 'ndburton@me.com';
const name = 'Dana Burton';
const password = 'Dana4545!';
const passwordHash = hashPassword(password);

// Calculate 10 years from now in Unix timestamp
const tenYearsFromNow = Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60);

// Generate Stripe IDs for prepaid subscription
const stripeCustomerId = `cus_prepaid_${Date.now()}`;
const stripeSubId = `sub_prepaid_10yr_${Date.now()}`;

// Create SQL statement
const sql = `INSERT INTO users (
  id,
  email,
  name,
  password_hash,
  role,
  subscription_status,
  stripe_customer_id,
  stripe_subscription_id,
  subscription_end_date
) VALUES (
  '${userId}',
  '${email}',
  '${name}',
  '${passwordHash}',
  'user',
  'active',
  '${stripeCustomerId}',
  '${stripeSubId}',
  ${tenYearsFromNow}
);`;

console.log('='.repeat(60));
console.log('USER DETAILS:');
console.log('='.repeat(60));
console.log('User ID:', userId);
console.log('Email:', email);
console.log('Name:', name);
console.log('Password:', password);
console.log('Password Hash:', passwordHash);
console.log('Subscription Status: active');
console.log('Subscription End Date:', new Date(tenYearsFromNow * 1000).toLocaleDateString());
console.log('Stripe Customer ID:', stripeCustomerId);
console.log('Stripe Subscription ID:', stripeSubId);
console.log('\n' + '='.repeat(60));
console.log('SQL TO EXECUTE:');
console.log('='.repeat(60));
console.log(sql);
console.log('\n' + '='.repeat(60));
console.log('WRANGLER COMMAND:');
console.log('='.repeat(60));
console.log(`wrangler d1 execute tradvio-db --command "${sql.replace(/"/g, '\\"')}"`);
