//
//  BuyCreditsView.swift
//  Snout
//
//  Two-screen purchase flow for credit packages:
//
//    1. Package list — every active `subscription_packages` row in the
//       owner's org, ordered cheapest-first. Each row shows price,
//       included-credits chips, and (for recurring packages) the billing
//       cycle.
//    2. Review + Pay — push detail. Same chips with a clearer summary,
//       fine-print on validity, and a "Pay" button that invokes
//       `create-package-checkout-session` and opens the Stripe Checkout
//       URL in an in-app SFSafariViewController. On dismiss we re-fetch
//       the owner row so the home credits card reflects the new balance
//       (the Connect webhook applies credits + creates an
//       owner_subscriptions row server-side).
//

import SwiftUI
import Supabase

// MARK: - Model

/// Mirror of `subscription_packages` for the customer-facing view. We only
/// pull what we need to render and submit a purchase.
struct CreditPackage: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let description: String?
    let priceCents: Int
    let billingCycle: String
    /// JSON like `{"daycare_full_day": 10, "boarding_night": 5}`. Convention
    /// matches the Connect-webhook fulfillment keys.
    let includedCredits: [String: Int]
    let validityDays: Int?

    enum CodingKeys: String, CodingKey {
        case id, name, description
        case priceCents       = "price_cents"
        case billingCycle     = "billing_cycle"
        case includedCredits  = "included_credits"
        case validityDays     = "validity_days"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id            = try c.decode(String.self, forKey: .id)
        name          = try c.decode(String.self, forKey: .name)
        description   = try c.decodeIfPresent(String.self, forKey: .description)
        priceCents    = try c.decode(Int.self, forKey: .priceCents)
        billingCycle  = try c.decode(String.self, forKey: .billingCycle)
        validityDays  = try c.decodeIfPresent(Int.self, forKey: .validityDays)
        // included_credits arrives as numeric values; tolerate doubles too.
        if let map = try? c.decode([String: Double].self, forKey: .includedCredits) {
            includedCredits = map.mapValues { Int($0) }
        } else {
            includedCredits = [:]
        }
    }

    /// Render-friendly chip lines. Maps the well-known keys to human labels.
    /// Unknown keys are surfaced verbatim ("baths · 5") so the parent at
    /// least sees what they're getting; the webhook stores the raw map on
    /// owner_subscriptions.remaining_credits regardless.
    var creditChips: [String] {
        includedCredits.compactMap { key, value -> String? in
            guard value > 0 else { return nil }
            switch key {
            case "daycare_full_day":
                return value == 1 ? "1 full day" : "\(value) full days"
            case "daycare_half_day":
                return value == 1 ? "1 half day" : "\(value) half days"
            case "boarding_night":
                return value == 1 ? "1 night" : "\(value) nights"
            case "store_credit_cents":
                return Money.formatCents(value, currency: "CAD") + " store credit"
            default:
                let label = key.replacingOccurrences(of: "_", with: " ").capitalized
                return "\(value) × \(label)"
            }
        }
        .sorted()
    }

    var billingLabel: String {
        switch billingCycle {
        case "monthly":   return "Billed monthly"
        case "quarterly": return "Billed every 3 months"
        case "annual":    return "Billed annually"
        default:          return "One-time"
        }
    }
}

// MARK: - List view model

@MainActor
final class BuyCreditsViewModel: ObservableObject {
    @Published var packages: [CreditPackage] = []
    @Published var isLoading: Bool = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared

    func load(organizationId: String) async {
        isLoading = true
        defer { isLoading = false }
        loadError = nil
        do {
            let rows: [CreditPackage] = try await client
                .from("subscription_packages")
                .select("id, name, description, price_cents, billing_cycle, included_credits, validity_days")
                .eq("organization_id", value: organizationId)
                .eq("active", value: true)
                .is("deleted_at", value: nil)
                .order("price_cents", ascending: true)
                .execute()
                .value
            self.packages = rows
        } catch {
            loadError = error.localizedDescription
        }
    }
}

// MARK: - List view

