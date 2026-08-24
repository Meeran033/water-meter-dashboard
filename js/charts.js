/* ── Chart.js Defaults ── */
Chart.defaults.color = '#6b8cae';
Chart.defaults.font.family = 'Inter';

/* ── Main Line Chart Setup ── */
const mainCtx = document.getElementById('mainChart').getContext('2d');
const mainChart = new Chart(mainCtx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [{
      label: 'Flow Rate (L/min)',
      data: [],
      borderColor: '#00b4ff',
      backgroundColor: 'rgba(0,180,255,0.08)',
      borderWidth: 2.5,
      tension: 0.45,
      fill: true,
      pointBackgroundColor: '#00b4ff',
      pointRadius: 4
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,.04)' } },
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,.04)' } }
    }
  }
});

/* ── Comparative Bar Chart Setup ── */
const multiCtx = document.getElementById('multiChart').getContext('2d');
const multiChart = new Chart(multiCtx, {
  type: 'bar',
  data: {
    labels: [],
    datasets: [
      { label: 'Flow Rate (L/m)', data: [], backgroundColor: 'rgba(0,180,255,0.7)', borderRadius: 4 },
      { label: 'Total Liters (L)', data: [], backgroundColor: 'rgba(0,255,200,0.7)', borderRadius: 4 },
      { label: 'Water2 Val', data: [], backgroundColor: 'rgba(255,179,0,0.7)',  borderRadius: 4 }
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { boxWidth: 12, padding: 16 } } },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,.04)' } },
      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,.04)' } }
    }
  }
});

/* ── Chart update push handlers ── */
function pushData(chart, label, value, maxPoints = 10) {
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(value);
  if (chart.data.labels.length > maxPoints) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.update();
}

function pushMulti(label, v1, v2, v3) {
  multiChart.data.labels.push(label);
  multiChart.data.datasets[0].data.push(v1);
  multiChart.data.datasets[1].data.push(v2);
  multiChart.data.datasets[2].data.push(v3);
  if (multiChart.data.labels.length > 10) {
    multiChart.data.labels.shift();
    multiChart.data.datasets.forEach(ds => ds.data.shift());
  }
  multiChart.update();
}

