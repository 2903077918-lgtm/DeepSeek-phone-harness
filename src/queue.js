// src/queue.js —— FIFO 任务队列（同一时间只执行一个任务）
export function createQueue() {
  let tail = Promise.resolve();
  let length = 0;
  return {
    enqueue(fn) {
      length++;
      const run = tail.then(fn, fn);
      tail = run.then(() => { length--; }, () => { length--; });
      return run;
    },
    get size() { return length; },
  };
}
