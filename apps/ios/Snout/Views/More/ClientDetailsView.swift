//
//  ClientDetailsView.swift
//  Snout
//
//  Edit screen for the parent's own owner row (name, contact, address,
//  communication preference). Backed by the `owners` table; we trust RLS's
//  "Tenant isolation update" policy — `is_org_member(organization_id)` —
//  scoped to the current owner's id so the customer can only update their
//  own row from this UI. A stricter "self-only" backend policy is a separate
//  hardening task.
//

import SwiftUI
import UIKit

@MainActor
final class ClientDetailsViewModel: ObservableObject {
    @Published var firstName: String = ""
    @Published var lastName: String = ""
    @Published var email: String = ""
    @Published var phone: String = ""
    @Published var streetAddress: String = ""
    @Published var city: String = ""
    @Published var stateProvince: String = ""
    @Published var postalCode: String = ""
    /// 'email' | 'sms' | 'both'
    @Published var communicationPreference: String = "email"

    @Published var isSaving: Bool = false
    @Published var saveError: String?
    @Published var didSave: Bool = false

    private let client = SupabaseClientProvider.shared

    /// Initial values, captured when the form is first populated. Used to
    /// detect a dirty state — we only enable Save when something actually
    /// changed.
    private var initialSnapshot: Snapshot?

    private struct Snapshot: Equatable {
        let firstName, lastName, email, phone: String
        let streetAddress, city, stateProvince, postalCode: String
        let communicationPreference: String
    }

    func hydrate(from owner: Owner) {
        firstName = owner.firstName
        lastName = owner.lastName
        email = owner.email ?? ""
        phone = owner.phone ?? ""
        streetAddress = owner.streetAddress ?? ""
        city = owner.city ?? ""
        stateProvince = owner.stateProvince ?? ""
        postalCode = owner.postalCode ?? ""
        communicationPreference = owner.communicationPreference
        initialSnapshot = currentSnapshot
    }

    private var currentSnapshot: Snapshot {
        Snapshot(
            firstName: firstName,
            lastName: lastName,
            email: email,
            phone: phone,
            streetAddress: streetAddress,
            city: city,
            stateProvince: stateProvince,
            postalCode: postalCode,
            communicationPreference: communicationPreference
        )
    }

    var isDirty: Bool {
        guard let initial = initialSnapshot else { return false }
        return initial != currentSnapshot
    }

    var canSave: Bool {
        !firstName.trimmingCharacters(in: .whitespaces).isEmpty
            && !lastName.trimmingCharacters(in: .whitespaces).isEmpty
            && isDirty
            && !isSaving
    }

    /// Persist the form to Postgres. Empty optional fields are written as
    /// nulls so the address stays clean rather than getting littered with
    /// empty strings.
    func save(ownerId: String) async {
        isSaving = true
        defer { isSaving = false }
        saveError = nil

        struct Payload: Encodable {
            let first_name: String
            let last_name: String
            let email: String?
            let phone: String?
            let street_address: String?
            let city: String?
            let state_province: String?
            let postal_code: String?
            let communication_preference: String
        }

        func nilIfBlank(_ s: String) -> String? {
            let trimmed = s.trimmingCharacters(in: .whitespaces)
            return trimmed.isEmpty ? nil : trimmed
        }

        let payload = Payload(
            first_name: firstName.trimmingCharacters(in: .whitespaces),
            last_name: lastName.trimmingCharacters(in: .whitespaces),
            email: nilIfBlank(email),
            phone: nilIfBlank(phone),
            street_address: nilIfBlank(streetAddress),
            city: nilIfBlank(city),
            state_province: nilIfBlank(stateProvince),
            postal_code: nilIfBlank(postalCode),
            communication_preference: communicationPreference
        )

        do {
            try await client
                .from("owners")
                .update(payload)
                .eq("id", value: ownerId)
                .execute()
            initialSnapshot = currentSnapshot
            didSave = true
        } catch {
            saveError = error.localizedDescription
        }
    }
}

