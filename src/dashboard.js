// Minimal HTML dashboard (zero dependencies - uses Node's built-in http)
import * as db from './db.js';
import { getTargetTemp, setTargetTemp, setFanAlwaysOn, getFanAlwaysOn } from './controller.js';
import { setFanTimer } from './nest.js';

// SSE clients
const clients = new Set();

// Broadcast state to all connected clients
export function broadcast() {
  const data = JSON.stringify({
    state: db.getCurrentState(),
    readings: db.getReadings(20),
    actions: db.getActions(10),
    fanAlwaysOn: getFanAlwaysOn()
  });
  for (const client of clients) {
    client.write(`data: ${data}\n\n`);
  }
}

function formatLocalTime(isoString) {
  return new Date(isoString).toLocaleString();
}

function renderReadingsRows(readings) {
  return readings.map(r => `
    <tr>
      <td>${formatLocalTime(r.timestamp)}</td>
      <td>${r.source}</td>
      <td>${r.temperature?.toFixed(1)}&deg;F</td>
      <td>${r.humidity?.toFixed(0) || '--'}%</td>
      <td>${r.source === 'nest' ? (r.hvacStatus || 'OFF') : '--'}</td>
      <td>${r.voc ?? '--'}</td>
      <td>${r.co2 ?? '--'}</td>
      <td>${r.pm25 ?? '--'}</td>
    </tr>
  `).join('');
}

function renderActionsRows(actions) {
  return actions.map(a => `
    <tr>
      <td>${formatLocalTime(a.timestamp)}</td>
      <td class="${a.action.includes('HEAT') ? 'heat' : a.action.includes('COOL') ? 'cool' : 'ok'}">${a.action}</td>
      <td>${a.avg_temp?.toFixed(1)}&deg;F</td>
      <td>${a.reason}</td>
    </tr>
  `).join('');
}

