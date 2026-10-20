// Functional refinement harness: arbitrary accepted operands, bubbles, first/last,
// resets and downstream backpressure. Reference uses the signed multiplication primitive and a separate sequential scoreboard.
module refinement #(parameter BITS=4,ACC=16,PIPE=1)(input clk);
 (* anyseq *) reg reset,valid,first,last,ready;
 (* anyseq *) reg [BITS-1:0] a,b;
 wire ir,ov;wire[ACC-1:0] data;
 siege_tile #(.P(1),.BITS(BITS),.ACC(ACC),.PIPE(PIPE)) dut(
 .clk(clk),.reset(reset),.in_valid(valid),.in_ready(ir),.in_first(first),.in_last(last),.a(a),.b(b),.out_valid(ov),.out_ready(ready),.out_data(data));
 // Shared mathematical multiply primitive; independent sequential scoreboard.
 // Signed multiplier behavior is additionally checked by the Python RTL oracle.
 wire signed [2*BITS-1:0] signed_product=$signed(a)*$signed(b);
 wire [ACC-1:0] ref_product={{(ACC-2*BITS){signed_product[2*BITS-1]}},signed_product};
 reg [ACC-1:0] expected,pending;
 reg pv,pf,past_valid=0;
 always @(posedge clk) begin
   past_valid<=1;
   if(!past_valid) assume(reset);
   if(past_valid) assert(data==expected);
   if(reset) begin expected<=0;pending<=0;pv<=0;pf<=0;end
   else begin
     pv<=valid&&ir;
     if(valid&&ir) begin pending<=ref_product;pf<=first;end
     if(PIPE && pv) expected<=(pf ? 0 : expected)+pending;
     if(!PIPE && valid&&ir) expected<=(first ? 0 : expected)+ref_product;
   end
 end
endmodule
