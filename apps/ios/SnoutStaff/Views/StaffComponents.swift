//
//  StaffComponents.swift
//  Snout Staff
//
//  Small Boho-styled form primitives for the staff app, so it doesn't depend
//  on the client app's view files. Mirrors the look of BohoFormField in the
//  client's MoreShared.swift.
//

import SwiftUI
import UIKit

struct StaffFormField: View {
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
                .autocorrectionDisabled(keyboard == .emailAddress)
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

struct StaffSecureField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text(label)
                .font(SnoutTheme.labelSM)
                .tracking(0.4)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            SecureField(placeholder, text: $text)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
                .textContentType(.password)
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
