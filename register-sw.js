// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.warn('SW registration failed:', err));

    // Listen for SW messages (e.g., check imminent trips)
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'SW_CHECK_TRIPS') {
        // Trigger the check in app.js context via custom event
        window.dispatchEvent(new CustomEvent('sw-check-trips'));
      }
    });

    // Ping SW every 60 seconds
    setInterval(() => {
      navigator.serviceWorker.controller?.postMessage({ type: 'CHECK_TRIPS' });
    }, 60_000);
  });
}
