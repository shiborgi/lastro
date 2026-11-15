"""Generates docs/diagrams/lastro-data-model.html — the inline-SVG diagrams of Lastro.

The tables, columns and foreign keys are written by hand from each module's
src/db/schema.ts and triggers.sql and the generated packages/host init; the
flows from the module READMEs and docs/adr (ADRs 6, 7, 11, 16, 19, 20 and 21).
Update them here when the schema or the rules change, then run:

    python3 docs/diagrams/generate.py

Every field drawn is checked against the box width at generation time, so a
column that no longer fits fails loudly instead of overflowing the box.
"""
import html, os, sys, json, re
from pathlib import Path

SNAPSHOT = json.loads((Path(__file__).resolve().parents[2] / "packages/host/drizzle/meta/0000_snapshot.json").read_text())
TABLES = {t["name"]: t for t in SNAPSHOT["tables"].values()}

PAPER, INK, MUTED, SOFT = "#f5f5f5", "#2d3142", "#4f5d75", "#5a6580"
ACCENT, ACCENT_TINT, LINK = "#bf4520", "rgba(191,69,32,0.08)", "#2e5aa8"
SANS, MONO = "'Geist', system-ui, sans-serif", "'Geist Mono', ui-monospace, monospace"


def ink(a):
    return f"rgba(45,49,66,{a})"


def e(s):
    return html.escape(str(s))


