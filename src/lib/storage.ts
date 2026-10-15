import "server-only";

import fs from "fs/promises";
import path from "path";

/** Les identifiants proviennent tous de la base (uuid) : on refuse tout le reste. */
function assertSafeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error("Identifiant de document invalide");
  }
  return id;
}

/** Résout un chemin sous la racine du stockage et refuse toute sortie de la racine. */
function resolveUnderStorage(...segments: string[]): string {
  const root = path.resolve(/* turbopackIgnore: true */ storageDir());
  const target = path.resolve(/* turbopackIgnore: true */ root, ...segments);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("Chemin hors stockage");
  }
  return target;
}

export function storageDir(): string {
  const configured = process.env.STORAGE_DIR?.trim() || "./storage";
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configured);
}

export function originalPath(docId: string): string {
  return resolveUnderStorage("originals", `${assertSafeId(docId)}.pdf`);
}

export function versionPath(docId: string, version: number): string {
  const safeVersion = Math.max(0, Math.floor(Number(version) || 0));
  return resolveUnderStorage("documents", assertSafeId(docId), `version-${safeVersion}.pdf`);
}

export function documentDir(docId: string): string {
  return resolveUnderStorage("documents", assertSafeId(docId));
}

export async function ensureDocumentDir(docId: string): Promise<void> {
  await fs.mkdir(documentDir(docId), { recursive: true });
}

export async function ensureStorageDirs(): Promise<void> {
  await fs.mkdir(resolveUnderStorage("originals"), { recursive: true });
  await fs.mkdir(resolveUnderStorage("documents"), { recursive: true });
}

/** Lit un fichier du stockage en bloquant toute traversée de chemin. */
export async function readStoredFile(absolutePath: string): Promise<Buffer> {
  const resolved = path.resolve(/* turbopackIgnore: true */ absolutePath);
  const root = path.resolve(storageDir());
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Chemin hors stockage");
  }
  return fs.readFile(resolved);
}

export async function removeDocumentFiles(docId: string): Promise<void> {
  const safeId = assertSafeId(docId);
  await fs.rm(documentDir(safeId), { recursive: true, force: true });
  await fs.rm(originalPath(safeId), { force: true });
}
