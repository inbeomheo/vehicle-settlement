import { openDB, type DBSchema } from 'idb';
import type { CreateUseInput } from '@/server/services/schemas';
import type { FormValues, FormError } from '@/components/use-form/model';
import type { Lookups, Mode, UseDetail, UseList, User, evidenceKinds } from '../types';
export type PendingEvidence = {
  client_upload_id: string;
  kind: keyof typeof evidenceKinds;
  original_name?: string;
  blob?: Blob;
  text_value?: string;
  serverId?: string;
  replacesId?: string;
  reason?: string;
  status: 'pending' | 'uploading' | 'failed' | 'uploaded';
  progress: number;
  error?: string;
};
export type Draft = {
  id: string;
  userId: string;
  mode: Mode;
  form: FormValues;
  // Local UI state only; optional for drafts created before visibility was remembered.
  revealedFields?: string[];
  // False only for a new, untouched form. Older stored drafts remain recoverable.
  hasUserInput?: boolean;
  uploads: PendingEvidence[];
  updatedAt: number;
  serverId?: string;
  server?: UseDetail;
  // Separate from display detail, which may be refreshed while local edits remain.
  lastSaved?: UseDetail;
  removedEvidenceIds?: string[];
  version?: number;
  phase: 'editing' | 'queued' | 'saved' | 'blocked' | 'conflict';
  intent?: 'save' | 'submit';
  request?: { key: string; payload: CreateUseInput & { version?: number } };
  // Persist before sending POST. Editing/canceling attachments must not discard it.
  pendingCreate?: { request: NonNullable<Draft['request']>; form: FormValues };
  savedRequest?: boolean;
  submitRequest?: { key: string; version: number };
  error?: string;
  inputError?: boolean;
  inputErrors?: FormError[];
  conflict?: UseDetail;
};
export type Bootstrap = { user: User; lookups: Lookups; recent: UseList; cachedAt: number };
interface OfflineDB extends DBSchema {
  drafts: { key: string; value: Draft };
  cache: { key: string; value: unknown };
}
export const ACTIVE_USER = 'vehicle-active-user';
export const LOGGED_OUT = 'vehicle-logged-out';
export function markLoggedOut() {
  localStorage.setItem(LOGGED_OUT, '1');
  isolateUser();
}
export function acceptLogin(id: string) {
  localStorage.removeItem(LOGGED_OUT);
  activateUser(id);
}
export const OFFLINE_EVENT = 'vehicle-offline-change';
export function activeUser() {
  return localStorage.getItem(ACTIVE_USER);
}
export function activateUser(id: string) {
  localStorage.setItem(ACTIVE_USER, id);
}
export function isolateUser() {
  localStorage.removeItem(ACTIVE_USER);
  window.dispatchEvent(new Event(OFFLINE_EVENT));
}
const databases = new Map<string, ReturnType<typeof openDB<OfflineDB>>>();
export function userDb(userId: string) {
  if (!databases.has(userId))
    databases.set(
      userId,
      openDB<OfflineDB>(`vehicle-w2-${userId}`, 1, {
        upgrade(db) {
          db.createObjectStore('drafts', { keyPath: 'id' });
          db.createObjectStore('cache');
        },
      }),
    );
  return databases.get(userId)!;
}
export function notifyChange() {
  window.dispatchEvent(new Event(OFFLINE_EVENT));
}
export async function putDraft(draft: Draft) {
  await (await userDb(draft.userId)).put('drafts', draft);
  notifyChange();
}
export async function getDraft(userId: string, id: string) {
  return (await userDb(userId)).get('drafts', id);
}
export async function listDrafts(userId: string) {
  return (await (await userDb(userId)).getAll('drafts')).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function cacheValue(userId: string, key: string, value: unknown) {
  await (await userDb(userId)).put('cache', value, key);
}
export async function cachedValue<T>(userId: string, key: string) {
  return (await (await userDb(userId)).get('cache', key)) as T | undefined;
}
export async function removeDraft(userId: string, id: string) {
  await (await userDb(userId)).delete('drafts', id);
  notifyChange();
}

export function shouldPersistDraft(draft: Draft) {
  return (
    draft.hasUserInput !== false || !!draft.serverId || !!draft.pendingCreate || draft.uploads.length > 0
  );
}

export function isUnsent(draft: Draft) {
  return shouldPersistDraft(draft) && draft.phase !== 'saved' && !draft.inputError;
}

export async function flushDrafts(reason?: 'update') {
  const pending: Promise<void>[] = [];
  window.dispatchEvent(
    new CustomEvent('vehicle-flush-drafts', {
      detail: { reason, waitUntil: (promise: Promise<void>) => pending.push(promise) },
    }),
  );
  await Promise.all(pending);
}
