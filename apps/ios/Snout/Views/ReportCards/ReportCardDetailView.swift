//
//  ReportCardDetailView.swift
//  Snout
//
//  Pet name + date as the hero. Photo carousel above the summary if photos exist.
//  Summary in a tinted Cotton card. Ratings as a horizontal emoji-pill row.
//

import SwiftUI
import Supabase

@MainActor
final class ReportCardDetailViewModel: ObservableObject {
    @Published var signedURLs: [URL] = []
    @Published var isLoading: Bool = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared
    private static let bucket = "report-card-photos"
    private static let signedTTLSeconds: Int = 3600

    func resolvePhotos(_ paths: [String]) async {
        if paths.isEmpty { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let signed = try await client.storage
                .from(Self.bucket)
                .createSignedURLs(paths: paths, expiresIn: Self.signedTTLSeconds)
            signedURLs = signed.compactMap { $0.signedURL }
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct ReportCardDetailView: View {
    let card: ReportCard
    let petName: String
    @StateObject private var vm = ReportCardDetailViewModel()
    @State private var lightboxIndex: Int? = nil

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xl) {
                    header
                    if !card.photoURLs.isEmpty {
                        photoCarousel
                    }
                    if let summary = card.summary, !summary.isEmpty {
                        summaryCard(summary)
                    }
                    if let sections = card.customSections, !sections.isEmpty {
                        customSectionsView(sections)
                    } else {
                        ratingsRow
                    }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(.horizontal, SnoutTheme.Spacing.xl)
                .padding(.top, SnoutTheme.Spacing.md)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Report Card")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.resolvePhotos(card.photoURLs) }
        .fullScreenCover(item: Binding(
            get: { lightboxIndex.map { LightboxIndex(value: $0) } },
            set: { lightboxIndex = $0?.value }
        )) { idx in
            PhotoLightboxView(
                urls: vm.signedURLs,
                startIndex: idx.value,
                petLabel: petName,
                publishedAt: card.publishedAt
            ) {
                lightboxIndex = nil
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text(dateLabel.uppercased())
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Text(petName)
                .font(SnoutTheme.titleXL)
                .foregroundStyle(SnoutTheme.onSurface)
            Text("Had a great day at your facility.")
                .font(SnoutTheme.bodyLG)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
    }

    private var photoCarousel: some View {
        Group {
            if vm.isLoading {
                RoundedRectangle(cornerRadius: SnoutTheme.radiusHero, style: .continuous)
                    .fill(SnoutTheme.frost.opacity(0.4))
                    .frame(height: 240)
                    .overlay(ProgressView())
            } else if !vm.signedURLs.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: SnoutTheme.Spacing.md) {
                        ForEach(Array(vm.signedURLs.enumerated()), id: \.offset) { idx, url in
                            Button {
                                lightboxIndex = idx
                            } label: {
                                AsyncImage(url: url) { phase in
                                    switch phase {
                                    case .empty:
                                        Rectangle().fill(SnoutTheme.frost.opacity(0.4))
                                    case .success(let img):
                                        img.resizable().scaledToFill()
                                    case .failure:
                                        Rectangle().fill(SnoutTheme.frost.opacity(0.4))
                                            .overlay(Image(systemName: "photo")
                                                .foregroundStyle(SnoutTheme.onSurfaceMuted))
                                    @unknown default:
                                        Rectangle().fill(SnoutTheme.frost.opacity(0.4))
                                    }
                                }
                                .frame(width: 280, height: 240)
                                .clipped()
                                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusHero, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .scrollClipDisabled()
            }
        }
    }

    private func summaryCard(_ s: String) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            Text("\u{201C}")
                .font(SnoutTheme.display(56, weight: .bold))
                .foregroundStyle(SnoutTheme.accent)
                .frame(height: 24, alignment: .top)
                .padding(.bottom, -16)
            Text(s)
                .font(SnoutTheme.bodyLG)
                .foregroundStyle(SnoutTheme.onSurface)
                .lineSpacing(4)
        }
        .snoutTinted(SnoutTheme.cotton, padding: SnoutTheme.Spacing.xl)
    }

    @ViewBuilder
    private func customSectionsView(_ sections: [ReportCardSection]) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            ForEach(Array(sections.enumerated()), id: \.offset) { _, section in
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
                    if !section.title.isEmpty {
                        Text(section.title.uppercased())
                            .font(SnoutTheme.labelSM)
                            .tracking(0.8)
                            .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    }
                    VStack(spacing: 0) {
                        ForEach(Array(section.fields.enumerated()), id: \.offset) { idx, field in
                            HStack(alignment: .top, spacing: SnoutTheme.Spacing.md) {
                                Text(field.label)
                                    .font(SnoutTheme.bodyMD)
                                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                                Spacer(minLength: SnoutTheme.Spacing.md)
                                Text(field.displayValue)
                                    .font(SnoutTheme.body(15, weight: .semibold))
                                    .foregroundStyle(SnoutTheme.onSurface)
                                    .multilineTextAlignment(.trailing)
                            }
                            .padding(.vertical, SnoutTheme.Spacing.sm)
                            if idx < section.fields.count - 1 {
                                Divider().overlay(SnoutTheme.divider)
                            }
                        }
                    }
                    .snoutTinted(SnoutTheme.cotton, padding: SnoutTheme.Spacing.lg)
                }
            }
        }
    }

    private var ratingsRow: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            Text("HOW THE DAY WENT")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: SnoutTheme.Spacing.md) {
                    if let mood = card.mood {
                        ratingTile(emoji: Format.moodEmoji(mood),
                                   label: "Mood",
                                   value: Format.humanize(mood),
                                   tint: SnoutTheme.cotton)
                    }
                    if let energy = card.energyLevel {
                        ratingTile(emoji: Format.energyEmoji(energy),
                                   label: "Energy",
                                   value: Format.humanize(energy),
                                   tint: SnoutTheme.vanilla)
                    }
                    if let appetite = card.appetite {
                        ratingTile(emoji: Format.appetiteEmoji(appetite),
                                   label: "Appetite",
                                   value: Format.humanize(appetite),
                                   tint: SnoutTheme.mist)
                    }
                    if let s = card.sociability {
                        ratingTile(emoji: Format.sociabilityEmoji(s),
                                   label: "Sociability",
                                   value: Format.humanize(s),
                                   tint: SnoutTheme.frost)
                    }
                    if let r = card.overallRating {
                        ratingTile(emoji: Format.ratingEmoji(r),
                                   label: "Overall",
                                   value: Format.humanize(r),
                                   tint: SnoutTheme.blueberry)
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    private func ratingTile(emoji: String, label: String, value: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            Text(emoji)
                .font(.system(size: 28))
            Text(label.uppercased())
                .font(SnoutTheme.labelSM)
                .tracking(0.6)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Text(value)
                .font(SnoutTheme.titleSM)
                .foregroundStyle(SnoutTheme.onSurface)
        }
        .padding(SnoutTheme.Spacing.lg)
        .frame(width: 130, alignment: .leading)
        .background(tint.opacity(0.45))
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusTile, style: .continuous))
    }

    private var dateLabel: String {
        guard let pub = card.publishedAt else { return "Report card" }
        let f = DateFormatter()
        f.dateFormat = "EEEE, MMMM d"
        return f.string(from: pub)
    }
}

private struct LightboxIndex: Identifiable {
    let value: Int
    var id: Int { value }
}
