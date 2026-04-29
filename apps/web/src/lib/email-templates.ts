// Snout-branded HTML email templates (inline CSS for email client compatibility)

const APP_BASE = "https://fella-fetch-hub.lovable.app";

const BG = "#F0E6E0";
const CARD = "#FFFBF8";
const CARD_ALT = "#F5F1ED";
const BORDER = "#E0D4CC";
const TEXT = "#362C26";
const TEXT_SECONDARY = "#6E5E54";
const TEXT_TERTIARY = "#9E8E82";
const ACCENT = "#CBA48F";
const ACCENT_HOVER = "#B8927C";

const FONTS_LINK =
  '<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fraunces:wght@600;700&display=swap" rel="stylesheet">';

interface Footer {
  org_name: string;
}

function shell(opts: { title: string; preview?: string; body: string; footer: Footer }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.title)}</title>
${FONTS_LINK}
</head>
<body style="margin:0;padding:0;background:${BG};font-family:'DM Sans',Arial,sans-serif;color:${TEXT};">
${opts.preview ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preview)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${CARD};border:1px solid ${BORDER};border-radius:14px;overflow:hidden;">
      <tr><td style="padding:28px 32px 8px;text-align:center;">
        <div style="font-family:'Fraunces',Georgia,serif;font-weight:700;font-size:28px;color:${TEXT};letter-spacing:-0.5px;">Snout<span style="color:${ACCENT};">.</span>app</div>
      </td></tr>
      <tr><td style="padding:8px 32px 32px;">
        ${opts.body}
      </td></tr>
      <tr><td style="padding:20px 32px 28px;border-top:1px solid ${BORDER};background:${CARD_ALT};text-align:center;">
        <div style="font-size:12px;color:${TEXT_TERTIARY};line-height:1.6;">
          Sent by <strong style="color:${TEXT_SECONDARY};">${escapeHtml(opts.footer.org_name)}</strong> via Snout.app<br>
          <a href="${APP_BASE}/portal-owner/account" style="color:${ACCENT};text-decoration:none;">Manage email preferences</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function h1(text: string) {
  return `<h1 style="margin:0 0 12px;font-family:'Fraunces',Georgia,serif;font-weight:700;font-size:24px;line-height:1.2;color:${TEXT};">${escapeHtml(text)}</h1>`;
}
function p(text: string) {
  return `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:${TEXT_SECONDARY};">${escapeHtml(text)}</p>`;
}
function button(label: string, href: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">
    <tr><td style="background:${ACCENT};border-radius:10px;">
      <a href="${href}" style="display:inline-block;padding:12px 22px;font-family:'DM Sans',Arial,sans-serif;font-weight:600;font-size:14px;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;
}
function detailsCard(rows: { label: string; value: string }[]) {
  const tr = rows
    .map(
      (r) => `<tr>
    <td style="padding:8px 0;font-size:12px;color:${TEXT_TERTIARY};text-transform:uppercase;letter-spacing:0.6px;font-weight:600;width:38%;vertical-align:top;">${escapeHtml(r.label)}</td>
    <td style="padding:8px 0;font-size:14px;color:${TEXT};vertical-align:top;">${escapeHtml(r.value)}</td>
  </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD_ALT};border-radius:12px;padding:18px 20px;margin:0 0 20px;">
    <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${tr}</table></td></tr>
  </table>`;
}
function escapeHtml(s: string) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// 1. Reservation confirmation
export function reservationConfirmationEmail(data: {
  pet_names: string[];
  service_name: string;
  start_at: string; // formatted
  location_name: string;
  reservation_id: string;
  org_name: string;
  owner_first_name?: string;
}) {
  const petLabel = data.pet_names.join(" & ");
  const subject = `${petLabel} is Booked! Your Reservation Confirmation`;
  const html = shell({
    title: subject,
    preview: `Your booking for ${petLabel} is confirmed`,
    footer: { org_name: data.org_name },
    body: `
      ${h1(`${data.owner_first_name ? `${data.owner_first_name}, ` : ""}you're all set!`)}
      ${p(`We can't wait to welcome ${petLabel} to ${data.org_name}. Here are your booking details:`)}
      ${detailsCard([
        { label: "Pet" + (data.pet_names.length > 1 ? "s" : ""), value: petLabel },
        { label: "Service", value: data.service_name },
        { label: "Date & Time", value: data.start_at },
        { label: "Location", value: data.location_name },
      ])}
      ${button("View Your Booking", `${APP_BASE}/portal-owner/bookings`)}
      ${p("If you need to make a change, just reply to this email or contact us directly.")}
    `,
  });
  return { subject, html };
}

// 2. Invoice created
export function invoiceCreatedEmail(data: {
  invoice_number: string;
  amount_display: string; // e.g. "$120.00 CAD"
  due_date: string;
  invoice_id: string;
  org_name: string;
  pay_now_url?: string;
}) {
  const subject = `Invoice ${data.invoice_number} from ${data.org_name}`;
  const payCta = data.pay_now_url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px 12px;display:inline-table;">
        <tr><td style="background:${ACCENT_HOVER};border-radius:10px;">
          <a href="${data.pay_now_url}" style="display:inline-block;padding:12px 22px;font-weight:600;font-size:14px;color:#ffffff;text-decoration:none;">Pay Now</a>
        </td></tr>
      </table>`
    : "";
  const html = shell({
    title: subject,
    preview: `New invoice ${data.invoice_number} — ${data.amount_display}`,
    footer: { org_name: data.org_name },
    body: `
      ${h1("You've got a new invoice")}
      ${p(`${data.org_name} has issued an invoice for your recent visit.`)}
      <div style="text-align:center;margin:24px 0;">
        <div style="font-family:'Fraunces',Georgia,serif;font-weight:700;font-size:40px;color:${ACCENT};line-height:1;">${escapeHtml(data.amount_display)}</div>
        <div style="margin-top:6px;font-size:12px;color:${TEXT_TERTIARY};text-transform:uppercase;letter-spacing:0.6px;font-weight:600;">Amount due</div>
      </div>
      ${detailsCard([
        { label: "Invoice", value: data.invoice_number },
        { label: "Due Date", value: data.due_date },
      ])}
      <div>${button("View Invoice", `${APP_BASE}/portal-owner/invoices/${data.invoice_id}`)}${payCta}</div>
    `,
  });
  return { subject, html };
}

// 3. Report card published
export function reportCardEmail(data: {
  pet_name: string;
  rating?: string | null;
  rating_emoji?: string | null;
  mood_summary?: string | null;
  visit_notes?: string | null;
  photo_url?: string | null;
  reservation_id: string;
  org_name: string;
}) {
  const subject = `${data.pet_name}'s Day with Us — Report Card Ready! 🐾`;
  const photo = data.photo_url
    ? `<img src="${data.photo_url}" alt="${escapeHtml(data.pet_name)}" style="display:block;width:100%;max-width:536px;border-radius:12px;margin:0 0 20px;" />`
    : "";
  const ratingBlock = data.rating
    ? `<div style="text-align:center;margin:0 0 20px;">
        <div style="display:inline-block;background:linear-gradient(135deg,#F2D3C9 0%,#EED4BB 100%);border-radius:14px;padding:16px 28px;">
          <div style="font-size:32px;line-height:1;">${escapeHtml(data.rating_emoji ?? "⭐")}</div>
          <div style="margin-top:6px;font-family:'Fraunces',Georgia,serif;font-weight:700;font-size:18px;color:${TEXT};text-transform:capitalize;">${escapeHtml(data.rating)}</div>
        </div>
      </div>`
    : "";
  const summary = data.mood_summary
    ? `<div style="background:linear-gradient(135deg,#F2D3C9 0%,#EED4BB 100%);border-radius:12px;padding:18px 20px;margin:0 0 20px;font-size:14px;line-height:1.6;color:${TEXT};">${escapeHtml(data.mood_summary)}</div>`
    : "";
  const notes = data.visit_notes ? p(data.visit_notes) : "";
  const html = shell({
    title: subject,
    preview: `${data.pet_name}'s report card is ready`,
    footer: { org_name: data.org_name },
    body: `
      ${h1(`${data.pet_name} had a great visit! 🐾`)}
      ${p(`Here's a recap of ${data.pet_name}'s day at ${data.org_name}.`)}
      ${photo}
      ${ratingBlock}
      ${summary}
      ${notes}
      ${button("View Full Report Card", `${APP_BASE}/portal-owner/report-cards`)}
    `,
  });
  return { subject, html };
}

// 4. Waiver reminder
export function waiverReminderEmail(data: {
  waiver_titles: string[];
  org_name: string;
  owner_first_name?: string;
}) {
  const n = data.waiver_titles.length;
  const subject = `Action Required: ${n} Waiver${n === 1 ? "" : "s"} Need Your Signature`;
  const list = data.waiver_titles
    .map(
      (t) =>
        `<div style="background:${CARD_ALT};border-radius:10px;padding:14px 18px;margin:0 0 10px;font-size:14px;color:${TEXT};font-weight:500;">📄 ${escapeHtml(t)}</div>`,
    )
    .join("");
  const html = shell({
    title: subject,
    preview: `${n} waiver${n === 1 ? "" : "s"} awaiting your signature`,
    footer: { org_name: data.org_name },
    body: `
      ${h1(`${data.owner_first_name ? `Hi ${data.owner_first_name}, ` : ""}a quick signature is needed`)}
      ${p(`${data.org_name} needs your signature on the following waiver${n === 1 ? "" : "s"} before your next visit:`)}
      ${list}
      <div style="margin-top:18px;">${button("Sign Waivers Now", `${APP_BASE}/portal-owner/waivers`)}</div>
    `,
  });
  return { subject, html };
}
