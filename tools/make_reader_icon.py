# -*- coding: utf-8 -*-
"""生成阅读器图标：朱红圆角方印 + 米色「红」字。"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parents[1]
OUT_DIR = BASE / "reader" / "app"
SIZE = 512
FONT = r"C:\Windows\Fonts\simhei.ttf"


def main() -> int:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([10, 10, SIZE - 10, SIZE - 10], radius=102,
                           fill=(143, 47, 43, 255))
    # 柔和的高光，避免纯色显得死板
    gloss = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gd = ImageDraw.Draw(gloss)
    gd.ellipse([-180, -260, SIZE + 180, int(SIZE * 0.62)], fill=(255, 255, 255, 14))
    image = Image.alpha_composite(image, gloss)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([32, 32, SIZE - 32, SIZE - 32], radius=82,
                           outline=(217, 180, 91, 190), width=7)

    font = ImageFont.truetype(FONT, 330)
    text = "红"
    box = draw.textbbox((0, 0), text, font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    x = (SIZE - w) / 2 - box[0]
    y = (SIZE - h) / 2 - box[1] - 8
    # 轻微阴影
    draw.text((x + 5, y + 6), text, font=font, fill=(70, 18, 16, 90))
    draw.text((x, y), text, font=font, fill=(247, 239, 224, 255))

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    image.save(OUT_DIR / "icon.png")
    image.save(OUT_DIR / "icon.ico", sizes=[
        (16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256),
    ])
    print("图标已生成:", OUT_DIR / "icon.ico")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
