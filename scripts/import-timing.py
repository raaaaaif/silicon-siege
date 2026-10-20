"""Import a matched, routed datapath experiment. Failed closure stays in the report."""
import json,pathlib,sys,hashlib,shutil
out=pathlib.Path('web/evidence');rows=[]
for pipe,folder in enumerate(sys.argv[1:3]):
 p=pathlib.Path(folder);m=json.loads((p/'metrics.json').read_text());drc=(p/'drc.rpt').read_text()
 assert '-period 2 ' in (p/'constraints.sdc').read_text()
 r=dict(pipe=pipe,area_um2=m['finish__design__instance__area__stdcell'],setup_slack_ns=m['finish__timing__setup__ws'],hold_slack_ns=m['finish__timing__hold__ws'],setup_violations=m['finish__timing__drv__setup_violation_count'],hold_violations=m['finish__timing__drv__hold_violation_count'],cap_violations=m['finish__timing__drv__max_cap'],slew_violations=m['finish__timing__drv__max_slew'],drc=0 if not drc.strip() else None,rtl_sha256=hashlib.sha256((p/'siege_tile.v').read_bytes()).hexdigest(),source_commit=(p/'commit.txt').read_text().strip())
 r['passes']=r['setup_slack_ns']>=0 and r['hold_slack_ns']>=0 and all(r[k]==0 for k in ['setup_violations','hold_violations','cap_violations','slew_violations','drc'])
 shutil.copy(p/'timing.rpt',out/f'timing-pipe-{pipe}.rpt');shutil.copy(p/'metrics.json',out/f'timing-pipe-{pipe}-metrics.json');rows.append(r)
(out/'timing-ablation.json').write_text(json.dumps(dict(schema=1,rows=rows,run_url=sys.argv[3],configuration=dict(p=4,bits=8,acc=24),clock_period_ns=2,input_output_delay_ns=.4,clock_uncertainty_ns=.1,image='openroad/orfs@sha256:ac327587b71c3ce1fea813f4efcf966644daa90c9fadc8f93ee2e4b4c1d64842',scope='Matched single-corner Nangate45 typical routed compute tiles. Same clock and I/O constraints. This is not system timing, measured silicon, multi-corner signoff or a power comparison.'),indent=2))
print(rows)
