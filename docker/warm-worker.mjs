// Next's standalone server initializes instrumentation on its first request.
// Start that request ourselves instead of waiting for the platform's delayed
// liveness probe. Only the worker uses this import; no external request/data.
if (process.env.HIREME_RUNTIME === 'worker') {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid worker port');
  let attempts = 0;
  const probe = async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(10000) });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch { /* Startup may still be preparing the request handler. */ }
    if (++attempts < 30) setTimeout(() => void probe(), 2000).unref();
    else console.error('Worker initialization did not complete; platform health checks remain active.');
  };
  setTimeout(() => void probe(), 1000).unref();
}
