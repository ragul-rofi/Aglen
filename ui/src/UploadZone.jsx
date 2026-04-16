import { useRef, useState, useCallback } from 'react';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadZone({ onFileSelected, disabled }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  const [error, setError] = useState('');

  const validate = useCallback((file) => {
    if (!ACCEPTED.includes(file.type)) {
      return `Unsupported format: ${file.type || 'unknown'}. Use JPG, PNG, or WebP.`;
    }
    if (file.size > MAX_SIZE) {
      return `File too large (${formatSize(file.size)}). Maximum is 10 MB.`;
    }
    return null;
  }, []);

  const handleFile = useCallback((file) => {
    setError('');
    const err = validate(file);
    if (err) {
      setError(err);
      setPreview(null);
      setFileInfo(null);
      return;
    }

    setFileInfo({ name: file.name, size: formatSize(file.size) });
    const url = URL.createObjectURL(file);
    setPreview(url);
    onFileSelected(file, url);
  }, [validate, onFileSelected]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleChange = useCallback((e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleClear = useCallback((e) => {
    e.stopPropagation();
    setPreview(null);
    setFileInfo(null);
    setError('');
    if (inputRef.current) inputRef.current.value = '';
    onFileSelected(null, null);
  }, [onFileSelected]);

  const zoneClass = [
    'upload-zone',
    dragOver && 'upload-zone--dragover',
    preview && 'upload-zone--has-file',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={zoneClass}
      onClick={() => !disabled && !preview && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp"
        onChange={handleChange}
        style={{ display: 'none' }}
        disabled={disabled}
        id="upload-input"
      />

      {!preview ? (
        <>
          <div className="upload-zone__icon">🍃</div>
          <div className="upload-zone__title">Drop a leaf image here</div>
          <div className="upload-zone__hint">
            or <strong onClick={() => inputRef.current?.click()}>browse files</strong>
          </div>
          <div className="upload-zone__formats">JPG · PNG · WebP — max 10 MB</div>
        </>
      ) : (
        <div className="upload-zone__preview-wrap">
          <img
            src={preview}
            alt="Selected leaf"
            className="upload-zone__preview-img"
          />
          <div className="upload-zone__file-info">
            <div className="upload-zone__file-name">{fileInfo?.name}</div>
            <div className="upload-zone__file-size">{fileInfo?.size}</div>
            <div className="upload-zone__actions">
              <button
                className="btn btn--outline"
                onClick={handleClear}
                type="button"
                id="clear-btn"
              >
                ✕ Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="upload-zone__error">{error}</div>}
    </div>
  );
}
