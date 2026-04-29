//
//  WebcamPlayerView.swift
//  Snout
//
//  AVPlayerViewController for hls/mp4; WKWebView for iframe sources. iOS handles HLS
//  natively — no third-party player needed.
//

import SwiftUI
import AVKit
import WebKit

struct WebcamPlayerView: View {
    let cam: Webcam

    var body: some View {
        Group {
            switch cam.sourceKind {
            case .hls, .mp4:
                if let url = URL(string: cam.sourceURL) {
                    AVPlayerSurface(url: url)
                        .ignoresSafeArea(edges: .bottom)
                } else {
                    invalidURL
                }
            case .iframe:
                if let url = URL(string: cam.sourceURL) {
                    WebSurface(url: url)
                        .ignoresSafeArea(edges: .bottom)
                } else {
                    invalidURL
                }
            }
        }
        .navigationTitle(cam.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var invalidURL: some View {
        Text("This camera's source URL is invalid.")
            .font(SnoutTheme.body(14))
            .foregroundStyle(.secondary)
    }
}

private struct AVPlayerSurface: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let player = AVPlayer(url: url)
        player.automaticallyWaitsToMinimizeStalling = true
        let vc = AVPlayerViewController()
        vc.player = player
        vc.allowsPictureInPicturePlayback = true
        vc.entersFullScreenWhenPlaybackBegins = false
        player.play()
        return vc
    }

    func updateUIViewController(_ uiViewController: AVPlayerViewController, context: Context) {}
}

private struct WebSurface: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: config)
        view.scrollView.isScrollEnabled = false
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        if uiView.url != url { uiView.load(URLRequest(url: url)) }
    }
}
