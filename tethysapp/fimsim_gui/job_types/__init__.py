from tethysapp.fimsim_gui.job_types.run_sim import RunSimJobType
from tethysapp.fimsim_gui.job_types.steps import (
    BCIStepJobType, BDYStepJobType, DEMStepJobType,
    ManningStepJobType, PARStepJobType,
)

REGISTRY = {
    jt.step_key: jt
    for jt in (
        DEMStepJobType(), ManningStepJobType(), BCIStepJobType(),
        BDYStepJobType(), PARStepJobType(), RunSimJobType(),
    )
}
