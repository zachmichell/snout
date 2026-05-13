//
//  PaymentMethodsView.swift
//  Snout
//
//  List + manage cards on file. The `payment_methods` table holds
//  card_brand, last_four, expiry, is_default, and the Stripe payment-method
//  id. We don't store card numbers anywhere — the actual card details live
//  with Stripe and we just keep the metadata for display + a Stripe handle
//  so the staff side can charge invoices against the saved card.
//
//  This turn:
//    - Real list (read), set default (UPDATE), remove (DELETE).
//    - Add card → routes to a "Coming soon" placeholder with guidance to
//      manage cards on the web portal. Native add requires either a new
//      setup-mode Stripe Checkout edge function or the Stripe iOS SDK
//      (Package.swift change); both are deliberately deferred.
//

import SwiftUI

// MARK: - Model

struct PaymentMethod: Decodable, Identifiable, Hashable {
    let id: String
    let cardBrand: String
    let cardLastFour: String
    let expiryMonth: Int
    let expiryYear: Int
    let isDefault: Bool
    let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case cardBrand     = "card_brand"
        case cardLastFour  = "card_last_four"
        case expiryMonth   = "expiry_month"
        case expiryYear    = "expiry_year"
        case isDefault     = "is_default"
        case createdAt     = "created_at"
    }
}

// MARK: - View model

@MainActor
final class PaymentMethodsViewModel: ObservableObject {
    @Published var methods: [PaymentMethod] = []
    @Published var isLoading: Bool = false
    @Published var loadError: String?
    @Published var actionError: String?
    @Published var pendingAction: String? // method id currently being mutated

    private let client = SupabaseClientProvider.shared

    func load(ownerId: String) async {
        isLoading = true
        defer { isLoading = false }
        loadError = nil
        do {
            let rows: [PaymentMethod] = try await client
                .from("payment_methods")
                .select("id, card_brand, card_last_four, expiry_month, expiry_year, is_default, created_at")
                .eq("owner_id", value: ownerId)
                .order("is_default", ascending: false)
                .order("created_at", ascending: false)
                .execute()
                .value
            self.methods = rows
        } catch {
            loadError = error.localizedDescription
        }
    }

    /// Set this card as the default — mirrors the web hook: clear all
    /// existing defaults for the owner first, then set the chosen one.
    /// The unique partial index `uniq_default_payment_method_per_owner`
    /// would otherwise reject a second is_default = true.
    func setDefault(method: PaymentMethod, ownerId: String) async {
        pendingAction = method.id
        defer { pendingAction = nil }
        actionError = nil

        struct ClearPayload: Encodable { let is_default: Bool }
        struct SetPayload: Encodable   { let is_default: Bool }

        do {
            try await client
                .from("payment_methods")
                .update(ClearPayload(is_default: false))
                .eq("owner_id", value: ownerId)
                .eq("is_default", value: true)
                .execute()
            try await client
                .from("payment_methods")
                .update(SetPayload(is_default: true))
                .eq("id", value: method.id)
                .execute()
            await load(ownerId: ownerId)
        } catch {
            actionError = error.localizedDescription
        }
    }

    func remove(method: PaymentMethod, ownerId: String) async {
        pendingAction = method.id
        defer { pendingAction = nil }
        actionError = nil
        do {
            try await client
                .from("payment_methods")
                .delete()
                .eq("id", value: method.id)
                .execute()
            await load(ownerId: ownerId)
        } catch {
            actionError = error.localizedDescription
        }
    }
}

// MARK: - View

