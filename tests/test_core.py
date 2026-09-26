import math

import pytest

from strata.georef import R, fit_affine, gdal_commands, loo_rmse_m, rmse_m, worst_gcp
from strata.whatwashere import existed_in


def synthetic_gcps(noise_at=None, noise_m=0.0):
    """Pixels on a 4000x3000 scan mapped by a known affine onto Manhattan-ish Mercator coordinates."""
    out = []
    for px, py in [(100, 100), (3900, 150), (200, 2900), (3800, 2850), (2000, 1500), (1000, 2200)]:
        x = -8236000 + 0.25 * px + 0.02 * py  # ~0.25 m/px with slight rotation
        y = 4975000 - 0.02 * px - 0.25 * py
        if noise_at is not None and len(out) == noise_at:
            x += noise_m
        lon = math.degrees(x / R)
        lat = math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2)
        out.append((px, py, lon, lat))
    return out


def test_perfect_gcps_have_zero_error():
    g = synthetic_gcps()
    assert rmse_m(g) < 1e-3
    assert loo_rmse_m(g) < 1e-3
    assert fit_affine(g).shape == (2, 3)


def test_bad_gcp_is_found_and_raises_error():
    g = synthetic_gcps(noise_at=4, noise_m=60)  # one point misplaced by 60 Mercator-m (~45 ground-m at 41°N)
    assert worst_gcp(g) == 4
    assert loo_rmse_m(g) > rmse_m(g) > 1


def test_too_few_gcps():
    with pytest.raises(ValueError):
        fit_affine(synthetic_gcps()[:2])


def test_gdal_commands():
    translate, warp = gdal_commands(synthetic_gcps()[:3], "scan.jpg", "out.tif", method="tps")
    assert translate[0] == "gdal_translate" and translate.count("-gcp") == 3
    assert "-tps" in warp and warp[-1] == "out.tif"
    assert gdal_commands(synthetic_gcps()[:3], "a", "b", "poly2")[1][1:3] == ["-order", "2"]


def test_existed_in():
    assert existed_in(1900, 1950, 1920)
    assert existed_in(1900, None, 2020)
    assert not existed_in(1900, 1950, 1960)
    assert not existed_in(None, None, 1920)
