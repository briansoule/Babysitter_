// Thermostat Babysitter - Main Entry Point
// Zero dependencies - uses only Node.js built-in modules
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env file FIRST, before other imports
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');

if (existsSync(envPath)) {
  const envFile = readFileSync(envPath, 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      process.env[key] = value;
    }
  }
}

// Now import modules that depend on env vars
const { getAwairReading } = await import('./sensors/awair.js');
const { getAirthingsReading } = await import('./sensors/airthings.js');
const { evaluateAndControl } = await import('./controller.js');
const { handleRequest, broadcast } = await import('./dashboard.js');
const { pingHealthcheck } = await import('./notify.js');

const PORT = parseInt(process.env.PORT) || 3000;
const POLL_INTERVAL = (parseInt(process.env.POLL_INTERVAL) || 60) * 1000;

async function pollSensors() {
  console.log('\n--- Polling sensors ---');

  // Fetch from both sensors in parallel
  const [awair, airthings] = await Promise.all([
    getAwairReading(),
    getAirthingsReading()
  ]);

  // Evaluate and control thermostat
  await evaluateAndControl([awair, airthings]);

  // Broadcast updates to all connected clients
  broadcast();

  // Ping healthcheck (external dead man's switch)
  await pingHealthcheck();
}

// Create HTTP server
const server = createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`\n🌡️  Thermostat Babysitter`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  console.log(`   Polling every ${POLL_INTERVAL / 1000} seconds`);
  console.log(`   Awair host: ${process.env.AWAIR_HOST || 'not configured'}`);
  console.log(`   Airthings device: ${process.env.AIRTHINGS_DEVICE_ID || 'not configured'}\n`);

  // Initial poll
  pollSensors();

  // Set up recurring poll
  setInterval(pollSensors, POLL_INTERVAL);
});
