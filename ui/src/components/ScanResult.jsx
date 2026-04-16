import { useMemo, useState } from 'react';

function toTitleCase(text) {
  return text
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDiseaseName(value = '') {
  const cleaned = value.split('___').pop() || value;
  return toTitleCase(cleaned.replaceAll('_', ' ').trim());
}

function confidenceClass(score) {
  if (score > 0.85) return 'scan-result__bar-fill--high';
  if (score >= 0.6) return 'scan-result__bar-fill--mid';
  return 'scan-result__bar-fill--low';
}

export default function ScanResult({
  result,
  originalSrc,
  saved,
  saving,
  onConfirm,
  onWrong,
  onSave,
  onScanAnother,
}) {
  const [imageMode, setImageMode] = useState('original');
  const [showWrongForm, setShowWrongForm] = useState(false);
  const [correctedClass, setCorrectedClass] = useState('');

  const predictions = useMemo(() => result?.top5 ?? [], [result]);
  const confidencePercent = Math.round((result?.confidence ?? 0) * 100);

  return (
    <section className="scan-result">
      <div className="scan-result__viewer">
        <div className="scan-result__pills" role="tablist" aria-label="Image toggle">
          <button
            type="button"
            className={`scan-result__pill ${imageMode === 'original' ? 'is-active' : ''}`}
            onClick={() => setImageMode('original')}
          >
            Original
          </button>
          <button
            type="button"
            className={`scan-result__pill ${imageMode === 'heatmap' ? 'is-active' : ''}`}
            onClick={() => setImageMode('heatmap')}
          >
            Heatmap
          </button>
        </div>

        <div className="scan-result__image-stack">
          <img
            src={originalSrc}
            alt="Original leaf"
            className={`scan-result__image ${imageMode === 'original' ? 'is-visible' : ''}`}
          />
          <img
            src={`data:image/png;base64,${result.heatmap_base64}`}
            alt="GradCAM heatmap"
            className={`scan-result__image ${imageMode === 'heatmap' ? 'is-visible' : ''}`}
          />
        </div>
      </div>

      <article className="scan-result__disease-card">
        <h2>{formatDiseaseName(result.predicted_class)}</h2>
        <div className="scan-result__bar-track" aria-hidden="true">
          <div
            className={`scan-result__bar-fill ${confidenceClass(result.confidence)}`}
            style={{ width: `${confidencePercent}%` }}
          />
        </div>
        <p className="scan-result__confidence-label">Confidence: {confidencePercent}%</p>
      </article>

      <article className="scan-result__note">
        <h3>Why this diagnosis</h3>
        <p>{result.activation_summary}</p>
      </article>

      <section className="scan-result__top5" aria-label="Top predictions">
        <h3>Top 5 predictions</h3>
        <ul>
          {predictions.map((item) => {
            const pct = Math.round(item.confidence * 100);
            return (
              <li key={item.class_name}>
                <div className="scan-result__top5-row">
                  <span>{formatDiseaseName(item.class_name)}</span>
                  <span>{pct}%</span>
                </div>
                <div className="scan-result__mini-track" aria-hidden="true">
                  <div className="scan-result__mini-fill" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="scan-result__actions">
        <button type="button" className="btn btn--confirm" onClick={onConfirm}>
          Confirm
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setShowWrongForm((prev) => !prev)}
        >
          Wrong?
        </button>
        <button
          type="button"
          className="btn btn--outline"
          onClick={onSave}
          disabled={saved || saving}
        >
          {saved ? 'Saved' : saving ? 'Saving...' : 'Save to history'}
        </button>
      </div>

      {showWrongForm && (
        <form
          className="scan-result__wrong-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!correctedClass) return;
            onWrong(correctedClass);
            setShowWrongForm(false);
          }}
        >
          <label htmlFor="corrected-class">Correct class</label>
          <select
            id="corrected-class"
            value={correctedClass}
            onChange={(event) => setCorrectedClass(event.target.value)}
          >
            <option value="">Select a class</option>
            {predictions.map((item) => (
              <option key={item.class_name} value={item.class_name}>
                {formatDiseaseName(item.class_name)}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn--primary">
            Submit correction
          </button>
        </form>
      )}

      <button type="button" className="btn btn--primary scan-result__scan-another" onClick={onScanAnother}>
        Scan another leaf
      </button>
    </section>
  );
}
