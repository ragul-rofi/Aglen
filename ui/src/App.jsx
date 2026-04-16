import { useState, useCallback } from 'react';
import UploadZone from './UploadZone';
import ResultPanel from './ResultPanel';
import LoadingState from './LoadingState';
import { explainImage } from './api';

export default function App() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFileSelected = useCallback((f, url) => {
    setFile(f);
    setPreviewUrl(url);
    setResult(null);
    setError('');
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await explainImage(file);
      setResult(data);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [file]);

  const handleReset = useCallback(() => {
    setFile(null);
    setPreviewUrl(null);
    setResult(null);
    setError('');
  }, []);

  return (
    <div className="app">
      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="header" id="app-header">
        <div className="header__brand">
          <div className="header__logo">🌿</div>
          <div>
            <div className="header__title">
              Aglen
            </div>
            <div className="header__subtitle">Explainable Crop AI</div>
          </div>
        </div>
        <div className="header__badge">Grad-CAM Powered</div>
      </header>

      {/* ── Main ────────────────────────────────────────────────── */}
      <main className="main" id="main-content">
        {/* Show upload zone when no result */}
        {!result && !loading && (
          <>
            <UploadZone
              onFileSelected={handleFileSelected}
              disabled={loading}
            />

            {file && (
              <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'center' }}>
                <button
                  className="btn btn--primary"
                  onClick={handleAnalyze}
                  disabled={loading}
                  id="analyze-btn"
                  type="button"
                >
                  🔬 Analyze Leaf
                </button>
              </div>
            )}

            {error && (
              <div className="upload-zone__error" style={{ marginTop: '1rem' }}>
                {error}
              </div>
            )}
          </>
        )}

        {/* Loading spinner */}
        {loading && <LoadingState />}

        {/* Results */}
        {result && (
          <ResultPanel
            result={result}
            previewUrl={previewUrl}
            onReset={handleReset}
          />
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer className="footer" id="app-footer">
        Built with <span className="footer__highlight">PyTorch + Grad-CAM</span> · 
        Explainability is the product ·{' '}
        <span className="footer__highlight">Jacob AI</span>
      </footer>
    </div>
  );
}
