// Google Nest Smart Device Management API
// Setup: https://developers.google.com/nest/device-access/get-started
import { reportApiError, reportApiSuccess } from './notify.js';

const PROJECT_ID = process.env.NEST_PROJECT_ID;
const CLIENT_ID = process.env.NEST_CLIENT_ID;
const CLIENT_SECRET = process.env.NEST_CLIENT_SECRET;
const DEVICE_ID = process.env.NEST_DEVICE_ID;
let refreshToken = process.env.NEST_REFRESH_TOKEN;

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://smartdevicemanagement.googleapis.com/v1';

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
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${text}`);
  }

  const data = await response.json();
  accessToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

  return accessToken;
}

function devicePath() {
  return `enterprises/${PROJECT_ID}/devices/${DEVICE_ID}`;
}

export async function getThermostatState() {
  if (!PROJECT_ID || !DEVICE_ID || !refreshToken) {
    console.log('[Nest] Missing credentials, skipping');
    return null;
  }

  try {
    const token = await getAccessToken();

    const response = await fetch(`${API_BASE}/${devicePath()}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    const traits = data.traits || {};

    // Extract relevant traits
    const mode = traits['sdm.devices.traits.ThermostatMode']?.mode;
    const hvacStatus = traits['sdm.devices.traits.ThermostatHvac']?.status;
    const tempC = traits['sdm.devices.traits.Temperature']?.ambientTemperatureCelsius;
    const humidity = traits['sdm.devices.traits.Humidity']?.ambientHumidityPercent;
    const setpointHeat = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius;
    const setpointCool = traits['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius;

    // Fan status
    const fanTimerMode = traits['sdm.devices.traits.Fan']?.timerMode; // ON or OFF
    const fanTimerTimeout = traits['sdm.devices.traits.Fan']?.timerTimeout;
    const fanRunning = fanTimerMode === 'ON';

    const tempF = tempC ? (tempC * 9/5) + 32 : null;

    console.log(`[Nest] Mode: ${mode}, HVAC: ${hvacStatus}, Fan: ${fanRunning ? 'ON' : 'OFF'}, Temp: ${tempF?.toFixed(1)}°F`);

    reportApiSuccess('nest');

    return {
      mode,
      hvacStatus,
      temperature: tempF,
      humidity,
      setpointHeat: setpointHeat ? (setpointHeat * 9/5) + 32 : null,
      setpointCool: setpointCool ? (setpointCool * 9/5) + 32 : null,
      fanRunning,
      fanTimerTimeout,
      raw: data
    };
  } catch (error) {
    console.error(`[Nest] Error getting state: ${error.message}`);
    reportApiError('nest', error.message);
    return null;
  }
}

export async function setMode(mode) {
  // mode: HEAT, COOL, HEATCOOL, OFF
  if (!PROJECT_ID || !DEVICE_ID || !refreshToken) {
    console.log('[Nest] Missing credentials, cannot set mode');
    return false;
  }

  try {
    const token = await getAccessToken();

    const response = await fetch(`${API_BASE}/${devicePath()}:executeCommand`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        command: 'sdm.devices.commands.ThermostatMode.SetMode',
        params: { mode }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SetMode failed: ${response.status} - ${text}`);
    }

    console.log(`[Nest] Mode set to ${mode}`);
    return true;
  } catch (error) {
    console.error(`[Nest] Error setting mode: ${error.message}`);
    return false;
  }
}

export async function setHeatTemp(tempF) {
  // Temperature in Fahrenheit, will convert to Celsius for API
  const tempC = (tempF - 32) * 5/9;

  try {
    const token = await getAccessToken();

    const response = await fetch(`${API_BASE}/${devicePath()}:executeCommand`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        command: 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat',
        params: { heatCelsius: tempC }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SetHeat failed: ${response.status} - ${text}`);
    }

    console.log(`[Nest] Heat setpoint: ${tempF}°F`);
    return true;
  } catch (error) {
    console.error(`[Nest] Error setting heat temp: ${error.message}`);
    return false;
  }
}

export async function setCoolTemp(tempF) {
  const tempC = (tempF - 32) * 5/9;

  try {
    const token = await getAccessToken();

    const response = await fetch(`${API_BASE}/${devicePath()}:executeCommand`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        command: 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool',
        params: { coolCelsius: tempC }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SetCool failed: ${response.status} - ${text}`);
    }

    console.log(`[Nest] Cool setpoint: ${tempF}°F`);
    return true;
  } catch (error) {
    console.error(`[Nest] Error setting cool temp: ${error.message}`);
    return false;
  }
}

// Set fan timer (max 43200 seconds = 12 hours)
export async function setFanTimer(durationSeconds = 43200) {
  if (!PROJECT_ID || !DEVICE_ID || !refreshToken) {
    console.log('[Nest] Missing credentials, cannot set fan timer');
    return false;
  }

  try {
    const token = await getAccessToken();

    const response = await fetch(`${API_BASE}/${devicePath()}:executeCommand`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        command: 'sdm.devices.commands.Fan.SetTimer',
        params: {
          timerMode: 'ON',
          duration: `${durationSeconds}s`
        }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SetFanTimer failed: ${response.status} - ${text}`);
    }

    console.log(`[Nest] Fan timer set for ${durationSeconds} seconds`);
    return true;
  } catch (error) {
    console.error(`[Nest] Error setting fan timer: ${error.message}`);
    return false;
  }
}

// Helper to check if Nest is configured
export function isConfigured() {
  return !!(PROJECT_ID && DEVICE_ID && refreshToken);
}
