// Silicon Siege: output-stationary streaming integer GEMM tile.
// One accepted beat supplies P activations and P weights; P*P signed MACs.
// first clears accumulators as part of the first MAC, last closes the tile.
// Result is held until out_valid && out_ready. Host tiles larger GEMMs.
// PIPE=1 inserts a product register, preserving initiation interval one.
// BUG is mutation-testing ONLY. Production uses BUG=0.
module siege_tile #(
  parameter P=4, BITS=8, ACC=24, PIPE=1, BUG=0
)(
  input wire clk, reset,
  input wire in_valid, output wire in_ready,
  input wire in_first, in_last,
  input wire [P*BITS-1:0] a, b,
  output reg out_valid, input wire out_ready,
  output wire [P*P*ACC-1:0] out_data
);
  reg closing;
  wire accepted = in_valid && in_ready;
  assign in_ready = !closing && !out_valid;
  reg signed [ACC-1:0] accum [0:P*P-1];
  wire signed [2*BITS-1:0] product [0:P*P-1];
  wire commit_valid, commit_first, commit_last;
  wire signed [2*BITS-1:0] value [0:P*P-1];
  genvar r,c;
  generate for(r=0;r<P;r=r+1) begin: rows
    for(c=0;c<P;c=c+1) begin: cols
      if(BUG==1) begin: unsigned_mutation
        assign product[r*P+c] = $unsigned(a[r*BITS+:BITS]) * $unsigned(b[c*BITS+:BITS]);
      end else begin: signed_product
        assign product[r*P+c] = $signed(a[r*BITS+:BITS]) * $signed(b[c*BITS+:BITS]);
      end
      assign out_data[(r*P+c)*ACC+:ACC] = accum[r*P+c];
    end
  end endgenerate
  generate if(PIPE==1) begin: pipelined
    reg pv, pf, pl;
    reg signed [2*BITS-1:0] prod [0:P*P-1];
    integer x;
    always @(posedge clk) begin
      if(reset) begin pv<=0; pf<=0; pl<=0; end
      else begin
        pv<=accepted;
        if(accepted) begin
          pf<=in_first; pl<=in_last;
          for(x=0;x<P*P;x=x+1) prod[x]<=product[x];
        end
      end
    end
    assign commit_valid=pv;
    assign commit_first=pf;
    assign commit_last=pl;
    for(r=0;r<P*P;r=r+1) begin: values
      assign value[r]=prod[r];
    end
  end else begin: direct
    assign commit_valid=accepted;
    assign commit_first=in_first;
    assign commit_last=in_last;
    for(r=0;r<P*P;r=r+1) begin: values
      assign value[r]=product[r];
    end
  end endgenerate
  integer i;
  always @(posedge clk) begin
    if(reset) begin
      out_valid<=0; closing<=0;
      for(i=0;i<P*P;i=i+1) accum[i]<=0;
    end else begin
      if(out_valid && out_ready) begin out_valid<=0; closing<=0; end
      if(accepted && in_last) closing<=1;
      if(commit_valid) begin
        for(i=0;i<P*P;i=i+1)
          accum[i] <= (commit_first ? {ACC{1'b0}} : accum[i]) + {{(ACC-2*BITS){value[i][2*BITS-1]}},value[i]};
        if(commit_last) out_valid<=1;
      end
      if(BUG==2 && out_valid && !out_ready) out_valid<=0;
    end
  end
`ifdef FORMAL
  reg past_valid=0;
  always @(posedge clk) begin
    past_valid<=1;
    if(!past_valid) assume(reset);
    if(past_valid && !$past(reset) && !reset) begin
      if($past(out_valid && !out_ready)) begin
        assert(out_valid);
        assert(out_data==$past(out_data));
      end
      if(out_valid) assert(!in_ready);
    end
    if(past_valid && $past(reset)) begin
      assert(!out_valid);
      assert(out_data==0);
    end
  end
`endif
endmodule
