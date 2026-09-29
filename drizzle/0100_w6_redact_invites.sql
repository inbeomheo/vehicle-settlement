-- Remove invitation secrets persisted by older versions of the idempotency wrapper.
UPDATE idempotency_keys
SET response_body = jsonb_set(
  response_body #- '{data,invite_url}',
  '{data,message}',
  to_jsonb('이미 생성된 초대입니다. 원본 링크는 다시 표시할 수 없습니다. 초대 목록에서 취소 후 새 초대를 생성하세요.'::text)
)
WHERE route = 'POST /api/invites'
  AND response_body #> '{data,invite_url}' IS NOT NULL;
