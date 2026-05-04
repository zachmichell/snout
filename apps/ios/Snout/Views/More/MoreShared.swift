//
//  MoreShared.swift
//  Snout
//
//  Shared primitives for the More tab's sub-pages. These were `private` and
//  inline in SettingsView.swift while the More hub was being built up; moved
//  here so each sub-page (Client details, Pets, Invoices, Agreements,
//  Payment methods) can share the same Boho form/control vocabulary.
//
//  Visibility is internal (file-default) — accessible across the More files
//  without polluting other modules.
//

import SwiftUI
import UIKit
import SafariServices

// MARK: - Coming-soon placeholder
//
// Used for sub-pages that are still stubs (e.g. when a feature is on the
// plan but not yet implemented). Tasteful, on-brand, and unambiguously
// "this isn't ready" so users don't think the app's broken.

struct ComingSoonPlaceholder: View {
    let title: String
    let subtitle: String
    let symbol: String

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            VStack(spacing: SnoutTheme.Spacing.lg) {
                ZStack {
                    Circle().fill(SnoutTheme.cotton.opacity(0.6)).frame(width: 88, height: 88)
                    Image(systemName: symbol)
                        .font(.system(size: 36, weight: .regular))
                        .foregroundStyle(SnoutTheme.onSurface)
                }
                VStack(spacing: SnoutTheme.Spacing.sm) {
                    Text(title)
                        .font(SnoutTheme.titleLG)
                        .foregroundStyle(SnoutTheme.onSurface)
                    Text(subtitle)
                        .font(SnoutTheme.bodyMD)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, SnoutTheme.Spacing.xl)
                Text("Coming soon")
                    .font(SnoutTheme.labelSM)
                    .tracking(0.8)
                    .foregroundStyle(SnoutTheme.onSurface)
                    .padding(.horizontal, SnoutTheme.Spacing.lg)
                    .padding(.vertical, SnoutTheme.Spacing.sm)
                    .background(SnoutTheme.vanilla)
                    .clipShape(Capsule())
            }
            .padding(SnoutTheme.Spacing.xl)
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - Boho form field (single-line)
//
// Label above, cream-tinted input below. iOS autofill content types and
// keyboard hints flow through. The cream `background` reads as a distinct
// fill against white surface cards; against the page background (also cream),
// the divider stroke does the visual separation.

struct BohoFormField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""
    var contentType: UITextContentType? = nil
    var keyboard: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .sentences

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text(label)
                .font(SnoutTheme.labelSM)
                .tracking(0.4)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            TextField(placeholder, text: $text)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
                .textContentType(contentType)
                .keyboardType(keyboard)
                .textInputAutocapitalization(capitalization)
                .autocorrectionDisabled(keyboard == .emailAddress || contentType == .postalCode)
                .padding(.horizontal, SnoutTheme.Spacing.md)
                .padding(.vertical, SnoutTheme.Spacing.sm)
                .background(SnoutTheme.background)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous)
                        .stroke(SnoutTheme.divider, lineWidth: 1)
                )
        }
    }
}

// MARK: - Boho multiline form field
//
// Same look as BohoFormField but with `axis: .vertical` so the input grows
// 2–6 lines as needed.

struct BohoMultilineField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text(label)
                .font(SnoutTheme.labelSM)
                .tracking(0.4)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            TextField(placeholder, text: $text, axis: .vertical)
                .lineLimit(2...6)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
                .padding(.horizontal, SnoutTheme.Spacing.md)
                .padding(.vertical, SnoutTheme.Spacing.sm)
                .background(SnoutTheme.background)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous)
                        .stroke(SnoutTheme.divider, lineWidth: 1)
                )
        }
    }
}

// MARK: - Boho segmented control
//
// Replacement for `Picker(.segmented)` that uses the brand accent (Soft Camel)
// for the active pill instead of the system blue. Pill-shaped capsule on a
// cream-tinted track.

struct BohoSegmented: View {
    /// (value, label) pairs. Selection is bound to `value`.
    let options: [(String, String)]
    @Binding var selection: String

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.0) { (value, label) in
                let isSelected = value == selection
                Button {
                    selection = value
                } label: {
                    Text(label)
                        .font(SnoutTheme.body(13, weight: .semibold))
                        .foregroundStyle(isSelected ? SnoutTheme.onAccent : SnoutTheme.onSurfaceMuted)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, SnoutTheme.Spacing.sm)
                        .background(isSelected ? SnoutTheme.accent : Color.clear)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(SnoutTheme.background)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(SnoutTheme.divider, lineWidth: 1))
    }
}

// MARK: - Safari sheet
//
// Reusable wrapper around SFSafariViewController so we can present a Stripe
// Checkout URL (or any other web flow) from SwiftUI. We deliberately use the
// in-app browser instead of opening Safari proper because:
//   1. It keeps the Stripe payment session inside our app's context.
//   2. The user can tap Done to return to Snout instead of getting kicked
//      into Mobile Safari.
//   3. Cookies + Apple Pay autofill still work.
//
// Usage:
//   .sheet(item: $checkoutURL) { url in
//       SafariSheet(url: url)
//           .ignoresSafeArea()
//   }
// where `checkoutURL` is `@State private var checkoutURL: SafariURL?`.

/// Identifiable wrapper around URL for `.sheet(item:)`.
struct SafariURL: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

struct SafariSheet: UIViewControllerRepresentable {
    let url: URL
    var preferredControlTintColor: UIColor? = nil
    var dismissButtonStyle: SFSafariViewController.DismissButtonStyle = .done

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.entersReaderIfAvailable = false
        config.barCollapsingEnabled = true
        let vc = SFSafariViewController(url: url, configuration: config)
        if let tint = preferredControlTintColor {
            vc.preferredControlTintColor = tint
        }
        vc.dismissButtonStyle = dismissButtonStyle
        return vc
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}
