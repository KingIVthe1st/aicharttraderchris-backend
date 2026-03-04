const bcrypt = require('bcryptjs');

const password = 'Troy2024!Trader';

bcrypt.hash(password, 10, (err, hash) => {
  if (err) {
    console.error('Error:', err);
    process.exit(1);
  }
  console.log('Password hash:', hash);
  console.log('\nSQL command to update:');
  console.log(`UPDATE users SET password_hash = '${hash}' WHERE email = 'Troysolomon22@gmail.com';`);
  process.exit(0);
});