def r4(v):
    return int((v + 3) // 4 * 4)


def mono_w(text, size):
    return r4(len(text) * size * 0.62 + 10)


def fits(text, size, width, where):
    # Geist Mono advances 0.6em; keep 12px of padding on each side.
    if len(text) * size * 0.6 > width - 24:
        sys.exit(f"{where}: '{text}' does not fit in {width}px")


class D:
    def __init__(self, slug, w, h, title, desc):
        self.slug, self.w, self.h, self.title, self.desc = slug, w, h, title, desc
        self.zones, self.arrows, self.labels, self.nodes = [], [], [], []

    def m(self, kind):
        return f"url(#{self.slug}-{kind})"

    # ---------- connectors ----------
    def path(self, d, color=MUTED, marker="arrow", dash=None, width=1.2):
        da = f' stroke-dasharray="{dash}"' if dash else ""
        mk = f' marker-end="{self.m(marker)}"' if marker else ""
        self.arrows.append(
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{width}"{da}{mk}/>'
        )

    def label(self, cx, ytop, text, color=SOFT, size=8):
        w = mono_w(text, size)
        self.labels.append(
            f'<rect x="{cx - w / 2:g}" y="{ytop}" width="{w}" height="12" rx="2" fill="{PAPER}"/>'
            f'<text x="{cx}" y="{ytop + 9}" fill="{color}" font-size="{size}" font-family="{MONO}" '
            f'text-anchor="middle" letter-spacing="0.06em">{e(text)}</text>'
        )
        return w

    def label_beside(self, x, cy, text, side, color=SOFT):
        w = mono_w(text, 8)
        cx = x + 8 + w / 2 if side == "right" else x - 8 - w / 2
        self.label(cx, cy - 6, text, color)

    # ---------- zones ----------
    def zone(self, x, y, w, h, text):
        lw = mono_w(text, 7) + 4
        self.zones.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{ink(0.02)}" stroke="{ink(0.10)}" stroke-width="0.8"/>'
            f'<rect x="{x + 12}" y="{y + 4}" width="{lw}" height="12" rx="2" fill="{PAPER}"/>'
            f'<text x="{x + 12 + lw / 2:g}" y="{y + 13}" fill="{SOFT}" font-size="7" font-family="{MONO}" '
            f'text-anchor="middle" letter-spacing="0.14em">{e(text)}</text>'
        )

    def lane(self, x, y, w, h, text, divider=True):
        out = []
        if divider:
            out.append(f'<line x1="{x}" y1="{y}" x2="{x}" y2="{y + h}" stroke="{ink(0.10)}" stroke-width="0.8"/>')
        out.append(
            f'<text x="{x + w / 2:g}" y="{y + 16}" fill="{SOFT}" font-size="8" font-family="{MONO}" '
            f'text-anchor="middle" letter-spacing="0.14em">{e(text)}</text>'
        )
        self.zones.append("".join(out))

    # ---------- architecture / flow node ----------
    TREAT = {
        "focal": (ACCENT_TINT, ACCENT, None),
        "backend": ("#ffffff", INK, None),
        "store": (ink(0.05), MUTED, None),
        "input": ("rgba(79,93,117,0.10)", SOFT, None),
        "external": (ink(0.03), ink(0.30), "4,3"),
    }

    def node(self, x, y, w, h, kind, tag, name, sub, sub2=None):
        fill, stroke, dash = self.TREAT[kind]
        da = f' stroke-dasharray="{dash}"' if dash else ""
        tag_ink = MUTED if kind == "external" else stroke
        tw = mono_w(tag, 7)
        cx = x + w / 2
        for t in (sub, sub2):
            if t:
                fits(t, 9, w, name)
        out = (
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{PAPER}"/>'
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="1"{da}/>'
            f'<rect x="{x + 8}" y="{y + 6}" width="{tw}" height="12" rx="2" fill="none" stroke="{tag_ink}" stroke-opacity="0.45" stroke-width="0.8"/>'
            f'<text x="{x + 8 + tw / 2:g}" y="{y + 15}" fill="{tag_ink}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.08em">{e(tag)}</text>'
            f'<text x="{cx:g}" y="{y + 38}" fill="{INK}" font-size="12" font-weight="600" font-family="{SANS}" text-anchor="middle">{e(name)}</text>'
            f'<text x="{cx:g}" y="{y + 54}" fill="{MUTED}" font-size="9" font-family="{MONO}" text-anchor="middle">{e(sub)}</text>'
        )
        if sub2:
            out += f'<text x="{cx:g}" y="{y + 67}" fill="{MUTED}" font-size="9" font-family="{MONO}" text-anchor="middle">{e(sub2)}</text>'
        self.nodes.append(out)

    def diamond(self, cx, cy, hw, hh, text, focal=False):
        stroke = ACCENT if focal else INK
        fill = ACCENT_TINT if focal else "#ffffff"
        pts = f"{cx},{cy - hh} {cx + hw},{cy} {cx},{cy + hh} {cx - hw},{cy}"
        self.nodes.append(
            f'<polygon points="{pts}" fill="{PAPER}"/>'
            f'<polygon points="{pts}" fill="{fill}" stroke="{stroke}" stroke-width="1"/>'
            f'<text x="{cx}" y="{cy + 4}" fill="{INK}" font-size="11" font-weight="600" font-family="{SANS}" text-anchor="middle">{e(text)}</text>'
        )

    # ---------- ER entity ----------
    def entity(self, x, y, w, name, fields, kind="entity"):
        """kind: entity | focal | ref (a table drawn in full in another diagram)."""
        h = hh(fields)
        focal, ref = kind == "focal", kind == "ref"
        stroke = ACCENT if focal else (ink(0.35) if ref else INK)
        head = ACCENT_TINT if focal else ink(0.04)
        da = ' stroke-dasharray="4,3"' if ref else ""
        body = ink(0.02) if ref else "#ffffff"
        for f in fields:
            fits(f, 9, w, name)
        out = [
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{PAPER}"/>',
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{body}" stroke="{stroke}" stroke-width="1"{da}/>',
            f'<path d="M{x + 0.5},{y + 28} V{y + 6} Q{x + 0.5},{y + 0.5} {x + 6},{y + 0.5} H{x + w - 6} Q{x + w - 0.5},{y + 0.5} {x + w - 0.5},{y + 6} V{y + 28} Z" fill="{head}"/>',
            f'<line x1="{x}" y1="{y + 28}" x2="{x + w}" y2="{y + 28}" stroke="{ink(0.22)}" stroke-width="1"/>',
            f'<text x="{x + 12}" y="{y + 18}" fill="{INK}" font-size="12" font-weight="600" font-family="{SANS}">{e(name)}</text>',
        ]
        tag = "REF" if ref else "TABLE"
        tag_ink = MUTED if ref else stroke
        tw = mono_w(tag, 7)
        out.append(
            f'<rect x="{x + w - 12 - tw}" y="{y + 8}" width="{tw}" height="12" rx="2" fill="none" stroke="{tag_ink}" stroke-opacity="0.45" stroke-width="0.8"/>'
            f'<text x="{x + w - 12 - tw / 2:g}" y="{y + 17}" fill="{tag_ink}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.08em">{tag}</text>'
        )
        for i, f in enumerate(fields):
            # SVG collapses leading spaces; continuation lines keep their indent as NBSP.
            body_text = "\u00a0" * (len(f) - len(f.lstrip(" "))) + f.lstrip(" ")
            out.append(
                f'<text x="{x + 12}" y="{y + 28 + 18 + 16 * i}" fill="{MUTED}" font-size="9" font-family="{MONO}">{e(body_text)}</text>'
            )
        self.nodes.append("".join(out))
        return h

    # ---------- DB table ----------
    def table(self, x, y, w, name, rows, compartment=None, focal=False):
        """rows: (column, [chips], sqltype). Returns {column: row_center_y}."""
        if name in TABLES:
            columns = TABLES[name]["columns"]
            unknown = [row[0] for row in rows if not row[0].startswith("+") and row[0] not in columns]
            if unknown:
                sys.exit(f"{name}: unknown diagram columns: {unknown}")
            shown = sum(1 for row in rows if row[0] in columns)
            rows = [(f"+ {len(columns) - shown} more columns", chips, typ) if re.match(r"\+ \d+ more columns", col) else (col, chips, "timestamptz" if col in columns and columns[col]["type"] == "timestamp with time zone" else typ) for col, chips, typ in rows]
        nrows = len(rows)
        body = 28 + 24 * nrows
        comp_h = 0
        if compartment:
            comp_h = 22 + 14 * len(compartment[1]) + 6
        h = body + comp_h
        head = ACCENT_TINT if focal else ink(0.04)
        out = [
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{PAPER}"/>',
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="#ffffff" stroke="{INK}" stroke-width="1"/>',
            f'<path d="M{x + 0.5},{y + 28} V{y + 6} Q{x + 0.5},{y + 0.5} {x + 6},{y + 0.5} H{x + w - 6} Q{x + w - 0.5},{y + 0.5} {x + w - 0.5},{y + 6} V{y + 28} Z" fill="{head}"/>',
            f'<line x1="{x}" y1="{y + 28}" x2="{x + w}" y2="{y + 28}" stroke="{ink(0.22)}" stroke-width="1"/>',
            f'<text x="{x + 12}" y="{y + 18}" fill="{INK}" font-size="12" font-weight="600" font-family="{SANS}">{e(name)}</text>',
            f'<rect x="{x + w - 52}" y="{y + 8}" width="40" height="12" rx="2" fill="none" stroke="{ink(0.40)}" stroke-width="0.8"/>',
            f'<text x="{x + w - 32}" y="{y + 17}" fill="{INK}" opacity="0.8" font-size="8" font-family="{MONO}" text-anchor="middle" letter-spacing="0.08em">TABLE</text>',
        ]
        centers = {}
        for i, (col, chips, typ) in enumerate(rows):
            ry = y + 28 + 24 * i
            centers[col] = ry + 12
            if i % 2 == 0 and not col.startswith("+"):
                out.append(f'<rect x="{x + 1}" y="{ry}" width="{w - 2}" height="24" fill="{ink(0.02)}"/>')
            if col.startswith("+"):
                out.append(
                    f'<text x="{x + 12}" y="{ry + 16}" fill="{MUTED}" font-size="9" font-family="{MONO}">{e(col)}</text>'
                )
                continue
            out.append(
                f'<text x="{x + 12}" y="{ry + 16}" fill="{INK}" font-size="12" font-family="{SANS}">{e(col)}</text>'
            )
            cxp = x + 136
            for c in chips:
                out.append(
                    f'<rect x="{cxp}" y="{ry + 6}" width="20" height="12" rx="2" fill="none" stroke="{ink(0.35)}" stroke-width="0.8"/>'
                    f'<text x="{cxp + 10}" y="{ry + 15}" fill="{INK}" opacity="0.75" font-size="8" font-family="{MONO}" text-anchor="middle">{c}</text>'
                )
                cxp += 24
            out.append(
                f'<text x="{x + w - 12}" y="{ry + 16}" fill="{MUTED}" font-size="9" font-family="{MONO}" text-anchor="end">{e(typ)}</text>'
            )
        if compartment:
            cy = y + body
            out.append(f'<line x1="{x}" y1="{cy}" x2="{x + w}" y2="{cy}" stroke="{ink(0.22)}" stroke-width="1"/>')
            out.append(
                f'<text x="{x + 12}" y="{cy + 15}" fill="{SOFT}" font-size="8" font-family="{MONO}" letter-spacing="0.14em">{e(compartment[0])}</text>'
            )
            for i, item in enumerate(compartment[1]):
                out.append(
                    f'<text x="{x + 12}" y="{cy + 30 + 14 * i}" fill="{MUTED}" font-size="9" font-family="{MONO}">{e(item)}</text>'
                )
        self.nodes.append("".join(out))
        centers["__bottom"] = y + h
        return centers

    # ---------- legend ----------
    def legend(self, y, items):
        out = [
            f'<line x1="40" y1="{y - 8}" x2="{self.w - 40}" y2="{y - 8}" stroke="{ink(0.10)}" stroke-width="0.8"/>',
            f'<text x="40" y="{y + 12}" fill="{MUTED}" font-size="8" font-family="{MONO}" letter-spacing="0.14em">LEGEND</text>',
        ]
        x = 112
        for it in items:
            kind = it[0]
            if kind == "box":
                _, fill, stroke, dash, text = it
                da = f' stroke-dasharray="{dash}"' if dash else ""
                out.append(
                    f'<rect x="{x}" y="{y + 2}" width="20" height="14" rx="3" fill="{fill}" stroke="{stroke}" stroke-width="1"{da}/>'
                )
            else:
                _, stroke, dash, marker, text = it
                da = f' stroke-dasharray="{dash}"' if dash else ""
                mk = f' marker-end="{self.m(marker)}"' if marker else ""
                out.append(
                    f'<line x1="{x}" y1="{y + 9}" x2="{x + 22}" y2="{y + 9}" stroke="{stroke}" stroke-width="1.2"{da}{mk}/>'
                )
            out.append(
                f'<text x="{x + 30}" y="{y + 12}" fill="{MUTED}" font-size="9" font-family="{MONO}">{e(text)}</text>'
            )
            x += 30 + len(text) * 9 * 0.62 + 28
        if x > self.w:
            sys.exit(f"{self.slug}: legend overflows ({x:.0f} > {self.w})")
        self.legend_svg = "".join(out)

    def render(self):
        s = self.slug
        markers = "".join(
            f'<marker id="{s}-{k}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">'
            f'<polygon points="0 0, 8 3, 0 6" fill="{c}"/></marker>'
            for k, c in (("arrow", MUTED), ("arrow-accent", ACCENT), ("arrow-link", LINK))
        )
        return (
            f'<svg viewBox="0 0 {self.w} {self.h}" style="min-width:{self.w}px" xmlns="http://www.w3.org/2000/svg" '
            f'role="img" aria-labelledby="{s}-title {s}-desc">'
            f'<title id="{s}-title">{e(self.title)}</title><desc id="{s}-desc">{e(self.desc)}</desc>'
            f"<defs>{markers}</defs>"
            f'<rect width="100%" height="100%" fill="{PAPER}"/>'
            + "\n".join(self.zones)
            + "\n".join(self.arrows)
            + "\n".join(self.labels)
            + "\n".join(self.nodes)
            + getattr(self, "legend_svg", "")
            + "</svg>"
        )