struct BuyCreditsView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = BuyCreditsViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                    if vm.isLoading && vm.packages.isEmpty {
                        ProgressView()
                            .tint(SnoutTheme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.top, SnoutTheme.Spacing.xxl)
                    } else if vm.packages.isEmpty {
                        emptyState
                    } else {
                        intro
                        ForEach(vm.packages) { pkg in
                            NavigationLink {
                                BuyCreditsPackageDetailView(package: pkg)
                            } label: {
                                packageRow(pkg)
                            }
                            .buttonStyle(.plain)
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
        .navigationTitle("Buy credits")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
    }

    private func reload() async {
        guard let org = currentOwner.organizationId else { return }
        await vm.load(organizationId: org)
    }

    private var intro: some View {
        Text("Stock up on visits at a discount. Credits apply automatically the next time you book.")
            .font(SnoutTheme.bodyMD)
            .foregroundStyle(SnoutTheme.onSurfaceMuted)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, SnoutTheme.Spacing.xs)
    }

    private func packageRow(_ pkg: CreditPackage) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(pkg.name)
                        .font(SnoutTheme.body(16, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                    Text(pkg.billingLabel)
                        .font(SnoutTheme.labelSM)
                        .tracking(0.4)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                Spacer()
                Text(Money.formatCents(pkg.priceCents, currency: "CAD"))
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
            }

            if !pkg.creditChips.isEmpty {
                FlowingChips(items: pkg.creditChips)
            }

            HStack {
                Spacer()
                SnoutGlyph("chevron.right", size: 13, weight: .semibold)
                    .foregroundStyle(SnoutTheme.onSurfaceFaint)
            }
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            ZStack {
                Circle().fill(SnoutTheme.cotton.opacity(0.6)).frame(width: 72, height: 72)
                SnoutGlyph("creditcard", size: 28, weight: .regular)
                    .foregroundStyle(SnoutTheme.onSurface)
            }
            Text("No packages right now")
                .font(SnoutTheme.titleMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Text("Your facility hasn't published any credit packages yet. Reach out to them if you'd like to pre-purchase visits.")
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

// MARK: - Detail / pay view

@MainActor
final class BuyCreditsCheckoutViewModel: ObservableObject {
    @Published var isStartingCheckout: Bool = false
    @Published var checkoutError: String?

    private let client = SupabaseClientProvider.shared

    func startCheckout(packageId: String) async -> URL? {
        isStartingCheckout = true
        defer { isStartingCheckout = false }
        checkoutError = nil

        struct Payload: Encodable {
            let package_id: String
            // Tells the edge function where Stripe should redirect after
            // checkout. Without this, the edge function falls back to the
            // request origin (Supabase functions URL), which doesn't host
            // any pages — Stripe's redirect lands on a 404 and the user
            // sees "requested path is invalid".
            let base_url: String
        }
        struct Response: Decodable {
            let checkout_url: String?
            let checkout_session_id: String?
            let error: String?
        }

        do {
            let response: Response = try await client.functions
                .invoke("create-package-checkout-session",
                        options: FunctionInvokeOptions(
                            body: Payload(package_id: packageId, base_url: AppConfig.webAppURL)
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

struct BuyCreditsPackageDetailView: View {
    let package: CreditPackage

    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = BuyCreditsCheckoutViewModel()
    @Environment(\.dismiss) private var dismiss
    @State private var checkoutSheet: SafariURL?
    /// Banner state after the Safari sheet closes. Stripe redirects to a
    /// `?package=success` URL on payment success and `?package=cancelled`
    /// when the user backs out. We detect that in the SafariSheet redirect
    /// callback, auto-dismiss the Safari view, and surface a native banner
    /// here so the user doesn't have to interpret a web login page.
    @State private var lastCheckoutOutcome: CheckoutOutcome?

    private enum CheckoutOutcome: Equatable {
        case success
        case cancelled
    }

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xl) {
                    if let outcome = lastCheckoutOutcome {
                        outcomeBanner(outcome)
                    }
                    summaryCard
                    if !package.creditChips.isEmpty {
                        includesCard
                    }
                    if let desc = package.description, !desc.isEmpty {
                        descriptionCard(desc)
                    }
                    finePrint
                    payButton
                    if let err = vm.checkoutError {
                        errorBanner(err)
                    }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle(package.name)
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $checkoutSheet, onDismiss: {
            // After Safari closes the user has either paid or cancelled.
            // The Connect webhook applies credits server-side; we just need
            // to refresh the owner row so the Home credits card updates.
            // Poll for ~30s so credits land without a manual refresh.
            Task { await pollOwnerForUpdate() }
        }) { item in
            SafariSheet(
                url: item.url,
                preferredControlTintColor: UIColor(SnoutTheme.accent),
                shouldAutoDismissOn: { url in
                    detectOutcome(in: url) != nil
                },
                onAutoDismiss: { url in
                    if let outcome = detectOutcome(in: url) {
                        lastCheckoutOutcome = outcome
                    }
                },
            )
            .ignoresSafeArea()
        }
    }

    /// Identifies Stripe's redirect-back URL by the query param the edge
    /// function set on `success_url` / `cancel_url`. Returns nil for any
    /// other URL (intermediate Stripe pages, 3DS challenges, etc.) so we
    /// don't dismiss too early.
    private func detectOutcome(in url: URL) -> CheckoutOutcome? {
        let q = url.query ?? ""
        if q.contains("package=success") { return .success }
        if q.contains("package=cancelled") || q.contains("package=canceled") { return .cancelled }
        return nil
    }

    /// Refetch the owner row every couple of seconds for up to ~30s so
    /// credits granted server-side (via webhook) appear without a manual
    /// pull-to-refresh. Stops early if balance changes or page closes.
    private func pollOwnerForUpdate() async {
        for _ in 0..<10 {
            await currentOwner.refreshOwner()
            try? await Task.sleep(nanoseconds: 3_000_000_000)
        }
    }

    @ViewBuilder
    private func outcomeBanner(_ outcome: CheckoutOutcome) -> some View {
        switch outcome {
        case .success:
            HStack(spacing: SnoutTheme.Spacing.sm) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Payment received")
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                    Text("Credits will appear in a few seconds.")
                        .font(SnoutTheme.bodySM)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                Spacer()
            }
            .padding(SnoutTheme.Spacing.lg)
            .background(SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        case .cancelled:
            HStack(spacing: SnoutTheme.Spacing.sm) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                Text("Payment cancelled. No charge was made.")
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                Spacer()
            }
            .padding(SnoutTheme.Spacing.lg)
            .background(SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        }
    }

    // MARK: - Cards

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            Text(package.billingLabel.uppercased())
                .font(SnoutTheme.labelSM)
                .tracking(0.6)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            HStack(alignment: .firstTextBaseline) {
                Text(package.name)
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                Spacer()
                Text(Money.formatCents(package.priceCents, currency: "CAD"))
                    .font(SnoutTheme.display(28, weight: .regular))
                    .foregroundStyle(SnoutTheme.onSurface)
            }
        }
        .padding(SnoutTheme.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SnoutTheme.cotton.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusTile, style: .continuous))
    }

    private var includesCard: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            Text("INCLUDES")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            FlowingChips(items: package.creditChips)
        }
        .padding(SnoutTheme.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private func descriptionCard(_ desc: String) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text("ABOUT")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Text(desc)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(SnoutTheme.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private var finePrint: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let v = package.validityDays, v > 0 {
                Text("Credits expire \(v) days after purchase.")
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
            Text("You'll be redirected to a secure Stripe checkout. Credits are added to your account automatically once your payment clears.")
                .font(SnoutTheme.bodySM)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, SnoutTheme.Spacing.xs)
    }

    private var payButton: some View {
        Button {
            Task {
                if let url = await vm.startCheckout(packageId: package.id) {
                    checkoutSheet = SafariURL(url: url)
                }
            }
        } label: {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                if vm.isStartingCheckout {
                    ProgressView().tint(SnoutTheme.onAccent)
                } else {
                    // Uses the same `creditcard` custom asset across the
                    // app for visual consistency — the user only authored
                    // one creditcard variant, so we don't fork into .fill.
                    SnoutGlyph("creditcard", size: 16, weight: .semibold)
                }
                Text(vm.isStartingCheckout
                     ? "Opening Stripe…"
                     : "Pay \(Money.formatCents(package.priceCents, currency: "CAD"))")
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

// MARK: - Wrap-line chip strip

/// Tiny FlexBox-ish wrap layout for credit chips. Built on iOS 16's Layout
/// protocol so the chips wrap onto multiple lines naturally.
private struct FlowingChips: View {
    let items: [String]

    var body: some View {
        ChipFlow(spacing: SnoutTheme.Spacing.sm) {
            ForEach(items, id: \.self) { text in
                Text(text)
                    .font(SnoutTheme.body(13, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                    .padding(.horizontal, SnoutTheme.Spacing.md)
                    .padding(.vertical, SnoutTheme.Spacing.xs)
                    .background(SnoutTheme.vanilla.opacity(0.85))
                    .clipShape(Capsule())
            }
        }
    }
}

private struct ChipFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0

        for subview in subviews {
            let s = subview.sizeThatFits(.unspecified)
            if x + s.width > maxWidth, x > 0 {
                totalHeight += rowHeight + spacing
                x = 0
                rowHeight = 0
            }
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
        totalHeight += rowHeight
        y = totalHeight
        return CGSize(width: maxWidth.isFinite ? maxWidth : x, height: y)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x: CGFloat = bounds.minX
        var y: CGFloat = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let s = subview.sizeThatFits(.unspecified)
            if x + s.width > bounds.maxX, x > bounds.minX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing
            rowHeight = max(rowHeight, s.height)
        }
    }
}