function renderChartsPage() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Thermostat Babysitter - Charts</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
  <style>
    body { font-family: monospace; padding: 20px; max-width: 1200px; margin: 0 auto; background: #f5f5f5; }
    h1 { margin-bottom: 5px; }
    .nav { margin-bottom: 20px; }
    .nav a { margin-right: 15px; }
    .chart-container { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    canvas { width: 100% !important; }
    .controls { margin-bottom: 20px; }
    .controls select { padding: 5px 10px; font-family: monospace; }
    .loading { text-align: center; padding: 40px; color: #666; }
  </style>
</head>
<body>
  <h1>Thermostat Babysitter - Charts</h1>
  <div class="nav">
    <a href="/">&lt;- Dashboard</a>
    <a href="/charts/unified">Unified View</a>
  </div>

  <div class="controls">
    <label>Time Range:
      <select id="timeRange" onchange="loadData()">
        <option value="6">Last 6 hours</option>
        <option value="12">Last 12 hours</option>
        <option value="24" selected>Last 24 hours</option>
        <option value="48">Last 48 hours</option>
        <option value="168">Last 7 days</option>
      </select>
    </label>
  </div>

  <div class="chart-container">
    <h3>Temperature (&deg;F)</h3>
    <canvas id="tempChart"></canvas>
  </div>

  <div class="chart-container">
    <h3>VOC (ppb)</h3>
    <canvas id="vocChart"></canvas>
  </div>

  <div class="chart-container">
    <h3>CO2 (ppm)</h3>
    <canvas id="co2Chart"></canvas>
  </div>

  <div class="chart-container">
    <h3>HVAC Status (from Nest)</h3>
    <canvas id="hvacChart"></canvas>
    <div style="font-size: 12px; margin-top: 10px; color: #666;">
      <span style="color: #c00;">Red = Heating</span> |
      <span style="color: #00c;">Blue = Cooling</span> |
      <span style="color: #0a0;">Green = Fan</span> |
      <span style="color: #999;">Gray = Off</span>
    </div>
  </div>

  <script>
    let tempChart, vocChart, co2Chart, hvacChart;

    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: {
          type: 'time',
          time: { displayFormats: { hour: 'MMM d, ha' } },
          title: { display: false }
        }
      },
      plugins: {
        legend: { position: 'top' }
      }
    };

    function createHvacPlugin() {
      return {
        id: 'hvacShading',
        beforeDraw: (chart) => {
          if (!chart.hvacData) return;
          const ctx = chart.ctx;
          const xScale = chart.scales.x;
          const yScale = chart.scales.y;

          chart.hvacData.forEach(period => {
            if (!period.start || !period.end) return;
            const x1 = xScale.getPixelForValue(new Date(period.start));
            const x2 = xScale.getPixelForValue(new Date(period.end));

            ctx.save();
            ctx.fillStyle = period.type === 'HEAT' ? 'rgba(255, 100, 100, 0.15)' :
                           period.type === 'COOL' ? 'rgba(100, 100, 255, 0.15)' :
                           'rgba(200, 200, 200, 0.1)';
            ctx.fillRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top);
            ctx.restore();
          });
        }
      };
    }

    function createFanPlugin() {
      return {
        id: 'fanShading',
        beforeDraw: (chart) => {
          if (!chart.fanData) return;
          const ctx = chart.ctx;
          const xScale = chart.scales.x;
          const yScale = chart.scales.y;

          chart.fanData.forEach(period => {
            if (!period.start || !period.end) return;
            const x1 = xScale.getPixelForValue(new Date(period.start));
            const x2 = xScale.getPixelForValue(new Date(period.end));

            ctx.save();
            ctx.fillStyle = 'rgba(100, 200, 100, 0.1)';
            ctx.strokeStyle = 'rgba(100, 200, 100, 0.3)';
            ctx.setLineDash([2, 2]);
            ctx.fillRect(x1, yScale.bottom - 20, x2 - x1, 20);
            ctx.strokeRect(x1, yScale.bottom - 20, x2 - x1, 20);
            ctx.restore();
          });
        }
      };
    }

    function processData(readings, actions) {
      // Separate by source
      const airthings = readings.filter(r => r.source === 'airthings').reverse();
      const awair = readings.filter(r => r.source === 'awair').reverse();
      const nestReadings = readings.filter(r => r.source === 'nest').sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // Process HVAC periods from Nest readings (actual hvacStatus)
      const hvacPeriods = [];
      let currentHvacPeriod = null;

      nestReadings.forEach(r => {
        const status = r.hvacStatus; // HEATING, COOLING, or OFF
        const type = status === 'HEATING' ? 'HEAT' : status === 'COOLING' ? 'COOL' : null;

        if (type && !currentHvacPeriod) {
          currentHvacPeriod = { type, start: r.timestamp };
        } else if (!type && currentHvacPeriod) {
          currentHvacPeriod.end = r.timestamp;
          hvacPeriods.push(currentHvacPeriod);
          currentHvacPeriod = null;
        } else if (type && currentHvacPeriod && type !== currentHvacPeriod.type) {
          currentHvacPeriod.end = r.timestamp;
          hvacPeriods.push(currentHvacPeriod);
          currentHvacPeriod = { type, start: r.timestamp };
        }
      });

      if (currentHvacPeriod) {
        currentHvacPeriod.end = new Date().toISOString();
        hvacPeriods.push(currentHvacPeriod);
      }

      // Process fan periods from Nest readings
      const fanPeriods = [];
      let currentFanPeriod = null;

      nestReadings.forEach(r => {
        const fanOn = r.fanRunning;

        if (fanOn && !currentFanPeriod) {
          currentFanPeriod = { start: r.timestamp };
        } else if (!fanOn && currentFanPeriod) {
          currentFanPeriod.end = r.timestamp;
          fanPeriods.push(currentFanPeriod);
          currentFanPeriod = null;
        }
      });

      if (currentFanPeriod) {
        currentFanPeriod.end = new Date().toISOString();
        fanPeriods.push(currentFanPeriod);
      }

      // Create HVAC status data points for the chart
      // Values: 2 = Heating, 1 = Cooling, 0.5 = Fan only, 0 = Off
      const hvacStatusData = nestReadings.map(r => {
        let value = 0;
        if (r.hvacStatus === 'HEATING') value = 2;
        else if (r.hvacStatus === 'COOLING') value = 1;
        else if (r.fanRunning) value = 0.5;
        return { x: new Date(r.timestamp), y: value, status: r.hvacStatus, fan: r.fanRunning };
      });

      return {
        airthings: {
          temp: airthings.map(r => ({ x: new Date(r.timestamp), y: r.temperature })),
          voc: airthings.map(r => ({ x: new Date(r.timestamp), y: r.voc })),
          co2: airthings.map(r => ({ x: new Date(r.timestamp), y: r.co2 }))
        },
        awair: {
          temp: awair.map(r => ({ x: new Date(r.timestamp), y: r.temperature })),
          voc: awair.map(r => ({ x: new Date(r.timestamp), y: r.voc })),
          co2: awair.map(r => ({ x: new Date(r.timestamp), y: r.co2 }))
        },
        hvacPeriods,
        fanPeriods,
        hvacStatusData
      };
    }

    function initCharts(data) {
      const hvacPlugin = createHvacPlugin();
      const fanPlugin = createFanPlugin();

      // Temperature chart
      const tempCtx = document.getElementById('tempChart').getContext('2d');
      tempChart = new Chart(tempCtx, {
        type: 'line',
        data: {
          datasets: [
            { label: 'Airthings', data: data.airthings.temp, borderColor: '#e74c3c', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0 },
            { label: 'Awair', data: data.awair.temp, borderColor: '#3498db', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0 }
          ]
        },
        options: { ...commonOptions, plugins: { ...commonOptions.plugins } },
        plugins: [hvacPlugin, fanPlugin]
      });
      tempChart.canvas.parentNode.style.height = '300px';
      tempChart.hvacData = data.hvacPeriods;
      tempChart.fanData = data.fanPeriods;

      // VOC chart
      const vocCtx = document.getElementById('vocChart').getContext('2d');
      vocChart = new Chart(vocCtx, {
        type: 'line',
        data: {
          datasets: [
            { label: 'Airthings', data: data.airthings.voc, borderColor: '#e74c3c', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0 },
            { label: 'Awair', data: data.awair.voc, borderColor: '#3498db', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0 }
          ]
        },
        options: { ...commonOptions, plugins: { ...commonOptions.plugins } },
        plugins: [hvacPlugin, fanPlugin]
      });
      vocChart.canvas.parentNode.style.height = '250px';
      vocChart.hvacData = data.hvacPeriods;
      vocChart.fanData = data.fanPeriods;

      // CO2 chart
      const co2Ctx = document.getElementById('co2Chart').getContext('2d');
      co2Chart = new Chart(co2Ctx, {
        type: 'line',
        data: {
          datasets: [
            { label: 'Airthings', data: data.airthings.co2, borderColor: '#e74c3c', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0 },
            { label: 'Awair', data: data.awair.co2, borderColor: '#3498db', backgroundColor: 'transparent', borderWidth: 2, pointRadius: 0 }
          ]
        },
        options: { ...commonOptions, plugins: { ...commonOptions.plugins } },
        plugins: [hvacPlugin, fanPlugin]
      });
      co2Chart.canvas.parentNode.style.height = '250px';
      co2Chart.hvacData = data.hvacPeriods;
      co2Chart.fanData = data.fanPeriods;

      // HVAC Status chart
      const hvacCtx = document.getElementById('hvacChart').getContext('2d');
      hvacChart = new Chart(hvacCtx, {
        type: 'line',
        data: {
          datasets: [{
            label: 'HVAC Status',
            data: data.hvacStatusData,
            borderWidth: 0,
            pointRadius: 0,
            fill: true,
            stepped: true,
            segment: {
              backgroundColor: ctx => {
                const value = ctx.p0.parsed.y;
                if (value >= 2) return 'rgba(200, 0, 0, 0.6)';      // Heating
                if (value >= 1) return 'rgba(0, 0, 200, 0.6)';      // Cooling
                if (value >= 0.5) return 'rgba(0, 180, 0, 0.6)';    // Fan only
                return 'rgba(180, 180, 180, 0.3)';                   // Off
              }
            }
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          scales: {
            x: {
              type: 'time',
              time: { displayFormats: { hour: 'MMM d, ha' } }
            },
            y: {
              min: 0,
              max: 2.5,
              ticks: {
                stepSize: 0.5,
                callback: function(value) {
                  if (value === 2) return 'Heating';
                  if (value === 1) return 'Cooling';
                  if (value === 0.5) return 'Fan';
                  if (value === 0) return 'Off';
                  return '';
                }
              }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const point = context.raw;
                  let status = point.status || 'OFF';
                  if (point.fan && status === 'OFF') status = 'Fan Only';
                  return 'Status: ' + status;
                }
              }
            }
          }
        }
      });
      hvacChart.canvas.parentNode.style.height = '150px';
    }

    function updateCharts(data) {
      tempChart.data.datasets[0].data = data.airthings.temp;
      tempChart.data.datasets[1].data = data.awair.temp;
      tempChart.hvacData = data.hvacPeriods;
      tempChart.fanData = data.fanPeriods;
      tempChart.update();

      vocChart.data.datasets[0].data = data.airthings.voc;
      vocChart.data.datasets[1].data = data.awair.voc;
      vocChart.hvacData = data.hvacPeriods;
      vocChart.fanData = data.fanPeriods;
      vocChart.update();

      co2Chart.data.datasets[0].data = data.airthings.co2;
      co2Chart.data.datasets[1].data = data.awair.co2;
      co2Chart.hvacData = data.hvacPeriods;
      co2Chart.fanData = data.fanPeriods;
      co2Chart.update();

      hvacChart.data.datasets[0].data = data.hvacStatusData;
      hvacChart.update();
    }

    async function loadData() {
      const hours = document.getElementById('timeRange').value;
      try {
        const res = await fetch('/api/chart-data?hours=' + hours);
        const json = await res.json();
        const data = processData(json.readings, json.actions);

        if (!tempChart) {
          initCharts(data);
        } else {
          updateCharts(data);
        }
      } catch (e) {
        console.error('Failed to load chart data:', e);
      }
    }

    // Initial load
    loadData();

    // Auto-refresh every 60 seconds
    setInterval(loadData, 60000);
  </script>
