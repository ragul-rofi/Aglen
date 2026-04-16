import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchScanStats } from '../../lib/analytics';

const FEEDBACK_COLORS = ['#2a8a4f', '#bc3f2f', '#c58a22', '#8f9a93'];

function confidenceColor(band) {
  if (band === 'high') return '#2f9b59';
  if (band === 'mid') return '#d28f26';
  return '#bf4938';
}

export default function ScanAnalyticsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const end = new Date();
        const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
        const payload = await fetchScanStats({ startDate: start, endDate: end });
        if (!ignore) setData(payload);
      } catch (err) {
        if (!ignore) setError(err.message || 'Failed to load scan analytics.');
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, []);

  const stats = useMemo(() => {
    const totals = data?.totals;
    return {
      totalScans: totals?.totalScans || 0,
      scansToday: totals?.scansToday || 0,
      avgConfidence: Math.round((totals?.avgConfidence || 0) * 100),
      feedbackRate: Math.round(totals?.feedbackRate || 0),
    };
  }, [data]);

  return (
    <section className="admin-analytics-page">
      <div className="admin-analytics-stats">
        <article><p>Total scans</p><strong>{stats.totalScans}</strong></article>
        <article><p>Scans today</p><strong>{stats.scansToday}</strong></article>
        <article><p>Avg confidence</p><strong>{stats.avgConfidence}%</strong></article>
        <article><p>Feedback rate</p><strong>{stats.feedbackRate}%</strong></article>
      </div>

      {loading && <p className="history-state">Loading analytics...</p>}
      {error && <p className="page-error">{error}</p>}

      {!loading && data && (
        <div className="admin-analytics-grid">
          <article className="chart-card chart-card--wide">
            <h3>Scan volume over time</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data.charts.volumeSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="total" stroke="#1a3c2b" strokeWidth={2} dot={false} name="Total scans" />
                <Line type="monotone" dataKey="confirmed" stroke="#3f9c5c" strokeWidth={2} dot={false} name="Confirmed correct" />
              </LineChart>
            </ResponsiveContainer>
          </article>

          <article className="chart-card">
            <h3>Top 10 diseases</h3>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={data.charts.topDiseases} layout="vertical" margin={{ left: 6, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" width={110} dataKey="disease" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#d18b2c" />
              </BarChart>
            </ResponsiveContainer>
          </article>

          <article className="chart-card">
            <h3>Confidence distribution</h3>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={data.charts.confidenceDistribution}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="bucket" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count">
                  {data.charts.confidenceDistribution.map((entry) => (
                    <Cell key={entry.bucket} fill={confidenceColor(entry.band)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </article>

          <article className="chart-card chart-card--pie">
            <h3>Feedback breakdown</h3>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={data.charts.feedbackPie} dataKey="value" nameKey="name" outerRadius={80} label>
                  {data.charts.feedbackPie.map((entry, index) => (
                    <Cell key={entry.name} fill={FEEDBACK_COLORS[index % FEEDBACK_COLORS.length]} />
                  ))}
                </Pie>
                <Legend layout="vertical" verticalAlign="middle" align="right" />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </article>
        </div>
      )}
    </section>
  );
}
