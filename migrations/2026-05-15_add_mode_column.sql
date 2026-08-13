-- ============================================================
-- 2026-05-15 conversations 테이블 mode 컬럼 추가
--
-- 목적: 어드민 개입 상태(sess.mode = 'admin') 영속화.
--   - 서버 재시작(배포) 시 in-memory sessions Map 이 휘발 → 어드민 모드 소실
--   - DB 에 저장해 서버 부팅 시 다시 메모리로 복원
--
-- 관련 이슈: rumanesystem/lumane-cloudtype#21
--
-- 실행 위치: Supabase Dashboard → SQL Editor (yqjyaxceeovllkuknvrf)
--   * service_role 키로 PostgREST 통해 DDL 불가 → 대시보드에서 1회 수동 실행
-- ============================================================

ALTER TABLE lumane.conversations
  ADD COLUMN IF NOT EXISTS mode varchar(10) DEFAULT 'ai';

ALTER TABLE lumane.test_conversations
  ADD COLUMN IF NOT EXISTS mode varchar(10) DEFAULT 'ai';

-- 확인용
-- SELECT session_id, mode, message_count, saved_at
-- FROM lumane.conversations
-- WHERE mode = 'admin'
-- ORDER BY saved_at DESC
-- LIMIT 10;
