"""Prune catalogued warped maps whose source image has since been replaced (see ingest.same_image).

python -m strata.ingest check_images. The bbox is ignored: it checks every map with a Georeference Annotation.
"""
from . import get_json, image_matches
from .nypl_warper import ALLMAPS_IMAGE_MAPS, allmaps_id


def resource_for(annotation: str, image: str | None) -> dict:
    """The annotation's resource (id, width, height). NYPL images were fetched per image at ingest, so that response
    is in the cache; anything else asks the Allmaps API for the one map."""
    if image:
        for f in get_json(ALLMAPS_IMAGE_MAPS.format(allmaps_id(image)))["features"]:
            if f["properties"]["id"] == annotation:
                return f["properties"]["resource"]
    return get_json("https://api.allmaps.org/maps/" + annotation.rsplit("/", 1)[-1])["resource"]


def run(conn, bbox) -> int:
    rows = conn.execute("SELECT id, georef_annotation, iiif_manifest, source FROM maps "
                        "WHERE georef_annotation IS NOT NULL ORDER BY id").fetchall()
    print(f"check_images: {len(rows)} warped maps")
    removed = 0
    for i, (map_id, annotation, image, source) in enumerate(rows, 1):
        try:
            resource = resource_for(annotation, image if source == "nypl" else None)
        except Exception as e:  # leave the row; the next run tries again
            print(f"  skip {map_id}: {e}")
            continue
        if not image_matches(resource):
            conn.execute("DELETE FROM maps WHERE id = %s", (map_id,))
            removed += 1
        if i % 100 == 0:
            conn.commit()
            print(f"  {i}/{len(rows)}, {removed} removed")
    print(f"check_images: removed {removed}")
    return len(rows) - removed
