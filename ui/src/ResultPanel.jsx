import { useState, useMemo } from 'react';

/**
 * Parse the activation summary to extract an approximate activated-area percentage.
 * The summary contains a phrase like "…attention to 18% of the leaf surface…"
 */
function extractAreaPct(summary) {
  const match = summary?.match(/(\d+)%\s*of the leaf/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Compute a 0–100 explainability score from the activated area %.
 * A focused 30 % activation is treated as the "ideal" maximum.
 */
function computeExplainabilityScore(areaPct) {
  if (areaPct == null) return null;
  return Math.min(100, Math.round((areaPct / 30) * 100));
}

/** Pretty-print a class name: replace underscores with spaces. */
function formatClass(name) {
  return name?.replaceAll('___', ' — ').replaceAll('_', ' ') ?? '';
}

export default function ResultPanel({ result, previewUrl, onReset }) {
  const [showHeatmap, setShowHeatmap] = useState(false);

  const areaPct = useMemo(() => extractAreaPct(result.activation_summary), [result]);
  const explainScore = useMemo(() => computeExplainabilityScore(areaPct), [areaPct]);

  const heatmapSrc = `data:image/png;base64,${result.heatmap_base64}`;
  const confidencePct = Math.round(result.confidence * 100);

  return (
    <div className="result" id="result-panel">
      <div className="result__grid">
        {/* ── LEFT: Image viewer ──────────────────────────────────── */}
        <div className="viewer" id="image-viewer">
          <div className="viewer__tabs">
            <button
              className={`viewer__tab ${!showHeatmap ? 'viewer__tab--active' : ''}`}
              onClick={() => setShowHeatmap(false)}
              id="tab-original"
              type="button"
            >
              Original
            </button>
            <button
              className={`viewer__tab ${showHeatmap ? 'viewer__tab--active' : ''}`}
              onClick={() => setShowHeatmap(true)}
              id="tab-gradcam"
              type="button"
            >
              Grad-CAM Overlay
            </button>
          </div>
          <div className="viewer__image-wrap">
            <img
              src={previewUrl}
              alt="Uploaded leaf"
              className={`viewer__image ${showHeatmap ? 'viewer__image--hidden' : ''}`}
            />
            <img
              src={heatmapSrc}
              alt="Grad-CAM heatmap overlay"
              className={`viewer__image ${!showHeatmap ? 'viewer__image--hidden' : ''}`}
            />
          </div>
        </div>

        {/* ── RIGHT: Diagnosis ────────────────────────────────────── */}
        <div className="diagnosis">
          {/* Disease name */}
          <div className="diagnosis__header" id="diagnosis-header">
            <div className="diagnosis__label">Detected Condition</div>
            <div className="diagnosis__class-name">
              {formatClass(result.predicted_class)}
            </div>
          </div>

          {/* Dual scores */}
          <div className="scores">
            <div className="score-card" id="confidence-score">
              <div className="score-card__label">Confidence</div>
              <div className="score-card__value">{confidencePct}%</div>
              <div className="score-card__bar">
                <div
                  className="score-card__fill"
                  style={{ width: `${confidencePct}%` }}
                />
              </div>
            </div>
            <div className="score-card" id="explainability-score">
              <div className="score-card__label">Explainability</div>
              <div className="score-card__value">
                {explainScore != null ? `${explainScore}%` : '—'}
              </div>
              <div className="score-card__bar">
                <div
                  className="score-card__fill"
                  style={{ width: `${explainScore ?? 0}%` }}
                />
              </div>
            </div>
          </div>

          {/* Top-5 bar chart */}
          <div className="top5" id="top5-chart">
            <div className="top5__title">Top 5 Predictions</div>
            {result.top5.map((item, i) => {
              const pct = Math.round(item.confidence * 100);
              return (
                <div className="top5__row" key={item.class_name}>
                  <span className="top5__rank">#{i + 1}</span>
                  <span className="top5__name" title={formatClass(item.class_name)}>
                    {formatClass(item.class_name)}
                  </span>
                  <div className="top5__bar-wrap">
                    <div
                      className={`top5__bar top5__bar--${i + 1}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="top5__pct">{pct}%</span>
                </div>
              );
            })}
          </div>

          {/* Diagnosis note */}
          <div className="note" id="diagnosis-note">
            <div className="note__title">
              🔬 Diagnosis Note
            </div>
            <p className="note__text">{result.activation_summary}</p>
          </div>
        </div>
      </div>

      <div className="result__actions">
        <button
          className="btn btn--primary"
          onClick={onReset}
          id="new-analysis-btn"
          type="button"
        >
          ↻ New Analysis
        </button>
      </div>
    </div>
  );
}
