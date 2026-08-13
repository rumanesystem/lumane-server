'use strict';

async function runOptionalSync(operation, onError) {
  try {
    await operation();
    return true;
  } catch (error) {
    try {
      await onError(error);
    } catch {
      // Reporting must not turn an optional integration into a primary failure.
    }
    return false;
  }
}

module.exports = { runOptionalSync };
