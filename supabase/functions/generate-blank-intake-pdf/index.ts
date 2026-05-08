// Reliability Batch H: render an agreement_templates row as a printable
// blank-form PDF.
//
// Use case: a walk-in customer doesn't want to (or can't) sign on a
// tablet. The operator clicks "Print blank form" from the agreement
// template list, prints the PDF, has the customer fill it out by
// hand, then scans/uploads the signed copy through the existing
// document-upload path.
//
// Implementation: pdf-lib (Deno-compatible) renders a single PDF with
// the org's name, the agreement's title, the body wrapped to fit
// letter-size pages, and a signature block at the bottom (name +
// signature line + date). HTML in the body is stripped to plain text
// — these templates aren't meant to be visually rich PDFs, they're
// the printable backup of an existing digital flow.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  "";

// Letter size in PDF points (72 dpi).
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54; // 0.75 inch margins
const BODY_WIDTH = PAGE_W - MARGIN * 2;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Authenticate the caller through their JWT — the operator session.
  // The PDF doesn't write anything, just reads the agreement template
  // and the org row, so RLS handles authorization.
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Accept the template id in either query param (GET, easy for an <a download>) or JSON body (POST).
  let templateId: string | null = null;
  try {
    const url = new URL(req.url);
    templateId = url.searchParams.get("agreement_id");
    if (!templateId && req.method === "POST") {
      const body = await req.json();
      templateId = typeof body?.agreement_id === "string" ? body.agreement_id : null;
    }
  } catch {
    /* leave templateId null and fall through to the validation error below */
  }
  if (!templateId) return json({ error: "Missing agreement_id" }, 400);

  // RLS scopes the read to the operator's org.
  const { data: tpl, error: tplErr } = await userClient
    .from("agreement_templates")
    .select("id, organization_id, name, type, body, version, status")
    .eq("id", templateId)
    .maybeSingle();
  if (tplErr) return json({ error: tplErr.message }, 500);
  if (!tpl) return json({ error: "Template not found" }, 404);

  // Pull the org name with service role — RLS would also work here but the
  // org row is small and we want the request to be a single round trip.
  const { data: org } = await admin
    .from("organizations")
    .select("name")
    .eq("id", tpl.organization_id)
    .maybeSingle();
  const orgName = org?.name ?? "";

  const pdfBytes = await renderPdf({
    orgName,
    title: tpl.name ?? "Intake Form",
    type: tpl.type ?? "",
    version: tpl.version ?? "",
    body: stripHtml(tpl.body ?? ""),
  });

  const filename = `${slugForFilename(tpl.name ?? "intake-form")}.pdf`;
  return new Response(pdfBytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});

async function renderPdf(args: {
  orgName: string;
  title: string;
  type: string;
  version: string | number;
  body: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  // Header band — org name on the left, version meta on the right.
  page.drawText(args.orgName || "Snout", {
    x: MARGIN,
    y,
    size: 14,
    font: bold,
    color: rgb(0.21, 0.17, 0.15),
  });
  if (args.version) {
    const versionLabel = `v${args.version}`;
    const w = font.widthOfTextAtSize(versionLabel, 10);
    page.drawText(versionLabel, {
      x: PAGE_W - MARGIN - w,
      y,
      size: 10,
      font,
      color: rgb(0.5, 0.45, 0.4),
    });
  }
  y -= 30;

  // Title.
  page.drawText(args.title, {
    x: MARGIN,
    y,
    size: 22,
    font: bold,
    color: rgb(0.21, 0.17, 0.15),
  });
  y -= 12;

  if (args.type) {
    page.drawText(args.type.toUpperCase(), {
      x: MARGIN,
      y,
      size: 9,
      font,
      color: rgb(0.62, 0.56, 0.51),
    });
    y -= 18;
  }

  y -= 8;

  // Body. Wrap to BODY_WIDTH and paginate when y crosses below MARGIN.
  const bodySize = 11;
  const lineHeight = 14;
  const lines = wrapText(args.body, font, bodySize, BODY_WIDTH);

  for (const line of lines) {
    if (y < MARGIN + 110) {
      // Reserve room for the signature block on the last page; if we run
      // past the bottom, start a new page.
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
    page.drawText(line, {
      x: MARGIN,
      y,
      size: bodySize,
      font,
      color: rgb(0.21, 0.17, 0.15),
    });
    y -= lineHeight;
  }

  // Signature block. Tries to land on the same page if there's room;
  // otherwise pushes to a fresh page.
  if (y < MARGIN + 110) {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
  }
  y -= 24;
  page.drawText("Signed:", { x: MARGIN, y, size: 10, font: bold, color: rgb(0.21, 0.17, 0.15) });
  y -= 30;

  drawSignatureLine(page, "Customer name (printed)", MARGIN, y, BODY_WIDTH * 0.55, font);
  drawSignatureLine(page, "Date", MARGIN + BODY_WIDTH * 0.6, y, BODY_WIDTH * 0.4, font);
  y -= 50;

  drawSignatureLine(page, "Customer signature", MARGIN, y, BODY_WIDTH, font);

  return await doc.save();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawSignatureLine(page: any, label: string, x: number, y: number, width: number, font: any) {
  page.drawLine({
    start: { x, y },
    end: { x: x + width, y },
    thickness: 0.75,
    color: rgb(0.4, 0.34, 0.3),
  });
  page.drawText(label, {
    x,
    y: y - 12,
    size: 9,
    font,
    color: rgb(0.62, 0.56, 0.51),
  });
}

// Greedy word-wrap. Keeps paragraph breaks (double newline) and single
// newlines as forced line breaks; everything else is reflowed to fit
// within `maxWidth` at the given font/size.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapText(input: string, font: any, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  const paragraphs = input.split(/\n{2,}/);
  for (let p = 0; p < paragraphs.length; p++) {
    const para = paragraphs[p];
    const explicitLines = para.split(/\n/);
    for (const ln of explicitLines) {
      const words = ln.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        out.push("");
        continue;
      }
      let current = "";
      for (const w of words) {
        const candidate = current ? current + " " + w : w;
        const width = font.widthOfTextAtSize(candidate, size);
        if (width <= maxWidth) {
          current = candidate;
        } else {
          if (current) out.push(current);
          current = w;
        }
      }
      if (current) out.push(current);
    }
    if (p < paragraphs.length - 1) out.push(""); // blank line between paragraphs
  }
  return out;
}

function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function slugForFilename(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "intake-form";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
