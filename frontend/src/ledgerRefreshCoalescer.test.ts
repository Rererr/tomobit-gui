import test from "node:test";
import assert from "node:assert/strict";
import { createRefreshCoalescer } from "./ledgerRefreshCoalescer.ts";

test("同一境界で2つのイベントが発火してもrunは1回しか走らない", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const coalescer = createRefreshCoalescer(() => {
    calls++;
  }, 200);

  // task.finished と chat:exit が相次いで届いた想定。
  coalescer.schedule();
  coalescer.schedule();
  t.mock.timers.tick(200);

  assert.equal(calls, 1);
});

test("runが済んだ後のscheduleは次の境界として新たにrunを起こす", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const coalescer = createRefreshCoalescer(() => {
    calls++;
  }, 200);

  coalescer.schedule();
  t.mock.timers.tick(200);
  assert.equal(calls, 1);

  coalescer.schedule();
  t.mock.timers.tick(200);
  assert.equal(calls, 2);
});

test("cancelは予定中のrunを止める", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0;
  const coalescer = createRefreshCoalescer(() => {
    calls++;
  }, 200);

  coalescer.schedule();
  coalescer.cancel();
  t.mock.timers.tick(200);

  assert.equal(calls, 0);
});
