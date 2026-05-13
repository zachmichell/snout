//
//  AddCardView.swift
//  Snout
//
//  Native flow for saving a card on file using Stripe's PaymentSheet in
//  setup mode. Replaces the prior `AddCardPlaceholder` "coming soon"
//  screen.
//
//  How it works:
//    1. Calls the `create-setup-intent` edge function with the current
//       owner + org. That function looks up or creates a Stripe Customer
//       on the org's connected Stripe account and returns the four
//       artifacts PaymentSheet needs (client secret, customer id,
//       ephemeral key secret, connected account id) plus the publishable
//       key.
//    2. Configures STPAPIClient with the publishable key + connected
//       account, then presents PaymentSheet bound to the SetupIntent.
//    3. On success, the `setup_intent.succeeded` Stripe webhook inserts
//       the new row into `payment_methods` server-side. We poll the list
//       once on dismissal so the UI catches up without waiting for the
//       Postgres realtime channel.
//    4. On failure, surface the error and let the user retry.
//
//  Auth: the edge function checks the caller is the owner or a staff
//  member of the org. We pass the Supabase user session token.
//

import SwiftUI
import StripePaymentSheet
import Supabase

@MainActor
final class AddCardViewModel: ObservableObject {
    enum LoadState {
        case idle
        case loadingIntent
        case ready(PaymentSheet)
        case error(String)
    }

    @Published private(set) var state: LoadState = .idle
    @Published private(set) var didFinishSuccessfully = false

    private let client = SupabaseClientProvider.shared

    /// Asks the edge function for a SetupIntent + ephemeral key + customer
    /// id, then constructs a PaymentSheet ready to present. Idempotent —
    /// safe to call again on retry.
    func prepare(organizationId: String, ownerId: String) async {
        state = .loadingIntent
        do {
            struct Response: Decodable {
                let setup_intent_client_secret: String
                let customer_id: String
                let ephemeral_key_secret: String
                let stripe_account_id: String
                let publishable_key: String?
            }
            let body: [String: String] = [
                "organization_id": organizationId,
                "owner_id": ownerId,
            ]
            let result: Response = try await client.functions
                .invoke("create-setup-intent", options: .init(body: body))

            guard let publishableKey = result.publishable_key, !publishableKey.isEmpty else {
                state = .error("Card saving isn't fully set up yet. Please contact the facility.")
                return
            }

            // Stripe SDK is global-state by design — configure the API
            // client with the connected account so requests target the
            // correct connected Stripe account.
            STPAPIClient.shared.publishableKey = publishableKey
            STPAPIClient.shared.stripeAccount = result.stripe_account_id

            var configuration = PaymentSheet.Configuration()
            configuration.merchantDisplayName = "Snout"
            configuration.customer = .init(
                id: result.customer_id,
                ephemeralKeySecret: result.ephemeral_key_secret,
            )
            // Match the off_session usage we set when minting the
            // SetupIntent server-side.
            configuration.allowsDelayedPaymentMethods = false

            let sheet = PaymentSheet(
                setupIntentClientSecret: result.setup_intent_client_secret,
                configuration: configuration,
            )
            state = .ready(sheet)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Called from the PaymentSheet result handler.
    func handle(result: PaymentSheetResult) {
        switch result {
        case .completed:
            didFinishSuccessfully = true
        case .canceled:
            // Intentional — user backed out. Leave the sheet ready for
            // another attempt; no state change.
            break
        case .failed(let error):
            state = .error(error.localizedDescription)
        }
    }
}

struct AddCardView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = AddCardViewModel()
    /// Optional callback the parent uses to refresh its card list after
    /// a successful save. The webhook does the DB write asynchronously,
    /// so the parent should refetch.
    var onSaved: (() -> Void)? = nil

    @State private var isPresentingSheet = false

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xl) {
                    intro

                    switch vm.state {
                    case .idle, .loadingIntent:
                        loadingCard
                    case .ready:
                        readyCard
                    case .error(let message):
                        errorCard(message)
                    }

                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(.horizontal, SnoutTheme.Spacing.xl)
                .padding(.top, SnoutTheme.Spacing.md)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Add a card")
        .navigationBarTitleDisplayMode(.inline)
        .task { await prepareIfNeeded() }
        .onChange(of: vm.didFinishSuccessfully) { _, finished in
            if finished {
                onSaved?()
                dismiss()
            }
        }
        // PaymentSheet's binding-driven presentation. We toggle
        // isPresentingSheet to true once `vm.state == .ready` and the
        // user taps the primary CTA.
        .paymentSheet(
            isPresented: $isPresentingSheet,
            paymentSheet: paymentSheetIfReady,
            onCompletion: { result in
                vm.handle(result: result)
            },
        )
    }

    // MARK: - Sections

    private var intro: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            Text("Save a card on file")
                .font(SnoutTheme.titleMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Text("We use Stripe to securely save your card. The card details never touch Snout's servers — only Stripe sees them.")
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var loadingCard: some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            ProgressView()
                .tint(SnoutTheme.accent)
            Text("Preparing a secure session…")
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(SnoutTheme.Spacing.xl)
        .snoutCard()
    }

    private var readyCard: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                Image(systemName: "lock.fill")
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                Text("Secure session is ready")
                    .font(SnoutTheme.body(15, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
            }
            Text("Tap below to enter your card details in Stripe's secure form.")
                .font(SnoutTheme.bodySM)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                isPresentingSheet = true
            } label: {
                HStack(spacing: SnoutTheme.Spacing.sm) {
                    Image(systemName: "creditcard.fill")
                        .font(.system(size: 16, weight: .semibold))
                    Text("Enter card details")
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
        .padding(SnoutTheme.Spacing.xl)
        .snoutCard()
    }

    private func errorCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                Text("Couldn't start a session")
                    .font(SnoutTheme.body(15, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
            }
            Text(message)
                .font(SnoutTheme.bodySM)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                Task { await prepareIfNeeded(force: true) }
            } label: {
                Text("Try again")
                    .font(SnoutTheme.body(15, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, SnoutTheme.Spacing.md)
                    .background(SnoutTheme.surface)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(SnoutTheme.divider, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .padding(SnoutTheme.Spacing.xl)
        .snoutCard()
    }

    // MARK: - Helpers

    private var paymentSheetIfReady: PaymentSheet? {
        if case .ready(let sheet) = vm.state { return sheet }
        return nil
    }

    private func prepareIfNeeded(force: Bool = false) async {
        if !force, case .ready = vm.state { return }
        guard
            let orgId = currentOwner.organizationId,
            let ownerId = currentOwner.ownerId
        else {
            return
        }
        await vm.prepare(organizationId: orgId, ownerId: ownerId)
    }
}
