// Bounded GEMM subsystem: command -> banked synchronous operand SRAM -> tile -> stream.
// Host loads complete A[M,K] and B[K,N] before command. Physical strides MAX_K/MAX_N.
// Memory contents intentionally survive reset; caller must initialize referenced words.
// No AXI/DRAM claim: this is a standalone single-clock accelerator peripheral.
module siege_system #(
 parameter P=4, BITS=8, ACC=24, PIPE=1, PREFETCH=1,
 parameter MAX_M=8, MAX_N=32, MAX_K=64
)(
 input wire clk, reset,
 input wire load_valid, load_b, input wire [11:0] load_addr,
 input wire [BITS-1:0] load_data, output wire load_ready,
 input wire cmd_valid, output wire cmd_ready,
 input wire [3:0] cmd_m, input wire [5:0] cmd_n, input wire [6:0] cmd_k,
 output wire result_valid, input wire result_ready,
 output wire [11:0] result_index, output wire signed [ACC-1:0] result_data,
 output wire done_valid, input wire done_ready, output reg error,
 output reg [31:0] cycles, mac_beats, output_stalls, read_cycles
);
 localparam IDLE=0, READ=1, MAC=2, DRAIN=3, EMIT=4, DONE=5;
 reg [2:0] state;
 reg [3:0] m, tr; reg [5:0] n, tc; reg [6:0] k, kk;
 reg [$clog2(P*P):0] lane;
 wire [P*BITS-1:0] av,bv;
 wire tile_ready,tile_valid;
 wire [P*P*ACC-1:0] tile_data;
 wire accepted=state==MAC && tile_ready;
 wire issue=state==READ || (PREFETCH && accepted && kk+1<k);
 wire [6:0] read_k=state==READ ? kk : kk+1;
 wire lane_in_range=tr+lane/P<m && tc+lane%P<n;
 wire advance=state==EMIT && (!lane_in_range || result_ready);
 assign cmd_ready=state==IDLE && !load_valid;
 assign load_ready=state==IDLE;
 assign done_valid=state==DONE;
 assign result_valid=state==EMIT && lane_in_range;
 assign result_index=(tr+lane/P)*n+tc+lane%P;
 assign result_data=tile_data[lane*ACC+:ACC];
 // P independent banks on each operand. One synchronous read per bank per cycle.
 genvar g;
 generate for(g=0;g<P;g=g+1) begin:banks
   reg [BITS-1:0] amem [0:(MAX_M/P)*MAX_K-1];
   reg [BITS-1:0] bmem [0:MAX_K*(MAX_N/P)-1];
   reg [BITS-1:0] ar,br;
   assign av[g*BITS+:BITS]=ar; assign bv[g*BITS+:BITS]=br;
   always @(posedge clk) begin
     if(!reset && load_valid && load_ready) begin
       if(!load_b && load_addr<MAX_M*MAX_K && (load_addr/MAX_K)%P==g)
         amem[(load_addr/(MAX_K*P))*MAX_K+load_addr%MAX_K]<=load_data;
       if(load_b && load_addr<MAX_K*MAX_N && load_addr%P==g)
         bmem[load_addr/P]<=load_data;
     end
     if(issue) begin
       ar<=tr+g<m ? amem[(tr/P)*MAX_K+read_k] : 0;
       br<=tc+g<n ? bmem[read_k*(MAX_N/P)+tc/P] : 0;
     end
   end
 end endgenerate
 siege_tile #(.P(P),.BITS(BITS),.ACC(ACC),.PIPE(PIPE)) tile(
 .clk(clk),.reset(reset),.in_valid(state==MAC),.in_ready(tile_ready),
 .in_first(kk==0),.in_last(kk+1==k),.a(av),.b(bv),
 .out_valid(tile_valid),.out_ready(advance && lane==P*P-1),.out_data(tile_data));
 always @(posedge clk) begin
   if(reset) begin
     state<=IDLE; error<=0;cycles<=0;mac_beats<=0;output_stalls<=0;read_cycles<=0;
     m<=0;n<=0;k<=0;tr<=0;tc<=0;kk<=0;lane<=0;
   end else begin
     if(state!=IDLE && state!=DONE) cycles<=cycles+1;
     if(accepted) mac_beats<=mac_beats+1;
     if(state==READ) read_cycles<=read_cycles+1;
     if(result_valid && !result_ready) output_stalls<=output_stalls+1;
     case(state)
       IDLE: if(cmd_valid && cmd_ready) begin
         error<=0; cycles<=0;mac_beats<=0;output_stalls<=0;read_cycles<=0;
         if(cmd_m==0 || cmd_m>MAX_M || cmd_n==0 || cmd_n>MAX_N || cmd_k==0 || cmd_k>MAX_K) begin
           error<=1;state<=DONE;
         end else begin
           m<=cmd_m;n<=cmd_n;k<=cmd_k;tr<=0;tc<=0;kk<=0;lane<=0;state<=READ;
         end
       end
       READ: state<=MAC;
       MAC: if(accepted) begin
         if(kk+1==k) state<=DRAIN;
         else begin kk<=kk+1; if(!PREFETCH) state<=READ; end
       end
       DRAIN: if(tile_valid) begin lane<=0;state<=EMIT;end
       EMIT: if(advance) begin
         if(lane==P*P-1) begin
           lane<=0;kk<=0;
           if(tc+P<n) begin tc<=tc+P;state<=READ;end
           else if(tr+P<m) begin tc<=0;tr<=tr+P;state<=READ;end
           else state<=DONE;
         end else lane<=lane+1;
       end
       DONE: if(done_ready) state<=IDLE;
       default: state<=IDLE;
     endcase
   end
 end
endmodule
