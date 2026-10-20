"""Fail CI when a routed result violates the declared timing/electrical contract."""
import json
from pathlib import Path
root = Path('build/physical')
metrics = json.loads((root / 'logs/base/6_report.json').read_text())
checks = {name: metrics['finish__timing__drv__'+key] for name,key in [('setup','setup_violation_count'),('hold','hold_violation_count'),('capacitance','max_cap'),('slew','max_slew')]}
assert (root / '6_final.gds').stat().st_size > 0, 'Missing GDS'
assert not (root / 'reports/base/5_route_drc.rpt').read_text().strip(), 'Routing DRC violations'
for name,count in checks.items():
    assert count == 0, f'{name} violations: {count}'
print('PASS: routed GDS; zero routing, setup, hold, capacitance and slew violations.')
