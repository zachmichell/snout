//
//  StaffLoginView.swift
//  Snout Staff
//
//  Email/password + magic-link sign-in. Reuses the shared AuthService.
//

import SwiftUI

struct StaffLoginView: View {
    @EnvironmentObject private var auth: AuthService

    @State private var email = ""
    @State private var password = ""
    @State private var isSubmitting = false
    @State private var magicSent = false
    @FocusState private var focused: Field?

    enum Field { case email, password }

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: SnoutTheme.Spacing.xl) {
                    header
                    card
                    if let err = auth.lastError {
                        Text(err)
                            .font(SnoutTheme.bodySM)
                            .foregroundStyle(SnoutTheme.onSurface)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(SnoutTheme.Spacing.md)
                            .background(SnoutTheme.cotton.opacity(0.6))
                            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
                    }
                }
                .padding(SnoutTheme.Spacing.xl)
                .frame(maxWidth: 460)
                .frame(maxWidth: .infinity)
            }
            .scrollContentBackground(.hidden)
        }
    }

    private var header: some View {
        VStack(spacing: SnoutTheme.Spacing.sm) {
            Text("Snout")
                .font(SnoutTheme.display(40, weight: .bold))
                .foregroundStyle(SnoutTheme.onSurface)
            Text("STAFF")
                .font(SnoutTheme.labelSM)
                .tracking(3)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
        .padding(.top, SnoutTheme.Spacing.xxl)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            Text("Sign in")
                .font(SnoutTheme.titleMD)
                .foregroundStyle(SnoutTheme.onSurface)

            StaffFormField(label: "Email", text: $email,
                           placeholder: "you@facility.com",
                           contentType: .username, keyboard: .emailAddress,
                           capitalization: .never)
                .focused($focused, equals: .email)

            StaffSecureField(label: "Password", text: $password, placeholder: "Your password")
                .focused($focused, equals: .password)

            Button {
                Task { await submitPassword() }
            } label: {
                HStack(spacing: SnoutTheme.Spacing.sm) {
                    if isSubmitting { ProgressView().tint(SnoutTheme.onAccent) }
                    Text(isSubmitting ? "Signing in…" : "Sign in")
                        .font(SnoutTheme.body(15, weight: .semibold))
                }
                .foregroundStyle(SnoutTheme.onAccent)
                .frame(maxWidth: .infinity)
                .padding(.vertical, SnoutTheme.Spacing.md)
                .background(canSubmit ? SnoutTheme.accent : SnoutTheme.accent.opacity(0.4))
                .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(!canSubmit)

            HStack {
                Rectangle().fill(SnoutTheme.divider).frame(height: 1)
                Text("or").font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted)
                Rectangle().fill(SnoutTheme.divider).frame(height: 1)
            }

            Button {
                Task { await submitMagicLink() }
            } label: {
                Text(magicSent ? "Magic link sent — check your email" : "Email me a magic link")
                    .font(SnoutTheme.body(15, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, SnoutTheme.Spacing.md)
                    .background(SnoutTheme.surface)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(SnoutTheme.divider, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(email.isEmpty || isSubmitting)
        }
        .padding(SnoutTheme.Spacing.xl)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private var canSubmit: Bool {
        !email.isEmpty && !password.isEmpty && !isSubmitting
    }

    private func submitPassword() async {
        focused = nil
        isSubmitting = true
        await auth.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
        isSubmitting = false
    }

    private func submitMagicLink() async {
        focused = nil
        isSubmitting = true
        let ok = await auth.sendMagicLink(email: email.trimmingCharacters(in: .whitespaces))
        magicSent = ok
        isSubmitting = false
    }
}