struct PaymentMethodsView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = PaymentMethodsViewModel()
    @State private var pendingRemoval: PaymentMethod?

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                    if vm.isLoading && vm.methods.isEmpty {
                        ProgressView()
                            .tint(SnoutTheme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.top, SnoutTheme.Spacing.xxl)
                    } else if vm.methods.isEmpty {
                        emptyState
                    } else {
                        ForEach(vm.methods) { method in
                            cardRow(method)
                        }
                    }
                    if let err = vm.loadError ?? vm.actionError {
                        errorBanner(err)
                    }
                    addCardButton
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
            .refreshable { await reload() }
        }
        .navigationTitle("Payment methods")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
        .overlay {
            if let pending = pendingRemoval {
                RemoveCardDialog(
                    method: pending,
                    isRemoving: vm.pendingAction == pending.id,
                    onConfirm: {
                        guard let ownerId = currentOwner.ownerId else { return }
                        Task {
                            await vm.remove(method: pending, ownerId: ownerId)
                            pendingRemoval = nil
                        }
                    },
                    onCancel: { pendingRemoval = nil }
                )
                .transition(.opacity.combined(with: .scale(scale: 0.96)))
                .zIndex(10)
            }
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: pendingRemoval == nil)
    }

    private func reload() async {
        guard let id = currentOwner.ownerId else { return }
        await vm.load(ownerId: id)
    }

    // MARK: - Card row

    private func cardRow(_ method: PaymentMethod) -> some View {
        let isPending = vm.pendingAction == method.id
        return VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            HStack(spacing: SnoutTheme.Spacing.lg) {
                ZStack {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(brandTint(method.cardBrand))
                        .frame(width: 44, height: 30)
                    Text(brandShort(method.cardBrand).uppercased())
                        .font(SnoutTheme.body(10, weight: .bold))
                        .foregroundStyle(SnoutTheme.onSurface)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(brandLong(method.cardBrand)) ··\(method.cardLastFour)")
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                    Text("Expires \(formatExpiry(method))")
                        .font(SnoutTheme.bodySM)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                Spacer()
                if method.isDefault {
                    Text("DEFAULT")
                        .font(SnoutTheme.labelSM)
                        .tracking(0.6)
                        .foregroundStyle(SnoutTheme.onSurface)
                        .padding(.horizontal, SnoutTheme.Spacing.sm)
                        .padding(.vertical, 3)
                        .background(SnoutTheme.mist.opacity(0.7))
                        .clipShape(Capsule())
                }
            }

            HStack(spacing: SnoutTheme.Spacing.sm) {
                if !method.isDefault {
                    Button {
                        guard let ownerId = currentOwner.ownerId else { return }
                        Task { await vm.setDefault(method: method, ownerId: ownerId) }
                    } label: {
                        Text("Make default")
                            .font(SnoutTheme.body(13, weight: .semibold))
                            .foregroundStyle(SnoutTheme.onSurface)
                            .padding(.horizontal, SnoutTheme.Spacing.md)
                            .padding(.vertical, SnoutTheme.Spacing.sm)
                            .background(SnoutTheme.surface)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(SnoutTheme.divider, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(isPending)
                }
                Button {
                    pendingRemoval = method
                } label: {
                    Text("Remove")
                        .font(SnoutTheme.body(13, weight: .semibold))
                        .foregroundStyle(SnoutTheme.destructive)
                        .padding(.horizontal, SnoutTheme.Spacing.md)
                        .padding(.vertical, SnoutTheme.Spacing.sm)
                        .background(SnoutTheme.surface)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SnoutTheme.destructive.opacity(0.4), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(isPending)
                Spacer()
                if isPending {
                    ProgressView().tint(SnoutTheme.accent)
                }
            }
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    // MARK: - Empty + add CTA

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            ZStack {
                Circle().fill(SnoutTheme.vanilla.opacity(0.7)).frame(width: 72, height: 72)
                SnoutGlyph("creditcard", size: 28, weight: .regular)
                    .foregroundStyle(SnoutTheme.onSurface)
            }
            Text("No cards saved")
                .font(SnoutTheme.titleMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Text("Add a card to make checkout fast for future invoices.")
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, SnoutTheme.Spacing.xxl)
    }

    private var addCardButton: some View {
        NavigationLink {
            AddCardView(onSaved: {
                guard let id = currentOwner.ownerId else { return }
                Task { await vm.load(ownerId: id) }
            })
        } label: {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 16, weight: .semibold))
                Text("Add a card")
                    .font(SnoutTheme.body(15, weight: .semibold))
            }
            .foregroundStyle(SnoutTheme.onAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, SnoutTheme.Spacing.md)
            .background(SnoutTheme.accent)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
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

    // MARK: - Card display helpers

    private func brandShort(_ brand: String) -> String {
        switch brand.lowercased() {
        case "visa":             return "Visa"
        case "mastercard":       return "MC"
        case "amex", "american express": return "Amex"
        case "discover":         return "Disc"
        default:                 return brand
        }
    }

    private func brandLong(_ brand: String) -> String {
        switch brand.lowercased() {
        case "visa":             return "Visa"
        case "mastercard":       return "Mastercard"
        case "amex", "american express": return "American Express"
        case "discover":         return "Discover"
        default:                 return brand.capitalized
        }
    }

    /// Soft tint per brand to give cards visual distinctness without
    /// resorting to brand-violating logo colors.
    private func brandTint(_ brand: String) -> Color {
        switch brand.lowercased() {
        case "visa":             return SnoutTheme.frost.opacity(0.85)
        case "mastercard":       return SnoutTheme.cotton.opacity(0.85)
        case "amex", "american express": return SnoutTheme.mist.opacity(0.85)
        case "discover":         return SnoutTheme.vanilla.opacity(0.85)
        default:                 return SnoutTheme.blueberry.opacity(0.85)
        }
    }

    private func formatExpiry(_ method: PaymentMethod) -> String {
        let mm = String(format: "%02d", method.expiryMonth)
        let yy = String(method.expiryYear).suffix(2)
        return "\(mm)/\(yy)"
    }
}

// MARK: - Remove confirm dialog

private struct RemoveCardDialog: View {
    let method: PaymentMethod
    let isRemoving: Bool
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            Color(red: 0.20, green: 0.15, blue: 0.13).opacity(0.45)
                .ignoresSafeArea()

            VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
                Text("Remove this card?")
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                Text("Your saved card ending in \(method.cardLastFour) will no longer be available for payments. You can add it again anytime.")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(spacing: SnoutTheme.Spacing.sm) {
                    Button(action: onConfirm) {
                        HStack(spacing: SnoutTheme.Spacing.sm) {
                            if isRemoving { ProgressView().tint(SnoutTheme.onDestructive) }
                            Text(isRemoving ? "Removing…" : "Confirm removal")
                                .font(SnoutTheme.body(15, weight: .semibold))
                        }
                        .foregroundStyle(SnoutTheme.onDestructive)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, SnoutTheme.Spacing.md)
                        .background(SnoutTheme.destructive)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(isRemoving)

                    Button(action: onCancel) {
                        Text("Keep card")
                            .font(SnoutTheme.body(15, weight: .semibold))
                            .foregroundStyle(SnoutTheme.onSurface)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, SnoutTheme.Spacing.md)
                            .background(SnoutTheme.surface)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(SnoutTheme.divider, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(isRemoving)
                }
                .padding(.top, SnoutTheme.Spacing.xs)
            }
            .padding(SnoutTheme.Spacing.xl)
            .background(SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusHero, style: .continuous))
            .shadow(color: SnoutTheme.heroShadowColor,
                    radius: SnoutTheme.heroShadowRadius,
                    x: 0, y: SnoutTheme.heroShadowY)
            .padding(.horizontal, SnoutTheme.Spacing.xl)
            .frame(maxWidth: 420)
        }
    }
}

// Note: native add-card now lives in `AddCardView.swift`. The prior
// AddCardPlaceholder ("coming soon") has been removed.
