from tethysapp.fimsim_gui.job_types.run_sim import RunSimJobType
from tethysapp.fimsim_gui.job_types.steps import (
    BCIStepJobType, BDYStepJobType, DEMStepJobType,
    ManningStepJobType, PARStepJobType,
)
from tethysapp.fimsim_gui.job_types.steps_triton import (
    TritonBCJobType, TritonCfgJobType, TritonDEMJobType,
    TritonFrictionJobType, TritonHydroJobType,
)

REGISTRY = {
    jt.step_key: jt
    for jt in (
        # LISFLOOD-FP (runs on the portal)
        DEMStepJobType(), ManningStepJobType(), BCIStepJobType(),
        BDYStepJobType(), PARStepJobType(), RunSimJobType(),
        # TRITON (deck generation only — desktop parity)
        TritonDEMJobType(), TritonFrictionJobType(), TritonBCJobType(),
        TritonHydroJobType(), TritonCfgJobType(),
    )
}
