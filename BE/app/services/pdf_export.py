"""Conversation -> PDF. Branded (logo + diagonal watermark on every page) and clearly marked as a reference-only copy."""

from __future__ import annotations

import html
import io
import os
import re
from datetime import datetime, timezone
from typing import Any

from app.schemas import UserDoc

NOTICE = "FOR REFERENCE ONLY"
NOTICE_LONG = (
    "This is an unofficial copy of an AI-assisted conversation, exported for reference only. It may contain "
    "inaccuracies and is not a verified or authoritative record. Check important facts against the source data."
)

_FONT_SETS = [  # (regular, bold, italic, bold-italic)
    ("arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"),
    ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf"),
]
_FONT_DIRS = [r"C:\Windows\Fonts", "/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu", "/Library/Fonts"]
_SUBS = {"→": "->", "←": "<-", "↔": "<->", "≥": ">=", "≤": "<=", "≈": "~", "−": "-", "✓": "v", "✔": "v", "✗": "x", "‑": "-"}
_fonts: dict[str, str] | None = None


def _setup_fonts() -> dict[str, str]:
    """Use a real Unicode TTF family when the machine has one, else the built-in Helvetica (Latin-1 only)."""
    global _fonts
    if _fonts is not None:
        return _fonts
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    _fonts = {"r": "Helvetica", "b": "Helvetica-Bold", "i": "Helvetica-Oblique", "bi": "Helvetica-BoldOblique", "unicode": ""}
    for files in _FONT_SETS:
        for d in _FONT_DIRS:
            paths = [os.path.join(d, f) for f in files]
            if all(os.path.exists(p) for p in paths):
                try:
                    for key, name, p in zip(("r", "b", "i", "bi"), ("NFSans", "NFSans-B", "NFSans-I", "NFSans-BI"), paths):
                        pdfmetrics.registerFont(TTFont(name, p))
                        _fonts[key] = name
                    pdfmetrics.registerFontFamily("NFSans", normal="NFSans", bold="NFSans-B", italic="NFSans-I", boldItalic="NFSans-BI")
                    _fonts["unicode"] = "1"
                    return _fonts
                except Exception:
                    _fonts.update({"r": "Helvetica", "b": "Helvetica-Bold", "i": "Helvetica-Oblique", "bi": "Helvetica-BoldOblique"})
    return _fonts


_DIGITS = str.maketrans("₀₁₂₃₄₅₆₇₈₉⁰⁴⁵⁶⁷⁸⁹", "01234567890456789")  # sub/superscripts are missing from most fonts


def _text(s: str) -> str:
    s = s.translate(_DIGITS)
    for a, b in _SUBS.items():
        s = s.replace(a, b)
    if _setup_fonts()["unicode"]:
        return re.sub(r"[\U00010000-\U0010ffff]", "", s)  # emoji are not in the font
    return s.encode("cp1252", "ignore").decode("cp1252")


