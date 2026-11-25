/**
 * The WhatsApp QR library (Baileys -> libsignal) logs whole encryption session
 * objects, including private keys, e.g. console.info("Closing session:", session).
 * Keep the short message but never write the session object to the logs.
 *
 * Imported first in server.js so it is active before Baileys is loaded.
 */
const SESSION_LOG_PREFIXES = [
  'Closing session:',
  'Opening session:',
  'Removing old closed session:',
  'Session already closed',
];

const isSessionDump = (first) =>
  typeof first === 'string' && SESSION_LOG_PREFIXES.some((p) => first.startsWith(p));

for (const level of ['log', 'info', 'warn', 'debug']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    if (args.length > 1 && isSessionDump(args[0])) {
      return original(`[libsignal] ${args[0]} (session details hidden)`);
    }
    return original(...args);
  };
}
