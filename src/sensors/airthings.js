// Airthings View Plus Cloud API
// Get credentials at: https://dashboard.airthings.com/integrations/api-integration
import { reportApiError, reportApiSuccess } from '../notify.js';

const CLIENT_ID = process.env.AIRTHINGS_CLIENT_ID;
const CLIENT_SECRET = process.env.AIRTHINGS_CLIENT_SECRET;
const DEVICE_ID = process.env.AIRTHINGS_DEVICE_ID;

const TOKEN_URL = 'https://accounts-api.airthings.com/v1/token';
const API_BASE = 'https://ext-api.airthings.com/v1';

let accessToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: 'read:device:current_values'
    })
  });

  if (!response.ok) {
    throw new Error(`Token request failed: ${response.status}`);
  }

  const data = await response.json();
  accessToken = data.access_token;
  // Expire 5 minutes early to be safe
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

  return accessToken;
}

export async function getAirthingsReading() {
  if (!CLIENT_ID || !CLIENT_SECRET || !DEVICE_ID) {
    console.log('[Airthings] Missing credentials, skipping');
    return null;
  }

  try {
    const token = await getAccessToken();

    const response = await fetch(`${API_BASE}/devices/${DEVICE_ID}/latest-samples`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();

    // Response includes: temp, humidity, co2, pm25, voc, radonShortTermAvg, etc.
    const temp = data.data?.temp;
    const humidity = data.data?.humidity;
    const voc = data.data?.voc; // VOC in ppb
    const co2 = data.data?.co2;
    const pm25 = data.data?.pm25;
    const radon = data.data?.radonShortTermAvg;

    if (temp === undefined) {
      throw new Error('No temperature in response');
    }

    // Airthings returns Celsius, convert to Fahrenheit
    const tempF = (temp * 9/5) + 32;

    console.log(`[Airthings] ${tempF.toFixed(1)}°F, ${humidity?.toFixed(0)}% humidity, VOC: ${voc || '--'}ppb, CO2: ${co2 || '--'}ppm`);

    reportApiSuccess('airthings');

    return {
      source: 'airthings',
      temperature: tempF,
      humidity: humidity,
      voc: voc,
      co2: co2,
      pm25: pm25,
      radon: radon,
      raw: data
    };
  } catch (error) {
    console.error(`[Airthings] Error: ${error.message}`);
    reportApiError('airthings', error.message);
    return null;
  }
}
