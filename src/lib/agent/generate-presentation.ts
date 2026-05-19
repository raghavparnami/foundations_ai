/**
 * Builds a presentation-quality .pptx file from a structured spec.
 *
 * Why this design:
 *  - Native PPT charts (not image embeds) — recipients can re-style in
 *    PowerPoint without losing data.
 *  - Indigo/violet brand palette matches the Loom UI.
 *  - Slide types are explicit (title / summary / chart / table / bullets /
 *    closing) so the agent can reason about deck structure instead of just
 *    dumping bullets.
 *
 * The agent uploads the spec; we serialize the PPTX to a buffer, stash it
 * in the `reports` table (kind=presentation by virtue of the .pptx slug),
 * and return a download URL.
 */
import pptxgen from "pptxgenjs";
import { catalogPool } from "../catalog/db";
import { audit } from "../catalog/queries";

const BRAND = {
  accent:   "5B6CFF",
  accent2:  "8A4DFF",
  ink:      "14152A",
  muted:    "5B6075",
  faint:    "9AA0B4",
  bg:       "FBFBFD",
  bgSoft:   "F4F5F9",
  border:   "E7E9F1",
};

const CHART_PALETTE = ["5B6CFF", "8A4DFF", "D36CFF", "7C3AED", "A78BFA", "C084FC"];

export type StatCard = { label: string; value: string; delta?: string };

export type Slide =
  | { type: "title"; title: string; subtitle?: string }
  | { type: "summary"; headline: string; body?: string; stats?: StatCard[] }
  | {
      type: "chart";
      headline: string;
      chart_type: "bar" | "line" | "pie" | "area";
      x_field: string;
      y_field: string;
      data: Record<string, string | number>[];
      caption?: string;
    }
  | {
      type: "table";
      headline: string;
      columns: string[];
      rows: (string | number)[][];
      caption?: string;
    }
  | { type: "bullets"; headline: string; bullets: string[] }
  | { type: "closing"; headline: string; body?: string };

export type PresentationSpec = {
  title: string;
  subtitle?: string;
  author?: string;
  slides: Slide[];
};

export type GeneratePresentationInput = {
  spec: PresentationSpec;
  slug?: string;
  conversationId: string;
};

export type GeneratePresentationResult =
  | { ok: true; slug: string; title: string; slide_count: number; download_url: string; bytes: number }
  | { ok: false; error: string };

export async function generatePresentation(
  input: GeneratePresentationInput,
): Promise<GeneratePresentationResult> {
  const spec = input.spec;
  if (!spec?.title?.trim()) return { ok: false, error: "spec.title is required" };
  if (!Array.isArray(spec.slides) || spec.slides.length === 0) {
    return { ok: false, error: "spec.slides must be a non-empty array" };
  }

  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.title = spec.title;
  if (spec.author) pres.author = spec.author;
  pres.company = "Loom";

  // Master slide — quiet header rule + footer pagination
  pres.defineSlideMaster({
    title: "LOOM_MASTER",
    background: { color: BRAND.bg },
    objects: [
      { rect: { x: 0, y: 0, w: 13.33, h: 0.08, fill: { color: BRAND.accent } } },
      {
        text: {
          text: "Loom · Always preparing",
          options: {
            x: 0.5, y: 7.05, w: 6, h: 0.3,
            fontFace: "Inter", fontSize: 9, color: BRAND.faint, align: "left",
          },
        },
      },
    ],
    slideNumber: {
      x: 12.5, y: 7.05, w: 0.5, h: 0.3,
      fontFace: "Inter", fontSize: 9, color: BRAND.faint, align: "right",
    },
  });

  for (const slide of spec.slides) {
    renderSlide(pres, slide, spec);
  }

  // Serialize
  const data = (await pres.write({ outputType: "nodebuffer" })) as Buffer;
  const slug = sanitizeSlug(input.slug || spec.title) || `deck-${Date.now()}`;
  const filename = `${slug}.pptx`;

  await catalogPool.query(
    `INSERT INTO reports (slug, title, body_md, conversation_id)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE
        SET title = EXCLUDED.title,
            body_md = EXCLUDED.body_md,
            conversation_id = EXCLUDED.conversation_id,
            created_at = now()`,
    [filename, spec.title, data.toString("base64"), input.conversationId],
  );

  await audit("agent", "generate_presentation", filename, {
    conversationId: input.conversationId,
    slides: spec.slides.length,
    bytes: data.length,
  });

  return {
    ok: true,
    slug: filename,
    title: spec.title,
    slide_count: spec.slides.length,
    download_url: `/api/presentations/${slug}/download`,
    bytes: data.length,
  };
}

