"""把 docs/screenshots 下的界面截图合成为演示 GIF。

用法：
    python scripts/make-gif.py            # 生成 docs/screenshots/demo.gif
    python scripts/make-gif.py --width 960

需要 Pillow。若未安装：pip install pillow
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "docs" / "screenshots"
# 展示顺序即动画顺序：先讲入口，再讲主界面与四块能力
ORDER = ["welcome", "overview", "health", "files", "terminal", "assistant"]
FRAME_MS = 1600


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--width", type=int, default=1200, help="输出 GIF 宽度")
    parser.add_argument("--out", default=str(SHOTS / "demo.gif"))
    args = parser.parse_args()

    frames: list[Image.Image] = []
    for name in ORDER:
        path = SHOTS / f"{name}.png"
        if not path.exists():
            print(f"跳过（不存在）：{path.name}")
            continue
        image = Image.open(path).convert("RGB")
        ratio = args.width / image.width
        image = image.resize((args.width, int(image.height * ratio)), Image.LANCZOS)
        # 转成调色板模式可以显著减小 GIF 体积
        frames.append(image.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))

    if not frames:
        raise SystemExit("没有找到可用的截图，请先运行 node scripts/ui-preview.mjs")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        out,
        save_all=True,
        append_images=frames[1:],
        duration=FRAME_MS,
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(f"已生成 {out}（{len(frames)} 帧，{out.stat().st_size / 1024:.0f} KB）")


if __name__ == "__main__":
    main()
