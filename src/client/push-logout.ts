/** Best-effort cleanup on both sides; a push outage must not prevent logout. */
export async function stopBrowserPush() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    await Promise.allSettled([
      subscription.unsubscribe(),
      fetch('/api/push/subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }),
    ]);
  } catch {
    // Unsupported/unavailable push APIs do not affect session logout.
  }
}
