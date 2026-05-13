//
//  InvoicesView.swift
//  Snout
//
//  Pet-parent invoices: list (split into Outstanding / History) and detail
//  (header, optional reservation context, line items, summary, optional
//  notes, Pay button).
//
//  Pay flow: tap "Pay $X.XX" on the detail screen → invoke the
//  `create-stripe-checkout-session` edge function with `{ invoice_id }` →
//  open the returned `checkout_url` in an in-app SFSafariViewController →
//  the stripe-billing-webhook updates the invoice when Stripe confirms the
//  charge → on dismissal we refresh the detail so the new status is visible.
//

import SwiftUI
import UIKit
import Supabase

// MARK: - Invoice models

struct Invoice: Decodable, Identifiable, Hashable {
    let id: String
    let invoiceNumber: String?
    let status: String
    let issuedAt: Date?
    let dueAt: Date?
    let paidAt: Date?
    let totalCents: Int
    let amountPaidCents: Int
    let subtotalCents: Int
    let taxCents: Int
    let currency: String
    let notes: String?
    let reservationId: String?
    let createdAt: Date

    var amountOwedCents: Int { max(0, totalCents - amountPaidCents) }
    var isUnpaid: Bool { ["sent", "partial", "overdue"].contains(status) }

    enum CodingKeys: String, CodingKey {
        case id
        case invoiceNumber   = "invoice_number"
        case status
        case issuedAt        = "issued_at"
        case dueAt           = "due_at"
        case paidAt          = "paid_at"
        case totalCents      = "total_cents"
        case amountPaidCents = "amount_paid_cents"
        case subtotalCents   = "subtotal_cents"
        case taxCents        = "tax_cents"
        case currency, notes
        case reservationId   = "reservation_id"
        case createdAt       = "created_at"
    }
}

struct InvoiceLine: Decodable, Identifiable, Hashable {
    let id: String
    let description: String
    /// Postgres numeric — comes back as String over the wire to preserve
    /// precision. We parse to Double on render (line items rarely need
    /// fractional precision in display).
    let quantity: String
    let unitPriceCents: Int
    let lineTotalCents: Int

    var quantityValue: Double { Double(quantity) ?? 1 }

    enum CodingKeys: String, CodingKey {
        case id, description, quantity
        case unitPriceCents = "unit_price_cents"
        case lineTotalCents = "line_total_cents"
    }
}

struct InvoiceTax: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let rateBasisPoints: Int
    let amountCents: Int

    var ratePercent: Double { Double(rateBasisPoints) / 100.0 }

    enum CodingKeys: String, CodingKey {
        case id, name
        case rateBasisPoints = "rate_basis_points"
        case amountCents     = "amount_cents"
    }
}

// MARK: - Invoices list

@MainActor
final class InvoicesListViewModel: ObservableObject {
    @Published var outstanding: [Invoice] = []
    @Published var history: [Invoice] = []
    @Published var isLoading: Bool = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared

    func load(ownerId: String) async {
        isLoading = true
        defer { isLoading = false }
        loadError = nil
        do {
            // Mirrors the web hook: skip drafts and voids. Order newest first.
            let rows: [Invoice] = try await client
                .from("invoices")
                .select("id, invoice_number, status, issued_at, due_at, paid_at, total_cents, amount_paid_cents, subtotal_cents, tax_cents, currency, notes, reservation_id, created_at")
                .eq("owner_id", value: ownerId)
                .is("deleted_at", value: nil)
                .neq("status", value: "draft")
                .neq("status", value: "void")
                .order("issued_at", ascending: false)
                .execute()
                .value
            self.outstanding = rows.filter { $0.isUnpaid }
                .sorted { lhs, rhs in
                    let order: [String: Int] = ["overdue": 0, "partial": 1, "sent": 2]
                    let lhsRank = order[lhs.status] ?? 99
                    let rhsRank = order[rhs.status] ?? 99
                    if lhsRank != rhsRank { return lhsRank < rhsRank }
                    return (lhs.dueAt ?? .distantFuture) < (rhs.dueAt ?? .distantFuture)
                }
            self.history = rows.filter { !$0.isUnpaid }
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct InvoicesListView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = InvoicesListViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xl) {
                    if vm.isLoading && vm.outstanding.isEmpty && vm.history.isEmpty {
                        ProgressView()
                            .tint(SnoutTheme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.top, SnoutTheme.Spacing.xxl)
                    } else if vm.outstanding.isEmpty && vm.history.isEmpty {
                        emptyState
                    } else {
                        if !vm.outstanding.isEmpty {
                            invoiceSection(title: "Outstanding", invoices: vm.outstanding, accent: true)
                        }
                        if !vm.history.isEmpty {
                            invoiceSection(title: "History", invoices: vm.history, accent: false)
                        }
                    }
                    if let err = vm.loadError {
                        errorBanner(err)
                    }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
            .refreshable { await reload() }
        }
        .navigationTitle("Invoices")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
    }

