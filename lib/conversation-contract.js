'use strict';

const crypto = require('crypto');

const CLIENT_EVENT_ID_RE = /^msg_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ConversationContractError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ConversationContractError';
    this.status = status;
  }
}

function normalizeStoredMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.filter(message =>
    message &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string'
  );
}

function acceptClientEvent(sess, event, now = new Date()) {
  if (!event || typeof event !== 'object') {
    throw new ConversationContractError('event 객체가 필요합니다.');
  }
  if (!CLIENT_EVENT_ID_RE.test(event.id || '')) {
    throw new ConversationContractError('유효하지 않은 event.id입니다.');
  }
  if (typeof event.content !== 'string' || event.content.length === 0 || event.content.length > 20000) {
    throw new ConversationContractError('event.content는 1~20000자 문자열이어야 합니다.');
  }

  const existing = sess.messages.find(message => message.id === event.id);
  if (existing) {
    if (existing.role !== 'user' || existing.content !== event.content) {
      throw new ConversationContractError('같은 event.id에 다른 내용이 제출되었습니다.', 409);
    }
    return { message: existing, isNew: false };
  }

  const message = {
    id: event.id,
    role: 'user',
    content: event.content,
    ts: now.toISOString(),
  };
  sess.messages.push(message);
  return { message, isNew: true };
}

function appendServerMessage(sess, message) {
  const existing = message.id && sess.messages.find(item => item.id === message.id);
  if (existing) return existing;
  const stored = {
    ...message,
    role: 'assistant',
    ts: message.ts || new Date().toISOString(),
  };
  sess.messages.push(stored);
  return stored;
}

function findReply(sess, eventId) {
  return sess.messages.find(message =>
    message.role === 'assistant' && message.replyTo === eventId
  ) || null;
}

function legacyHistoryToEvent(sessionId, messages) {
  if (!Array.isArray(messages)) return null;
  const lastUser = [...messages].reverse().find(message =>
    message?.role === 'user' &&
    typeof message.content === 'string' &&
    message.content.length > 0 &&
    message.content.length <= 20000
  );
  if (!lastUser) return null;
  const digest = crypto.createHash('sha256')
    .update(`${sessionId}\0${lastUser.mid || ''}\0${lastUser.ts || ''}\0${lastUser.content}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  digest[12] = '4';
  digest[16] = ['8', '9', 'a', 'b'][parseInt(digest[16], 16) % 4];
  const hex = digest.join('');
  return {
    id: `msg_${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    content: lastUser.content,
  };
}

module.exports = {
  ConversationContractError,
  acceptClientEvent,
  appendServerMessage,
  findReply,
  legacyHistoryToEvent,
  normalizeStoredMessages,
};
