"""Georeferencing math: fit GCPs, measure error in ground meters, emit GDAL commands.

A GCP is (px, py, lon, lat): a pixel on the scan and where it is on Earth.
"""
import math

import numpy as np

R = 6378137.0  # Web Mercator sphere radius


def to_mercator(lon: float, lat: float) -> tuple[float, float]:
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def fit_affine(gcps: list[tuple[float, float, float, float]]) -> np.ndarray:
    """Least-squares 1st-order polynomial pixel -> EPSG:3857. Returns 2x3 matrix. Needs >= 3 GCPs."""
    if len(gcps) < 3:
        raise ValueError("affine needs at least 3 GCPs")
    A = np.array([[px, py, 1.0] for px, py, _, _ in gcps])
    XY = np.array([to_mercator(lon, lat) for _, _, lon, lat in gcps])
    coef, *_ = np.linalg.lstsq(A, XY, rcond=None)
    return coef.T


def residuals_m(gcps, M: np.ndarray) -> list[float]:
    """Per-GCP error in *ground* meters (Mercator meters shrunk by cos(lat))."""
    out = []
    for px, py, lon, lat in gcps:
        pred = M @ np.array([px, py, 1.0])
        actual = np.array(to_mercator(lon, lat))
        out.append(float(np.linalg.norm(pred - actual)) * math.cos(math.radians(lat)))
    return out


def rmse_m(gcps) -> float:
    r = residuals_m(gcps, fit_affine(gcps))
    return math.sqrt(sum(x * x for x in r) / len(r))


def loo_rmse_m(gcps) -> float:
    """Leave-one-out RMSE: predict each GCP from a fit of the others.

    This is the honest error to store and show. Fit RMSE is 0 with exactly 3 GCPs and always 0 for TPS.
    """
    if len(gcps) < 4:
        raise ValueError("leave-one-out needs at least 4 GCPs")
    errs = [residuals_m([g], fit_affine(gcps[:i] + gcps[i + 1 :]))[0] for i, g in enumerate(gcps)]
    return math.sqrt(sum(e * e for e in errs) / len(errs))


def worst_gcp(gcps) -> int:
    """Index of the GCP with the largest residual: the first one to show the user as 'probably misplaced'."""
    r = residuals_m(gcps, fit_affine(gcps))
    return max(range(len(r)), key=r.__getitem__)


def gdal_commands(gcps, src: str, dst: str, method: str = "poly1") -> list[list[str]]:
    """gdal_translate (attach GCPs) + gdalwarp (to a Cloud-Optimized GeoTIFF in EPSG:3857).

    method: poly1 (accurate surveys: Sanborn, USGS) | poly2 | poly3 | tps (hand-drawn / warped maps).
    """
    tmp = dst + ".gcps.tif"
    translate = ["gdal_translate", "-of", "GTiff", "-a_srs", "EPSG:4326"]
    for px, py, lon, lat in gcps:
        translate += ["-gcp", str(px), str(py), str(lon), str(lat)]
    translate += [src, tmp]
    how = ["-tps"] if method == "tps" else ["-order", method[-1]]
    warp = ["gdalwarp", *how, "-r", "bilinear", "-t_srs", "EPSG:3857", "-dstalpha",
            "-of", "COG", "-co", "COMPRESS=WEBP", "-co", "QUALITY=85", tmp, dst]
    return [translate, warp]
