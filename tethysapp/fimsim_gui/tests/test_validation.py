"""Step-config validation: bad inputs are rejected at the API with a reason,
never shipped to a worker where a keyword-only fimcore call would crash
mid-job. One test class per wizard step, plus the server-only-key contract."""
from tethysapp.fimsim_gui.job_types import REGISTRY


def _problems(step, config):
    return REGISTRY[step].validate_config(config)


# ── cross-step contracts ──────────────────────────────────────────────────────

#: the minimum a user must genuinely provide per step (everything else
#: defaults) — bdy's event window has no sensible default
REQUIRED_INPUT = {
    "bdy": {"start_dt": "2016-10-05T00:00", "end_dt": "2016-10-15T00:00"},
}


def test_defaults_plus_required_input_pass_validation():
    for step, jt in REGISTRY.items():
        cfg = jt.merged(REQUIRED_INPUT.get(step, {}))
        assert jt.validate_config(cfg) == [], step


def test_unknown_keys_are_rejected_with_the_allowed_list():
    problems = _problems("dem", {"resolution": 10})
    assert len(problems) == 1
    assert "unknown option 'resolution'" in problems[0]
    assert "dem_res_m" in problems[0]  # the reason names what IS accepted


def test_non_dict_config_is_rejected():
    assert _problems("dem", ["not", "a", "dict"]) == \
        ["config must be a JSON object"]


def test_run_solver_path_is_server_only():
    # the submit endpoint strips these before validation; a client value
    # would pick the binary the worker executes
    assert "solver_path" in REGISTRY["run"].server_only_keys


# ── terrain ───────────────────────────────────────────────────────────────────

def test_dem_rejects_unsupported_resolution_and_source():
    assert any("dem_res_m" in p for p in _problems("dem", {"dem_res_m": 7}))
    assert any("dem_source" in p for p in _problems("dem", {"dem_source": "srtm"}))
    assert _problems("dem", {"dem_res_m": 10, "dem_source": "hand"}) == []


# ── roughness ─────────────────────────────────────────────────────────────────

def test_manning_bounds():
    assert _problems("manning", {"fric_mode": "fixed", "fpfric_val": 0.05}) == []
    assert any("fpfric_val" in p
               for p in _problems("manning", {"fpfric_val": 0}))
    assert any("fpfric_val" in p
               for p in _problems("manning", {"fpfric_val": "rough"}))
    assert any("lulc_year" in p
               for p in _problems("manning", {"lulc_year": 1802}))


def test_manning_mapping_shape():
    ok = {"manning_mapping": {"11": 0.03, "42": 0.11}}
    assert _problems("manning", ok) == []
    bad_type = {"manning_mapping": [0.03]}
    assert any("manning_mapping" in p for p in _problems("manning", bad_type))
    bad_value = {"manning_mapping": {"11": 3.0}}
    problems = _problems("manning", bad_value)
    assert any("11" in p for p in problems)  # names the offending class


# ── boundaries ────────────────────────────────────────────────────────────────

def test_bci_fixed_discharge_requires_a_value():
    problems = _problems("bci", {"upstream_mode": "fixed_discharge"})
    assert any("fixed_discharge_cms" in p for p in problems)
    assert _problems("bci", {"upstream_mode": "fixed_discharge",
                             "fixed_discharge_cms": 250.0}) == []


def test_bci_slope_and_level_ranges():
    assert any("downstream_slope" in p
               for p in _problems("bci", {"downstream_slope": 2.0}))
    assert any("downstream_hfix" in p
               for p in _problems("bci", {"downstream_hfix": -5000}))


# ── flow data ─────────────────────────────────────────────────────────────────

WINDOW = {"start_dt": "2016-10-05T00:00", "end_dt": "2016-10-15T00:00"}


def test_bdy_happy_path():
    assert _problems("bdy", dict(WINDOW)) == []


def test_bdy_requires_the_event_window():
    problems = _problems("bdy", {})
    assert any("start_dt" in p for p in problems)
    assert any("end_dt" in p for p in problems)


def test_bdy_rejects_garbage_datetimes_and_empty_windows():
    assert any("not a valid ISO" in p for p in _problems(
        "bdy", {**WINDOW, "start_dt": "last tuesday"}))
    assert any("must be before" in p for p in _problems(
        "bdy", {"start_dt": WINDOW["end_dt"], "end_dt": WINDOW["start_dt"]}))
    assert any("366 days" in p for p in _problems(
        "bdy", {"start_dt": "2010-01-01T00:00", "end_dt": "2016-01-01T00:00"}))


def test_bdy_retro_range_is_enforced_with_an_alternative():
    problems = _problems(
        "bdy", {"start_dt": "2024-06-01T00:00", "end_dt": "2024-06-10T00:00"})
    assert any("1979-02-01 to 2023-01-31" in p for p in problems)
    assert any("USGS gage" in p for p in problems)  # tells the user a way out
    # same window is fine for a source that covers it
    assert _problems("bdy", {"start_dt": "2024-06-01T00:00",
                             "end_dt": "2024-06-10T00:00",
                             "bdy_source": "usgs",
                             "gage_id": "02089000"}) == []


def test_bdy_usgs_needs_a_plausible_gage_id():
    base = {**WINDOW, "bdy_source": "usgs"}
    assert any("gage_id" in p for p in _problems("bdy", base))
    assert any("gage_id" in p for p in _problems("bdy", {**base, "gage_id": "abc"}))
    assert _problems("bdy", {**base, "gage_id": "02089000"}) == []


# ── settings / run ────────────────────────────────────────────────────────────

def test_par_rejects_deck_breaking_names():
    problems = _problems("par", {"par_name": "my model"})  # space breaks .par
    assert any("par_name" in p for p in problems)
    assert _problems("par", {"par_name": "model_v2"}) == []


def test_par_numeric_ranges():
    assert any("initial_tstep" in p
               for p in _problems("par", {"initial_tstep": 0}))
    assert any("sim_time" in p for p in _problems("par", {"sim_time": -5}))


def test_run_timeout_and_snapshots():
    assert any("solver_timeout_s" in p
               for p in _problems("run", {"solver_timeout_s": 999999}))
    assert any("keep_snapshots" in p
               for p in _problems("run", {"keep_snapshots": "maybe"}))
    assert _problems("run", {"solver_timeout_s": 1800,
                             "keep_snapshots": "true"}) == []
