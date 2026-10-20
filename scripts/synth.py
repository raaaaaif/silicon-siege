"""36 standard-cell mapped candidates using one pinned Nangate45 library."""
import hashlib,json,pathlib,subprocess,re
ROOT=pathlib.Path(__file__).resolve().parents[1]; OUT=ROOT/'build';OUT.mkdir(exist_ok=True)
LIB=OUT/'NangateOpenCellLibrary_typical.lib'
rows=[]
for p in [2,4,8]:
 for bits in [4,8]:
  for acc in [16,24,32]:
   # All 36 candidates: 3 array sizes x 2 widths x 3 accumulators x 2 pipelines.
   for pipe in [0,1]:
    name=f'p{p}-b{bits}-a{acc}-s{pipe}'
    script=f'read_verilog rtl/siege_tile.v; chparam -set P {p} -set BITS {bits} -set ACC {acc} -set PIPE {pipe} siege_tile; synth -top siege_tile; dfflibmap -liberty {LIB}; abc -liberty {LIB}; clean; stat -liberty {LIB}; write_verilog -noattr build/{name}.v'
    r=subprocess.run(['yosys','-p',script],cwd=ROOT,text=True,capture_output=True,check=True)
    (OUT/f'{name}-synth.log').write_text(r.stdout+r.stderr)
    areas=re.findall(r'Chip area for module.*?:\s*([\d.]+)',r.stdout)
    cells=re.findall(r'Number of cells:\s*(\d+)',r.stdout)
    assert areas, r.stdout[-1500:]
    row=dict(p=p,bits=bits,acc=acc,pipe=pipe,area_um2=float(areas[-1]),cells=int(cells[-1]),netlist_sha256=hashlib.sha256((OUT/f'{name}.v').read_bytes()).hexdigest())
    rows.append(row);print(name,row['area_um2'],flush=True)
data=dict(schema=1,scope='Streaming GEMM tile only. Excludes host, SRAM macros, IO pads, clock tree and routing.',technology='Nangate45 typical standard-cell library, 1.1 V / 25 C',tool=subprocess.check_output(['yosys','-V'],text=True).strip(),library_sha256=hashlib.sha256(LIB.read_bytes()).hexdigest(),rtl_sha256=hashlib.sha256((ROOT/'rtl/siege_tile.v').read_bytes()).hexdigest(),candidates=rows)
(OUT/'synthesis.json').write_text(json.dumps(data,indent=2))
