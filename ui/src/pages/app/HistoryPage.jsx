import { useEffect, useMemo, useRef, useState } from 'react';
import { useScanStore } from '../../store/scanStore';

function formatDiseaseName(value = '') {
  const cleaned = value.split('___').pop() || value;
  return cleaned.replaceAll('_', ' ');
}

function formatDate(dateText) {
  const date = new Date(dateText);
  return date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
  });
}

function FeedbackBadge({ value }) {
  if (!value) return <span className="history-badge history-badge--none">No feedback</span>;
  return <span className={`history-badge history-badge--${value}`}>{value}</span>;
}

function thumbnailSrc(scan) {
  const value = scan?.image_url;
  if (!value) return '';
  if (value.startsWith('blob:') || value.startsWith('http') || value.startsWith('data:')) {
    return value;
  }
  return '';
}

function ScanDetailModal({ scan, onClose }) {
  if (!scan) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__card">
        <button type="button" className="modal__close" onClick={onClose}>
          Close
        </button>
        <h3>{formatDiseaseName(scan.predicted_class)}</h3>
        <p>Confidence: {Math.round((scan.confidence ?? 0) * 100)}%</p>
        <p>{scan.activation_summary || 'No explanation summary available.'}</p>
      </div>
    </div>
  );
}

export default function HistoryPage({ userId }) {
  const scans = useScanStore((state) => state.scans);
  const hasMore = useScanStore((state) => state.hasMore);
  const loading = useScanStore((state) => state.loading);
  const error = useScanStore((state) => state.error);
  const fetchScans = useScanStore((state) => state.fetchScans);

  const [filter, setFilter] = useState('all');
  const [activeScan, setActiveScan] = useState(null);
  const sentinelRef = useRef(null);

  useEffect(() => {
    fetchScans(userId, true);
  }, [fetchScans, userId]);

  useEffect(() => {
    if (!sentinelRef.current) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !loading) {
          fetchScans(userId, false);
        }
      },
      { threshold: 0.4 },
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [fetchScans, hasMore, loading, userId]);

  const filteredScans = useMemo(() => {
    if (filter === 'confirmed') return scans.filter((item) => item.feedback === 'confirmed');
    if (filter === 'flagged') return scans.filter((item) => item.feedback === 'wrong');
    return scans;
  }, [filter, scans]);

  return (
    <section className="history-page">
      <div className="history-page__chips" role="tablist" aria-label="History filters">
        {[
          { key: 'all', label: 'All' },
          { key: 'confirmed', label: 'Confirmed' },
          { key: 'flagged', label: 'Flagged' },
        ].map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={`chip ${filter === chip.key ? 'is-active' : ''}`}
            onClick={() => setFilter(chip.key)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <ul className="history-list">
        {filteredScans.map((scan) => (
          <li key={scan.id}>
            <button type="button" className="history-item" onClick={() => setActiveScan(scan)}>
              {thumbnailSrc(scan) ? (
                <img src={thumbnailSrc(scan)} alt="Scan thumbnail" className="history-item__thumb-img" />
              ) : (
                <div className="history-item__thumb" />
              )}
              <div className="history-item__meta">
                <strong>{formatDiseaseName(scan.predicted_class)}</strong>
                <span>{Math.round((scan.confidence ?? 0) * 100)}% confidence</span>
              </div>
              <div className="history-item__tail">
                <span>{formatDate(scan.created_at || new Date().toISOString())}</span>
                <FeedbackBadge value={scan.feedback} />
              </div>
            </button>
          </li>
        ))}
      </ul>

      <div ref={sentinelRef} className="history-sentinel" aria-hidden="true" />
      {loading && <p className="history-state">Loading more scans...</p>}
      {error && <p className="page-error">{error}</p>}

      <ScanDetailModal scan={activeScan} onClose={() => setActiveScan(null)} />
    </section>
  );
}
