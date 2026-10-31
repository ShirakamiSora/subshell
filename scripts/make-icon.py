"""生成 subshell 应用图标（深色圆角底 + 青绿色终端提示符）。"""

from PIL import Image, ImageDraw, ImageFont

SIZE = 512
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# 圆角深色背景
radius = 112
draw.rounded_rectangle((16, 16, SIZE - 16, SIZE - 16), radius=radius, fill=(11, 15, 22, 255))

# 内层渐变感：叠一层更亮的圆角
draw.rounded_rectangle((16, 16, SIZE - 16, SIZE - 16), radius=radius, outline=(35, 48, 68, 255), width=6)

# 终端提示符 >_
accent = (45, 212, 191, 255)
draw.line([(150, 196), (232, 268), (150, 340)], fill=accent, width=40, joint="curve")
draw.line([(300, 344), (392, 344)], fill=accent, width=40)
draw.ellipse((300 - 12, 344 - 12, 300 + 12, 344 + 12), fill=accent)
draw.ellipse((392 - 12, 344 - 12, 392 + 12, 344 + 12), fill=accent)

img.save("build/icon.png")
img.save(
    "build/icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("icon generated")