def _inline(s: str) -> str:
    s = html.escape(_text(s), quote=False)
    s = re.sub(r"`([^`]+)`", r'<font name="Courier" size="9">\1</font>', s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", s)
    s = re.sub(r"(?<![\w])_(?!\s)(.+?)(?<!\s)_(?![\w])", r"<i>\1</i>", s)
    return re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", r"\1", s)


def _when(iso: str | None) -> str:
    try:
        return datetime.fromisoformat(iso or "").astimezone(timezone.utc).strftime("%d %b %Y, %H:%M UTC")
    except ValueError:
        return ""


def _markdown(md: str, st: dict[str, Any], width: float) -> list:
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Preformatted, Spacer, Table, TableStyle

    out: list = []
    lines = md.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if s.startswith("```"):
            code = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(_text(lines[i])[:110])
                i += 1
            out.append(Preformatted("\n".join(code), st["code"]))
            i += 1
            continue
        if s.startswith("|") and i + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-{2,}", lines[i + 1]):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                if not re.match(r"^\s*\|?[\s:|-]+\|?\s*$", lines[i]):
                    rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")])
                i += 1
            ncol = max(len(r) for r in rows)
            data = [
                [Paragraph(_inline(c), st["th" if ri == 0 else "td"]) for c in r + [""] * (ncol - len(r))]
                for ri, r in enumerate(rows)
            ]
            t = Table(data, colWidths=[width / ncol] * ncol, repeatRows=1)
            t.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#c9ccd1")),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef0f3")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]))
            out += [t, Spacer(1, 4)]
            continue
        if not s:
            i += 1
            continue
        if (m := re.match(r"^(#{1,6})\s+(.*)$", s)):
            out.append(Paragraph(_inline(m.group(2)), st["h"]))
        elif (m := re.match(r"^[-*+]\s+(.*)$", s)):
            out.append(Paragraph(_inline(m.group(1)), st["li"], bulletText="•"))
        elif (m := re.match(r"^(\d+)[.)]\s+(.*)$", s)):
            out.append(Paragraph(_inline(m.group(2)), st["li"], bulletText=f"{m.group(1)}."))
        elif s.startswith(">"):
            out.append(Paragraph(_inline(s.lstrip("> ")), st["quote"]))
        else:
            para = [s]
            while i + 1 < len(lines) and lines[i + 1].strip() and not re.match(r"^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```)", lines[i + 1].strip()):
                i += 1
                para.append(lines[i].strip())
            out.append(Paragraph(_inline(" ".join(para)), st["p"]))
        i += 1
    return out


def build_conversation_pdf(conv: dict[str, Any], user: UserDoc) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from reportlab.pdfgen import canvas as rl_canvas
    from reportlab.platypus import (
        BaseDocTemplate, Frame, HRFlowable, KeepTogether, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    )

    f = _setup_fonts()
    ink, mute, rule = colors.HexColor("#0e0c14"), colors.HexColor("#5d656d"), colors.HexColor("#d9dce1")
    base = ParagraphStyle("base", fontName=f["r"], fontSize=9.5, leading=13.5, textColor=ink, alignment=TA_LEFT)
    st = {
        "p": ParagraphStyle("p", parent=base, spaceAfter=4),
        "li": ParagraphStyle("li", parent=base, leftIndent=14, bulletIndent=2, spaceAfter=2),
        "h": ParagraphStyle("h", parent=base, fontName=f["b"], fontSize=10.5, leading=14, spaceBefore=6, spaceAfter=3),
        "quote": ParagraphStyle("q", parent=base, leftIndent=10, textColor=mute, borderPadding=(0, 0, 0, 6)),
        "code": ParagraphStyle("c", parent=base, fontName="Courier", fontSize=8, leading=10, backColor=colors.HexColor("#f3f4f6"), borderPadding=4, spaceAfter=6),
        "th": ParagraphStyle("th", parent=base, fontName=f["b"], fontSize=8.5, leading=11),
        "td": ParagraphStyle("td", parent=base, fontSize=8.5, leading=11),
        "title": ParagraphStyle("title", parent=base, fontName=f["b"], fontSize=18, leading=22, spaceAfter=4),
        "meta": ParagraphStyle("meta", parent=base, fontSize=8.5, leading=12, textColor=mute),
        "who": ParagraphStyle("who", parent=base, fontName=f["b"], fontSize=9, leading=12, textColor=ink),
        "small": ParagraphStyle("small", parent=base, fontSize=8, leading=10.5, textColor=mute),
        "notice": ParagraphStyle("notice", parent=base, fontSize=8.5, leading=12, textColor=ink),
    }

    page_w, page_h = A4
    margin_x, top, bottom = 20 * mm, 24 * mm, 20 * mm
    frame_w = page_w - 2 * margin_x
    exported = datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC")
    title = _text(conv.get("title") or "Conversation")

    def draw_logo(c, x: float, y: float, size: float) -> None:
        nova = stringWidth("Nova", f["bi"], size)
        forge = stringWidth("Forge", f["bi"], size)
        pad, gap = size * 0.3, size * 0.06
        c.setFillColor(ink)
        c.setFont(f["bi"], size)
        c.drawString(x, y, "Nova")
        c.roundRect(x + nova + gap, y - size * 0.3, forge + 2 * pad, size * 1.25, size * 0.32, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.drawString(x + nova + gap + pad, y, "Forge")

    class Numbered(rl_canvas.Canvas):
        def __init__(self, *a, **k):
            super().__init__(*a, **k)
            self._pages: list[dict] = []

        def showPage(self):
            self._pages.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._pages)
            for state in self._pages:
                self.__dict__.update(state)
                self._decorate(total)
                super().showPage()
            super().save()

        def _decorate(self, total: int) -> None:
            c = self
            c.saveState()
            c.translate(page_w / 2, page_h / 2)  # diagonal watermark: drawn over the content, light enough to stay readable
            c.rotate(38)
            c.setFillColor(colors.Color(0, 0, 0, alpha=0.07))
            c.setFont(f["bi"], 96)
            c.drawCentredString(0, 0, "NovaForge")
            c.setFont(f["b"], 22)
            c.drawCentredString(0, -42, NOTICE)
            c.restoreState()

            c.saveState()
            draw_logo(c, margin_x, page_h - 14 * mm, 14)
            c.setFillColor(mute)
            c.setFont(f["b"], 7.5)
            c.drawRightString(page_w - margin_x, page_h - 13 * mm, NOTICE)
            c.setStrokeColor(rule)
            c.setLineWidth(0.6)
            c.line(margin_x, page_h - 18 * mm, page_w - margin_x, page_h - 18 * mm)
            c.line(margin_x, 14 * mm, page_w - margin_x, 14 * mm)
            c.setFont(f["r"], 7)
            c.drawString(margin_x, 9.5 * mm, _text(f"For reference only. AI-generated content may be inaccurate. Exported {exported} by {user.name} ({user.id})."))
            c.drawRightString(page_w - margin_x, 9.5 * mm, f"Page {c.getPageNumber()} of {total}")
            c.restoreState()

    buf = io.BytesIO()
    doc = BaseDocTemplate(
        buf, pagesize=A4, leftMargin=margin_x, rightMargin=margin_x, topMargin=top, bottomMargin=bottom,
        title=f"NovaForge conversation - {title}", author="NovaForge", subject="Reference copy of a NovaForge conversation",
    )
    doc.addPageTemplates([PageTemplate(id="p", frames=[Frame(margin_x, bottom, frame_w, page_h - top - bottom, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)])])

    story: list = [Paragraph(_inline(title), st["title"])]
    msgs = conv.get("messages", [])
    meta = [
        [Paragraph("<b>Exported by</b>", st["meta"]), Paragraph(_inline(f"{user.name} ({user.id})"), st["meta"]),
         Paragraph("<b>Exported on</b>", st["meta"]), Paragraph(exported, st["meta"])],
        [Paragraph("<b>Started</b>", st["meta"]), Paragraph(_when(conv.get("created_at")) or "-", st["meta"]),
         Paragraph("<b>Messages</b>", st["meta"]), Paragraph(str(len(msgs)), st["meta"])],
    ]
    mt = Table(meta, colWidths=[26 * mm, frame_w / 2 - 26 * mm, 24 * mm, frame_w / 2 - 24 * mm])
    mt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))
    box = Table([[Paragraph(f"<b>{NOTICE}.</b> {_inline(NOTICE_LONG)}", st["notice"])]], colWidths=[frame_w])
    box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, ink), ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f6f6f7")), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story += [mt, Spacer(1, 8), box, Spacer(1, 12)]

    for m in msgs:
        is_user = m.get("role") == "user"
        who = user.name if is_user else "NovaForge"
        head = Paragraph(f"{_inline(who)}  <font name='{f['r']}' size='8' color='#5d656d'>{_when(m.get('ts'))}</font>", st["who"])
        body = _markdown(m.get("content", ""), st, frame_w) or [Paragraph("(empty)", st["p"])]
        if m.get("blocked"):
            body.append(Paragraph("<i>This request was flagged by the safety check.</i>", st["small"]))
        cites = m.get("citations") or []
        if cites:
            body.append(Paragraph("<b>Sources</b>", st["small"]))
            for n, c in enumerate(cites[:8], 1):
                page = f", p.{c['page']}" if c.get("page") else ""
                body.append(Paragraph(_inline(f"[{n}] {c.get('filename', '')}{page}"), st["small"]))
        # flowables go straight into the story (not one big table cell) so long answers can break across pages
        story += [KeepTogether([head, Spacer(1, 3), body[0]]), *body[1:], Spacer(1, 4),
                  HRFlowable(width="100%", thickness=0.4, color=rule, spaceAfter=8)]

    doc.build(story, canvasmaker=Numbered)
    return buf.getvalue()