def hh(fields):
    """Height of an ER entity box with these fields."""
    return 28 + 16 * len(fields) + 12


def H(x1, y, x2):
    return f"M{x1},{y} H{x2}"


def V(x, y1, y2):
    return f"M{x},{y1} V{y2}"


def sgn(v):
    return 1 if v > 0 else -1


def elbow_hvh(x1, y1, x2, y2, mid):
    """horizontal → vertical at mid → horizontal, r=8."""
    sx, sy, ex = sgn(mid - x1), sgn(y2 - y1), sgn(x2 - mid)
    return (
        f"M{x1},{y1} H{mid - 8 * sx} Q{mid},{y1} {mid},{y1 + 8 * sy} "
        f"V{y2 - 8 * sy} Q{mid},{y2} {mid + 8 * ex},{y2} H{x2}"
    )


def elbow_vhv(x1, y1, x2, y2, midy):
    """vertical → horizontal at midy → vertical, r=8."""
    sy, sx, ey = sgn(midy - y1), sgn(x2 - x1), sgn(y2 - midy)
    return (
        f"M{x1},{y1} V{midy - 8 * sy} Q{x1},{midy} {x1 + 8 * sx},{midy} "
        f"H{x2 - 8 * sx} Q{x2},{midy} {x2},{midy + 8 * ey} V{y2}"
    )


def elbow_hv(x1, y1, x2, y2):
    """horizontal to x2, then vertical to y2, one r=8 corner."""
    sx, sy = sgn(x2 - x1), sgn(y2 - y1)
    return f"M{x1},{y1} H{x2 - 8 * sx} Q{x2},{y1} {x2},{y1 + 8 * sy} V{y2}"


def elbow_vh(x1, y1, x2, y2):
    """vertical to y2, then horizontal to x2, one r=8 corner."""
    sx, sy = sgn(x2 - x1), sgn(y2 - y1)
    return f"M{x1},{y1} V{y2 - 8 * sy} Q{x1},{y2} {x1 + 8 * sx},{y2} H{x2}"


