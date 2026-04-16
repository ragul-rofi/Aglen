import { useEffect, useMemo, useRef, useState } from 'react';
import ScanResult from '../../components/ScanResult';
import { explainScan, explainScanBase64 } from '../../api';
import { useScanStore } from '../../store/scanStore';

const cropOptions = ['tomato', 'potato', 'pepper', 'maize', 'rice'];
const growthOptions = ['seedling', 'vegetative', 'flowering', 'fruiting', 'mature'];
const OFFLINE_QUEUE_KEY = 'aglen.offlineScanQueue';
const MAX_QUEUED_SCANS = 3;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      resolve(value.split(',').pop() || '');
    };
    reader.onerror = () => reject(new Error('Unable to queue scan image.'));
    reader.readAsDataURL(file);
  });
}

function readQueue() {
  try {
    const raw = window.localStorage.getItem(OFFLINE_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(entries) {
  window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(entries));
}

export default function ScanPage({ userId }) {
  const [mode, setMode] = useState('capture');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [cropType, setCropType] = useState('');
  const [growthStage, setGrowthStage] = useState('');
  const [saving, setSaving] = useState(false);
  const [notification, setNotification] = useState('');
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const inputRef = useRef(null);

  const addScan = useScanStore((state) => state.addScan);
  const updateFeedback = useScanStore((state) => state.updateFeedback);

  const isSaved = Boolean(result?.scan_id);

  const currentScanPayload = useMemo(
    () => ({
      predicted_class: result?.predicted_class,
      confidence: result?.confidence,
      top5: result?.top5,
      activation_summary: result?.activation_summary,
      crop_type: cropType || null,
      growth_stage: growthStage || null,
    }),
    [result, cropType, growthStage],
  );

  useEffect(() => {
    const goOnline = async () => {
      setIsOnline(true);

      const queued = readQueue();
      if (queued.length === 0) return;

      const remaining = [];
      let processed = 0;

      for (const item of queued) {
        try {
          const analyzed = await explainScanBase64(item.imageBase64);
          addScan({
            id: item.id,
            user_id: item.userId,
            predicted_class: analyzed.predicted_class,
            confidence: analyzed.confidence,
            top5: analyzed.top5,
            activation_summary: analyzed.activation_summary,
            crop_type: item.cropType,
            growth_stage: item.growthStage,
            image_url: '',
            heatmap_url: analyzed.heatmap_base64,
            created_at: item.createdAt,
          });
          processed += 1;
        } catch {
          remaining.push(item);
        }
      }

      writeQueue(remaining);
      if (processed > 0) {
        setNotification('Queued scan analyzed');
      }
    };

    const goOffline = () => setIsOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    if (navigator.onLine) {
      void goOnline();
    }

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [addScan]);

  async function setSelectedFile(file) {
    if (!file) return;

    if (!navigator.onLine) {
      try {
        const imageBase64 = await fileToBase64(file);
        const queued = readQueue();
        const next = [
          ...queued,
          {
            id: `queued-${Date.now()}`,
            userId,
            imageBase64,
            cropType: cropType || null,
            growthStage: growthStage || null,
            createdAt: new Date().toISOString(),
          },
        ].slice(-MAX_QUEUED_SCANS);
        writeQueue(next);
        setNotification('Scan queued — will analyze when connected');
        setMode('capture');
        setImageFile(null);
        setImagePreviewUrl('');
        setResult(null);
        setError('');
        return;
      } catch (err) {
        setError(err.message || 'Unable to queue scan offline.');
        return;
      }
    }

    const url = URL.createObjectURL(file);
    setImageFile(file);
    setImagePreviewUrl(url);
    setResult(null);
    setError('');
    setMode('preview');
  }

  function resetFlow() {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setMode('capture');
    setImageFile(null);
    setImagePreviewUrl('');
    setResult(null);
    setError('');
    setNotification('');
    setCropType('');
    setGrowthStage('');
  }

  async function runAnalyze() {
    if (!imageFile) return;

    if (!navigator.onLine) {
      try {
        const imageBase64 = await fileToBase64(imageFile);
        const queued = readQueue();
        const next = [
          ...queued,
          {
            id: `queued-${Date.now()}`,
            userId,
            imageBase64,
            cropType: cropType || null,
            growthStage: growthStage || null,
            createdAt: new Date().toISOString(),
          },
        ].slice(-MAX_QUEUED_SCANS);
        writeQueue(next);
        setNotification('Scan queued — will analyze when connected');
        resetFlow();
        return;
      } catch (err) {
        setError(err.message || 'Unable to queue scan offline.');
        return;
      }
    }

    setMode('analyzing');
    setError('');
    try {
      const data = await explainScan(imageFile, userId);
      const enriched = {
        ...data,
        crop_type: cropType || null,
        growth_stage: growthStage || null,
      };
      setResult(enriched);
      if (enriched.scan_id) {
        addScan({
          id: enriched.scan_id,
          user_id: userId,
          predicted_class: enriched.predicted_class,
          confidence: enriched.confidence,
          top5: enriched.top5,
          activation_summary: enriched.activation_summary,
          crop_type: enriched.crop_type,
          growth_stage: enriched.growth_stage,
          image_url: imagePreviewUrl,
          heatmap_url: enriched.heatmap_base64,
          created_at: new Date().toISOString(),
        });
      }
      setMode('result');
    } catch (err) {
      setError(err.message || 'Failed to analyze image.');
      setMode('preview');
    }
  }

  async function handleConfirm() {
    if (!result?.scan_id) return;
    try {
      await updateFeedback(result.scan_id, 'confirmed', null);
      setResult((prev) => ({ ...prev, feedback: 'confirmed' }));
    } catch (err) {
      setError(err.message || 'Unable to update feedback.');
    }
  }

  async function handleWrong(correctedClass) {
    if (!result?.scan_id) return;
    try {
      await updateFeedback(result.scan_id, 'wrong', correctedClass);
      setResult((prev) => ({ ...prev, feedback: 'wrong', corrected_class: correctedClass }));
    } catch (err) {
      setError(err.message || 'Unable to submit correction.');
    }
  }

  async function handleSaveToHistory() {
    if (isSaved || !imageFile || !userId) return;
    setSaving(true);
    try {
      const data = await explainScan(imageFile, userId);
      if (data.scan_id) {
        setResult((prev) => ({ ...prev, scan_id: data.scan_id }));
        addScan({
          id: data.scan_id,
          user_id: userId,
          ...currentScanPayload,
          image_url: imagePreviewUrl,
          heatmap_url: result?.heatmap_base64,
          created_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      setError(err.message || 'Unable to save this scan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="scan-page">
      {mode === 'capture' && (
        <div
          className="scan-capture"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const dropped = event.dataTransfer.files?.[0];
            setSelectedFile(dropped);
          }}
        >
          <div className="scan-capture__intro">
            <h2>Capture a leaf image</h2>
            <p>Use your camera in the field or drop a file on desktop.</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(event) => setSelectedFile(event.target.files?.[0])}
          />
          <button type="button" className="scan-capture__button" onClick={() => inputRef.current?.click()}>
            <span />
          </button>
          <button type="button" className="scan-capture__gallery" onClick={() => inputRef.current?.click()}>
            Upload from gallery
          </button>
          {error && <p className="page-error">{error}</p>}
        </div>
      )}

      {mode === 'preview' && (
        <div className="scan-preview">
          <img src={imagePreviewUrl} alt="Selected leaf" className="scan-preview__image" />
          <div className="scan-preview__fields">
            <label>
              Crop type (optional)
              <select value={cropType} onChange={(event) => setCropType(event.target.value)}>
                <option value="">Skip</option>
                {cropOptions.map((crop) => (
                  <option key={crop} value={crop}>
                    {crop}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Growth stage (optional)
              <select value={growthStage} onChange={(event) => setGrowthStage(event.target.value)}>
                <option value="">Skip</option>
                {growthOptions.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="scan-preview__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={runAnalyze}
              disabled={!isOnline}
              title={!isOnline ? 'Connect to internet to analyze' : undefined}
            >
              Analyze leaf
            </button>
            <button type="button" className="btn btn--ghost" onClick={resetFlow}>
              Retake
            </button>
          </div>
          {!isOnline && <p className="scan-offline-hint">Connect to internet to analyze</p>}
          {error && <p className="page-error">{error}</p>}
        </div>
      )}

      {mode === 'analyzing' && (
        <div className="scan-analyzing">
          <img src={imagePreviewUrl} alt="Analyzing leaf" className="scan-analyzing__image" />
          <div className="scan-analyzing__overlay">
            <div className="scan-analyzing__pulse" />
            <p>Analyzing...</p>
          </div>
        </div>
      )}

      {mode === 'result' && result && (
        <ScanResult
          result={result}
          originalSrc={imagePreviewUrl}
          saved={isSaved}
          saving={saving}
          onConfirm={handleConfirm}
          onWrong={handleWrong}
          onSave={handleSaveToHistory}
          onScanAnother={resetFlow}
        />
      )}

      {notification && <p className="scan-notification">{notification}</p>}
    </section>
  );
}