</body>
</html>`;
}

function renderCombinedChartsPage() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Thermostat Babysitter - Combined Charts</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
  <style>
    body { font-family: monospace; padding: 20px; max-width: 1200px; margin: 0 auto; background: #f5f5f5; }
    h1 { margin-bottom: 5px; }
    .nav { margin-bottom: 20px; }
    .nav a { margin-right: 15px; }
    .chart-container { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    canvas { width: 100% !important; }
    .controls { margin-bottom: 20px; }
    .controls select { padding: 5px 10px; font-family: monospace; }
    .legend { display: flex; gap: 20px; margin-top: 10px; font-size: 12px; }
    .legend-item { display: flex; align-items: center; gap: 5px; }
    .legend-box { width: 20px; height: 12px; }
    .heat-box { background: rgba(255, 100, 100, 0.3); border: 1px solid rgba(255, 100, 100, 0.5); }
    .cool-box { background: rgba(100, 100, 255, 0.3); border: 1px solid rgba(100, 100, 255, 0.5); }
    .fan-box { background: rgba(100, 200, 100, 0.3); border: 1px dashed rgba(100, 200, 100, 0.5); }
  </style>
</head>
<body>
  <h1>Thermostat Babysitter - Combined View</h1>
  <div class="nav">
    <a href="/">&lt;- Dashboard</a>
    <a href="/charts">Individual Sensors</a>
  </div>

  <div class="controls">
    <label>Time Range:
      <select id="timeRange" onchange="loadData()">
        <option value="6">Last 6 hours</option>
        <option value="12">Last 12 hours</option>
        <option value="24" selected>Last 24 hours</option>
        <option value="48">Last 48 hours</option>
        <option value="168">Last 7 days</option>
      </select>
    </label>
  </div>

  <div class="chart-container">
    <h3>Average Temperature (&deg;F)</h3>
    <canvas id="tempChart"></canvas>
    <div class="legend">
      <div class="legend-item"><div class="legend-box heat-box"></div> Heating</div>
      <div class="legend-item"><div class="legend-box cool-box"></div> Cooling</div>
      <div class="legend-item"><div class="legend-box fan-box"></div> Fan On</div>
    </div>
  </div>

  <div class="chart-container">
    <h3>Average Humidity (%)</h3>
    <canvas id="humidityChart"></canvas>
  </div>

  <div class="chart-container">
    <h3>Average VOC (ppb)</h3>
    <canvas id="vocChart"></canvas>
  </div>

  <div class="chart-container">
    <h3>Average CO2 (ppm)</h3>
    <canvas id="co2Chart"></canvas>
  </div>

  <script>
    let tempChart, humidityChart, vocChart, co2Chart;

    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: {
          type: 'time',
          time: { displayFormats: { hour: 'MMM d, ha' } },
          title: { display: false }
        }
      },
      plugins: {
        legend: { display: false }
      }
    };

    function createHvacPlugin() {
      return {
        id: 'hvacShading',
        beforeDraw: (chart) => {
          if (!chart.hvacData) return;
          const ctx = chart.ctx;
          const xScale = chart.scales.x;
          const yScale = chart.scales.y;

          chart.hvacData.forEach(period => {
            if (!period.start || !period.end) return;
            const x1 = xScale.getPixelForValue(new Date(period.start));
            const x2 = xScale.getPixelForValue(new Date(period.end));

            ctx.save();
            ctx.fillStyle = period.type === 'HEAT' ? 'rgba(255, 100, 100, 0.2)' :
                           period.type === 'COOL' ? 'rgba(100, 100, 255, 0.2)' :
                           'rgba(200, 200, 200, 0.1)';
            ctx.fillRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top);
            ctx.restore();
          });
        }
      };
    }

    function createFanPlugin() {
      return {
        id: 'fanShading',
        beforeDraw: (chart) => {
          if (!chart.fanData) return;
          const ctx = chart.ctx;
          const xScale = chart.scales.x;
          const yScale = chart.scales.y;

          chart.fanData.forEach(period => {
            if (!period.start || !period.end) return;
            const x1 = xScale.getPixelForValue(new Date(period.start));
            const x2 = xScale.getPixelForValue(new Date(period.end));

            ctx.save();
            ctx.fillStyle = 'rgba(100, 200, 100, 0.15)';
            ctx.strokeStyle = 'rgba(100, 200, 100, 0.4)';
            ctx.setLineDash([4, 4]);
            ctx.fillRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top);
            ctx.strokeRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top);
            ctx.restore();
          });
        }
      };
    }

    function processData(readings, actions) {
      // Filter sensor readings (exclude nest for averaging)
      const sensorReadings = readings.filter(r => r.source !== 'nest');
      const nestReadings = readings.filter(r => r.source === 'nest').sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // Group readings by approximate timestamp (within 5 seconds)
      const grouped = {};

      sensorReadings.forEach(r => {
        // Round to nearest minute for grouping
        const ts = new Date(r.timestamp);
        ts.setSeconds(0, 0);
        const key = ts.toISOString();

        if (!grouped[key]) {
          grouped[key] = { timestamp: key, temps: [], humidities: [], vocs: [], co2s: [] };
        }

        if (r.temperature != null) grouped[key].temps.push(r.temperature);
        if (r.humidity != null) grouped[key].humidities.push(r.humidity);
        if (r.voc != null) grouped[key].vocs.push(r.voc);
        if (r.co2 != null) grouped[key].co2s.push(r.co2);
      });

      // Calculate averages
      const averaged = Object.values(grouped)
        .map(g => ({
          timestamp: g.timestamp,
          temp: g.temps.length ? g.temps.reduce((a, b) => a + b, 0) / g.temps.length : null,
          humidity: g.humidities.length ? g.humidities.reduce((a, b) => a + b, 0) / g.humidities.length : null,
          voc: g.vocs.length ? g.vocs.reduce((a, b) => a + b, 0) / g.vocs.length : null,
          co2: g.co2s.length ? g.co2s.reduce((a, b) => a + b, 0) / g.co2s.length : null
        }))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // Process HVAC periods from Nest readings
      const hvacPeriods = [];
      let currentHvacPeriod = null;

      nestReadings.forEach(r => {
        const status = r.hvacStatus;
        const type = status === 'HEATING' ? 'HEAT' : status === 'COOLING' ? 'COOL' : null;

        if (type && !currentHvacPeriod) {
          currentHvacPeriod = { type, start: r.timestamp };
        } else if (!type && currentHvacPeriod) {
          currentHvacPeriod.end = r.timestamp;
          hvacPeriods.push(currentHvacPeriod);
          currentHvacPeriod = null;
        } else if (type && currentHvacPeriod && type !== currentHvacPeriod.type) {
          currentHvacPeriod.end = r.timestamp;
          hvacPeriods.push(currentHvacPeriod);
          currentHvacPeriod = { type, start: r.timestamp };
        }
      });

      if (currentHvacPeriod) {
        currentHvacPeriod.end = new Date().toISOString();
        hvacPeriods.push(currentHvacPeriod);
      }

      // Process fan periods from Nest readings
      const fanPeriods = [];
      let currentFanPeriod = null;

      nestReadings.forEach(r => {
        const fanOn = r.fanRunning;

        if (fanOn && !currentFanPeriod) {
          currentFanPeriod = { start: r.timestamp };
        } else if (!fanOn && currentFanPeriod) {
          currentFanPeriod.end = r.timestamp;
          fanPeriods.push(currentFanPeriod);
          currentFanPeriod = null;
        }
      });

      if (currentFanPeriod) {
        currentFanPeriod.end = new Date().toISOString();
        fanPeriods.push(currentFanPeriod);
      }

      return {
        temp: averaged.map(r => ({ x: new Date(r.timestamp), y: r.temp })).filter(r => r.y != null),
        humidity: averaged.map(r => ({ x: new Date(r.timestamp), y: r.humidity })).filter(r => r.y != null),
        voc: averaged.map(r => ({ x: new Date(r.timestamp), y: r.voc })).filter(r => r.y != null),
        co2: averaged.map(r => ({ x: new Date(r.timestamp), y: r.co2 })).filter(r => r.y != null),
        hvacPeriods,
        fanPeriods
      };
    }

    function initCharts(data) {
      const hvacPlugin = createHvacPlugin();
      const fanPlugin = createFanPlugin();

      // Temperature chart
      const tempCtx = document.getElementById('tempChart').getContext('2d');
      tempChart = new Chart(tempCtx, {
        type: 'line',
        data: {
          datasets: [
            { label: 'Avg Temperature', data: data.temp, borderColor: '#9b59b6', backgroundColor: 'rgba(155, 89, 182, 0.1)', borderWidth: 2, pointRadius: 0, fill: true }
          ]
        },
        options: { ...commonOptions },
        plugins: [hvacPlugin, fanPlugin]
      });
      tempChart.canvas.parentNode.style.height = '300px';
      tempChart.hvacData = data.hvacPeriods;
      tempChart.fanData = data.fanPeriods;

      // Humidity chart
      const humidityCtx = document.getElementById('humidityChart').getContext('2d');
      humidityChart = new Chart(humidityCtx, {
        type: 'line',
        data: {
          datasets: [
            { label: 'Avg Humidity', data: data.humidity, borderColor: '#1abc9c', backgroundColor: 'rgba(26, 188, 156, 0.1)', borderWidth: 2, pointRadius: 0, fill: true }
          ]
        },
        options: { ...commonOptions },
        plugins: [hvacPlugin, fanPlugin]
      });
      humidityChart.canvas.parentNode.style.height = '250px';
      humidityChart.hvacData = data.hvacPeriods;
      humidityChart.fanData = data.fanPeriods;

      // VOC chart
      const vocCtx = document.getElementById('vocChart').getContext('2d');
      vocChart = new Chart(vocCtx, {
        type: 'line',
        data: {
          datasets: [
            { label: 'Avg VOC', data: data.voc, borderColor: '#e67e22', backgroundColor: 'rgba(230, 126, 34, 0.1)', borderWidth: 2, pointRadius: 0, fill: true }
          ]
        },
        options: { ...commonOptions },
        plugins: [hvacPlugin, fanPlugin]
      });
      vocChart.canvas.parentNode.style.height = '250px';
      vocChart.hvacData = data.hvacPeriods;
      vocChart.fanData = data.fanPeriods;

      // CO2 chart
      const co2Ctx = document.getElementById('co2Chart').getContext('2d');
      co2Chart = new Chart(co2Ctx, {
        type: 'line',
        data: {
          datasets: [
            { label: 'Avg CO2', data: data.co2, borderColor: '#34495e', backgroundColor: 'rgba(52, 73, 94, 0.1)', borderWidth: 2, pointRadius: 0, fill: true }
          ]
        },
        options: { ...commonOptions },
        plugins: [hvacPlugin, fanPlugin]
      });
      co2Chart.canvas.parentNode.style.height = '250px';
      co2Chart.hvacData = data.hvacPeriods;
      co2Chart.fanData = data.fanPeriods;
    }

    function updateCharts(data) {
      tempChart.data.datasets[0].data = data.temp;
      tempChart.hvacData = data.hvacPeriods;
      tempChart.fanData = data.fanPeriods;
      tempChart.update();

      humidityChart.data.datasets[0].data = data.humidity;
      humidityChart.hvacData = data.hvacPeriods;
      humidityChart.fanData = data.fanPeriods;
      humidityChart.update();

      vocChart.data.datasets[0].data = data.voc;
      vocChart.hvacData = data.hvacPeriods;
      vocChart.fanData = data.fanPeriods;
      vocChart.update();

      co2Chart.data.datasets[0].data = data.co2;
      co2Chart.hvacData = data.hvacPeriods;
      co2Chart.fanData = data.fanPeriods;
      co2Chart.update();
    }

    async function loadData() {
      const hours = document.getElementById('timeRange').value;
      try {
        const res = await fetch('/api/chart-data?hours=' + hours);
        const json = await res.json();
        const data = processData(json.readings, json.actions);

        if (!tempChart) {
          initCharts(data);
        } else {
          updateCharts(data);
        }
      } catch (e) {
        console.error('Failed to load chart data:', e);
      }
    }

    // Initial load
    loadData();

    // Auto-refresh every 60 seconds
    setInterval(loadData, 60000);
  </script>
</body>
</html>`;
}

