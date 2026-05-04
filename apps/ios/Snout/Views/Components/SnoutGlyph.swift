//
//  SnoutGlyph.swift
//  Snout
//
//  Drop-in replacement for `Image(systemName:)` that prefers a custom Boho
//  asset when one is present in `Assets.xcassets/Glyphs/` and falls back to
//  the matching SF Symbol when it isn't.
//
//  Naming convention: each custom imageset uses the SF Symbol name
//  verbatim (`house`, `plus.circle.fill`, `bubble.left.and.bubble.right`)
//  and is set to "Render As: Template Image" so SwiftUI's
//  `.foregroundStyle()` tints it the same way it tints SF Symbols. That
//  way the swap is mechanical: replace `Image(systemName: "X")` with
//  `SnoutGlyph("X")` and the call site keeps the same modifiers.
//
//  As we batch-replace SF Symbols with custom artwork, every site that
//  uses SnoutGlyph picks up the new asset automatically — no per-site
//  edit needed once the file lands in the catalog.
//

import SwiftUI
import UIKit

struct SnoutGlyph: View {
    let name: String
    /// Optional explicit point size. When set, the glyph scales to fit
    /// without affecting its parent's intrinsic size — same semantics as
    /// `Image(systemName:).font(.system(size:))` so existing call sites
    /// transfer cleanly.
    var size: CGFloat? = nil
    var weight: Font.Weight = .regular

    init(_ name: String, size: CGFloat? = nil, weight: Font.Weight = .regular) {
        self.name = name
        self.size = size
        self.weight = weight
    }

    var body: some View {
        // UIImage(named:) returns nil for assets we haven't custom-authored
        // yet, so falling back to the SF Symbol keeps the rest of the UI
        // working while we batch-design the brand glyphs incrementally.
        if UIImage(named: name) != nil {
            Image(name)
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .applyingSize(size)
        } else {
            Image(systemName: name)
                .applyingFontIfSized(size: size, weight: weight)
        }
    }
}

private extension View {
    /// Pin a square frame when an explicit size is provided; otherwise let
    /// the parent determine the layout (matches SF Symbol intrinsic-size
    /// behavior).
    @ViewBuilder
    func applyingSize(_ size: CGFloat?) -> some View {
        if let size {
            self.frame(width: size, height: size)
        } else {
            self
        }
    }

    @ViewBuilder
    func applyingFontIfSized(size: CGFloat?, weight: Font.Weight) -> some View {
        if let size {
            self.font(.system(size: size, weight: weight))
        } else {
            self
        }
    }
}
