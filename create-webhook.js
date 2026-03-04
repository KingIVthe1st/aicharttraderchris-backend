// Temporary script to create Stripe webhook endpoint
const https = require('https');

// Get Stripe secret key from environment or command line
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || process.argv[2];

if (!STRIPE_SECRET_KEY) {
  console.error('❌ Error: STRIPE_SECRET_KEY environment variable not set');
  console.error('Usage: STRIPE_SECRET_KEY=sk_xxx node create-webhook.js');
  process.exit(1);
}

const webhookData = JSON.stringify({
  url: 'https://tradvio-backend.ivanleejackson.workers.dev/api/stripe/webhook',
  enabled_events: [
    'checkout.session.completed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_succeeded',
    'invoice.payment_failed'
  ],
  api_version: '2024-11-20.acacia',
  description: 'Tradvio subscription lifecycle events'
});

const options = {
  hostname: 'api.stripe.com',
  port: 443,
  path: '/v1/webhook_endpoints',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': Buffer.byteLength(new URLSearchParams({
      url: 'https://tradvio-backend.ivanleejackson.workers.dev/api/stripe/webhook',
      'enabled_events[]': 'checkout.session.completed',
      api_version: '2024-11-20.acacia',
      description: 'Tradvio subscription lifecycle events'
    }).toString())
  }
};

// Convert to form data
const formData = new URLSearchParams({
  url: 'https://tradvio-backend.ivanleejackson.workers.dev/api/stripe/webhook',
  api_version: '2024-11-20.acacia',
  description: 'Tradvio subscription lifecycle events'
});

// Add array fields
formData.append('enabled_events[]', 'checkout.session.completed');
formData.append('enabled_events[]', 'customer.subscription.updated');
formData.append('enabled_events[]', 'customer.subscription.deleted');
formData.append('enabled_events[]', 'invoice.payment_succeeded');
formData.append('enabled_events[]', 'invoice.payment_failed');

const postData = formData.toString();

options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
options.headers['Content-Length'] = Buffer.byteLength(postData);

console.log('🔄 Creating webhook endpoint...');
console.log('📍 URL: https://tradvio-backend.ivanleejackson.workers.dev/api/stripe/webhook');
console.log('📋 Events:', [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
  'invoice.payment_failed'
]);
console.log('');

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const response = JSON.parse(data);

      if (res.statusCode === 200 || res.statusCode === 201) {
        console.log('✅ Webhook endpoint created successfully!');
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔐 WEBHOOK SIGNING SECRET (save this!):');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(response.secret);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('📝 Webhook ID:', response.id);
        console.log('📍 Endpoint URL:', response.url);
        console.log('✓ Status:', response.status);
        console.log('');
        console.log('Next step: Run this command to set the webhook secret:');
        console.log(`  wrangler secret put STRIPE_WEBHOOK_SECRET`);
        console.log('');
        console.log('When prompted, paste the webhook signing secret shown above.');
      } else {
        console.error('❌ Error creating webhook endpoint:');
        console.error('Status:', res.statusCode);
        console.error('Response:', JSON.stringify(response, null, 2));

        if (response.error?.code === 'url_invalid') {
          console.error('');
          console.error('💡 The webhook URL might already exist or is invalid.');
          console.error('   Check your Stripe dashboard: https://dashboard.stripe.com/webhooks');
        }
      }
    } catch (error) {
      console.error('❌ Error parsing response:', error.message);
      console.error('Raw response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('❌ Request failed:', error.message);
  process.exit(1);
});

req.write(postData);
req.end();