function renderUnifiedChartPage() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Thermostat Babysitter - Unified View</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
  <style>
    body { font-family: monospace; padding: 20px; max-width: 1400px; margin: 0 auto; background: #f5f5f5; }
    h1 { margin-bottom: 5px; }
    .nav { margin-bottom: 20px; }
    .nav a { margin-right: 15px; }
    .chart-container { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    canvas { width: 100% !important; }
    .controls { margin-bottom: 20px; display: flex; gap: 20px; align-items: center; flex-wrap: wrap; }
    .controls select, .controls label { padding: 5px 10px; font-family: monospace; }
    .legend { display: flex; gap: 15px; margin-top: 15px; font-size: 12px; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 5px; }
    .legend-line { width: 20px; height: 3px; }
    .legend-box { width: 20px; height: 12px; }
    .temp-line { background: #9b59b6; }
    .humidity-line { background: #1abc9c; }
    .voc-line { background: #e67e22; }
    .co2-line { background: #34495e; }
    .heat-box { background: rgba(255, 100, 100, 0.3); border: 1px solid rgba(255, 100, 100, 0.5); }
    .cool-box { background: rgba(100, 100, 255, 0.3); border: 1px solid rgba(100, 100, 255, 0.5); }
    .fan-box { background: rgba(100, 200, 100, 0.3); border: 1px dashed rgba(100, 200, 100, 0.5); }
  </style>
</head>
<body>
  <h1>Thermostat Babysitter - Unified View</h1>
  <div class="nav">
    <a href="/">&lt;- Dashboard</a>
    <a href="/charts">Individual Sensors</a>
  </div>

  <div class="controls">
    <label>Time Range:
      <select id="timeRange" onchange="loadData()">
        <option value="6">Last 6 hours</option>
        <option value="12">Last 12 hours</option>
        <option value="24" selected>Last 24 hours</option>
        <option value="48">Last 48 hours</option>
        <option value="168">Last 7 days</option>
      </select>
    </label>
    <label><input type="checkbox" id="showTemp" checked onchange="toggleDataset(0)"> Temperature</label>
    <label><input type="checkbox" id="showHumidity" checked onchange="toggleDataset(1)"> Humidity</label>
    <label><input type="checkbox" id="showVoc" checked onchange="toggleDataset(2)"> VOC</label>
    <label><input type="checkbox" id="showCo2" checked onchange="toggleDataset(3)"> CO2</label>
  </div>

  <div class="chart-container">
    <canvas id="unifiedChart"></canvas>
    <div class="legend">
      <div class="legend-item"><div class="legend-line temp-line"></div> Temperature (&deg;F)</div>
      <div class="legend-item"><div class="legend-line humidity-line"></div> Humidity (%)</div>
      <div class="legend-item"><div class="legend-line voc-line"></div> VOC (ppb /10)</div>
      <div class="legend-item"><div class="legend-line co2-line"></div> CO2 (ppm /10)</div>
      <div class="legend-item"><div class="legend-box heat-box"></div> Heating</div>
      <div class="legend-item"><div class="legend-box cool-box"></div> Cooling</div>
      <div class="legend-item"><div class="legend-box fan-box"></div> Fan On</div>
    </div>
  </div>

  <script>
    let unifiedChart;

    function createHvacPlugin() {
      return {
        id: 'hvacShading',
        beforeDraw: (chart) => {
          if (!chart.hvacData) return;
          const ctx = chart.ctx;
          const xScale = chart.scales.x;
          const yScale = chart.scales.y;

          chart.hvacData.forEach(period => {
            if (!period.start || !period.end) return;
            const x1 = xScale.getPixelForValue(new Date(period.start));
            const x2 = xScale.getPixelForValue(new Date(period.end));

            ctx.save();
            ctx.fillStyle = period.type === 'HEAT' ? 'rgba(255, 100, 100, 0.2)' :
                           period.type === 'COOL' ? 'rgba(100, 100, 255, 0.2)' :
                           'rgba(200, 200, 200, 0.1)';
            ctx.fillRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top);
            ctx.restore();
          });
        }
      };
    }

    function createFanPlugin() {
      return {
        id: 'fanShading',
        beforeDraw: (chart) => {
          if (!chart.fanData) return;
          const ctx = chart.ctx;
          const xScale = chart.scales.x;
          const yScale = chart.scales.y;

          chart.fanData.forEach(period => {
            if (!period.start || !period.end) return;
            const x1 = xScale.getPixelForValue(new Date(period.start));
            const x2 = xScale.getPixelForValue(new Date(period.end));

            ctx.save();
            ctx.fillStyle = 'rgba(100, 200, 100, 0.12)';
            ctx.strokeStyle = 'rgba(100, 200, 100, 0.3)';
            ctx.setLineDash([4, 4]);
            ctx.fillRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top);
            ctx.strokeRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top);
            ctx.restore();
          });
        }
      };
    }

    function processData(readings, actions) {
      // Group readings by timestamp (rounded to minute)
      // Filter sensor readings (exclude nest for averaging)
      const sensorReadings = readings.filter(r => r.source !== 'nest');
      const nestReadings = readings.filter(r => r.source === 'nest').sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      const grouped = {};

      sensorReadings.forEach(r => {
        const ts = new Date(r.timestamp);
        ts.setSeconds(0, 0);
        const key = ts.toISOString();

        if (!grouped[key]) {
          grouped[key] = { timestamp: key, temps: [], humidities: [], vocs: [], co2s: [] };
        }

        if (r.temperature != null) grouped[key].temps.push(r.temperature);
        if (r.humidity != null) grouped[key].humidities.push(r.humidity);
        if (r.voc != null) grouped[key].vocs.push(r.voc);
        if (r.co2 != null) grouped[key].co2s.push(r.co2);
      });

      // Calculate averages and normalize for display on same scale
      const averaged = Object.values(grouped)
        .map(g => ({
          timestamp: g.timestamp,
          temp: g.temps.length ? g.temps.reduce((a, b) => a + b, 0) / g.temps.length : null,
          humidity: g.humidities.length ? g.humidities.reduce((a, b) => a + b, 0) / g.humidities.length : null,
          voc: g.vocs.length ? g.vocs.reduce((a, b) => a + b, 0) / g.vocs.length : null,
          co2: g.co2s.length ? g.co2s.reduce((a, b) => a + b, 0) / g.co2s.length : null
        }))
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      // Process HVAC periods from Nest readings
      const hvacPeriods = [];
      let currentHvacPeriod = null;

      nestReadings.forEach(r => {
        const status = r.hvacStatus;
        const type = status === 'HEATING' ? 'HEAT' : status === 'COOLING' ? 'COOL' : null;

        if (type && !currentHvacPeriod) {
          currentHvacPeriod = { type, start: r.timestamp };
        } else if (!type && currentHvacPeriod) {
          currentHvacPeriod.end = r.timestamp;
          hvacPeriods.push(currentHvacPeriod);
          currentHvacPeriod = null;
        } else if (type && currentHvacPeriod && type !== currentHvacPeriod.type) {
          currentHvacPeriod.end = r.timestamp;
          hvacPeriods.push(currentHvacPeriod);
          currentHvacPeriod = { type, start: r.timestamp };
        }
      });

      if (currentHvacPeriod) {
        currentHvacPeriod.end = new Date().toISOString();
        hvacPeriods.push(currentHvacPeriod);
      }

      // Process fan periods from Nest readings
      const fanPeriods = [];
      let currentFanPeriod = null;

      nestReadings.forEach(r => {
        const fanOn = r.fanRunning;

        if (fanOn && !currentFanPeriod) {
          currentFanPeriod = { start: r.timestamp };
        } else if (!fanOn && currentFanPeriod) {
          currentFanPeriod.end = r.timestamp;
          fanPeriods.push(currentFanPeriod);
          currentFanPeriod = null;
        }
      });

      if (currentFanPeriod) {
        currentFanPeriod.end = new Date().toISOString();
        fanPeriods.push(currentFanPeriod);
      }

      return {
        temp: averaged.map(r => ({ x: new Date(r.timestamp), y: r.temp })).filter(r => r.y != null),
        humidity: averaged.map(r => ({ x: new Date(r.timestamp), y: r.humidity })).filter(r => r.y != null),
        // Scale VOC and CO2 down to fit on same chart (divide by 10)
        voc: averaged.map(r => ({ x: new Date(r.timestamp), y: r.voc ? r.voc / 10 : null })).filter(r => r.y != null),
        co2: averaged.map(r => ({ x: new Date(r.timestamp), y: r.co2 ? r.co2 / 10 : null })).filter(r => r.y != null),
        hvacPeriods,
        fanPeriods
      };
    }

    function initChart(data) {
      const ctx = document.getElementById('unifiedChart').getContext('2d');

      unifiedChart = new Chart(ctx, {
        type: 'line',
        data: {
          datasets: [
            {
              label: 'Temperature (&deg;F)',
              data: data.temp,
              borderColor: '#9b59b6',
              backgroundColor: 'rgba(155, 89, 182, 0.1)',
              borderWidth: 2,
              pointRadius: 0,
              fill: false,
              yAxisID: 'y'
            },
            {
              label: 'Humidity (%)',
              data: data.humidity,
              borderColor: '#1abc9c',
              backgroundColor: 'rgba(26, 188, 156, 0.1)',
              borderWidth: 2,
              pointRadius: 0,
              fill: false,
              yAxisID: 'y'
            },
            {
              label: 'VOC (/10)',
              data: data.voc,
              borderColor: '#e67e22',
              backgroundColor: 'rgba(230, 126, 34, 0.1)',
              borderWidth: 2,
              pointRadius: 0,
              fill: false,
              yAxisID: 'y'
            },
            {
              label: 'CO2 (/10)',
              data: data.co2,
              borderColor: '#34495e',
              backgroundColor: 'rgba(52, 73, 94, 0.1)',
              borderWidth: 2,
              pointRadius: 0,
              fill: false,
              yAxisID: 'y'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          scales: {
            x: {
              type: 'time',
              time: { displayFormats: { hour: 'MMM d, ha', minute: 'h:mm a' } },
              title: { display: false }
            },
            y: {
              type: 'linear',
              display: true,
              position: 'left',
              title: { display: true, text: 'Value' },
              min: 0,
              max: 120
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function(context) {
                  let label = context.dataset.label || '';
                  let value = context.parsed.y;
                  if (label.includes('VOC')) {
                    return 'VOC: ' + (value * 10).toFixed(0) + ' ppb';
                  } else if (label.includes('CO2')) {
                    return 'CO2: ' + (value * 10).toFixed(0) + ' ppm';
                  } else if (label.includes('Temperature')) {
                    return 'Temp: ' + value.toFixed(1) + '&deg;F';
                  } else if (label.includes('Humidity')) {
                    return 'Humidity: ' + value.toFixed(0) + '%';
                  }
                  return label + ': ' + value;
                }
              }
            }
          }
        },
        plugins: [createHvacPlugin(), createFanPlugin()]
      });

      unifiedChart.canvas.parentNode.style.height = '500px';
      unifiedChart.hvacData = data.hvacPeriods;
      unifiedChart.fanData = data.fanPeriods;
    }

    function updateChart(data) {
      unifiedChart.data.datasets[0].data = data.temp;
      unifiedChart.data.datasets[1].data = data.humidity;
      unifiedChart.data.datasets[2].data = data.voc;
      unifiedChart.data.datasets[3].data = data.co2;
      unifiedChart.hvacData = data.hvacPeriods;
      unifiedChart.fanData = data.fanPeriods;
      unifiedChart.update();
    }

    function toggleDataset(index) {
      const meta = unifiedChart.getDatasetMeta(index);
      meta.hidden = !meta.hidden;
      unifiedChart.update();
    }

    async function loadData() {
      const hours = document.getElementById('timeRange').value;
      try {
        const res = await fetch('/api/chart-data?hours=' + hours);
        const json = await res.json();
        const data = processData(json.readings, json.actions);

        if (!unifiedChart) {
          initChart(data);
        } else {
          updateChart(data);
        }
      } catch (e) {
        console.error('Failed to load chart data:', e);
      }
    }

    // Initial load
    loadData();

    // Auto-refresh every 60 seconds
    setInterval(loadData, 60000);
  </script>
</body>
</html>`;
}

export function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // SSE endpoint for live updates
  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    clients.add(res);
    console.log(`[SSE] Client connected (${clients.size} total)`);

    // Send initial state
    const data = JSON.stringify({
      state: db.getCurrentState(),
      readings: db.getReadings(20),
      actions: db.getActions(10),
      fanAlwaysOn: getFanAlwaysOn()
    });
    res.write(`data: ${data}\n\n`);

    req.on('close', () => {
      clients.delete(res);
      console.log(`[SSE] Client disconnected (${clients.size} total)`);
    });
    return;
  }

  // Handle POST to set target temp
  if (req.method === 'POST' && url.pathname === '/api/target') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { target } = JSON.parse(body);
        const temp = parseFloat(target);
        if (isNaN(temp) || temp < 50 || temp > 90) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Temperature must be between 50-90&deg;F' }));
          return;
        }
        setTargetTemp(temp);
        console.log(`[Dashboard] Target temperature set to ${temp}&deg;F`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, target: temp }));
        // Broadcast the change
        broadcast();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      state: db.getCurrentState(),
      readings: db.getReadings(20),
      actions: db.getActions(10),
      fanAlwaysOn: getFanAlwaysOn()
    }));
    return;
  }

  // Health check endpoint for watchdog
  if (url.pathname === '/api/health') {
    const state = db.getCurrentState();
    const lastCheck = state.last_check?.value;
    const staleMinutes = lastCheck ? (Date.now() - new Date(lastCheck).getTime()) / 60000 : null;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      last_check: lastCheck,
      stale_minutes: staleMinutes?.toFixed(1),
      uptime: process.uptime()
    }));
    return;
  }

  // Handle POST to toggle fan always on
  if (req.method === 'POST' && url.pathname === '/api/fan') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { enabled } = JSON.parse(body);
        setFanAlwaysOn(!!enabled);
        console.log(`[Dashboard] Fan always on set to ${!!enabled}`);

        // If enabling, turn on fan immediately
        if (enabled) {
          await setFanTimer(43200);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, enabled: !!enabled }));
        broadcast();
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  // API endpoint for chart data (last 24 hours)
  if (url.pathname === '/api/chart-data') {
    const hours = parseInt(url.searchParams.get('hours')) || 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      readings: db.getReadingsSince(since),
      actions: db.getActionsSince(since),
      state: db.getCurrentState()
    }));
    return;
  }

  // Charts page
  if (url.pathname === '/charts') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderChartsPage());
    return;
  }

  // Unified single chart page
  if (url.pathname === '/charts/unified') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderUnifiedChartPage());
    return;
  }

  // Default: HTML dashboard
  const state = db.getCurrentState();
  const readings = db.getReadings(20);
  const actions = db.getActions(10);
  const currentTarget = getTargetTemp();
  const fanAlwaysOn = getFanAlwaysOn();

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Thermostat Babysitter</title>
  <style>
    body { font-family: monospace; padding: 20px; max-width: 800px; margin: 0 auto; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    td, th { border: 1px solid #ccc; padding: 5px; text-align: left; }
    .heat { color: #c00; }
    .cool { color: #00c; }
    .ok { color: #0a0; }
    .controls { margin: 15px 0; padding: 10px; border: 1px solid #ccc; }
    .controls input { width: 60px; padding: 5px; font-family: monospace; }
    .controls button { padding: 5px 15px; margin-left: 10px; cursor: pointer; }
    .live { display: inline-block; width: 8px; height: 8px; background: #0a0; border-radius: 50%; margin-right: 5px; }
    .live.disconnected { background: #c00; }
  </style>
</head>
<body>
  <h1><span class="live" id="liveIndicator"></span>Thermostat Babysitter</h1>
  <div class="nav"><a href="/charts">Charts</a> | <a href="/charts/unified">Unified</a></div>

  <div class="controls">
    <label>Target Temperature:
      <input type="number" id="targetTemp" value="${currentTarget}" min="50" max="90" step="0.5">&deg;F
    </label>
    <button onclick="setTarget()">Set</button>
    <span id="status"></span>
    |
    <label>Fan 24/7: <button id="fanBtn" onclick="toggleFan()">${fanAlwaysOn ? 'Turn Off' : 'Turn On'}</button></label>
  </div>

  <h2>Current State</h2>
  <table>
    <tr><td>Average Temp</td><td><b id="avgTemp">${state.avg_temp?.value?.toFixed(1) || '--'}&deg;F</b></td></tr>
    <tr><td>Target Temp</td><td id="targetDisplay">${state.target_temp?.value || currentTarget}&deg;F +/-${state.threshold?.value || '--'}</td></tr>
    <tr><td>Last Action</td><td id="lastAction" class="${state.last_action?.value === 'HEAT' ? 'heat' : state.last_action?.value === 'COOL' ? 'cool' : 'ok'}">${state.last_action?.value || '--'}</td></tr>
    <tr><td>Reason</td><td id="reason">${state.last_reason?.value || '--'}</td></tr>
    <tr><td>Sensors</td><td id="sensorCount">${state.sensor_count?.value || 0} active</td></tr>
    <tr><td>Last Check</td><td id="lastCheck">${state.last_check?.value ? formatLocalTime(state.last_check.value) : '--'}</td></tr>
    <tr><td>Nest Mode</td><td id="nestMode">${state.nest_state?.value?.mode || 'Not configured'}</td></tr>
    <tr><td>Nest HVAC</td><td id="nestHvac">${state.nest_state?.value?.hvacStatus || '--'}</td></tr>
    <tr><td>Nest Fan</td><td id="nestFan">${state.nest_state?.value?.fanRunning ? 'ON' : 'OFF'}</td></tr>
  </table>

  <h2>Recent Readings</h2>
  <table>
    <thead><tr><th>Time</th><th>Source</th><th>Temp</th><th>Humidity</th><th>HVAC</th><th>VOC (ppb)</th><th>CO2 (ppm)</th><th>PM2.5</th></tr></thead>
    <tbody id="readingsTable">${renderReadingsRows(readings)}</tbody>
  </table>

  <h2>Recent Actions</h2>
  <table>
    <thead><tr><th>Time</th><th>Action</th><th>Avg Temp</th><th>Reason</th></tr></thead>
    <tbody id="actionsTable">${renderActionsRows(actions)}</tbody>
  </table>

  <p><small>Live updates enabled</small></p>

  <script>
    function formatLocalTime(isoString) {
      return new Date(isoString).toLocaleString();
    }

    const evtSource = new EventSource('/api/events');
    const indicator = document.getElementById('liveIndicator');

    evtSource.onopen = () => indicator.classList.remove('disconnected');
    evtSource.onerror = () => indicator.classList.add('disconnected');

    evtSource.onmessage = (event) => {
      const { state, readings, actions, fanAlwaysOn } = JSON.parse(event.data);

      // Update state
      document.getElementById('avgTemp').textContent = (state.avg_temp?.value?.toFixed(1) || '--') + ' F';
      document.getElementById('targetDisplay').textContent = (state.target_temp?.value || '--') + ' F +/-' + (state.threshold?.value || '--');

      const lastAction = document.getElementById('lastAction');
      lastAction.textContent = state.last_action?.value || '--';
      lastAction.className = state.last_action?.value === 'HEAT' ? 'heat' : state.last_action?.value === 'COOL' ? 'cool' : 'ok';

      document.getElementById('reason').textContent = state.last_reason?.value || '--';
      document.getElementById('sensorCount').textContent = (state.sensor_count?.value || 0) + ' active';
      document.getElementById('lastCheck').textContent = formatLocalTime(state.last_check?.value) || '--';
      document.getElementById('nestMode').textContent = state.nest_state?.value?.mode || 'Not configured';
      document.getElementById('nestHvac').textContent = state.nest_state?.value?.hvacStatus || '--';
      document.getElementById('nestFan').textContent = state.nest_state?.value?.fanRunning ? 'ON' : 'OFF';

      // Update fan 24/7 button
      document.getElementById('fanBtn').textContent = fanAlwaysOn ? 'Turn Off' : 'Turn On';

      // Update readings table
      document.getElementById('readingsTable').innerHTML = readings.map(r =>
        '<tr><td>' + formatLocalTime(r.timestamp) + '</td><td>' + r.source + '</td><td>' +
        (r.temperature?.toFixed(1) || '--') + '&deg;F</td><td>' +
        (r.humidity?.toFixed(0) || '--') + '%</td><td>' +
        (r.source === 'nest' ? (r.hvacStatus || 'OFF') : '--') + '</td><td>' +
        (r.voc ?? '--') + '</td><td>' +
        (r.co2 ?? '--') + '</td><td>' +
        (r.pm25 ?? '--') + '</td></tr>'
      ).join('');

      // Update actions table
      document.getElementById('actionsTable').innerHTML = actions.map(a =>
        '<tr><td>' + formatLocalTime(a.timestamp) + '</td><td class="' +
        (a.action.includes('HEAT') ? 'heat' : a.action.includes('COOL') ? 'cool' : 'ok') + '">' +
        a.action + '</td><td>' + (a.avg_temp?.toFixed(1) || '--') + '&deg;F</td><td>' +
        a.reason + '</td></tr>'
      ).join('');
    };

    async function setTarget() {
      const temp = document.getElementById('targetTemp').value;
      const status = document.getElementById('status');
      try {
        const res = await fetch('/api/target', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target: temp })
        });
        const data = await res.json();
        if (data.success) {
          status.innerHTML = 'OK: Set to ' + data.target + '&deg;F';
          status.style.color = 'green';
        } else {
          status.textContent = 'Error: ' + data.error;
          status.style.color = 'red';
        }
      } catch (e) {
        status.textContent = 'Error: Error';
        status.style.color = 'red';
      }
    }

    async function toggleFan() {
      const btn = document.getElementById('fanBtn');
      const currentlyOn = btn.textContent === 'Turn Off';
      try {
        const res = await fetch('/api/fan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: !currentlyOn })
        });
        const data = await res.json();
        if (data.success) {
          btn.textContent = data.enabled ? 'Turn Off' : 'Turn On';
        }
      } catch (e) {
        console.error('Failed to toggle fan:', e);
      }
    }
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
}