    private func reload() async {
        guard let id = currentOwner.ownerId else { return }
        await vm.load(ownerId: id)
    }

    @ViewBuilder
    private func invoiceSection(title: String, invoices: [Invoice], accent: Bool) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                Text(title.uppercased())
                    .font(SnoutTheme.labelSM)
                    .tracking(0.8)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                if accent {
                    Circle().fill(SnoutTheme.accent).frame(width: 6, height: 6)
                }
                Spacer()
            }
            .padding(.horizontal, SnoutTheme.Spacing.xs)

            VStack(spacing: SnoutTheme.Spacing.sm) {
                ForEach(invoices) { inv in
                    NavigationLink {
                        InvoiceDetailView(invoiceId: inv.id)
                    } label: {
                        invoiceRow(inv)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func invoiceRow(_ inv: Invoice) -> some View {
        HStack(spacing: SnoutTheme.Spacing.lg) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: SnoutTheme.Spacing.sm) {
                    Text(inv.invoiceNumber ?? "Invoice")
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                    InvoiceStatusChip(status: inv.status)
                }
                Text(rowSubtitle(for: inv))
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(Money.formatCents(inv.totalCents, currency: inv.currency))
                    .font(SnoutTheme.body(15, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                if inv.isUnpaid && inv.amountPaidCents > 0 {
                    Text("\(Money.formatCents(inv.amountOwedCents, currency: inv.currency)) owed")
                        .font(SnoutTheme.labelSM)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
            }
            SnoutGlyph("chevron.right", size: 13, weight: .semibold)
                .foregroundStyle(SnoutTheme.onSurfaceFaint)
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private func rowSubtitle(for inv: Invoice) -> String {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "America/Regina") ?? .current
        f.dateFormat = "MMM d, yyyy"
        if let paid = inv.paidAt { return "Paid \(f.string(from: paid))" }
        if let due = inv.dueAt   { return "Due \(f.string(from: due))" }
        if let issued = inv.issuedAt { return "Issued \(f.string(from: issued))" }
        return ""
    }

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            ZStack {
                Circle().fill(SnoutTheme.frost.opacity(0.6)).frame(width: 72, height: 72)
                SnoutGlyph("doc.text", size: 28, weight: .regular)
                    .foregroundStyle(SnoutTheme.onSurface)
            }
            Text("No invoices yet")
                .font(SnoutTheme.titleMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Text("Your billing history will appear here once your facility issues an invoice.")
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, SnoutTheme.Spacing.xxl)
    }

    private func errorBanner(_ message: String) -> some View {
        Text(message)
            .font(SnoutTheme.bodySM)
            .foregroundStyle(SnoutTheme.onSurface)
            .padding(SnoutTheme.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SnoutTheme.cotton.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
    }
}

// MARK: - Invoice status chip

private struct InvoiceStatusChip: View {
    let status: String

    var body: some View {
        Text(label.uppercased())
            .font(SnoutTheme.labelSM)
            .tracking(0.6)
            .foregroundStyle(foreground)
            .padding(.horizontal, SnoutTheme.Spacing.sm)
            .padding(.vertical, 3)
            .background(background)
            .clipShape(Capsule())
    }

    private var label: String {
        switch status {
        case "sent":     return "Sent"
        case "partial":  return "Partial"
        case "overdue":  return "Overdue"
        case "paid":     return "Paid"
        case "draft":    return "Draft"
        case "void":     return "Void"
        default:         return status.capitalized
        }
    }

    /// Boho status mapping. Overdue uses cotton (warm pink) at higher
    /// opacity to read as "needs attention" without leaning on a system red.
    private var background: Color {
        switch status {
        case "overdue":  return SnoutTheme.cotton.opacity(0.85)
        case "partial":  return SnoutTheme.vanilla.opacity(0.85)
        case "sent":     return SnoutTheme.frost.opacity(0.65)
        case "paid":     return SnoutTheme.mist.opacity(0.65)
        default:         return SnoutTheme.divider
        }
    }

    private var foreground: Color { SnoutTheme.onSurface }
}

// MARK: - Invoice detail

@MainActor
final class InvoiceDetailViewModel: ObservableObject {
    @Published var invoice: Invoice?
    @Published var lines: [InvoiceLine] = []
    @Published var taxes: [InvoiceTax] = []
    @Published var reservationLabel: String?
    @Published var isLoading: Bool = false
    @Published var loadError: String?

    @Published var isStartingCheckout: Bool = false
    @Published var checkoutError: String?

    private let client = SupabaseClientProvider.shared

    func load(invoiceId: String) async {
        isLoading = true
        defer { isLoading = false }
        loadError = nil
        do {
            struct DetailRow: Decodable {
                let id: String
                let invoice_number: String?
                let status: String
                let issued_at: Date?
                let due_at: Date?
                let paid_at: Date?
                let total_cents: Int
                let amount_paid_cents: Int
                let subtotal_cents: Int
                let tax_cents: Int
                let currency: String
                let notes: String?
                let reservation_id: String?
                let created_at: Date
                let invoice_lines: [InvoiceLine]
                let invoice_taxes: [InvoiceTax]
            }
            let rows: [DetailRow] = try await client
                .from("invoices")
                .select("""
                    id, invoice_number, status, issued_at, due_at, paid_at,
                    total_cents, amount_paid_cents, subtotal_cents, tax_cents,
                    currency, notes, reservation_id, created_at,
                    invoice_lines(id, description, quantity, unit_price_cents, line_total_cents),
                    invoice_taxes(id, name, rate_basis_points, amount_cents)
                """)
                .eq("id", value: invoiceId)
                .limit(1)
                .execute()
                .value
            guard let row = rows.first else {
                loadError = "Invoice not found."
                return
            }
            self.invoice = Invoice(
                id: row.id,
                invoiceNumber: row.invoice_number,
                status: row.status,
                issuedAt: row.issued_at,
                dueAt: row.due_at,
                paidAt: row.paid_at,
                totalCents: row.total_cents,
                amountPaidCents: row.amount_paid_cents,
                subtotalCents: row.subtotal_cents,
                taxCents: row.tax_cents,
                currency: row.currency,
                notes: row.notes,
                reservationId: row.reservation_id,
                createdAt: row.created_at
            )
            self.lines = row.invoice_lines
            self.taxes = row.invoice_taxes

            if let rid = row.reservation_id {
                await loadReservationContext(reservationId: rid)
            }
        } catch {
            loadError = error.localizedDescription
        }
    }

    private func loadReservationContext(reservationId: String) async {
        struct ResRow: Decodable {
            let start_at: Date
            let service: ServiceName?
            struct ServiceName: Decodable { let name: String }
            enum CodingKeys: String, CodingKey {
                case start_at
                case service = "services"
            }
        }
        do {
            let rows: [ResRow] = try await client
                .from("reservations")
                .select("start_at, services(name)")
                .eq("id", value: reservationId)
                .limit(1)
                .execute()
                .value
            guard let row = rows.first else { return }
            let f = DateFormatter()
            f.timeZone = TimeZone(identifier: "America/Regina") ?? .current
            f.dateFormat = "MMM d, yyyy"
            let dateStr = f.string(from: row.start_at)
            if let svcName = row.service?.name {
                reservationLabel = "\(svcName) · \(dateStr)"
            } else {
                reservationLabel = dateStr
            }
        } catch {
            // Non-fatal; just don't show the context line.
        }
    }

    /// Invoke the `create-stripe-checkout-session` edge function for this
    /// invoice and return the Stripe Checkout URL the caller should open in
    /// SFSafariViewController. The stripe-billing-webhook handles the
    /// invoice update server-side once the user completes payment; we just
    /// need to refresh the detail view after the Safari sheet dismisses.
    func startCheckout(invoiceId: String) async -> URL? {
        isStartingCheckout = true
        defer { isStartingCheckout = false }
        checkoutError = nil

        struct Payload: Encodable {
            let invoice_id: String
            // See note in BuyCreditsView: without base_url the edge function
            // falls back to the Supabase functions URL, which doesn't host
            // pages — Stripe's redirect 404s with "requested path is invalid".
            let base_url: String
        }
        struct Response: Decodable {
            let checkout_url: String?
            let checkout_session_id: String?
            let error: String?
        }

        do {
            let response: Response = try await client.functions
                .invoke("create-stripe-checkout-session",
                        options: FunctionInvokeOptions(
                            body: Payload(invoice_id: invoiceId, base_url: AppConfig.webAppURL)
                        ))
            if let err = response.error {
                checkoutError = err
                return nil
            }
            guard let urlString = response.checkout_url, let url = URL(string: urlString) else {
                checkoutError = "Couldn't start checkout — no URL returned."
                return nil
            }
            return url
        } catch {
            checkoutError = error.localizedDescription
            return nil
        }
    }
}

struct InvoiceDetailView: View {
    let invoiceId: String

    @StateObject private var vm = InvoiceDetailViewModel()
    @State private var checkoutSheet: SafariURL?

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                    if let inv = vm.invoice {
                        headerCard(inv)
                        if let label = vm.reservationLabel {
                            contextRow(label: label)
                        }
                        if !vm.lines.isEmpty {
                            linesCard
                        }
                        summaryCard(inv)
                        if let notes = inv.notes, !notes.isEmpty {
                            notesCard(notes)
                        }
                        if inv.isUnpaid {
                            payButton(for: inv)
                        }
                        if let err = vm.checkoutError {
                            errorBanner(err)
                        }
                    } else if let err = vm.loadError {
                        errorBanner(err)
                    } else {
                        ProgressView()
                            .tint(SnoutTheme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.top, SnoutTheme.Spacing.xxl)
                    }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Invoice")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load(invoiceId: invoiceId) }
        .sheet(item: $checkoutSheet, onDismiss: {
            // After Safari closes the user has either paid or cancelled.
            // Either way, refresh from the wire — the webhook may have
            // already updated the invoice status.
            Task { await vm.load(invoiceId: invoiceId) }
        }) { item in
            SafariSheet(url: item.url, preferredControlTintColor: UIColor(SnoutTheme.accent))
                .ignoresSafeArea()
        }
    }

    // MARK: - Header

    private func headerCard(_ inv: Invoice) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                Text(inv.invoiceNumber ?? "Invoice")
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                Spacer()
                InvoiceStatusChip(status: inv.status)
            }
            HStack(alignment: .firstTextBaseline) {
                Text(Money.formatCents(inv.totalCents, currency: inv.currency))
                    .font(SnoutTheme.display(34, weight: .regular))
                    .foregroundStyle(SnoutTheme.onSurface)
                Spacer()
                if inv.isUnpaid && inv.amountPaidCents > 0 {
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("OWED")
                            .font(SnoutTheme.labelSM)
                            .tracking(0.6)
                            .foregroundStyle(SnoutTheme.onSurfaceMuted)
                        Text(Money.formatCents(inv.amountOwedCents, currency: inv.currency))
                            .font(SnoutTheme.body(17, weight: .semibold))
                            .foregroundStyle(SnoutTheme.onSurface)
                    }
                }
            }
            if let dateLine = headerDateLine(inv) {
                Text(dateLine)
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
        }
        .padding(SnoutTheme.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(headerBackground(for: inv))
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusTile, style: .continuous))
    }

    private func headerBackground(for inv: Invoice) -> Color {
        switch inv.status {
        case "overdue":  return SnoutTheme.cotton.opacity(0.55)
        case "partial":  return SnoutTheme.vanilla.opacity(0.55)
        case "sent":     return SnoutTheme.frost.opacity(0.45)
        case "paid":     return SnoutTheme.mist.opacity(0.45)
        default:         return SnoutTheme.surface
        }
    }

    private func headerDateLine(_ inv: Invoice) -> String? {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "America/Regina") ?? .current
        f.dateFormat = "MMM d, yyyy"
        if inv.status == "paid", let paid = inv.paidAt {
            return "Paid on \(f.string(from: paid))"
        }
        if let due = inv.dueAt {
            return "Due \(f.string(from: due))"
        }
        if let issued = inv.issuedAt {
            return "Issued \(f.string(from: issued))"
        }
        return nil
    }

    // MARK: - Reservation context

    private func contextRow(label: String) -> some View {
        HStack(spacing: SnoutTheme.Spacing.md) {
            SnoutGlyph("calendar", size: 14, weight: .semibold)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Text(label)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Spacer()
        }
        .padding(SnoutTheme.Spacing.md)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
    }

    // MARK: - Lines

    private var linesCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionTitle("Items")
            VStack(spacing: 0) {
                ForEach(vm.lines.indices, id: \.self) { i in
                    let line = vm.lines[i]
                    HStack(alignment: .top, spacing: SnoutTheme.Spacing.md) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(line.description)
                                .font(SnoutTheme.bodyMD)
                                .foregroundStyle(SnoutTheme.onSurface)
                                .fixedSize(horizontal: false, vertical: true)
                            if line.quantityValue != 1 || line.unitPriceCents != line.lineTotalCents {
                                let qty = line.quantityValue
                                let qtyStr = qty == qty.rounded() ? String(Int(qty)) : String(qty)
                                Text("\(qtyStr) × \(Money.formatCents(line.unitPriceCents, currency: vm.invoice?.currency ?? "CAD"))")
                                    .font(SnoutTheme.bodySM)
                                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                            }
                        }
                        Spacer()
                        Text(Money.formatCents(line.lineTotalCents, currency: vm.invoice?.currency ?? "CAD"))
                            .font(SnoutTheme.body(15, weight: .semibold))
                            .foregroundStyle(SnoutTheme.onSurface)
                    }
                    .padding(.vertical, SnoutTheme.Spacing.sm)
                    if i < vm.lines.count - 1 {
                        Divider().background(SnoutTheme.divider)
                    }
                }
            }
            .padding(SnoutTheme.Spacing.md)
            .background(SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        }
    }

    // MARK: - Summary

    private func summaryCard(_ inv: Invoice) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionTitle("Summary")
            VStack(spacing: SnoutTheme.Spacing.sm) {
                summaryRow(label: "Subtotal",
                           value: Money.formatCents(inv.subtotalCents, currency: inv.currency))
                ForEach(vm.taxes) { tax in
                    summaryRow(
                        label: "\(tax.name) (\(formatRate(tax.ratePercent)))",
                        value: Money.formatCents(tax.amountCents, currency: inv.currency)
                    )
                }
                if vm.taxes.isEmpty && inv.taxCents > 0 {
                    summaryRow(label: "Tax",
                               value: Money.formatCents(inv.taxCents, currency: inv.currency))
                }
                Divider().background(SnoutTheme.divider)
                summaryRow(label: "Total",
                           value: Money.formatCents(inv.totalCents, currency: inv.currency),
                           emphasized: true)
                if inv.amountPaidCents > 0 {
                    summaryRow(label: "Paid",
                               value: "−\(Money.formatCents(inv.amountPaidCents, currency: inv.currency))")
                    if inv.isUnpaid {
                        summaryRow(label: "Owed",
                                   value: Money.formatCents(inv.amountOwedCents, currency: inv.currency),
                                   emphasized: true)
                    }
                }
            }
            .padding(SnoutTheme.Spacing.lg)
            .background(SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        }
    }

    private func summaryRow(label: String, value: String, emphasized: Bool = false) -> some View {
        HStack {
            Text(label)
                .font(emphasized ? SnoutTheme.body(15, weight: .semibold) : SnoutTheme.bodyMD)
                .foregroundStyle(emphasized ? SnoutTheme.onSurface : SnoutTheme.onSurfaceMuted)
            Spacer()
            Text(value)
                .font(emphasized ? SnoutTheme.body(15, weight: .semibold) : SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
        }
    }

    private func formatRate(_ pct: Double) -> String {
        let trimmed = pct.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(pct)) : String(format: "%.2f", pct)
        return "\(trimmed)%"
    }

    // MARK: - Notes

    private func notesCard(_ notes: String) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text("NOTES")
                .font(SnoutTheme.labelSM)
                .tracking(0.6)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Text(notes)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    // MARK: - Pay button

    private func payButton(for inv: Invoice) -> some View {
        Button {
            Task {
                if let url = await vm.startCheckout(invoiceId: inv.id) {
                    checkoutSheet = SafariURL(url: url)
                }
            }
        } label: {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                if vm.isStartingCheckout {
                    ProgressView().tint(SnoutTheme.onAccent)
                } else {
                    SnoutGlyph("creditcard", size: 16, weight: .semibold)
                }
                Text(vm.isStartingCheckout
                     ? "Opening Stripe…"
                     : "Pay \(Money.formatCents(inv.amountOwedCents, currency: inv.currency))")
                    .font(SnoutTheme.body(15, weight: .semibold))
            }
            .foregroundStyle(SnoutTheme.onAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, SnoutTheme.Spacing.md)
            .background(SnoutTheme.accent)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(vm.isStartingCheckout)
    }

    // MARK: - Section title

    private func sectionTitle(_ s: String) -> some View {
        Text(s.uppercased())
            .font(SnoutTheme.labelSM)
            .tracking(0.8)
            .foregroundStyle(SnoutTheme.onSurfaceMuted)
            .padding(.horizontal, SnoutTheme.Spacing.xs)
            .padding(.bottom, SnoutTheme.Spacing.xs)
    }

    private func errorBanner(_ message: String) -> some View {
        Text(message)
            .font(SnoutTheme.bodySM)
            .foregroundStyle(SnoutTheme.onSurface)
            .padding(SnoutTheme.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SnoutTheme.cotton.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
    }
}