def card(d, x1, x2, y, left, right):
    """Cardinality marks just below a horizontal ER line."""
    d.label(x1 + 12, y + 6, left)
    d.label(x2 - 12, y + 6, right)


def card_v(d, x, y1, y2, top, bottom):
    """Cardinality marks beside a vertical ER line."""
    d.label_beside(x, y1 + 12, top, "right")
    d.label_beside(x, y2 - 12, bottom, "right")


# =====================================================================
# 1. Architecture
# =====================================================================
def architecture():
    d = D(
        "lastro-architecture", 960, 600,
        'Lastro architecture',
        'Operators use the web app and agents use MCP. Both adapters publish every operation of the composed host, derived from each module\'s descriptors. packages/host composes the modules in dependency order; core\'s write envelope runs every operation; each module persists its own tables in PostgreSQL.',
    )
    W, NH = 192, 64
    c1, c2, c3 = 96, 384, 672
    r1, r2, r3, r4_ = 40, 152, 296, 440
    d.zone(72, r2 - 32, 816, NH + 48, 'ADAPTERS')
    d.zone(72, r3 - 32, 816, NH + 48, 'COMPOSITION')
    d.zone(360, r4_ - 32, 528, NH + 48, 'PERSISTENCE')

    # clients
    d.path(V(c1 + 96, r1 + NH, r2), LINK, "arrow-link")
    d.label_beside(c1 + 96, (r1 + NH + r2 - 32) / 2 + 16, "HTTPS", "right")
    d.path(H(c3, r1 + 32, c2 + W), LINK, "arrow-link")
    d.label((c2 + W + c3) / 2, r1 + 32 - 20, 'READS')
    d.path(V(c3 + 96, r1 + NH, r2), LINK, "arrow-link")
    d.label_beside(c3 + 96, (r1 + NH + r2 - 32) / 2 + 16, "TOOLS", "right")
    d.path(H(c1 + W, r2 + 32, c2), LINK, "arrow-link")
    d.label((c1 + W + c2) / 2, r2 + 32 - 20, "/API/BACKEND")
    # adapters -> host
    d.path(V(c2 + 64, r2 + NH, r3))
    d.path(elbow_vhv(c3 + 96, r2 + NH, c2 + 128, r3, 256))
    d.label(640, 256 - 20, 'ONE HOST')
    d.path(V(c1 + 96, r2 + NH, r3))
    d.label_beside(c1 + 96, 256, "CONTRACTS", "right")
    d.path(elbow_vhv(c2 + 24, r2 + NH, c1 + 152, r3, 248))
    # host -> modules -> storage
    d.path(H(c2 + W, r3 + 32, c3), MUTED)
    d.label((c2 + W + c3) / 2, r3 + 32 - 20, 'IN ORDER')
    d.path(V(c2 + 96, r3 + NH, r4_), MUTED, dash="5,4")
    d.label_beside(c2 + 96, (r3 + NH + r4_) / 2, 'ENVELOPE', "right")
    d.path(H(c2 + W, r4_ + 32, c3))
    d.label((c2 + W + c3) / 2, r4_ + 32 - 20, "SQL · TX")

    d.node(c1, r1, W, NH, "input", "USER", 'Operator', "browser · tailnet")
    d.node(c2, r1, W, NH, "external", "EXT", 'Source systems', 'files · reports · read-only')
    d.node(c3, r1, W, NH, "input", "AGENT", "Agent", 'MCP client · bearer')
    d.node(c1, r2, W, NH, "backend", "WEB", "apps/web", "shell + module screens")
    d.node(c2, r2, W, NH, "backend", "API", "apps/api", "Hono · Better Auth · :3001")
    d.node(c3, r2, W, NH, "backend", "MCP", "apps/mcp", "MCP SDK · :3002")
    d.node(c1, r3, W, NH, "backend", "PURE", "packages/kernel", "values · operations")
    d.node(c2, r3, W, NH, "focal", "HOST", "packages/host", 'compose · one init')
    d.node(c3, r3, W, NH, "backend", "MODULES", "modules/*", 'six business modules')
    d.node(c2, r4_, W, NH, "backend", "CORE", "write envelope", 'authz · tx · replay · audit')
    d.node(c3, r4_, W, NH, "store", "DB", "PostgreSQL 16", 'triggers · book_id keys')
    d.legend(560, [
        ("box", ACCENT_TINT, ACCENT, None, 'composition root'),
        ("box", "#ffffff", INK, None, 'package / app'),
        ("box", ink(0.05), MUTED, None, 'database'),
        ("box", "rgba(79,93,117,0.10)", SOFT, None, 'client'),
        ("box", ink(0.03), ink(0.30), "4,3", 'external'),
        ("line", LINK, None, "arrow-link", "HTTP / MCP"),
        ("line", MUTED, "5,4", "arrow", 'operations'),
    ])
    return d


# =====================================================================
# 2. Financial core ER
# =====================================================================
X4 = (40, 340, 640, 940)
EW = 220


