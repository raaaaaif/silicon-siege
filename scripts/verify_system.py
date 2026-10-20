"""Independent matrix oracle + transaction scoreboard + exact cycle-accounting contract.
Feeds actual held-out quantized MLP tensors; random/ragged/extreme kernels; reset abort;
invalid descriptors; input lockout; random output stalls and completion backpressure.
"""
import json,pathlib,subprocess,random,hashlib
O=pathlib.Path('build/depth'); O.mkdir(parents=True,exist_ok=True)
fixtures=json.loads((O/'ml-vectors.json').read_text());rng=random.Random(713)
rows=[]
for p in [2,4]:
 for bits in [4,8]:
  for acc in [16,24,32]:
   for pipe in [0,1]:
    for prefetch in [0,1]:
     name=f'p{p}-b{bits}-a{acc}-s{pipe}-f{prefetch}'
     cases=[f for f in fixtures if f['bits']==bits and f['acc']==acc]
     for m,n,k in [(1,1,1),(3,5,7),(7,9,33),(8,32,64)]:
      lo=-2**(bits-1);hi=2**(bits-1)-1
      A=[[rng.randint(lo,hi) for _ in range(k)] for _ in range(m)]
      B=[[rng.randint(lo,hi) for _ in range(n)] for _ in range(k)]
      cases.append(dict(id=f'random-{m}-{n}-{k}',A=A,B=B))
     actions=[];expects=[];meta=[]
     for ci,f in enumerate(cases):
      A,B=f['A'],f['B'];m,n,k=len(A),len(B[0]),len(B)
      C=[[(sum(A[i][t]*B[t][j] for t in range(k))+2**(acc-1))%2**acc-2**(acc-1) for j in range(n)] for i in range(m)]
      if 'C' in f:assert C==f['C']
      actions.append(f'case_id={ci}; seen=0; stall_seen=0;')
      for i,row in enumerate(A):
       for t,v in enumerate(row): actions.append(f'load(0,{i*64+t},{bits}\'h{v%(1<<bits):x});')
      for t,row in enumerate(B):
       for j,v in enumerate(row): actions.append(f'load(1,{t*32+j},{bits}\'h{v%(1<<bits):x});')
      for i,row in enumerate(C):
       for j,v in enumerate(row):actions.append(f'expected[{i*n+j}]={acc}\'h{v%(1<<acc):x}; touched[{i*n+j}]=0;')
      tiles=((m+p-1)//p)*((n+p-1)//p)
      reads=tiles*(1 if prefetch else k)
      base=reads+tiles*(k+pipe+1+p*p)
      actions.append(f'''command({m},{n},{k});
      while(!done_valid) begin
        @(negedge clk); result_ready=($random(seed)&7)>2;
        load_valid=1;load_b=0;load_addr=0;load_data=0;
        if(load_ready || cmd_ready) $fatal(1,"busy accepted host operation");
        @(posedge clk);
        if(result_valid && result_ready) begin
          if(result_index>={m*n} || touched[result_index] || result_data!==expected[result_index]) $fatal(1,"data case %d idx %d got %h expected %h",case_id,result_index,result_data,expected[result_index]);
          touched[result_index]=1;seen=seen+1;
        end
        if(result_valid && !result_ready) stall_seen=stall_seen+1;
        #1;
      end
      if(error || seen!={m*n} || mac_beats!={tiles*k} || read_cycles!={reads} || output_stalls!=stall_seen || cycles!={base}+stall_seen) $fatal(1,"counters case %d cycles %d base %d stalls %d reads %d",case_id,cycles,{base},stall_seen,read_cycles);
      $display("REPORT {ci} %0d %0d %0d %0d",cycles,mac_beats,output_stalls,read_cycles);
      saved_cycles=cycles;
      repeat(3) begin @(negedge clk);load_valid=0; @(posedge clk);#1;if(!done_valid || cycles!=saved_cycles || cmd_ready) $fatal(1,"completion hold");end
      @(negedge clk);done_ready=1;@(posedge clk);#1;@(negedge clk);done_ready=0;
      ''')
      meta.append(dict(id=f['id'],m=m,n=n,k=k,outputs=m*n,base_cycles=base,operand_bytes=(m*k+k*n)*bits/8,macs=m*n*k))
     tb=f'''module tb;
reg clk=0;always #5 clk=~clk;reg reset=1,load_valid=0,load_b=0,cmd_valid=0,result_ready=0,done_ready=0;
reg [11:0]load_addr=0;reg[{bits-1}:0]load_data=0;reg[3:0]cmd_m=0;reg[5:0]cmd_n=0;reg[6:0]cmd_k=0;
wire load_ready,cmd_ready,result_valid,done_valid,error;wire[11:0]result_index;wire signed[{acc-1}:0]result_data;wire[31:0]cycles,mac_beats,output_stalls,read_cycles;
siege_system #(.P({p}),.BITS({bits}),.ACC({acc}),.PIPE({pipe}),.PREFETCH({prefetch})) dut(.*);
reg[{acc-1}:0]expected[0:255];reg touched[0:255];integer seen,stall_seen,case_id,seed=9841,saved_cycles;
reg prev_stall=0;reg[{acc-1}:0]held;reg[11:0]held_idx;
always @(posedge clk) begin
 if(!reset && prev_stall && (!result_valid || result_data!==held || result_index!==held_idx)) $fatal(1,"unstable result under stall");
 prev_stall<=!reset && result_valid && !result_ready;held<=result_data;held_idx<=result_index;
end
task load(input reg b,input integer addr,input reg[{bits-1}:0]d);begin
 @(negedge clk);load_valid=1;load_b=b;load_addr=addr;load_data=d;
 @(posedge clk);if(!load_ready)$fatal(1,"load not ready");#1;
end endtask
task command(input integer m,input integer n,input integer k);begin
 @(negedge clk);load_valid=0;cmd_valid=1;cmd_m=m;cmd_n=n;cmd_k=k;
 @(posedge clk);if(!cmd_ready)$fatal(1,"command not ready");#1;
 @(negedge clk);cmd_valid=0;
end endtask
initial begin #20000000;$fatal(1,"watchdog");end
initial begin
 repeat(2)@(posedge clk);@(negedge clk);reset=0;
 // Invalid descriptors produce a held error completion without touching datapath.
 command(0,1,1);if(!done_valid || !error || cycles!=0)$fatal(1,"invalid command");
 @(negedge clk);done_ready=1;@(posedge clk);#1;@(negedge clk);done_ready=0;
 // Reset aborts an active command; no output is allowed to escape afterward.
 command(8,32,64);repeat(5)@(posedge clk);@(negedge clk);reset=1;
 @(posedge clk);#1;if(result_valid || done_valid || cycles!=0)$fatal(1,"reset abort");
 @(negedge clk);reset=0;
 {''.join(actions)}
 $display("PASS");$finish;end
endmodule'''
     (O/'system_tb.v').write_text(tb)
     subprocess.run(['iverilog','-g2012','-s','tb','-o',str(O/'sim'),'rtl/siege_tile.v','rtl/siege_system.v',str(O/'system_tb.v')],check=True,capture_output=True)
     run=subprocess.run(['vvp',str(O/'sim')],text=True,capture_output=True)
     (O/f'{name}.log').write_text(run.stdout+run.stderr)
     assert run.returncode==0, name+'\n'+run.stdout+run.stderr
     for line in run.stdout.splitlines():
      if line.startswith('REPORT'):
       _,ci,cy,mb,st,rd=line.split();meta[int(ci)].update(cycles=int(cy),mac_beats=int(mb),output_stalls=int(st),read_cycles=int(rd))
     rows.append(dict(p=p,bits=bits,acc=acc,pipe=pipe,prefetch=prefetch,cases=meta));print(name,'PASS',flush=True)
# Confirm complete subsystem synthesizes; preserve inferred synchronous memories, not fake SRAM area.
script='read_verilog rtl/siege_tile.v rtl/siege_system.v; hierarchy -top siege_system; proc; opt; memory_dff; memory_collect; check -assert; stat -width; write_json build/depth/system-netlist.json'
s=subprocess.run(['yosys','-p',script],text=True,capture_output=True,check=True);(O/'system-synthesis.log').write_text(s.stdout)
report=dict(schema=1,configurations=len(rows),cases=sum(len(r['cases']) for r in rows),rows=rows,rtl_sha256={f:hashlib.sha256(pathlib.Path('rtl/'+f).read_bytes()).hexdigest() for f in ['siege_tile.v','siege_system.v']},scope='RTL simulation + synthesis with inferred memories. No SRAM macro mapping, AXI integration or physical timing claim for this subsystem.',tool=subprocess.check_output(['iverilog','-V'],text=True,stderr=subprocess.DEVNULL).splitlines()[0])
(O/'system.json').write_text(json.dumps(report,indent=2))
