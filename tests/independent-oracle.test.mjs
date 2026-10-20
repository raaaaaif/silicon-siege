import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { TileCore, DEFAULT } from "../web/engine.js";
// Same independent Python vectors used by remote Icarus are applied to the JS
// controller. Hex strings preserve wide packed buses without JSON precision loss.
test("browser controller agrees with independent Python oracle across all 36 RTL configurations", () => {
  const py = spawnSync(
    "python3",
    [
      "-c",
      `import sys,json\nsys.path.insert(0,'scripts')\nfrom verify_rtl import stimulus\nfor p in [2,4,8]:\n for bits in [4,8]:\n  for acc in [16,24,32]:\n   for pipe in [0,1]:\n    rows,_,_=stimulus(p,bits,acc,pipe,20261020)\n    print(json.dumps(dict(p=p,bits=bits,acc=acc,pipe=pipe,rows=[[hex(v) for v in row] for row in rows])))`,
    ],
    { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 },
  );
  assert.equal(py.status, 0, py.stderr);
  let clocks = 0;
  for (const line of py.stdout.trim().split("\n")) {
    const v = JSON.parse(line),
      core = new TileCore({ ...DEFAULT, ...v });
    const unpack = (hex, n, w) => {
      const b = BigInt(hex),
        mask = (1n << BigInt(w)) - 1n;
      return Array.from({ length: n }, (_, i) => {
        let x = Number((b >> BigInt(i * w)) & mask);
        return x >= 2 ** (w - 1) ? x - 2 ** w : x;
      });
    };
    for (const row of v.rows) {
      const [reset, valid, first, last, ready, a, b, er, ev, data] = row;
      const edge = core.tick({
        reset: !!Number(reset),
        valid: !!Number(valid),
        first: !!Number(first),
        last: !!Number(last),
        ready: !!Number(ready),
        a: unpack(a, v.p, v.bits),
        b: unpack(b, v.p, v.bits),
      });
      assert.equal(edge.ready, !!Number(er));
      assert.equal(edge.valid, !!Number(ev));
      assert.deepEqual(edge.accum, unpack(data, v.p * v.p, v.acc));
      clocks++;
    }
  }
  assert(clocks > 40000);
  console.log(`Independent Python/JS parity: ${clocks} clock edges`);
});