def financial():
    d = D(
        "lastro-financial", 1200, 704,
        'Lastro financial core',
        'Settlements link expenses and revenues to payments and receipts. Expenses and revenues state their amounts; settlements never exceed them. Accounts hold payments, receipts and transfers, with card billing windows. A receipt is expected until its paid date is set.',
    )
    c1, c2, c3, c4 = X4
    W = EW
    exp = ["# id · key", "→ party · → financial_category", 'amount  bigint ± (fixed)',
           "currency · reference_month", "name · occurred_at", 'status = f(settlements)']
    es = ["# id", "→ expense_id · → payment_id", "amount  bigint ≠ 0",
          "installment_number / _count", "voided_at · void_reason"]
    pay = ["# id · key", "→ account_id · method", 'amount = Σ settlements',
           "reference_month", "due_on / at · paid_on / at"]
    desc = ["# id · operation · action", "who · source · correlation", "payload (jsonb)", "one per write"]
    cat = ["# id · name", "kind  EXPENSE | REVENUE", '→ parent_id  (2 levels)',
           "role  FIXED | MERCHANDISE |", "      DEDUCTION | null"]
    tr = ["# id · key", "→ source_account_id", "→ destination_account_id",
          "amount  bigint > 0", "currency · reference_month"]
    acc = ["# id · key · name", "→ institution_id · number", "type  CARD · ACCOUNT · CASH", "      INVESTMENT"]
    mov = ["# id · → account_id", "reference_month", "starts_on .. ends_on", "no overlap per card"]
    rev = ["# id · key", "→ party · → financial_category", 'amount  bigint ± (stated)',
           "currency · reference_month", "name · occurred_on", 'status = f(settlements)']
    rs = ["# id", "→ revenue_id · → receipt_id", "amount  bigint ≠ 0", "voided_at · void_reason"]
    rec = ["# id · key", "→ account_id · method", 'amount = Σ settlements ≥ 0', "due_on / at · paid_on / at", 'expected while not paid']
    pty = ["# id · key · name · type", "customers · suppliers", "acquirers · operators", "never an account"]


    rA = 40
    rB = rA + max(map(hh, (exp, es, pay, desc))) + 64
    rC = rB + max(map(hh, (cat, tr, acc, mov))) + 64
    yA, yB, yC = rA + 64, rB + 44, rC + 64

    for x1, x2 in ((c1 + W, c2), (c2 + W, c3)):
        d.path(H(x1, yA, x2), MUTED, None)
        d.path(H(x1, yC, x2), MUTED, None)
    card(d, c1 + W, c2, yA, "1", "N")
    card(d, c2 + W, c3, yA, "N", "1")
    card(d, c1 + W, c2, yC, "1", "N")
    card(d, c2 + W, c3, yC, "N", "1")
    # transfer -> account (twice: from, to)
    d.path(H(c2 + W, yB, c3), MUTED, None)
    d.label((c2 + W + c3) / 2, yB - 20, "FROM · TO")
    card(d, c2 + W, c3, yB, "N", "1")
    # billing windows -> account
    d.path(H(c3 + W, yB, c4), MUTED, None)
    card(d, c3 + W, c4, yB, "1", "N")
    # verticals
    m1, m3, m4 = c1 + W / 2, c3 + W / 2, c4 + W / 2
    d.path(V(m1, rA + hh(exp), rB), MUTED, None)
    card_v(d, m1, rA + hh(exp), rB, "N", "1")
    d.path(V(m1, rB + hh(cat), rC), MUTED, None)
    card_v(d, m1, rB + hh(cat), rC, "1", "N")
    d.path(V(m3, rA + hh(pay), rB), MUTED, None)
    card_v(d, m3, rA + hh(pay), rB, "N", "1")
    d.path(V(m3, rB + hh(acc), rC), MUTED, None)
    card_v(d, m3, rB + hh(acc), rC, "1", "N")

    d.entity(c1, rA, W, "expenses", exp)
    d.entity(c2, rA, W, "expense_settlements", es, "focal")
    d.entity(c3, rA, W, "payments", pay)
    d.entity(c4, rA, W, "audit_events", desc, "ref")
    d.entity(c1, rB, W, "financial_categories", cat)
    d.entity(c2, rB, W, "transfers", tr)
    d.entity(c3, rB, W, "accounts", acc)
    d.entity(c4, rB, W, "account_cycles", mov)
    d.entity(c1, rC, W, "revenues", rev)
    d.entity(c2, rC, W, "revenue_settlements", rs, "focal")
    d.entity(c3, rC, W, "receipts", rec)
    d.entity(c4, rC, W, "parties", pty)
    d.h = r4(rC + max(map(hh, (rev, rs, rec, pty))) + 96)
    d.legend(d.h - 40, [
        ("box", ACCENT_TINT, ACCENT, None, 'settlement (the link)'),
        ("box", "#ffffff", INK, None, 'table'),
        ("line", MUTED, None, None, 'FK · cardinality 1 / N'),
    ])
    return d


# =====================================================================
# 3. Commercial ER
# =====================================================================
def commercial():
    d = D("lastro-commercial", 1200, 760, 'Sales and cash',
          'Imports stage what each file says. A day\'s sales by product become sale lines; its sales by method become revenues (Yooga: gross, − discount, + tip; Stone: − its fee). Money in is a receipt that settles those revenues: a Stone deposit (the promise) and its C6 line (the money) are one receipt, Pix lands in the Stone account, cash in the till.')
    boxes = [
        (0, 0, "product_categories", ["# id · key · name", '→ parent_id (2 levels)']),
        (1, 0, "products", ["# id · key · name", "→ product_category_id", "cost_override · active"]),
        (2, 0, "sale_movements", ["# id · external_id (hash)", "day · code · name", "quantity · revenue · cost"]),
        (3, 0, "sale_movement_descriptors", ["# descriptor_key (code)", "→ product_id", "nothing inferred"]),
        (3, 1, "daily close (derived)", ["from the day's lines", "fixed-cost share by month", "result is not stored"]),
        (1, 1, "sales", ["# id · business_date", "→ product_id · quantity", "revenue · cost · source"]),
        (2, 1, "sale_movement_links", ["→ movement · → sale", "external_key", "sale_key ‹key›-sale"]),
        (0, 2, "revenues", ['from revenue_movements', 'gross · discount · tip', "acquirer's fee (negative)"]),
        (1, 2, "revenue_settlements", ["→ revenue_id · receipt_id", 'amount ≠ 0 · matching sign', "never beyond the revenue"]),
        (2, 2, "receipts", ["→ account_id · method", 'Σ settlements ≥ 0', "due_on · paid_on", "expected: a promise"]),
        (3, 2, "receipt_movements", ["deposit (promise) · bank line", "Pix of the day · voucher", "one statement key, one receipt"]),
    ]
    for col, row, title, fields in boxes:
        d.entity(X4[col], 40 + row * 220, EW, title, fields, "focal" if title in ("receipts", "revenue_settlements", "sales") else "backend")
    for row, pairs in [(0, [(0, 1), (2, 3)]), (2, [(0, 1), (1, 2), (2, 3)])]:
        for left, right in pairs:
            d.path(H(X4[left] + EW, 92 + row * 220, X4[right]), MUTED, None)
    # products -> lines; a movement -> its link -> its line
    d.path(V(X4[1] + EW / 2, 40 + hh(boxes[1][3]), 40 + 220), MUTED, None)
    d.path(V(X4[2] + EW / 2, 40 + hh(boxes[2][3]), 40 + 220), MUTED, None)
    d.path(H(X4[1] + EW, 92 + 220, X4[2]), MUTED, None)
    d.legend(720, [("box", ACCENT_TINT, ACCENT, None, 'what a day sold and how it was paid'), ("line", MUTED, None, None, 'reference (Book omitted)')])
    return d


