'use strict';

async function insertIdempotentQuote({
  payload,
  insert,
  findByRequestId,
  regenerateQuoteNumber,
  maxQuoteNumberRetries = 2,
}) {
  let current = { ...payload };
  for (let attempt = 0; ; attempt++) {
    try {
      const data = await insert(current);
      return { data, payload: current, deduplicated: false };
    } catch (error) {
      if (error.code !== '23505' || !current.request_id) throw error;
      const existing = await findByRequestId(current.request_id);
      if (existing) return { data: existing, payload: current, deduplicated: true };
      if (attempt >= maxQuoteNumberRetries) throw error;
      current = { ...current, quote_number: regenerateQuoteNumber() };
    }
  }
}

module.exports = { insertIdempotentQuote };
