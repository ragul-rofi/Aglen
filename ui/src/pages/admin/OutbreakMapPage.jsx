import { useEffect, useMemo, useState } from 'react';
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import {
  fetchIndiaGeoJson,
  fetchOutbreakData,
  formatDiseaseName,
  getGeoStateName,
} from '../../lib/mapData';

function severityBadgeClass(level) {
  if (level === 'critical') return 'alerts-badge alerts-badge--critical';
  if (level === 'high') return 'alerts-badge alerts-badge--high';
  if (level === 'medium') return 'alerts-badge alerts-badge--medium';
  return 'alerts-badge alerts-badge--low';
}

function formatDateISO(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function colorForValue(value, max) {
  if (!value || value <= 0) return '#ecefed';
  const t = max <= 0 ? 0 : value / max;
  const steps = [
    '#E1F5EE',
    '#C5EBDD',
    '#9FD8C3',
    '#67B596',
    '#2E896D',
    '#085041',
  ];
  const index = Math.min(steps.length - 1, Math.floor(t * (steps.length - 1)));
  return steps[index];
}

function SparklineBars({ series = [] }) {
  const max = Math.max(...series.map((item) => item.count), 1);
  return (
    <div className="sparkline-bars" aria-label="7 day trend">
      {series.map((item) => (
        <div key={item.date} className="sparkline-bars__item">
          <span style={{ height: `${Math.max(10, (item.count / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

export default function OutbreakMapPage() {
  const [rangeType, setRangeType] = useState('30d');
  const [customStart, setCustomStart] = useState(formatDateISO(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [customEnd, setCustomEnd] = useState(formatDateISO(new Date()));
  const [diseaseClass, setDiseaseClass] = useState('all');
  const [metric, setMetric] = useState('scan_volume');
  const [severity, setSeverity] = useState('all');

  const [geoData, setGeoData] = useState(null);
  const [dataset, setDataset] = useState(null);
  const [selectedState, setSelectedState] = useState(null);
  const [stateAlerts, setStateAlerts] = useState([]);
  const [tooltip, setTooltip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [activePanel, setActivePanel] = useState('filters');

  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    if (rangeType === '7d') {
      return {
        startDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        endDate: now,
      };
    }
    if (rangeType === '30d') {
      return {
        startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        endDate: now,
      };
    }
    if (rangeType === '90d') {
      return {
        startDate: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
        endDate: now,
      };
    }
    return {
      startDate: new Date(customStart),
      endDate: new Date(customEnd),
    };
  }, [rangeType, customStart, customEnd]);

  useEffect(() => {
    let ignore = false;
    async function loadGeo() {
      try {
        const geo = await fetchIndiaGeoJson();
        if (!ignore) setGeoData(geo);
      } catch (err) {
        if (!ignore) setError(err.message || 'Failed to load map boundary data.');
      }
    }
    loadGeo();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    async function loadData() {
      setLoading(true);
      setError('');
      try {
        const result = await fetchOutbreakData({
          startDate,
          endDate,
          diseaseClass,
          metric,
          severityFilter: severity,
        });

        if (!ignore) {
          setDataset(result);
          if (selectedState && !result.states.some((item) => item.state === selectedState.state)) {
            setSelectedState(null);
            setStateAlerts([]);
          }
        }
      } catch (err) {
        if (!ignore) setError(err.message || 'Failed to load outbreak map data.');
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadData();
    return () => {
      ignore = true;
    };
  }, [startDate, endDate, diseaseClass, metric, severity, selectedState]);

  useEffect(() => {
    let ignore = false;
    async function loadAlerts() {
      if (!selectedState || !dataset?.fetchAlertsForState) {
        setStateAlerts([]);
        return;
      }
      const alerts = await dataset.fetchAlertsForState(selectedState.state);
      if (!ignore) setStateAlerts(alerts);
    }
    loadAlerts();
    return () => {
      ignore = true;
    };
  }, [selectedState, dataset]);

  const stateMap = useMemo(() => {
    const map = new Map();
    (dataset?.states || []).forEach((item) => map.set(item.state, item));
    return map;
  }, [dataset]);

  const maxValue = useMemo(
    () => Math.max(...(dataset?.states || []).map((item) => item.value || 0), 0),
    [dataset],
  );

  return (
    <section className="admin-map-page">
      <aside className="admin-map-panel">
        <h2>Outbreak intelligence</h2>
        <div className="admin-map-filters">
          <label>
            Date range
            <select value={rangeType} onChange={(event) => setRangeType(event.target.value)}>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          {rangeType === 'custom' && (
            <div className="admin-map-custom-dates">
              <input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} />
              <input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} />
            </div>
          )}

          <label>
            Disease class
            <select value={diseaseClass} onChange={(event) => setDiseaseClass(event.target.value)}>
              <option value="all">All</option>
              {(dataset?.uniqueDiseases || []).map((item) => (
                <option key={item} value={item}>{formatDiseaseName(item)}</option>
              ))}
            </select>
          </label>

          <label>
            Metric
            <select value={metric} onChange={(event) => setMetric(event.target.value)}>
              <option value="scan_volume">Scan volume</option>
              <option value="disease_prevalence">Disease prevalence</option>
              <option value="confirmed_cases">Confirmed cases</option>
            </select>
          </label>

          <label>
            Severity filter
            <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
              <option value="all">All</option>
              <option value="medium_plus">Medium+</option>
              <option value="high_plus">High+</option>
              <option value="critical">Critical only</option>
            </select>
          </label>
        </div>

        <div className="admin-map-top-list">
          <h3>Top diseases</h3>
          <ol>
            {(dataset?.topDiseases || []).map((item, idx) => (
              <li key={item.disease}>
                <span className="rank">{idx + 1}</span>
                <span className="name">{formatDiseaseName(item.disease)}</span>
                <span className="count">{item.count}</span>
                <span className={`trend ${item.trend === 'up' ? 'up' : 'down'}`}>{item.trend === 'up' ? '↑' : '↓'}</span>
                <span className={severityBadgeClass(item.severity)}>{item.severity}</span>
              </li>
            ))}
          </ol>
        </div>

        {selectedState && (
          <div className="admin-map-drilldown">
            <h3>{selectedState.state}</h3>
            <p>Total scans: {selectedState.totalScans}</p>
            <p>Metric value: {selectedState.value}</p>

            <h4>Top 3 diseases</h4>
            <ul>
              {selectedState.diseases.slice(0, 3).map((item) => (
                <li key={item.disease}>
                  <span>{formatDiseaseName(item.disease)}</span>
                  <strong>{item.count}</strong>
                </li>
              ))}
            </ul>

            <h4>7-day scan trend</h4>
            <SparklineBars series={selectedState.trend} />

            <h4>Active alerts</h4>
            <ul>
              {stateAlerts.slice(0, 5).map((alert) => (
                <li key={alert.id}>
                  <span>{formatDiseaseName(alert.disease_class)}</span>
                  <span className={severityBadgeClass(alert.severity)}>{alert.severity}</span>
                </li>
              ))}
              {stateAlerts.length === 0 && <li>No active alerts</li>}
            </ul>

            <h4>Top districts</h4>
            <ul>
              {selectedState.districts.slice(0, 6).map((item) => (
                <li key={item.district}>
                  <span>{item.district}</span>
                  <strong>{item.count}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <div className="admin-map-main">
        {loading && <p className="history-state">Loading outbreak map...</p>}
        {error && <p className="page-error">{error}</p>}
        {!loading && geoData && (
          <div className="admin-map-canvas">
            <ComposableMap projection="geoMercator" projectionConfig={{ scale: 950, center: [82.8, 23.8] }}>
              <Geographies geography={geoData}>
                {({ geographies }) => (
                  geographies.map((geo) => {
                    const stateName = getGeoStateName(geo.properties);
                    const row = stateMap.get(stateName);
                    const fill = colorForValue(row?.value || 0, maxValue);

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={fill}
                        stroke="#ffffff"
                        strokeWidth={0.6}
                        style={{
                          default: { outline: 'none' },
                          hover: { outline: 'none', fill: '#0f6f5d' },
                          pressed: { outline: 'none', fill: '#085041' },
                        }}
                        onMouseMove={(event) => {
                          setTooltip({
                            x: event.clientX,
                            y: event.clientY,
                            state: stateName,
                            value: row?.value || 0,
                            topDisease: row?.topDisease || 'N/A',
                          });
                        }}
                        onMouseLeave={() => setTooltip(null)}
                        onClick={() => setSelectedState(row || {
                          state: stateName,
                          value: 0,
                          totalScans: 0,
                          diseases: [],
                          districts: [],
                          trend: [],
                        })}
                      />
                    );
                  })
                )}
              </Geographies>
            </ComposableMap>

            {tooltip && (
              <div className="admin-map-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}>
                <strong>{tooltip.state}</strong>
                <span>Scans: {tooltip.value}</span>
                <span>Top disease: {formatDiseaseName(tooltip.topDisease)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
