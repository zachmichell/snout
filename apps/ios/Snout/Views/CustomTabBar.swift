//
//  CustomTabBar.swift
//  Snout
//
//  Custom bottom navigation with a sliding accent pill behind the active tab.
//  Replaces the default SwiftUI TabView chrome (the system tab bar is hidden in
//  MainTabView via `.toolbar(.hidden, for: .tabBar)`).
//
//  Layout note: SwiftUI shape primitives (Capsule, Rectangle, etc.) are *greedy*
//  — they expand to fill any unconstrained dimension. So we never put a Capsule
//  as a sibling of a sized view inside a ZStack; instead it goes through `.background`
//  on the sized view, where its frame is bounded by the foreground content.
//
//  Animation: the active capsule uses `matchedGeometryEffect` to slide smoothly
//  between tab positions when `selection` changes. Spring tuned for a confident,
//  slightly bouncy glide (response 0.45, damping 0.78).
//

import SwiftUI

struct SnoutTabItem {
    let icon: String        // SF Symbol
    let label: String
}

struct CustomTabBar: View {
    @Binding var selection: Int
    let items: [SnoutTabItem]
    /// Map of tab index → unread badge count. 0 or missing = no badge.
    var unreadCounts: [Int: Int] = [:]

    @Namespace private var pillNamespace

    var body: some View {
        HStack(spacing: 4) {
            ForEach(items.indices, id: \.self) { index in
                tabButton(at: index)
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 6)
        // Capsule is greedy — applied as a background of the sized HStack so it
        // takes that intrinsic size, never the parent's available height.
        .background(
            Capsule()
                .fill(SnoutTheme.surface)
                .shadow(color: SnoutTheme.cardShadowColor,
                        radius: SnoutTheme.cardShadowRadius,
                        x: 0, y: SnoutTheme.cardShadowY)
        )
        .padding(.horizontal, SnoutTheme.Spacing.lg)
    }

    private func tabButton(at index: Int) -> some View {
        let isSelected = selection == index
        let item = items[index]

        return Button {
            withAnimation(.spring(response: 0.45, dampingFraction: 0.78)) {
                selection = index
            }
        } label: {
            VStack(spacing: 2) {
                ZStack(alignment: .topTrailing) {
                    // SnoutGlyph prefers the custom Boho asset when present
                    // in Assets.xcassets/Glyphs and falls back to the SF
                    // Symbol of the same name when it isn't. Sizing matches
                    // the previous SF Symbol (18pt semibold) for parity.
                    SnoutGlyph(item.icon, size: 18, weight: .semibold)
                    if let count = unreadCounts[index], count > 0 {
                        badge(count: count)
                            .offset(x: 10, y: -8)
                    }
                }
                Text(item.label)
                    .font(.system(size: 10, weight: .medium))
                    .lineLimit(1)
                    // "Messages" is the longest label and was getting clipped
                    // at the previous 10pt horizontal padding. Tighten by a
                    // touch and allow a small scale-down so every label fits
                    // even on the narrowest devices (iPhone SE / mini).
                    .minimumScaleFactor(0.85)
                    .allowsTightening(true)
            }
            .foregroundStyle(isSelected ? SnoutTheme.onAccent : SnoutTheme.onSurfaceMuted)
            .padding(.horizontal, 6)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            // Active pill goes BEHIND the VStack content via `.background` so it
            // inherits the VStack's intrinsic size (greedy Capsule trap avoided).
            .background {
                if isSelected {
                    Capsule()
                        .fill(SnoutTheme.accent)
                        .matchedGeometryEffect(id: "active-pill", in: pillNamespace)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func badge(count: Int) -> some View {
        Text("\(min(count, 99))")
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .frame(minWidth: 16, minHeight: 16)
            .background(Color.red, in: Capsule())
    }
}

#Preview {
    struct PreviewWrap: View {
        @State var sel = 0
        var body: some View {
            ZStack(alignment: .bottom) {
                SnoutTheme.background.ignoresSafeArea()
                CustomTabBar(
                    selection: $sel,
                    items: [
                        .init(icon: "house", label: "Home"),
                        .init(icon: "bubble.left.and.bubble.right", label: "Messages"),
                        .init(icon: "plus.circle.fill", label: "Book"),
                        .init(icon: "calendar", label: "Calendar"),
                        .init(icon: "ellipsis.circle.fill", label: "More")
                    ],
                    unreadCounts: [1: 2]
                )
                .padding(.bottom, 16)
            }
        }
    }
    return PreviewWrap()
}
