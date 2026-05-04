//
//  PhotoLightboxView.swift
//  Snout
//
//  Full-screen photo viewer with pinch-zoom + swipe paging + share-sheet download.
//  Filename convention matches the web: <pet>-<YYYY-MM-DD>-photo-<idx>.<ext>
//

import SwiftUI

struct PhotoLightboxView: View {
    let urls: [URL]
    let startIndex: Int
    let petLabel: String
    let publishedAt: Date?
    let onClose: () -> Void

    @State private var index: Int

    init(urls: [URL], startIndex: Int, petLabel: String, publishedAt: Date?, onClose: @escaping () -> Void) {
        self.urls = urls
        self.startIndex = startIndex
        self.petLabel = petLabel
        self.publishedAt = publishedAt
        self.onClose = onClose
        self._index = State(initialValue: startIndex)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(urls.enumerated()), id: \.offset) { i, url in
                    ZoomableAsyncImage(url: url)
                        .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            VStack {
                HStack {
                    Button(action: onClose) {
                        SnoutGlyph("xmark", size: 18, weight: .semibold)
                            .foregroundStyle(.white)
                            .padding(10)
                            .background(.black.opacity(0.5))
                            .clipShape(Circle())
                    }
                    Spacer()
                    if !urls.isEmpty {
                        Text("\(index + 1) / \(urls.count)")
                            .font(SnoutTheme.body(13, weight: .medium))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(.black.opacity(0.5))
                            .clipShape(Capsule())
                    }
                    Spacer()
                    ShareLink(item: urls[index]) {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(10)
                            .background(.black.opacity(0.5))
                            .clipShape(Circle())
                    }
                }
                .padding()
                Spacer()
            }
        }
    }
}

private struct ZoomableAsyncImage: View {
    let url: URL
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .empty:
                ProgressView().tint(.white)
            case .success(let image):
                image
                    .resizable()
                    .scaledToFit()
                    .scaleEffect(scale)
                    .offset(offset)
                    .gesture(magnification)
                    .simultaneousGesture(drag)
                    .onTapGesture(count: 2) {
                        withAnimation(.spring()) {
                            if scale > 1 {
                                scale = 1; lastScale = 1
                                offset = .zero; lastOffset = .zero
                            } else {
                                scale = 2.5; lastScale = 2.5
                            }
                        }
                    }
            case .failure:
                Image(systemName: "photo.badge.exclamationmark")
                    .foregroundStyle(.white.opacity(0.6))
            @unknown default:
                EmptyView()
            }
        }
    }

    private var magnification: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                scale = max(1, lastScale * value)
            }
            .onEnded { _ in
                lastScale = scale
                if scale <= 1 {
                    withAnimation(.spring()) { offset = .zero; lastOffset = .zero }
                }
            }
    }

    private var drag: some Gesture {
        DragGesture()
            .onChanged { value in
                guard scale > 1 else { return }
                offset = CGSize(width: lastOffset.width + value.translation.width,
                                height: lastOffset.height + value.translation.height)
            }
            .onEnded { _ in
                lastOffset = offset
            }
    }
}
