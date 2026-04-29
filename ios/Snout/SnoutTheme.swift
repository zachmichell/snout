//
//  SnoutTheme.swift
//  Snout
//
//  Strict Boho Rainbow palette + warm consumer-mobile aesthetic.
//  Six brand tones from /memory/project_brand_palette.md plus white and a single
//  ink tone for text. No raw hex outside this file. No system grays in app surfaces
//  except where iOS forces them (e.g. system navigation chrome).
//
//  Cotton Candy   #F2D3C9
//  Vanilla Ice    #EED4BB
//  Frosted Glass  #CBD5D6
//  Morning Mist   #C7D0C5
//  Blueberry Crm  #CDB5B1
//  Soft Camel     #CBA48F  (accent / primary)
//

import SwiftUI

enum SnoutTheme {
    // MARK: - Palette tokens (asset catalog)
    static let accent      = Color("AccentColor")     // #CBA48F Soft Camel
    static let cotton      = Color("BrandCotton")     // #F2D3C9
    static let vanilla     = Color("BrandVanilla")    // #EED4BB
    static let frost       = Color("BrandFrost")      // #CBD5D6
    static let mist        = Color("BrandMist")       // #C7D0C5
    static let blueberry   = Color("BrandBlueberry")  // #CDB5B1
    static let camel       = Color("AccentColor")     // alias

    // MARK: - Semantic surface tokens (warm off-whites — kept inside palette family)
    /// Page background. A warm off-white that sits inside the Boho family rather than pure system white.
    static let background        = Color(red: 0.992, green: 0.973, blue: 0.957)   // #FDF8F4 cream
    /// Cards / sheets sit on background.
    static let surface           = Color.white
    /// Elevated surface (modals, hero cards) — slightly warmer than surface.
    static let surfaceElevated   = Color(red: 0.996, green: 0.984, blue: 0.973)   // #FEFBF8

    /// Primary text on warm light surfaces. A deep warm brown rather than pure black.
    static let onSurface         = Color(red: 0.20, green: 0.15, blue: 0.13)      // #332620
    /// Secondary / supporting text.
    static let onSurfaceMuted    = Color(red: 0.42, green: 0.36, blue: 0.32)      // #6B5C52
    /// Tertiary / disabled.
    static let onSurfaceFaint    = Color(red: 0.62, green: 0.56, blue: 0.51)      // #9F8F82
    /// Hairline divider.
    static let divider           = Color(red: 0.94, green: 0.91, blue: 0.87)      // #F0E8DE

    /// Text on the warm primary (accent) button.
    static let onAccent          = Color.white

    // MARK: - Status semantic colors (mapped to palette tones, never raw red/green)
    static func statusBackground(for status: ReservationStatus) -> Color {
        switch status {
        case .requested:                return vanilla.opacity(0.55)    // pending — vanilla
        case .confirmed:                return mist.opacity(0.65)       // calm — sage mist
        case .checkedIn:                return cotton.opacity(0.85)     // active — warm pink
        case .checkedOut:               return frost.opacity(0.65)      // done — cool frost
        case .cancelled, .noShow:       return blueberry.opacity(0.30)  // muted
        }
    }

    static func statusForeground(for status: ReservationStatus) -> Color {
        switch status {
        case .cancelled, .noShow:       return onSurfaceMuted
        default:                        return onSurface
        }
    }

    // MARK: - Corner radii
    static let radiusXS:    CGFloat = 6
    static let radiusSM:    CGFloat = 10
    static let radiusCard:  CGFloat = 14
    static let radiusTile:  CGFloat = 18
    static let radiusHero:  CGFloat = 24
    static let radiusPill:  CGFloat = 999

    // MARK: - Spacing scale (4pt grid)
    enum Spacing {
        static let xxs: CGFloat = 2
        static let xs:  CGFloat = 4
        static let sm:  CGFloat = 8
        static let md:  CGFloat = 12
        static let lg:  CGFloat = 16
        static let xl:  CGFloat = 20
        static let xxl: CGFloat = 28
        static let xxxl: CGFloat = 40
    }

    // MARK: - Elevation
    /// Soft warm shadow for cards.
    static let cardShadowColor    = Color.black.opacity(0.05)
    static let cardShadowRadius:  CGFloat = 12
    static let cardShadowY:       CGFloat = 2