struct ClientDetailsView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = ClientDetailsViewModel()
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Field?

    enum Field { case firstName, lastName, email, phone, street, city, region, postal }

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xl) {
                    nameSection
                    contactSection
                    addressSection
                    if let err = vm.saveError {
                        errorBanner(err)
                    }
                    saveButton
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Client details")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if let owner = currentOwner.owner {
                vm.hydrate(from: owner)
            } else {
                await currentOwner.refreshOwner()
                if let owner = currentOwner.owner {
                    vm.hydrate(from: owner)
                }
            }
        }
        .onChange(of: vm.didSave) { _, new in
            if new {
                Task {
                    await currentOwner.refreshOwner()
                    dismiss()
                }
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focused = nil }
                    .foregroundStyle(SnoutTheme.accent)
            }
        }
    }

    // MARK: - Sections

    private var nameSection: some View {
        formSection(title: "Name") {
            HStack(spacing: SnoutTheme.Spacing.md) {
                BohoFormField(
                    label: "First",
                    text: $vm.firstName,
                    placeholder: "First name",
                    contentType: .givenName,
                    capitalization: .words
                )
                .focused($focused, equals: .firstName)
                BohoFormField(
                    label: "Last",
                    text: $vm.lastName,
                    placeholder: "Last name",
                    contentType: .familyName,
                    capitalization: .words
                )
                .focused($focused, equals: .lastName)
            }
        }
    }

    private var contactSection: some View {
        formSection(title: "Contact") {
            BohoFormField(
                label: "Email",
                text: $vm.email,
                placeholder: "you@example.com",
                contentType: .emailAddress,
                keyboard: .emailAddress,
                capitalization: .never
            )
            .focused($focused, equals: .email)

            BohoFormField(
                label: "Phone",
                text: $vm.phone,
                placeholder: "555 123 4567",
                contentType: .telephoneNumber,
                keyboard: .phonePad
            )
            .focused($focused, equals: .phone)

            VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
                Text("Communication preference")
                    .font(SnoutTheme.labelSM)
                    .tracking(0.6)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                BohoSegmented(
                    options: [("email", "Email"), ("sms", "Text"), ("both", "Both")],
                    selection: $vm.communicationPreference
                )
            }
        }
    }

    private var addressSection: some View {
        formSection(title: "Address") {
            BohoFormField(
                label: "Street",
                text: $vm.streetAddress,
                placeholder: "123 Dogwood Drive",
                contentType: .streetAddressLine1,
                capitalization: .words
            )
            .focused($focused, equals: .street)

            HStack(spacing: SnoutTheme.Spacing.md) {
                BohoFormField(
                    label: "City",
                    text: $vm.city,
                    placeholder: "Regina",
                    contentType: .addressCity,
                    capitalization: .words
                )
                .focused($focused, equals: .city)
                BohoFormField(
                    label: "Province",
                    text: $vm.stateProvince,
                    placeholder: "SK",
                    contentType: .addressState,
                    capitalization: .characters
                )
                .focused($focused, equals: .region)
            }

            BohoFormField(
                label: "Postal code",
                text: $vm.postalCode,
                placeholder: "S4P 1A1",
                contentType: .postalCode,
                capitalization: .characters
            )
            .focused($focused, equals: .postal)
        }
    }

    // MARK: - Save

    private var saveButton: some View {
        Button {
            guard let id = currentOwner.ownerId else { return }
            Task { await vm.save(ownerId: id) }
        } label: {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                if vm.isSaving { ProgressView().tint(SnoutTheme.onAccent) }
                Text(vm.isSaving ? "Saving…" : "Save changes")
                    .font(SnoutTheme.body(15, weight: .semibold))
            }
            .foregroundStyle(SnoutTheme.onAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, SnoutTheme.Spacing.md)
            .background(vm.canSave ? SnoutTheme.accent : SnoutTheme.accent.opacity(0.4))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!vm.canSave)
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

    // MARK: - Section wrapper

    @ViewBuilder
    private func formSection<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            Text(title.uppercased())
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .padding(.horizontal, SnoutTheme.Spacing.xs)
            VStack(spacing: SnoutTheme.Spacing.md) {
                content()
            }
            .padding(SnoutTheme.Spacing.lg)
            .background(SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        }
    }
}
