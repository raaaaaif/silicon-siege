"""Independent Python big-integer oracle → Icarus vector test; no packages.
The oracle does not import the browser simulator or generate expected values in RTL.
Exercises exact modular arithmetic, signed extrema, random bubbles, output stalls,
multiple transactions, and mid-transaction reset. Verifies every clock, not just end.
"""
import argparse, hashlib, json, pathlib, random, subprocess

ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'build'; OUT.mkdir(exist_ok=True)

def stimulus(p,bits,acc,pipe,seed):
    rng=random.Random(seed); rows=[]; accum=[0]*(p*p)
    closing=False; valid=False; pending=None; cycle=0; accepted_count=0; results=0
    def tick(reset,iv,first,last,a,b,ready):
        nonlocal closing,valid,pending,accum,cycle,accepted_count,results
        ir=not closing and not valid
        accept=iv and ir and not reset
        if valid and ready and not reset: results+=1
        old_pending=pending
        if reset:
            closing=False;valid=False;pending=None;accum=[0]*(p*p)
        else:
            if valid and ready:valid=False;closing=False
            if accept and last:closing=True
            op=(first,last,[x*y for x in a for y in b]) if accept else None
            commit=old_pending if pipe else op
            pending=op if pipe else None
            if commit:
                f,l,products=commit
                accum=[((0 if f else x)+v)%(1<<acc) for x,v in zip(accum,products)]
                if l:valid=True
            if accept:accepted_count+=1
        packed=lambda xs,w:sum((x% (1<<w))<<(i*w) for i,x in enumerate(xs))
        rows.append((reset,iv,first,last,ready,packed(a,bits),packed(b,bits),int(not closing and not valid),int(valid),packed(accum,acc)))
        cycle+=1
        return accept
    z=[0]*p
    tick(1,0,0,0,z,z,0);tick(1,1,1,1,z,z,0);tick(0,0,0,0,z,z,0)
    for tx in range(48):
        k=[1,2,3,7,16,33][tx%6]
        for t in range(k):
            extrema=[-(1<<(bits-1)),(1<<(bits-1))-1,-1,0,1]
            a=[rng.choice(extrema) if tx%3==0 else rng.randrange(-(1<<(bits-1)),1<<(bits-1)) for _ in range(p)]
            b=[rng.choice(extrema) if tx%3==0 else rng.randrange(-(1<<(bits-1)),1<<(bits-1)) for _ in range(p)]
            for _ in range(rng.randrange(3)):tick(0,0,t==0,t==k-1,a,b,0)
            assert tick(0,1,t==0,t==k-1,a,b,0)
        for _ in range(pipe+1):tick(0,0,0,0,z,z,0)
        for _ in range(rng.randrange(1,8)):
            # A producer may present another request, but must not be accepted.
            assert not tick(0,1,1,1,[-1]*p,[3]*p,0)
        tick(0,0,0,0,z,z,1);tick(0,0,0,0,z,z,0)
        if tx%8==0:
            tick(0,1,1,0,[-1]*p,[2]*p,0)
            tick(1,0,0,0,z,z,0);tick(0,0,0,0,z,z,0)
    return rows,accepted_count,results

def verify(p,bits,acc,pipe,bug=0,seed=20261020):
    name=f'p{p}-b{bits}-a{acc}-s{pipe}-bug{bug}'
    rows,beats,results=stimulus(p,bits,acc,pipe,seed)
    vec=OUT/f'{name}.txt'
    vec.write_text('\n'.join(' '.join(f'{v:x}' for v in row) for row in rows)+'\n')
    tb=OUT/f'{name}.v'
    tb.write_text(f'''module tb;
reg clk=0; always #5 clk=~clk;
reg reset,in_valid,in_first,in_last,out_ready;
reg [{p*bits-1}:0] a,b;
wire in_ready,out_valid; wire [{p*p*acc-1}:0] out_data;
reg expected_ready,expected_valid; reg [{p*p*acc-1}:0] expected_data;
integer fd,rc,line=0;
siege_tile #(.P({p}),.BITS({bits}),.ACC({acc}),.PIPE({pipe}),.BUG({bug})) dut(.*);
initial begin
fd=$fopen("{vec}","r");
while(!$feof(fd)) begin
 @(negedge clk);
 rc=$fscanf(fd,"%h %h %h %h %h %h %h %h %h %h\\n",reset,in_valid,in_first,in_last,out_ready,a,b,expected_ready,expected_valid,expected_data);
 if(rc==10) begin
  @(posedge clk); #1; line=line+1;
  if(in_ready!==expected_ready || out_valid!==expected_valid || out_data!==expected_data) begin
   $display("FAIL cycle=%0d ready=%b/%b valid=%b/%b data=%h expected=%h",line,in_ready,expected_ready,out_valid,expected_valid,out_data,expected_data); $fatal(1);
  end
 end
end
$display("PASS {name} cycles=%0d",line); $finish;
end
initial begin #1000000; $fatal(1,"timeout"); end
endmodule''')
    binary=OUT/f'{name}.vvp'
    subprocess.run(['iverilog','-g2012','-s','tb','-o',str(binary),str(ROOT/'rtl/siege_tile.v'),str(tb)],check=True,capture_output=True)
    run=subprocess.run(['vvp',str(binary)],text=True,capture_output=True)
    (OUT/f'{name}.log').write_text(run.stdout+run.stderr)
    if bug:
        assert run.returncode!=0, f'Mutation {bug} escaped verification!'
    else:
        assert run.returncode==0,run.stdout+run.stderr
    return dict(p=p,bits=bits,acc=acc,pipe=pipe,bug=bug,cycles=len(rows),accepted_beats=beats,completed_tiles=results,seed=seed,passed=run.returncode==0,mutation_caught=bool(bug and run.returncode),vector_sha256=hashlib.sha256(vec.read_bytes()).hexdigest(),log=run.stdout[:1500])

if __name__=='__main__':
    reports=[]
    for p in [2,4,8]:
        for bits in [4,8]:
            for acc in [16,24,32]:
                for pipe in [0,1]:
                    report=verify(p,bits,acc,pipe); reports.append(report);print(report['log'].strip(),flush=True)
    for bug in [1,2]:reports.append(verify(2,8,24,1,bug))
    (OUT/'verification.json').write_text(json.dumps({'schema':1,'tool':'Icarus Verilog + independent Python integer oracle','rtl_sha256':hashlib.sha256((ROOT/'rtl/siege_tile.v').read_bytes()).hexdigest(),'reports':reports},indent=2))
