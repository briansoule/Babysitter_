// Awair Cloud API
// Get token from Awair app: Awair+ > Awair APIs > Cloud API > Get API Token
import { reportApiError, reportApiSuccess } from '../notify.js';

const AWAIR_TOKEN = process.env.AWAIR_TOKEN;
const AWAIR_DEVICE_TYPE = process.env.AWAIR_DEVICE_TYPE || 'awair-element';
const AWAIR_DEVICE_ID = process.env.AWAIR_DEVICE_ID;

const API_BASE = 'https://developer-apis.awair.is/v1';

export async function getAwairReading() {
  if (!AWAIR_TOKEN || !AWAIR_DEVICE_ID) {
    console.log('[Awair] Missing AWAIR_TOKEN or AWAIR_DEVICE_ID, skipping');
    return null;
  }

  try {
    const url = `${API_BASE}/users/self/devices/${AWAIR_DEVICE_TYPE}/${AWAIR_DEVICE_ID}/air-data/latest`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${AWAIR_TOKEN}`
      }
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();

    // Cloud API returns: { data: [{ timestamp, score, sensors: [...] }] }
    const latest = data.data?.[0];
    if (!latest) {
      throw new Error('No data in response');
    }

    let temp, humidity, voc, co2, pm25;

    if (latest.sensors) {
      const tempSensor = latest.sensors.find(s => s.comp === 'temp');
      const humidSensor = latest.sensors.find(s => s.comp === 'humid');
      const vocSensor = latest.sensors.find(s => s.comp === 'voc');
      const co2Sensor = latest.sensors.find(s => s.comp === 'co2');
      const pm25Sensor = latest.sensors.find(s => s.comp === 'pm25');
      temp = tempSensor?.value;
      humidity = humidSensor?.value;
      voc = vocSensor?.value; // VOC in ppb
      co2 = co2Sensor?.value;
      pm25 = pm25Sensor?.value;
    } else {
      temp = latest.temp;
      humidity = latest.humid;
      voc = latest.voc;
      co2 = latest.co2;
      pm25 = latest.pm25;
    }

    if (temp === undefined) {
      throw new Error('No temperature in response');
    }

    // Convert Celsius to Fahrenheit
    const tempF = (temp * 9/5) + 32;

    console.log(`[Awair] ${tempF.toFixed(1)}°F, ${humidity?.toFixed(0)}% humidity, VOC: ${voc || '--'}ppb, CO2: ${co2 || '--'}ppm`);

    reportApiSuccess('awair');

    return {
      source: 'awair',
      temperature: tempF,
      humidity: humidity,
      voc: voc,
      co2: co2,
      pm25: pm25,
      raw: data
    };
  } catch (error) {
    console.error(`[Awair] Error: ${error.message}`);
    reportApiError('awair', error.message);
    return null;
  }
}
