"""Unbounded temporal induction, single-lane arithmetic refinement + tile protocol.
Lane property exercises full signed input domains; does not prove subsystem liveness.
"""
import pathlib,subprocess,json,hashlib
O=pathlib.Path('build/depth');rows=[]
for bits,acc in [(4,16),(8,24)]:
 for pipe in [0,1]:
  script=f'read_verilog -formal rtl/siege_tile.v rtl/refinement.v; chparam -set BITS {bits} -set ACC {acc} -set PIPE {pipe} refinement; prep -top refinement -flatten; memory_map; opt; sat -seq 4 -tempinduct -maxsteps 12 -prove-asserts -set-assumes -verify -timeout 120'
  r=subprocess.run(['yosys','-p',script],text=True,capture_output=True,timeout=160)
  name=f'refinement-b{bits}-a{acc}-s{pipe}.log';(O/name).write_text(r.stdout+r.stderr)
  assert r.returncode==0 and 'Induction step proven: SUCCESS' in r.stdout,r.stdout[-3000:]+r.stderr
  rows.append(dict(bits=bits,acc=acc,pipe=pipe,result='inductive proof passed',log=name))
(O/'formal-depth.json').write_text(json.dumps(dict(schema=1,proofs=rows,scope='Unbounded single-lane modular arithmetic refinement and tile protocol. Arbitrary input values and valid/ready sequences after initial reset. Does not establish system-level liveness, CDC or physical correctness.',harness_sha256=hashlib.sha256(pathlib.Path('rtl/refinement.v').read_bytes()).hexdigest()),indent=2))
