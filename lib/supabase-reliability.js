'use strict';

const RETRYABLE_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
]);

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_MESSAGE_RE = /fetch failed|network|socket|timeout|timed out|connection reset|econnreset|econnrefused|temporary|temporarily unavailable/i;

class SupabaseOperationError extends Error {
  constructor(operation, cause) {
    super(`${operation}: ${cause?.message || 'Supabase operation failed'}`, { cause });
    this.name = 'SupabaseOperationError';
    this.operation = operation;
    this.code = cause?.code;
    this.status = cause?.status || cause?.statusCode;
    this.details = cause?.details;
    this.hint = cause?.hint;
    this.retryable = isRetryableSupabaseError(cause);
  }
}

function isRetryableSupabaseError(error) {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const status = Number(error.status || error.statusCode || 0);
  return RETRYABLE_CODES.has(code) ||
    RETRYABLE_STATUSES.has(status) ||
    RETRYABLE_MESSAGE_RE.test(String(error.message || ''));
}

function assertSupabaseSuccess(result, operation) {
  if (!result || typeof result !== 'object') {
    throw new SupabaseOperationError(operation, new Error('Supabase returned no result'));
  }
  if (result.error) throw new SupabaseOperationError(operation, result.error);
  return result.data;
}

async function executeSupabase(operation, query, options = {}) {
  const maxAttempts = Math.max(1, options.maxAttempts || 2);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 200);
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await query();
      return assertSupabaseSuccess(result, operation);
    } catch (error) {
      const normalized = error instanceof SupabaseOperationError
        ? error
        : new SupabaseOperationError(operation, error);
      if (!normalized.retryable || attempt === maxAttempts) throw normalized;
      await sleep(baseDelayMs * (2 ** (attempt - 1)));
    }
  }
}

module.exports = {
  SupabaseOperationError,
  assertSupabaseSuccess,
  executeSupabase,
  isRetryableSupabaseError,
};