function renderSlide(pres: pptxgen, s: Slide, spec: PresentationSpec) {
  const slide = pres.addSlide({ masterName: "LOOM_MASTER" });

  switch (s.type) {
    case "title": {
      // Big centered title with gradient-feel accent bar
      slide.addShape("rect", {
        x: 0.5, y: 2.4, w: 0.16, h: 1.6,
        fill: { color: BRAND.accent },
      });
      slide.addText(s.title, {
        x: 0.9, y: 2.4, w: 11.5, h: 1.0,
        fontFace: "Inter", fontSize: 44, bold: true, color: BRAND.ink, valign: "middle",
      });
      slide.addText(s.subtitle ?? new Date().toISOString().slice(0, 10), {
        x: 0.9, y: 3.5, w: 11.5, h: 0.5,
        fontFace: "Inter", fontSize: 16, color: BRAND.muted, valign: "middle",
      });
      if (spec.author) {
        slide.addText(`Prepared by ${spec.author}`, {
          x: 0.9, y: 5.8, w: 11.5, h: 0.4,
          fontFace: "Inter", fontSize: 11, color: BRAND.faint,
        });
      }
      break;
    }

    case "summary": {
      headline(slide, s.headline);
      if (s.body) {
        slide.addText(s.body, {
          x: 0.5, y: 1.5, w: 12.3, h: 1.2,
          fontFace: "Inter", fontSize: 14, color: BRAND.muted, valign: "top",
        });
      }
      const stats = s.stats ?? [];
      if (stats.length > 0) {
        const cardW = 12.3 / Math.min(stats.length, 4);
        const y = s.body ? 3.0 : 1.8;
        stats.slice(0, 4).forEach((stat, i) => {
          const x = 0.5 + i * cardW;
          slide.addShape("roundRect", {
            x: x + 0.08, y, w: cardW - 0.2, h: 1.8,
            fill: { color: BRAND.bgSoft },
            line: { color: BRAND.border, width: 0.75 },
            rectRadius: 0.12,
          });
          slide.addText(stat.label.toUpperCase(), {
            x: x + 0.32, y: y + 0.18, w: cardW - 0.5, h: 0.35,
            fontFace: "Inter", fontSize: 9, color: BRAND.faint, bold: true, charSpacing: 1,
          });
          slide.addText(stat.value, {
            x: x + 0.32, y: y + 0.55, w: cardW - 0.5, h: 0.8,
            fontFace: "Inter", fontSize: 28, bold: true, color: BRAND.ink,
          });
          if (stat.delta) {
            slide.addText(stat.delta, {
              x: x + 0.32, y: y + 1.35, w: cardW - 0.5, h: 0.3,
              fontFace: "Inter", fontSize: 11, color: BRAND.accent2,
            });
          }
        });
      }
      break;
    }

    case "chart": {
      headline(slide, s.headline);
      const chartType =
        s.chart_type === "pie" ? pres.ChartType.pie :
        s.chart_type === "line" ? pres.ChartType.line :
        s.chart_type === "area" ? pres.ChartType.area :
        pres.ChartType.bar;
      const labels = s.data.map((row) => String(row[s.x_field] ?? ""));
      const values = s.data.map((row) => Number(row[s.y_field] ?? 0));
      slide.addChart(
        chartType,
        [{ name: s.y_field, labels, values }],
        {
          x: 0.5, y: 1.3, w: 12.3, h: 4.8,
          showLegend: false,
          showTitle: false,
          chartColors: CHART_PALETTE,
          catAxisLabelFontFace: "Inter",
          catAxisLabelFontSize: 10,
          valAxisLabelFontFace: "Inter",
          valAxisLabelFontSize: 10,
          dataLabelFontFace: "Inter",
          dataLabelFontSize: 9,
          barGapWidthPct: 50,
        },
      );
      if (s.caption) {
        slide.addText(s.caption, {
          x: 0.5, y: 6.2, w: 12.3, h: 0.5,
          fontFace: "Inter", fontSize: 10, color: BRAND.faint, italic: true,
        });
      }
      break;
    }

    case "table": {
      headline(slide, s.headline);
      const headerRow = s.columns.map((c) => ({
        text: c,
        options: { bold: true, color: "FFFFFF", fill: { color: BRAND.accent }, fontSize: 11 },
      }));
      const bodyRows = s.rows.map((row, i) =>
        row.map((cell) => ({
          text: String(cell),
          options: {
            color: BRAND.ink,
            fill: { color: i % 2 === 0 ? "FFFFFF" : BRAND.bgSoft },
            fontSize: 11,
          },
        })),
      );
      slide.addTable([headerRow, ...bodyRows] as never, {
        x: 0.5, y: 1.3, w: 12.3,
        fontFace: "Inter",
        border: { type: "solid", pt: 0.5, color: BRAND.border },
        rowH: 0.4,
        autoPage: false,
      });
      if (s.caption) {
        slide.addText(s.caption, {
          x: 0.5, y: 6.2, w: 12.3, h: 0.5,
          fontFace: "Inter", fontSize: 10, color: BRAND.faint, italic: true,
        });
      }
      break;
    }

    case "bullets": {
      headline(slide, s.headline);
      slide.addText(
        s.bullets.map((b) => ({ text: b, options: { bullet: { code: "25CF" } } })),
        {
          x: 0.7, y: 1.4, w: 12.0, h: 5.0,
          fontFace: "Inter", fontSize: 16, color: BRAND.ink, paraSpaceAfter: 8,
        },
      );
      break;
    }

    case "closing": {
      slide.addShape("rect", {
        x: 0, y: 3.0, w: 13.33, h: 0.08,
        fill: { color: BRAND.accent2 },
      });
      slide.addText(s.headline, {
        x: 0.5, y: 3.3, w: 12.3, h: 0.8,
        fontFace: "Inter", fontSize: 36, bold: true, color: BRAND.ink,
      });
      if (s.body) {
        slide.addText(s.body, {
          x: 0.5, y: 4.2, w: 12.3, h: 1.5,
          fontFace: "Inter", fontSize: 14, color: BRAND.muted, valign: "top",
        });
      }
      break;
    }
  }
}

function headline(slide: pptxgen.Slide, text: string) {
  slide.addText(text, {
    x: 0.5, y: 0.5, w: 12.3, h: 0.7,
    fontFace: "Inter", fontSize: 24, bold: true, color: BRAND.ink,
  });
  slide.addShape("rect", {
    x: 0.5, y: 1.2, w: 0.6, h: 0.04,
    fill: { color: BRAND.accent },
  });
}

function sanitizeSlug(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return /^[a-z0-9][a-z0-9-]{1,80}$/.test(s) ? s : null;
}
