"""FIMSIM-BE10 maintenance: stale-run reaper + artifact retention.

Run periodically (Gio's cron owns the schedule):
    tethys manage shell < scripts/maintenance.py

- Reaps active StepRuns with no sign of life for > 3h (worker died before
  finalizing — OOM kill, reboot): marks them failed with a re-run hint.
- Deletes stored artifacts of superseded runs and runs older than the
  retention_days setting; manifests are marked expired (idempotent).
"""
from tethysapp.fimsim_gui import guards
from tethysapp.fimsim_gui.app import App
from tethysapp.fimsim_gui.models import get_session_maker
from tethysapp.fimsim_gui.storage import get_storage


def _setting(name, default):
    try:
        v = App.get_custom_setting(name)
        return type(default)(v) if v else default
    except Exception:
        return default


session = get_session_maker(App)()
try:
    reaped = guards.reap_stale_runs(session)
    retention = _setting('retention_days', guards.DEFAULT_RETENTION_DAYS)
    freed = guards.clean_expired_artifacts(session, get_storage(), retention)
    print(f"maintenance: reaped {reaped} stale run(s), "
          f"freed {freed / 1e6:.1f} MB (retention {retention}d)")
finally:
    session.close()
