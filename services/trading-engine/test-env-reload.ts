import dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Force reload .env after changes
const fs = require('fs');
const envPath = path.resolve(process.cwd(), '.env');
delete require.cache[require.resolve(envPath)];
const envContent = fs.readFileSync(envPath, 'utf-8');
envContent.split('\n').forEach(line => {
  const [key, ...values] = line.split('=');
  if (key && values.length) {
    process.env[key.trim()] = values.join('=').trim();
  }
});

console.log(' Environment reloaded');
console.log('SL_POI_BUFFER:', process.env.SL_POI_BUFFER);
