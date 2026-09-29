import { ApiError } from '../api';
import type { UseDetail } from '../types';
import type { Draft } from './store';

type File = UseDetail['evidence'][number];
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}
function fileContent(file: File) {
  const { updated_at: _updated, upload_status: _status, ...content } = file;
  void _updated;
  void _status;
  return content;
}

// Count only evidence transitions attributable to this queue. A coincident
// manager edit adds another version even when its visible values are unchanged.
function ownEvidenceSteps(draft: Draft, before: UseDetail, latest: UseDetail): number | null {
  let steps = 0;
  for (const file of latest.evidence ?? []) {
    const old = before.evidence?.find((value) => value.id === file.id);
    if (old && canonical(fileContent(old)) === canonical(fileContent(file))) continue;
    const local = draft.uploads.find((value) => value.client_upload_id === file.client_upload_id);
    if (!local || file.uploaded_by !== draft.userId || local.kind !== file.kind) return null;
    if (local.blob) {
      if (
        file.original_name !== local.original_name ||
        file.mime !== local.blob.type ||
        file.size !== local.blob.size
      )
        return null;
    } else if (file.text_value !== local.text_value?.trim()) return null;
    if (!old) steps += 1 + Number(!!local.blob && file.upload_status === 'UPLOADED');
    else {
      if (old.upload_status === 'UPLOADED' || file.upload_status !== 'UPLOADED') return null;
      // Completion may change only the upload result, never the metadata.
      const { sha256: _oldHash, uploaded_at: _oldAt, ...oldMeta } = fileContent(old);
      const { sha256: _newHash, uploaded_at: _newAt, ...newMeta } = fileContent(file);
      void _oldHash;
      void _oldAt;
      void _newHash;
      void _newAt;
      if (canonical(oldMeta) !== canonical(newMeta)) return null;
      steps++;
    }
  }
  for (const old of before.evidence ?? []) {
    if (latest.evidence?.some((file) => file.id === old.id)) continue;
    if (draft.removedEvidenceIds?.includes(old.id)) {
      steps++;
      continue;
    }
    if (
      !draft.uploads.some(
        (local) =>
          local.replacesId === old.id &&
          latest.evidence?.some((file) => file.client_upload_id === local.client_upload_id),
      )
    )
      return null;
  }
  return steps;
}
function businessContent(use: UseDetail, evidenceEdit: boolean, mode: Draft['mode']) {
  const {
    version: _version,
    updated_at: _updated,
    evidence: _evidence,
    revisions,
    review_status,
    current_revision_no,
    approved_revision_id,
    driver_confirmed_at,
    charge_lines,
    ...header
  } = use;
  void _version;
  void _updated;
  void _evidence;
  const reviewed = ['SUBMITTED', 'APPROVED'].includes(review_status);
  const autoSubmit = evidenceEdit && reviewed && mode === 'manager';
  return {
    ...header,
    review_status: evidenceEdit && reviewed ? (mode === 'driver' ? 'DRAFT' : 'SUBMITTED') : review_status,
    current_revision_no,
    approved_revision_id: evidenceEdit ? null : approved_revision_id,
    driver_confirmed_at: evidenceEdit ? null : driver_confirmed_at,
    revisions: evidenceEdit ? undefined : revisions,
    autoSubmit,
    charge_lines: charge_lines?.map(({ version: _v, updated_at: _at, ...line }) => {
      void _v;
      void _at;
      return evidenceEdit && line.charge_type !== 'ADJUSTMENT'
        ? { ...line, approved_amount: null, tax_amount: null, line_review_status: 'PENDING' }
        : line;
    }),
  };
}
export function rememberServer(draft: Draft, server: UseDetail) {
  draft.server = server;
  draft.version = server.version;
  draft.lastSaved = server;
}
export function reconcileServer(draft: Draft, latest: UseDetail) {
  const before = draft.lastSaved ?? (draft.server?.version === draft.version ? draft.server : undefined);
  const steps = before ? ownEvidenceSteps(draft, before, latest) : null;
  let matches = false;
  if (before && steps !== null) {
    const expected = businessContent(before, steps > 0, draft.mode);
    const current = businessContent(latest, false, draft.mode);
    if (steps > 0) {
      expected.current_revision_no += expected.autoSubmit ? steps : 0;
      expected.autoSubmit = false;
      current.revisions = undefined;
    }
    matches = latest.version === before.version + steps && canonical(expected) === canonical(current);
  }
  if (!matches) {
    draft.conflict = latest;
    throw new ApiError(
      409,
      'VERSION_CONFLICT',
      '다른 수정 내용이 있습니다. 최신 값을 확인한 뒤 다시 저장·제출하세요.',
    );
  }
  rememberServer(draft, latest);
  draft.removedEvidenceIds = undefined;
}
