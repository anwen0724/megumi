"""Writes the PNG fixture the image tests send.

The fixture is generated rather than committed so it is reproducible and its bytes are
obvious from the code that produces them. The image is a red circle on a white square, which
is enough for a test to tell that an image survived a round trip without being able to depend
on any particular encoder.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

__all__ = ["CIRCLE_RADIUS", "SIZE", "main", "render_red_circle_png"]

SIZE = 200
CIRCLE_RADIUS = 50
_CENTRE = SIZE // 2

# The two colours as 8-bit RGB triples.
_WHITE = (255, 255, 255)
_RED = (255, 0, 0)


def _pixel_is_in_circle(x: int, y: int) -> bool:
    """Whether a pixel centre lies inside the circle, with no anti-aliasing."""

    dx = x - _CENTRE
    dy = y - _CENTRE
    return dx * dx + dy * dy <= CIRCLE_RADIUS * CIRCLE_RADIUS


def _raw_rows() -> bytes:
    """The image rows, each prefixed with the PNG filter byte that means "no filter"."""

    rows = bytearray()
    for y in range(SIZE):
        rows.append(0)
        for x in range(SIZE):
            rows.extend(_RED if _pixel_is_in_circle(x, y) else _WHITE)
    return bytes(rows)


def _chunk(kind: bytes, payload: bytes) -> bytes:
    """One PNG chunk: its length, its type, its payload and its checksum."""

    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def render_red_circle_png() -> bytes:
    """A square white image with a red circle in the middle, encoded as PNG.

    The encoder is written out because it only has one job: two colours, no transparency, no
    interlacing. A general image library would add a dependency for a fixture.
    """

    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", header)
        + _chunk(b"IDAT", zlib.compress(_raw_rows(), 9))
        + _chunk(b"IEND", b"")
    )


def main() -> int:
    """Write the fixture beside the tests that use it."""

    output_dir = Path(__file__).resolve().parents[4] / "tests" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "red-circle.png"
    output_path.write_bytes(render_red_circle_png())
    print(f"Generated test image at: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