def daily_close():
    d = D(
        "lastro-daily-close", 1000, 540,
        'Daily closing',
        'Illustrative example: subtract the cost of goods and the allocated fixed costs from the day\'s sales. The remainder is the daily result, which is derived rather than stored.',
    )
    walk = [
        ("total", 2170, 'Sold', 'product revenue'),
        ("delta", -780, 'COGS', 'MISSING: warning, not 0'),
        ("delta", -612, 'Fixed cost share', 'provisional until month end'),
        ("total", 778, 'Result', 'derived, never stored'),
    ]
    base, top_ = 420, 40
    domain_max = 2400
    k0 = (base - top_) / domain_max
    start_h = round(walk[0][1] * k0)
    k = start_h / walk[0][1]  # the scale the start anchor implies, as the verifier refits it

    def y(v):
        return round(base - v * k)

    for g in range(0, domain_max + 1, 600):
        gy = round(base - g * k0)
        if g:
            d.zones.append(f'<line x1="80" y1="{gy}" x2="960" y2="{gy}" stroke="{ink(0.08)}" stroke-width="0.8"/>')
        d.zones.append(
            f'<text x="72" y="{gy + 3}" fill="{MUTED}" font-size="8" font-family="{MONO}" text-anchor="end">{g}</text>'
        )
    d.zones.append(f'<line x1="80" y1="{top_}" x2="80" y2="{base}" stroke="{ink(0.25)}" stroke-width="1"/>')
    d.zones.append(f'<line x1="80" y1="{base}" x2="960" y2="{base}" stroke="{ink(0.25)}" stroke-width="1"/>')
    d.zones.append(
        f'<text x="24" y="230" fill="{SOFT}" font-size="7" font-family="{MONO}" letter-spacing="0.14em" '
        f'text-anchor="middle" transform="rotate(-90 24 230)">R$ · EXAMPLE</text>'
    )
    level = 0
    for i, (role, v, name, note) in enumerate(walk):
        x = 112 + 144 * i
        if role == "total":
            y1, y2 = y(v), base
            fill, stroke = ink(0.08), INK
            level = v
            ly, txt = y1 - 8, f"{v}"
        else:
            after = level + v
            y1, y2 = y(level), y(after)
            focal = name == 'Fixed cost share'
            fill = "rgba(191,69,32,0.12)" if focal else PAPER
            stroke = ACCENT if focal else MUTED
            level = after
            ly, txt = y2 + 12, f"−{-v}"
        dv = f"{v}" if role == "total" else f"{v:+d}"
        d.nodes.append(
            f'<rect x="{x}" y="{y1}" width="96" height="{y2 - y1}" fill="{PAPER}"/>'
            f'<rect x="{x}" y="{y1}" width="96" height="{y2 - y1}" fill="{fill}" stroke="{stroke}" stroke-width="1" '
            f'data-role="{role}" data-value="{dv}" data-name="{e(name)}"/>'
            f'<text x="{x + 48}" y="{ly}" fill="{ACCENT if stroke == ACCENT else MUTED}" font-size="8" font-family="{MONO}" text-anchor="middle">{txt}</text>'
            f'<text x="{x + 48}" y="440" fill="{ACCENT if stroke == ACCENT else INK}" font-size="11" font-weight="600" font-family="{SANS}" text-anchor="middle">{e(name)}</text>'
            f'<text x="{x + 48}" y="456" fill="{MUTED}" font-size="8" font-family="{MONO}" text-anchor="middle">{e(note)}</text>'
        )
        if i < len(walk) - 1:
            d.arrows.append(
                f'<line x1="{x + 96}" y1="{y(level)}" x2="{x + 144}" y2="{y(level)}" stroke="{ink(0.55)}" stroke-width="1" data-carry="{level}"/>'
            )
    d.legend(500, [
        ("box", ink(0.08), INK, None, "total"),
        ("box", PAPER, MUTED, None, 'deduction'),
        ("box", "rgba(191,69,32,0.12)", ACCENT, None, 'provisional while the month is open'),
    ])
    return d


# =====================================================================
# 6. DB — expense cycle
# =====================================================================
C1, C2, C3, TW = 40, 440, 840, 280


