'use strict';

const SESSION_RECOVERY_TTL_MS = 60 * 60 * 1000;
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;

function parseTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isRecoverableSession(row, now = Date.now(), ttlMs = SESSION_RECOVERY_TTL_MS) {
  const savedAt = parseTimestamp(row?.saved_at);
  return savedAt !== null && savedAt <= now && now - savedAt <= ttlMs;
}

function isIdleSession(lastActivity, now = Date.now(), ttlMs = SESSION_IDLE_TTL_MS) {
  const activeAt = parseTimestamp(lastActivity);
  return activeAt !== null && activeAt <= now && now - activeAt > ttlMs;
}

function normalizeCounter(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function recoverRuntimeState(messages, tokenRow, savedAt) {
  const storedMessages = Array.isArray(messages) ? messages : [];
  const fallbackSent = storedMessages.some(message =>
    message?.role === 'assistant' && typeof message.id === 'string' && message.id.startsWith('fallback_')
  );
  const slackNotified = storedMessages.some(message => message?.role === 'user');
  const latestMessageAt = storedMessages.reduce((latest, message) => {
    const timestamp = parseTimestamp(message?.ts || message?.time);
    return timestamp !== null && timestamp > latest ? timestamp : latest;
  }, parseTimestamp(savedAt) || 0);
  const lastReadAt = storedMessages.reduce((latest, message) => {
    const timestamp = parseTimestamp(message?.readAt);
    return timestamp !== null && timestamp > latest ? timestamp : latest;
  }, 0);

  return {
    fallbackSent,
    slackNotified,
    lastReadAt: lastReadAt ? new Date(lastReadAt).toISOString() : null,
    lastPersistedAt: parseTimestamp(savedAt),
    lastMessageAt: latestMessageAt || null,
    tokens: {
      input: normalizeCounter(tokenRow?.input_tokens),
      output: normalizeCounter(tokenRow?.output_tokens),
      cacheWrite: normalizeCounter(tokenRow?.cache_write_tokens),
      cacheRead: normalizeCounter(tokenRow?.cache_read_tokens),
      turns: normalizeCounter(tokenRow?.turns),
    },
  };
}

module.exports = {
  SESSION_IDLE_TTL_MS,
  SESSION_RECOVERY_TTL_MS,
  isIdleSession,
  isRecoverableSession,
  recoverRuntimeState,
};