    /// Stronger shadow for hero / floating elements.
    static let heroShadowColor    = Color.black.opacity(0.08)
    static let heroShadowRadius:  CGFloat = 24
    static let heroShadowY:       CGFloat = 6

    // MARK: - Typography
    // Display: serif (Fraunces on web; SF Serif as iOS substitute until font is licensed).
    // Body: SF Text rounded for a softer consumer feel.
    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    static func body(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }

    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    // Type ramp shortcuts
    static let titleXL = display(34, weight: .bold)
    static let titleLG = display(28, weight: .semibold)
    static let titleMD = display(22, weight: .semibold)
    static let titleSM = body(17, weight: .semibold)

    static let bodyLG  = body(17, weight: .regular)
    static let bodyMD  = body(15, weight: .regular)
    static let bodySM  = body(13, weight: .regular)

    static let labelLG = body(15, weight: .medium)
    static let labelMD = body(13, weight: .medium)
    static let labelSM = body(11, weight: .medium)

    static let caption = body(11, weight: .regular)
}

// MARK: - Reusable view modifiers

/// Standard surface card. Rounded, white, soft shadow.
struct SnoutCard: ViewModifier {
    var radius: CGFloat = SnoutTheme.radiusCard
    var padding: CGFloat = SnoutTheme.Spacing.lg
    var fill: Color = SnoutTheme.surface

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(fill)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .shadow(color: SnoutTheme.cardShadowColor,
                    radius: SnoutTheme.cardShadowRadius,
                    x: 0, y: SnoutTheme.cardShadowY)
    }
}

/// Tinted brand card — uses one of the six Boho tones at low opacity.
struct SnoutTintedCard: ViewModifier {
    var tint: Color
    var radius: CGFloat = SnoutTheme.radiusTile
    var padding: CGFloat = SnoutTheme.Spacing.lg

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(tint.opacity(0.35))
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

/// Hero card — large radius, soft elevated shadow. Used for prominent items.
struct SnoutHeroCard: ViewModifier {
    var radius: CGFloat = SnoutTheme.radiusHero
    var padding: CGFloat = SnoutTheme.Spacing.xl
    var fill: Color = SnoutTheme.surfaceElevated

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(fill)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .shadow(color: SnoutTheme.heroShadowColor,
                    radius: SnoutTheme.heroShadowRadius,
                    x: 0, y: SnoutTheme.heroShadowY)
    }
}

extension View {
    func snoutCard(radius: CGFloat = SnoutTheme.radiusCard,
                   padding: CGFloat = SnoutTheme.Spacing.lg,
                   fill: Color = SnoutTheme.surface) -> some View {
        modifier(SnoutCard(radius: radius, padding: padding, fill: fill))
    }

    func snoutTinted(_ tint: Color,
                     radius: CGFloat = SnoutTheme.radiusTile,
                     padding: CGFloat = SnoutTheme.Spacing.lg) -> some View {
        modifier(SnoutTintedCard(tint: tint, radius: radius, padding: padding))
    }

    func snoutHeroCard(radius: CGFloat = SnoutTheme.radiusHero,
                       padding: CGFloat = SnoutTheme.Spacing.xl,
                       fill: Color = SnoutTheme.surfaceElevated) -> some View {
        modifier(SnoutHeroCard(radius: radius, padding: padding, fill: fill))
    }
}

// MARK: - Brand badge (status pills, etc.)

struct SnoutBadge: View {
    let text: String
    let background: Color
    let foreground: Color

    var body: some View {
        Text(text.uppercased())
            .font(SnoutTheme.labelSM)
            .tracking(0.6)
            .padding(.horizontal, SnoutTheme.Spacing.md)
            .padding(.vertical, 5)
            .background(background)
            .foregroundStyle(foreground)
            .clipShape(Capsule())
    }
}

// MARK: - Primary brand button

struct SnoutPrimaryButton: View {
    let title: String
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                if isLoading {
                    ProgressView().tint(SnoutTheme.onAccent)
                }
                Text(title)
                    .font(SnoutTheme.body(17, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, SnoutTheme.Spacing.lg)
            .background(SnoutTheme.accent)
            .foregroundStyle(SnoutTheme.onAccent)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
