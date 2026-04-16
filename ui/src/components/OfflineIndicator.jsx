import { useEffect, useState } from 'react';

export default function OfflineIndicator() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="offline-indicator" role="status" aria-live="polite">
      Offline mode — scan history available, new scans paused
    </div>
  );
}
