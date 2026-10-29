"""Download the Supertonic 3 ONNX assets into SUPERTONIC_MODEL_DIR.

Runs at container start (a .complete marker skips later boots). The revision
pins the archived snapshot exactly as recommended by the supertone-oss-archive
quick start.
"""

import os
from pathlib import Path

from huggingface_hub import snapshot_download

REPO_ID = "supertone-oss-archive/supertonic-3"
REVISION = "aafc6e32416a594460b32413efc49d7fe4ce6d46"


def main() -> None:
    target = Path(os.environ.get("SUPERTONIC_MODEL_DIR", "models/supertonic"))
    marker = target / ".complete"

    if marker.exists():
        print("Supertonic assets already present in " + str(target))
        return

    target.mkdir(parents=True, exist_ok=True)
    token = os.environ.get("HF_TOKEN") or None
    print("Downloading " + REPO_ID + " (revision " + REVISION[:12] + ") to " + str(target) + " ...")
    snapshot_download(
        repo_id=REPO_ID,
        revision=REVISION,
        local_dir=str(target),
        token=token,
    )
    marker.touch()
    print("Supertonic assets ready.")


if __name__ == "__main__":
    main()
