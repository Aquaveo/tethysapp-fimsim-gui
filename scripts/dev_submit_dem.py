"""FIMSIM-BE5 dev harness: submit DEM jobs for the Neuse test AOI and watch.

Run inside the portal's Django context:

    conda activate tethys
    # terminal 1:  dask scheduler
    # terminal 2:  dask worker tcp://127.0.0.1:8786 --nworkers 2 --nthreads 1
    # terminal 3:
    tethys manage shell < scripts/dev_submit_dem.py

Creates (or reuses) a dev project with TWO copies of the Neuse AOI, one
StepRun per AOI, submits both (fan-out — they run concurrently on the two
workers), then polls the StepRun rows until both finish, printing progress.
"""
import time

from django.contrib.auth import get_user_model

from tethysapp.fimsim_gui.app import App
from tethysapp.fimsim_gui.jobs import submit_step
from tethysapp.fimsim_gui.models import Aoi, Project, StepRun, get_session_maker

NEUSE_WKT = (
    "SRID=4326;POLYGON((-78.10992 35.45282,-77.93055 35.44839,"
    "-77.93668 35.28632,-78.1157 35.29072,-78.10992 35.45282))"
)

user = get_user_model().objects.filter(is_superuser=True).first()
print(f"Submitting as portal user: {user.username}")

Session = get_session_maker(App)
session = Session()

project = (session.query(Project)
           .filter_by(username=user.username, name="BE5_Harness").first())
if project is None:
    project = Project(username=user.username, name="BE5_Harness")
    session.add(project)
    session.commit()

if not project.aois:
    for i in (1, 2):
        session.add(Aoi(project_id=project.id, name=f"Neuse_{i}", source="example",
                        geometry=NEUSE_WKT, area_km2=290.4, is_rectangular=True,
                        working_crs_epsg=26917))
    session.commit()
session.refresh(project)

runs = []
for aoi in project.aois:
    for old in aoi.step_runs:
        old.superseded = True
    run = StepRun(aoi_id=aoi.id, step_key="dem",
                  config={"dem_res_m": 90, "dem_source": "3dep"})
    session.add(run)
    session.commit()
    job = submit_step(run, user)
    session.commit()
    runs.append(run)
    print(f"submitted StepRun {run.id} (AOI '{aoi.name}') as DaskJob {job.id}")

print("\npolling …")
t0 = time.time()
while True:
    time.sleep(5)
    done = 0
    for run in runs:
        session.expire(run)
        last = (run.progress or [{}])[-1].get("message", "")
        print(f"  [{time.time()-t0:5.0f}s] StepRun {run.id}: {run.status:10s} {last[:70]}")
        if run.status in ("succeeded", "failed", "cancelled"):
            done += 1
    if done == len(runs):
        break
    if time.time() - t0 > 1800:
        print("timed out waiting"); break

for run in runs:
    session.refresh(run)
    print(f"\nStepRun {run.id}: {run.status}")
    if run.manifest:
        for m in run.manifest:
            print(f"  {m['bytes']:>10,}  {m['key']}")
    if run.error:
        print("  error:", run.error[:400])
session.close()
