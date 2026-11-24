"""Regenerate synthetic PDF fixtures: python -m pip install reportlab pillow."""

from io import BytesIO
from pathlib import Path
import os

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ROOT = Path(__file__).resolve().parent
PAGE = (612, 792)
# Override on Linux, e.g. PDF_FIXTURE_FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
FONT = os.environ.get("PDF_FIXTURE_FONT", "/System/Library/Fonts/Supplemental/Arial.ttf")
pdfmetrics.registerFont(TTFont("FixtureFont", FONT))


def canvas(name):
    return Canvas(str(ROOT / name), pagesize=PAGE, invariant=1, pageCompression=1)


def native(c, heading="Digital document"):
    c.setFont("FixtureFont", 20)
    c.drawString(54, 730, heading)
    c.setFont("FixtureFont", 12)
    c.drawString(54, 696, "Native English text stays readable.")
    c.drawString(54, 676, "Deutscher Text: Die Rechnung ist bezahlt.")
    c.drawString(54, 646, "A simple table follows.")
    for x in (54, 254, 454):
        c.line(x, 500, x, 620)
    for y in (500, 540, 580, 620):
        c.line(54, y, 454, y)
    for y, values in ((596, ("Product", "Quantity")), (556, ("Apples", "12")), (516, ("Pears", "7"))):
        for x, value in zip((64, 264), values):
            c.drawString(x, y, value)
    illustration = Image.new("RGB", (160, 100), "#e8f0ff")
    ImageDraw.Draw(illustration).ellipse((40, 10, 120, 90), fill="#336699")
    c.drawImage(ImageReader(illustration), 54, 360, width=120, height=75)
    c.drawString(54, 338, "Figure caption remains native text.")


def scan():
    image = Image.new("RGB", (1530, 1980), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(FONT, 36)
    for index, line in enumerate((
        "Scanned English text is readable.",
        "The invoice has been paid in full.",
        "Deutscher Scan: Die Rechnung ist bezahlt.",
        "Grüße aus Köln für zwölf Gäste.",
        "Literal syntax: [invoice] *paid* <tag>.",
    )):
        draw.text((120, 160 + index * 100), line, font=font, fill="black")
    data = BytesIO()
    image.save(data, format="PNG")
    data.seek(0)
    return ImageReader(data)


def scanned(c, footer=False):
    c.drawImage(scan(), 0, 0, width=PAGE[0], height=PAGE[1])
    if footer:
        c.setFont("FixtureFont", 8)
        c.drawString(54, 24, "Native footer only - page 2")


c = canvas("digital.pdf")
native(c)
c.showPage()
c.save()

c = canvas("scanned.pdf")
scanned(c)
c.showPage()
c.save()

c = canvas("mixed.pdf")
native(c, "Mixed document first page")
c.showPage()
scanned(c, footer=True)
c.showPage()
c.showPage()  # Blank physical page must remain in the output.
c.setFont("FixtureFont", 12)
c.drawString(54, 700, "Last native page after the blank page.")
c.showPage()
c.save()