def db_expense():
    d = D(
        "lastro-db-expense", 1220, 760,
        'Physical schema · expense cycle',
        'Expenses, expense_settlements, payments, accounts and financial_categories with SQL types, constraints and composite foreign keys including book_id and currency, all ON DELETE NO ACTION.',
    )
    es_y = 60
    es = [("id", ["PK"], "serial"), ("book_id", ["PK", "FK"], "integer"),
          ("expense_id", ["FK", "NN"], "integer"), ("payment_id", ["FK", "NN"], "integer"),
          ("amount", ["NN"], "bigint ≠ 0"), ("currency", ["FK", "NN"], "text [A-Z]{3}"),
          ("voided_at", [], "timestamp"), ("+ 5 more columns", [], "")]
    ex = [("id", ["PK"], "serial"), ("book_id", ["PK", "FK"], "integer"),
          ("party_id", ["FK", "NN"], "integer"), ("financial_category_id", ["FK", "NN"], "integer"),
          ("amount", ["NN"], "bigint ≠ 0"), ("currency", ["NN"], "text · def USD"),
          ("reference_month", ["NN"], "date"), ("+ 3 more columns", [], "")]
    pa = [("id", ["PK"], "serial"), ("book_id", ["PK", "FK"], "integer"),
          ("account_id", ["FK", "NN"], "integer"), ("amount", ["NN"], "bigint derived"),
          ("currency", ["NN"], "text"), ("due_on", [], "date"),
          ("paid_on", [], "date"), ("+ 3 more columns", [], "")]
    ac = [("id", ["PK"], "serial"), ("book_id", ["PK", "FK"], "integer"),
          ("institution_id", ["FK"], "integer"), ("name", ["NN"], "text"),
          ("type", ["NN"], 'text · 4 types'), ("+ 2 more columns", [], "")]
    ca = [("id", ["PK"], "serial"), ("book_id", ["PK", "FK"], "integer"),
          ("kind", ["NN"], "text"), ("name", ["NN"], "text"), ("parent_id", ["FK"], "integer"),
          ("role", [], 'text · 3 roles')]
    ca_comp = ("TRIGGERS", ["category_group_rules", "category_must_be_a_leaf"])
    ac_comp = ("TRIGGERS", ["account_cycle_no_overlap"])

    ex_y = es_y + 48
    pa_y = es_y + 72
    es_c = {c[0]: es_y + 28 + 24 * i + 12 for i, c in enumerate(es)}
    ex_c = {c[0]: ex_y + 28 + 24 * i + 12 for i, c in enumerate(ex)}
    pa_c = {c[0]: pa_y + 28 + 24 * i + 12 for i, c in enumerate(pa)}
    es_bottom = es_y + 28 + 24 * len(es) + 22 + 14 * 2 + 6
    pa_bottom = pa_y + 28 + 24 * len(pa) + 22 + 14 * 1 + 6
    ca_y = r4(es_bottom + 64)
    ac_y = r4(pa_bottom + 64)
    ca_id = ca_y + 40
    ac_id = ac_y + 40

    d.path(H(C2, es_c["expense_id"], C1 + TW))
    d.label((C1 + TW + C2) / 2, es_c["expense_id"] - 20, "NO ACTION")
    d.path(H(C2 + TW, es_c["payment_id"], C3))
    d.label((C2 + TW + C3) / 2, es_c["payment_id"] - 20, "NO ACTION")
    d.path(elbow_hvh(C1 + TW, ex_c["financial_category_id"], C2, ca_id, 380))
    d.label_beside(380, (ex_c["financial_category_id"] + ca_id) / 2 + 24, "NO ACTION", "right")
    d.path(elbow_hvh(C3 + TW, pa_c["account_id"], C3 + TW, ac_id, C3 + TW + 20))
    d.label_beside(C3 + TW + 20, (pa_c["account_id"] + ac_id) / 2, "NO ACTION", "right")

    d.table(C2, es_y, TW, "expense_settlements", es,
            ("TRIGGERS", ["expense_settlement_within_total", "refresh_payment_amount"]))
    d.table(C1, ex_y, TW, "expenses", ex, ("UNIQUE", ["(book_id, id, currency)"]))
    d.table(C3, pa_y, TW, "payments", pa, ("UNIQUE", ["(book_id, id, currency)"]))
    ca_end = d.table(C2, ca_y, TW, "financial_categories", ca, ca_comp)["__bottom"]
    ac_end = d.table(C3, ac_y, TW, "accounts", ac, ac_comp)["__bottom"]
    d.h = r4(max(ca_end, ac_end) + 80)
    d.legend(d.h - 40, [
        ("line", MUTED, None, "arrow", 'FK column → column'),
        ("box", "#ffffff", INK, None, 'public.* table'),
    ])
    return d


# =====================================================================
# 7. DB — import / descriptors
# =====================================================================
# =====================================================================
# 8. DB — auth & tenancy
# =====================================================================
def db_auth():
    d = D(
        "lastro-db-auth", 1220, 640,
        'Physical schema · authentication and tenancy',
        'Better Auth users, cascading session deletion, Book members and agent credentials scoped to a Book and a member operator.',
    )
    us_y = 80
    us = [("id", ["PK"], "text"), ("name", ["NN"], "text"), ("email", ["UQ", "NN"], "text"),
          ("email_verified", ["NN"], "boolean"), ("+ 3 more columns", [], "")]
    yc = us_y + 40
    se_y = yc - 8 - 64
    se = [("id", ["PK"], "text"), ("user_id", ["FK", "NN"], "text"), ("token", ["UQ", "NN"], "text"),
          ("expires_at", ["NN"], "timestamp"), ("+ 4 more columns", [], "")]
    bm_y = 280
    bm = [("book_id", ["PK", "FK"], "integer"), ("user_id", ["PK", "FK"], "text"), ("role", ["NN"], "text")]
    bk_y = 280
    bk = [("id", ["PK"], "serial"), ("key", ["UQ", "NN"], "text"), ("name", ["NN"], "text")]
    ac_y = 432
    ac = [("id", ["PK"], "text"), ("book_id", ["FK", "NN"], "integer"),
          ("delegated_operator", ["FK", "NN"], "text"), ("principal", ["NN"], "text"),
          ("secret_hash", ["NN"], "text"), ("revoked_at", [], "timestamp")]
    bm_book = bm_y + 40
    bm_user = bm_y + 64
    bk_id = bk_y + 40
    ac_book = ac_y + 64
    ac_op = ac_y + 88

    d.path(H(C1 + TW, yc - 8, C2), ACCENT, "arrow-accent")
    d.label((C1 + TW + C2) / 2, yc - 8 - 20, "CASCADE", ACCENT)
    d.path(elbow_hvh(C2, bm_user, C2, yc + 8, 380))
    d.label_beside(380, (bm_user + yc) / 2 + 12, "NO ACTION", "left")
    d.path(H(C2 + TW, bm_book - 6, C3))
    d.label((C2 + TW + C3) / 2, bm_book - 6 - 20, "NO ACTION")
    d.path(elbow_hvh(C3 + TW, ac_book, C3 + TW, bk_id + 8, C3 + TW + 20))
    d.label_beside(C3 + TW + 20, (ac_book + bk_id) / 2 + 8, "NO ACTION", "right")
    d.path(elbow_hvh(C3, ac_op, C2 + TW, bm_user, 760))
    d.label_beside(760, (ac_op + bm_user) / 2 + 12, "MEMBER ONLY", "left")
    d.table(C1, se_y, TW, "auth_sessions", se, focal=True)
    d.table(C2, us_y, TW, "auth_users", us)
    d.table(C2, bm_y, TW, "book_members", bm)
    d.table(C3, bk_y, TW, "books", bk)
    d.table(C3, ac_y, TW, "agent_credentials", ac)
    d.h = r4(ac_y + 28 + 24 * len(ac) + 80)
    d.legend(d.h - 40, [
        ("line", ACCENT, None, "arrow-accent", "ON DELETE CASCADE"),
        ("line", MUTED, None, "arrow", "FK NO ACTION"),
        ("box", ACCENT_TINT, INK, None, 'rows deleted in cascade'),
    ])
    return d


