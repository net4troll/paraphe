import "server-only";

/**
 * Verrou d'exécution séquentiel par document (mémoire du process).
 * Garantit que deux signataires qui signent "en parallèle" sont appliqués
 * l'un après l'autre sur la bonne version du PDF.
 * Valable pour un déploiement mono-instance (Docker/Coolify simple).
 */
const locks = new Map<string, Promise<unknown>>();

export function withDocumentLock<T>(documentId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(documentId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(
    documentId,
    run.catch(() => {})
  );
  void previous.catch(() => {});
  return run;
}
