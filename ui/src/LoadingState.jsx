export default function LoadingState() {
  return (
    <div className="loading" id="loading-state">
      <div className="loading__spinner" />
      <div className="loading__text">Analyzing leaf…</div>
      <div className="loading__subtext">Running model inference + Grad-CAM</div>
    </div>
  );
}
