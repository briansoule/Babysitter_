#!/usr/bin/env node
// Run this script to discover your Nest thermostat device ID
// Usage: node scripts/discover-nest.js

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env
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

const PROJECT_ID = process.env.NEST_PROJECT_ID;
const CLIENT_ID = process.env.NEST_CLIENT_ID;
const CLIENT_SECRET = process.env.NEST_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.NEST_REFRESH_TOKEN;

async function getAccessToken() {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function listDevices() {
  console.log('Getting access token...');
  const token = await getAccessToken();

  console.log('Fetching devices...\n');
  const response = await fetch(
    `https://smartdevicemanagement.googleapis.com/v1/enterprises/${PROJECT_ID}/devices`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed: ${response.status} - ${text}`);
  }

  const data = await response.json();

  if (!data.devices || data.devices.length === 0) {
    console.log('No devices found. Make sure you have linked your Nest account.');
    return;
  }

  console.log('Found devices:\n');

  for (const device of data.devices) {
    const deviceId = device.name.split('/').pop();
    const type = device.type;
    const traits = device.traits || {};

    console.log(`Device ID: ${deviceId}`);
    console.log(`Type: ${type}`);

    if (traits['sdm.devices.traits.Info']) {
      console.log(`Name: ${traits['sdm.devices.traits.Info'].customName || 'unnamed'}`);
    }

    if (type.includes('THERMOSTAT')) {
      console.log('\n*** This is your thermostat! ***');
      console.log(`Add this to your .env file:`);
      console.log(`NEST_DEVICE_ID=${deviceId}`);

      // Show current state
      if (traits['sdm.devices.traits.Temperature']) {
        const tempC = traits['sdm.devices.traits.Temperature'].ambientTemperatureCelsius;
        const tempF = (tempC * 9/5) + 32;
        console.log(`\nCurrent temperature: ${tempF.toFixed(1)}°F`);
      }

      if (traits['sdm.devices.traits.ThermostatMode']) {
        console.log(`Mode: ${traits['sdm.devices.traits.ThermostatMode'].mode}`);
      }

      if (traits['sdm.devices.traits.ThermostatHvac']) {
        console.log(`HVAC Status: ${traits['sdm.devices.traits.ThermostatHvac'].status}`);
      }
    }

    console.log('\n---\n');
  }
}

listDevices().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
