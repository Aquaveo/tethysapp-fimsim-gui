"""#xi (FIMSIM-FE35): the web app runs ONE study area per project (Sagy: online =
one case study at a time; batch work belongs to the desktop FIMsim)."""
from tethysapp.fimsim_gui.ingest import MAX_AOIS_PER_PROJECT, single_aoi_problem


def test_one_area_per_project():
    assert MAX_AOIS_PER_PROJECT == 1


def test_first_area_is_fine_and_a_second_is_refused_with_a_reason():
    assert single_aoi_problem(existing=0, requested=1, replace=False) is None
    msg = single_aoi_problem(existing=1, requested=1, replace=False)
    assert msg and "one study area" in msg.lower() and "desktop" in msg.lower()


def test_replace_swaps_the_existing_area():
    assert single_aoi_problem(existing=1, requested=1, replace=True) is None
    # a legacy multi-AOI project can still be replaced wholesale
    assert single_aoi_problem(existing=3, requested=1, replace=True) is None


def test_more_than_one_feature_at_once_is_refused_even_on_an_empty_project():
    msg = single_aoi_problem(existing=0, requested=2, replace=False)
    assert msg and "one" in msg.lower()
    # nothing to add → not this rule's business (other checks answer)
    assert single_aoi_problem(existing=0, requested=0, replace=False) is None
