// Load .env file manually (no dotenv dependency)
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');

if (existsSync(envPath)) {
  const envFile = readFileSync(envPath, 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  }
}

export const config = {
  targetTemp: parseFloat(process.env.TARGET_TEMP) || 70,
  threshold: parseFloat(process.env.THRESHOLD) || 1.5,
  pollInterval: (parseInt(process.env.POLL_INTERVAL) || 60) * 1000,
  port: parseInt(process.env.PORT) || 3000,

  awair: {
    host: process.env.AWAIR_HOST
  },

  airthings: {
    clientId: process.env.AIRTHINGS_CLIENT_ID,
    clientSecret: process.env.AIRTHINGS_CLIENT_SECRET,
    deviceId: process.env.AIRTHINGS_DEVICE_ID
  },

  nest: {
    projectId: process.env.NEST_PROJECT_ID,
    clientId: process.env.NEST_CLIENT_ID,
    clientSecret: process.env.NEST_CLIENT_SECRET,
    refreshToken: process.env.NEST_REFRESH_TOKEN,
    deviceId: process.env.NEST_DEVICE_ID
  }
};
