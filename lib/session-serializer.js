'use strict';

class SessionSerializer {
  constructor() {
    this.tails = new Map();
  }

  async acquire(key) {
    const previous = this.tails.get(key) || Promise.resolve();
    let releaseGate;
    const gate = new Promise(resolve => { releaseGate = resolve; });
    const tail = previous.catch(() => {}).then(() => gate);
    this.tails.set(key, tail);
    await previous.catch(() => {});

    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseGate();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    };
  }
}

module.exports = { SessionSerializer };