SECTIONS = [
    (architecture, 'Architecture · modules', 'Architecture', 'Both adapters publish every operation of the composed host, derived from the modules\' descriptors. packages/host composes the modules in dependency order; core\'s write envelope runs every operation; source systems stay read-only.'),
    (financial, 'ER · financial core', 'Financial core', 'Four records: expense ≠ payment, revenue ≠ receipt. Items are negative exactly in DEDUCTION financial categories; settlements match item signs and never exceed their item, which states its amount (ADR 7). Receipts and payments are nonnegative signed sums.'),
    (commercial, 'ER · sales and cash', 'Sales and cash', 'Every import stages its file as movements and posts by descriptor (ADR 16). Sale movements become the day\'s lines; revenue movements become revenues; receipt movements become receipts that settle them (ADRs 20 and 21).'),
    (daily_close, 'Waterfall · result', 'Daily closing', 'Illustrative example: result = sold − cost of goods − fixed cost share. An open month keeps the day provisional.'),
    (db_expense, 'Database schema · expenses', 'Physical schema — expenses', 'Composite Book/currency foreign keys enforce isolation. Settlements match item signs and cannot exceed their magnitude. Payment amounts are derived and ≥ 0; discounts are negative expenses in the same payment.'),
    (db_auth, 'Database schema · authentication', 'Physical schema — authentication and tenancy', 'An agent credential belongs to a Book and its delegated operator must be a member. Composite keys enforce isolation across Books.'),
]


def page():
    parts = []
    for fn, eyebrow, h2, caption in SECTIONS:
        d = fn()
        parts.append(
            f'<section><p class="eyebrow">{e(eyebrow)}</p><h2>{e(h2)}</h2>'
            f'<p class="caption">{caption}</p>'
            f'<div class="diagram-container">{d.render()}</div></section>'
        )
    return TEMPLATE.replace("{{BODY}}", "\n".join(parts))


TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Lastro · data model</title>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { --paper:#f5f5f5; --ink:#2d3142; --muted:#4f5d75; --accent:#bf4520;
  --sans:'Geist', system-ui, sans-serif; --serif:'Instrument Serif', serif; --mono:'Geist Mono', ui-monospace, monospace; }
body { font-family: var(--sans); background: var(--paper); color: var(--ink); padding: 3rem 1rem; }
.frame { max-width: 1240px; margin: 0 auto; }
header { margin-bottom: 3rem; }
.eyebrow { font-family: var(--mono); font-size: .66rem; font-weight: 500; letter-spacing: .18em; text-transform: uppercase; color: var(--muted); margin-bottom: .5rem; }
h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(2rem, 3vw + 1rem, 2.8rem); letter-spacing: -.02em; line-height: 1.1; }
.lede { max-width: 72ch; margin-top: .75rem; color: var(--muted); line-height: 1.55; font-size: .95rem; }
section { margin: 0 0 4rem; }
h2 { font-family: var(--serif); font-weight: 400; font-size: clamp(1.4rem, 2vw + .75rem, 1.9rem); letter-spacing: -.02em; margin-bottom: .6rem; }
.caption { max-width: 80ch; color: var(--muted); line-height: 1.55; font-size: .9rem; margin-bottom: 1.25rem; }
.caption strong { color: var(--ink); font-weight: 600; }
code { font-family: var(--mono); font-size: .82em; color: var(--ink); }
.diagram-container { width: 100%; overflow-x: auto; }
svg { width: 100%; display: block; }
@media print { .diagram-container { overflow-x: visible; } svg { min-width: 0 !important; } }
</style>
</head>
<body>
<div class="frame">
<header>
<p class="eyebrow">Lastro · data model · modules core, finance, sales and the imports · ADRs 6, 7, 11, 16, 19, 20 and 21</p>
<h1>Lastro data model</h1>
<p class="lede">Architecture, financial core, sales and cash, daily closing formula and the
physical schema of the subsystems enforcing these rules, based on current code (each module's
<code>src/db/schema.ts</code> and <code>triggers.sql</code>, and <code>packages/host/drizzle/0000_init.sql</code>).
Deploying a regenerated schema requires database recreation; see the runbook.</p>
<p class="lede"><strong>Where revenue and cash come from:</strong> the point of sale's payments report and
the acquirer's sales are the revenue; deposits, the Pix credited to the Stone account and the till are the
receipts that settle it. Each file is staged as movements and posted only by its descriptors; every flow is
documented in <code>docs/flows</code>.</p>
<p class="lede"><a href="../data-model.md">Data model guide</a> ·
<a href="../domain-dictionary.md">Domain dictionary</a> ·
<a href="../data-dictionary.md">Complete physical dictionary</a> ·
<a href="../operating/runbook.md">Runbook</a></p>
</header>
{{BODY}}
</div>
</body>
</html>
"""

if __name__ == "__main__":
    default = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lastro-data-model.html")
    out = sys.argv[1] if len(sys.argv) > 1 else default
    with open(out, "w") as f:
        f.write(page())
