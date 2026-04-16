import { useEffect, useMemo, useRef, useState } from 'react';

const DISMISS_KEY = 'aglen.installPromptDismissedAt';
const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export default function InstallPrompt() {
  const deferredPromptRef = useRef(null);
  const [visible, setVisible] = useState(false);

  const isMobile = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 820px)').matches;
  }, []);

  useEffect(() => {
    if (!isMobile) return undefined;

    const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_WINDOW_MS) return undefined;

    const timer = window.setTimeout(() => {
      if (deferredPromptRef.current) setVisible(true);
    }, 30000);

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      deferredPromptRef.current = event;
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    };
  }, [isMobile]);

  async function handleInstall() {
    const prompt = deferredPromptRef.current;
    if (!prompt) return;

    await prompt.prompt();
    await prompt.userChoice;
    deferredPromptRef.current = null;
    setVisible(false);
  }

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="install-prompt" role="dialog" aria-live="polite">
      <p>Add AgroLens to your home screen for faster access</p>
      <div className="install-prompt__actions">
        <button type="button" className="install-prompt__install" onClick={handleInstall}>
          Install
        </button>
        <button type="button" className="install-prompt__dismiss" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
