//
//  SignInView.swift
//  Snout
//
//  Warm Boho-tinted sign-in surface. Sign in with Apple is wired but disabled until
//  a paid Apple Developer account is in place.
//

import SwiftUI

struct SignInView: View {
    @EnvironmentObject private var auth: AuthService

    @State private var email: String = ""
    @State private var password: String = ""
    @State private var isWorking: Bool = false
    @State private var magicLinkSent: Bool = false

    private let appleSignInEnabled: Bool = false

    var body: some View {
        ZStack {
            backgroundGradient.ignoresSafeArea()

            ScrollView {
                VStack(spacing: SnoutTheme.Spacing.xxl) {
                    branding
                    formCard
                    if let err = auth.lastError {
                        errorBanner(err)
                    }
                    if magicLinkSent {
                        infoBanner("Check your email for a sign-in link.")
                    }
                    if appleSignInEnabled { appleButton }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(.horizontal, SnoutTheme.Spacing.xl)
                .padding(.top, SnoutTheme.Spacing.xxl)
            }
            .scrollContentBackground(.hidden)
        }
    }

    // MARK: - Background

    private var backgroundGradient: some View {
        LinearGradient(
            colors: [
                SnoutTheme.cotton,
                SnoutTheme.vanilla,
                SnoutTheme.background
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    // MARK: - Branding

    private var branding: some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            ZStack {
                Circle()
                    .fill(SnoutTheme.surface)
                    .frame(width: 84, height: 84)
                    .shadow(color: SnoutTheme.cardShadowColor,
                            radius: SnoutTheme.cardShadowRadius, x: 0, y: SnoutTheme.cardShadowY)
                Image(systemName: "pawprint.fill")
                    .font(.system(size: 36))
                    .foregroundStyle(SnoutTheme.accent)
            }
            .padding(.top, SnoutTheme.Spacing.xxl)

            Text("Snout")
                .font(SnoutTheme.display(44, weight: .bold))
                .foregroundStyle(SnoutTheme.onSurface)

            Text("Welcome back. Let's see what your pet is up to.")
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, SnoutTheme.Spacing.lg)
        }
    }

    // MARK: - Form card

    private var formCard: some View {
        VStack(spacing: SnoutTheme.Spacing.lg) {
            field(label: "Email",
                  placeholder: "you@example.com",
                  text: $email,
                  isSecure: false)

            secureField(label: "Password",
                        placeholder: "••••••••",
                        text: $password)

            SnoutPrimaryButton(
                title: isWorking ? "Signing in…" : "Sign in",
                isLoading: isWorking,
                action: { Task { await signIn() } }
            )
            .opacity(canSubmit ? 1 : 0.5)
            .allowsHitTesting(canSubmit && !isWorking)

            Button {
                Task { await sendMagicLink() }
            } label: {
                Text("Email me a sign-in link instead")
                    .font(SnoutTheme.body(14, weight: .medium))
                    .foregroundStyle(SnoutTheme.accent)
            }
            .disabled(isWorking || email.isEmpty)
        }
        .snoutHeroCard()
    }

    private func field(label: String, placeholder: String,
                       text: Binding<String>, isSecure: Bool) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text(label)
                .font(SnoutTheme.labelMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)

            TextField(placeholder, text: text)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .font(SnoutTheme.bodyLG)
                .foregroundStyle(SnoutTheme.onSurface)
                .padding(SnoutTheme.Spacing.lg)
                .background(SnoutTheme.background)
                .overlay(
                    RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous)
                        .stroke(SnoutTheme.divider, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        }
    }

    private func secureField(label: String, placeholder: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text(label)
                .font(SnoutTheme.labelMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)

            SecureField(placeholder, text: text)
                .textContentType(.password)
                .font(SnoutTheme.bodyLG)
                .foregroundStyle(SnoutTheme.onSurface)
                .padding(SnoutTheme.Spacing.lg)
                .background(SnoutTheme.background)
                .overlay(
                    RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous)
                        .stroke(SnoutTheme.divider, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        }
    }

    private func errorBanner(_ message: String) -> some View {
        Text(message)
            .font(SnoutTheme.bodySM)
            .foregroundStyle(SnoutTheme.onSurface)
            .padding(SnoutTheme.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SnoutTheme.cotton.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private func infoBanner(_ message: String) -> some View {
        Text(message)
            .font(SnoutTheme.bodySM)
            .foregroundStyle(SnoutTheme.onSurfaceMuted)
            .padding(SnoutTheme.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SnoutTheme.mist.opacity(0.5))
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    // MARK: - Apple sign in (gated)

    private var appleButton: some View {
        Button { /* TODO when paid Apple Dev account is ready */ } label: {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                Image(systemName: "apple.logo")
                Text("Sign in with Apple")
                    .font(SnoutTheme.body(17, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, SnoutTheme.Spacing.lg)
            .background(SnoutTheme.onSurface)
            .foregroundStyle(SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        }
    }

    // MARK: - Actions

    private var canSubmit: Bool { !email.isEmpty && !password.isEmpty }

    private func signIn() async {
        isWorking = true
        defer { isWorking = false }
        magicLinkSent = false
        await auth.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
    }

    private func sendMagicLink() async {
        isWorking = true
        defer { isWorking = false }
        let ok = await auth.sendMagicLink(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
        if ok { magicLinkSent = true }
    }
}

#Preview {
    SignInView()
        .environmentObject(AuthService())
}
