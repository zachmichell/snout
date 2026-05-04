//
//  AgreementsView.swift
//  Snout
//
//  Pet-parent agreements (waivers): list (Action required / Signed) and
//  detail with on-device signature capture via PencilKit.
//
//  A waiver-signature is "outdated" when the org publishes a newer
//  `waivers.version` than the parent's most-recent signature's
//  `waiver_version`. The parent re-signs to bring it current.
//

import SwiftUI
import UIKit
import PencilKit

// MARK: - Models

enum WaiverStatus: String {
    case signed
    case outdated
    case unsigned
}

struct Waiver: Decodable, Identifiable, Hashable {
    let id: String
    let title: String
    let body: String
    let version: Int

    enum CodingKeys: String, CodingKey {
        case id, title, body, version
    }
}

struct WaiverSignatureRecord: Decodable, Hashable {
    let waiverId: String
    let waiverVersion: Int
    let signedAt: Date

    enum CodingKeys: String, CodingKey {
        case waiverId       = "waiver_id"
        case waiverVersion  = "waiver_version"
        case signedAt       = "signed_at"
    }
}

struct WaiverWithStatus: Identifiable, Hashable {
    let waiver: Waiver
    let latestSignature: WaiverSignatureRecord?
    let status: WaiverStatus

    var id: String { waiver.id }
}

// MARK: - Agreements list

@MainActor
final class AgreementsListViewModel: ObservableObject {
    @Published var actionRequired: [WaiverWithStatus] = []
    @Published var signed: [WaiverWithStatus] = []
    @Published var isLoading: Bool = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared

    func load(organizationId: String, ownerId: String) async {
        isLoading = true
        defer { isLoading = false }
        loadError = nil
        do {
            async let waiversTask: [Waiver] = client
                .from("waivers")
                .select("id, title, body, version")
                .eq("organization_id", value: organizationId)
                .eq("active", value: true)
                .is("deleted_at", value: nil)
                .order("title", ascending: true)
                .execute()
                .value

            async let sigsTask: [WaiverSignatureRecord] = client
                .from("waiver_signatures")
                .select("waiver_id, waiver_version, signed_at")
                .eq("owner_id", value: ownerId)
                .order("signed_at", ascending: false)
                .execute()
                .value

            let waivers = try await waiversTask
            let sigs = try await sigsTask

            var latestByWaiver: [String: WaiverSignatureRecord] = [:]
            for s in sigs where latestByWaiver[s.waiverId] == nil {
                latestByWaiver[s.waiverId] = s
            }

            let combined: [WaiverWithStatus] = waivers.map { w in
                let sig = latestByWaiver[w.id]
                let status: WaiverStatus = {
                    guard let sig else { return .unsigned }
                    return sig.waiverVersion >= w.version ? .signed : .outdated
                }()
                return WaiverWithStatus(waiver: w, latestSignature: sig, status: status)
            }

            self.actionRequired = combined.filter { $0.status != .signed }
            self.signed = combined.filter { $0.status == .signed }
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct AgreementsListView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = AgreementsListViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xl) {
                    if vm.isLoading && vm.actionRequired.isEmpty && vm.signed.isEmpty {
                        ProgressView()
                            .tint(SnoutTheme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.top, SnoutTheme.Spacing.xxl)
                    } else if vm.actionRequired.isEmpty && vm.signed.isEmpty {
                        emptyState
                    } else {
                        if !vm.actionRequired.isEmpty {
                            agreementSection(
                                title: "Action required",
                                accent: true,
                                items: vm.actionRequired
                            )
                        }
                        if !vm.signed.isEmpty {
                            agreementSection(
                                title: "Signed",
                                accent: false,
                                items: vm.signed
                            )
                        }
                    }
                    if let err = vm.loadError {
                        errorBanner(err)
                    }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
            .refreshable { await reload() }
        }
        .navigationTitle("Agreements")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
    }

    private func reload() async {
        guard let org = currentOwner.organizationId,
              let ownerId = currentOwner.ownerId else { return }
        await vm.load(organizationId: org, ownerId: ownerId)
    }

    @ViewBuilder
    private func agreementSection(title: String, accent: Bool, items: [WaiverWithStatus]) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                Text(title.uppercased())
                    .font(SnoutTheme.labelSM)
                    .tracking(0.8)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                if accent {
                    Circle().fill(SnoutTheme.accent).frame(width: 6, height: 6)
                }
                Spacer()
            }
            .padding(.horizontal, SnoutTheme.Spacing.xs)

            VStack(spacing: SnoutTheme.Spacing.sm) {
                ForEach(items) { item in
                    NavigationLink {
                        AgreementDetailView(waiverId: item.waiver.id, onChange: reload)
                    } label: {
                        agreementRow(item)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func agreementRow(_ item: WaiverWithStatus) -> some View {
        HStack(spacing: SnoutTheme.Spacing.lg) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: SnoutTheme.Spacing.sm) {
                    Text(item.waiver.title)
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                    WaiverStatusChip(status: item.status)
                }
                Text(rowSubtitle(for: item))
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
            Spacer()
            SnoutGlyph("chevron.right", size: 13, weight: .semibold)
                .foregroundStyle(SnoutTheme.onSurfaceFaint)
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private func rowSubtitle(for item: WaiverWithStatus) -> String {
        switch item.status {
        case .unsigned:
            return "Tap to review and sign"
        case .outdated:
            return "Updated by your facility — please re-sign"
        case .signed:
            if let sig = item.latestSignature {
                let f = DateFormatter()
                f.timeZone = TimeZone(identifier: "America/Regina") ?? .current
                f.dateFormat = "MMM d, yyyy"
                return "Signed \(f.string(from: sig.signedAt))"
            }
            return "Signed"
        }
    }

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            ZStack {
                Circle().fill(SnoutTheme.blueberry.opacity(0.55)).frame(width: 72, height: 72)
                SnoutGlyph("signature", size: 28, weight: .regular)
                    .foregroundStyle(SnoutTheme.onSurface)
            }
            Text("No agreements")
                .font(SnoutTheme.titleMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Text("Your facility hasn't published any agreements yet. They'll appear here when they do.")
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, SnoutTheme.Spacing.xxl)
    }

    private func errorBanner(_ message: String) -> some View {
        Text(message)
            .font(SnoutTheme.bodySM)
            .foregroundStyle(SnoutTheme.onSurface)
            .padding(SnoutTheme.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SnoutTheme.cotton.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
    }
}

// MARK: - Status chip

private struct WaiverStatusChip: View {
    let status: WaiverStatus

    var body: some View {
        Text(label.uppercased())
            .font(SnoutTheme.labelSM)
            .tracking(0.6)
            .foregroundStyle(SnoutTheme.onSurface)
            .padding(.horizontal, SnoutTheme.Spacing.sm)
            .padding(.vertical, 3)
            .background(background)
            .clipShape(Capsule())
    }

    private var label: String {
        switch status {
        case .signed:   return "Signed"
        case .outdated: return "Outdated"
        case .unsigned: return "Unsigned"
        }
    }

    private var background: Color {
        switch status {
        case .signed:   return SnoutTheme.mist.opacity(0.65)
        case .outdated: return SnoutTheme.cotton.opacity(0.85)
        case .unsigned: return SnoutTheme.vanilla.opacity(0.85)
        }
    }
}

// MARK: - Detail + signature capture

@MainActor
final class AgreementDetailViewModel: ObservableObject {
    @Published var waiver: Waiver?
    @Published var latestSignature: WaiverSignatureRecord?
    @Published var status: WaiverStatus = .unsigned
    @Published var isLoading: Bool = false
    @Published var loadError: String?

    @Published var isSubmitting: Bool = false
    @Published var submitError: String?
    @Published var didSign: Bool = false

    private let client = SupabaseClientProvider.shared

    func load(waiverId: String, ownerId: String, organizationId: String) async {
        isLoading = true
        defer { isLoading = false }
        loadError = nil
        do {
            let waivers: [Waiver] = try await client
                .from("waivers")
                .select("id, title, body, version")
                .eq("id", value: waiverId)
                .eq("organization_id", value: organizationId)
                .is("deleted_at", value: nil)
                .limit(1)
                .execute()
                .value
            guard let w = waivers.first else {
                loadError = "Agreement not found."
                return
            }
            self.waiver = w

            let sigs: [WaiverSignatureRecord] = try await client
                .from("waiver_signatures")
                .select("waiver_id, waiver_version, signed_at")
                .eq("waiver_id", value: w.id)
                .eq("owner_id", value: ownerId)
                .order("signed_at", ascending: false)
                .limit(1)
                .execute()
                .value

            let sig = sigs.first
            self.latestSignature = sig
            self.status = {
                guard let sig else { return .unsigned }
                return sig.waiverVersion >= w.version ? .signed : .outdated
            }()
        } catch {
            loadError = error.localizedDescription
        }
    }

    /// Submit a freshly-rendered signature. signature_data is a data-URL-
    /// prefixed base64 PNG to match the wire shape the web portal writes.
    func submit(
        signatureDataURL: String,
        ownerId: String,
        organizationId: String
    ) async {
        guard let waiver else { return }
        isSubmitting = true
        defer { isSubmitting = false }
        submitError = nil

        struct Payload: Encodable {
            let organization_id: String
            let waiver_id: String
            let waiver_version: Int
            let owner_id: String
            let signed_at: String
            let signature_data: String
            let user_agent: String
        }

        let payload = Payload(
            organization_id: organizationId,
            waiver_id: waiver.id,
            waiver_version: waiver.version,
            owner_id: ownerId,
            signed_at: ISO8601DateFormatter().string(from: Date()),
            signature_data: signatureDataURL,
            user_agent: Self.userAgent()
        )

        do {
            try await client
                .from("waiver_signatures")
                .insert(payload)
                .execute()
            didSign = true
        } catch {
            submitError = error.localizedDescription
        }
    }

    private static func userAgent() -> String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        let device = UIDevice.current
        return "Snout iOS \(version) (build \(build)) · \(device.systemName) \(device.systemVersion) · \(device.model)"
    }
}

struct AgreementDetailView: View {
    let waiverId: String
    var onChange: () async -> Void = {}

    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = AgreementDetailViewModel()
    @Environment(\.dismiss) private var dismiss

    @State private var canvas: PKCanvasView = {
        let c = PKCanvasView()
        c.drawingPolicy = .anyInput
        c.tool = PKInkingTool(.pen, color: .black, width: 2.4)
        c.backgroundColor = .clear
        c.isOpaque = false
        return c
    }()
    @State private var hasInk: Bool = false

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                    if let waiver = vm.waiver {
                        headerCard(waiver)
                        statusBanner
                        bodyCard(waiver.body)
                        if vm.status != .signed {
                            signatureSection
                            submitButton
                        }
                        if let err = vm.submitError {
                            errorBanner(err)
                        }
                    } else if let err = vm.loadError {
                        errorBanner(err)
                    } else {
                        ProgressView()
                            .tint(SnoutTheme.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.top, SnoutTheme.Spacing.xxl)
                    }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle("Agreement")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard let org = currentOwner.organizationId,
                  let owner = currentOwner.ownerId else { return }
            await vm.load(waiverId: waiverId, ownerId: owner, organizationId: org)
        }
        .onChange(of: vm.didSign) { _, new in
            if new {
                Task {
                    await onChange()
                    dismiss()
                }
            }
        }
    }

    // MARK: - Header

    private func headerCard(_ waiver: Waiver) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            HStack(alignment: .top) {
                Text(waiver.title)
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                    .frame(maxWidth: .infinity, alignment: .leading)
                WaiverStatusChip(status: vm.status)
            }
            Text("Version \(waiver.version)")
                .font(SnoutTheme.labelSM)
                .tracking(0.6)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
        .padding(SnoutTheme.Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    @ViewBuilder
    private var statusBanner: some View {
        switch vm.status {
        case .signed:
            HStack(spacing: SnoutTheme.Spacing.md) {
                SnoutGlyph("checkmark.seal.fill", size: 16, weight: .semibold)
                    .foregroundStyle(SnoutTheme.onSurface)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Signed")
                        .font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                    if let sig = vm.latestSignature {
                        Text(signedSubline(for: sig))
                            .font(SnoutTheme.bodySM)
                            .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    }
                }
                Spacer()
            }
            .padding(SnoutTheme.Spacing.md)
            .background(SnoutTheme.mist.opacity(0.65))
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
        case .outdated:
            HStack(spacing: SnoutTheme.Spacing.md) {
                SnoutGlyph("exclamationmark.triangle.fill", size: 16, weight: .semibold)
                    .foregroundStyle(SnoutTheme.onSurface)
                Text("Your facility has updated this agreement. Please re-sign to keep your account current.")
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurface)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer()
            }
            .padding(SnoutTheme.Spacing.md)
            .background(SnoutTheme.cotton.opacity(0.85))
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
        case .unsigned:
            EmptyView()
        }
    }

    private func signedSubline(for sig: WaiverSignatureRecord) -> String {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "America/Regina") ?? .current
        f.dateFormat = "MMM d, yyyy"
        return "On \(f.string(from: sig.signedAt)) · version \(sig.waiverVersion)"
    }

    // MARK: - Body

    private func bodyCard(_ body: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(body)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    // MARK: - Signature pad

    private var signatureSection: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            HStack {
                Text("YOUR SIGNATURE")
                    .font(SnoutTheme.labelSM)
                    .tracking(0.8)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                Spacer()
                Button {
                    canvas.drawing = PKDrawing()
                    hasInk = false
                } label: {
                    Text("Clear")
                        .font(SnoutTheme.labelSM)
                        .tracking(0.6)
                        .foregroundStyle(SnoutTheme.accent)
                }
                .buttonStyle(.plain)
                .disabled(!hasInk || vm.isSubmitting)
                .opacity(hasInk ? 1 : 0.4)
            }

            ZStack(alignment: .bottom) {
                SignatureCanvas(canvas: $canvas, hasInk: $hasInk)
                    .frame(height: 180)
                    .background(SnoutTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous)
                            .stroke(SnoutTheme.divider, lineWidth: 1)
                    )

                if !hasInk {
                    HStack(spacing: SnoutTheme.Spacing.sm) {
                        Text("✕")
                            .font(SnoutTheme.body(20, weight: .regular))
                            .foregroundStyle(SnoutTheme.onSurfaceFaint)
                        Rectangle()
                            .fill(SnoutTheme.onSurfaceFaint.opacity(0.5))
                            .frame(height: 1)
                    }
                    .padding(.horizontal, SnoutTheme.Spacing.lg)
                    .padding(.bottom, SnoutTheme.Spacing.lg)
                    .allowsHitTesting(false)
                }
            }

            Text("Sign with your finger or Apple Pencil. By tapping the button below you agree to the terms of this document on behalf of your account.")
                .font(SnoutTheme.bodySM)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, SnoutTheme.Spacing.xs)
        }
    }

    private var submitButton: some View {
        Button {
            submit()
        } label: {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                if vm.isSubmitting { ProgressView().tint(SnoutTheme.onAccent) }
                Text(vm.isSubmitting ? "Submitting…" : (vm.status == .outdated ? "Re-sign agreement" : "Sign agreement"))
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
    }

    private var canSubmit: Bool { hasInk && !vm.isSubmitting }

    private func submit() {
        guard let org = currentOwner.organizationId,
              let ownerId = currentOwner.ownerId else { return }
        guard let dataURL = renderSignatureDataURL() else {
            vm.submitError = "Couldn't capture signature — try drawing it again."
            return
        }
        Task {
            await vm.submit(
                signatureDataURL: dataURL,
                ownerId: ownerId,
                organizationId: org
            )
        }
    }

    private func renderSignatureDataURL() -> String? {
        let drawing = canvas.drawing
        guard !drawing.bounds.isEmpty else { return nil }
        let bounds = drawing.bounds.insetBy(dx: -8, dy: -8)
        let image = drawing.image(from: bounds, scale: UIScreen.main.scale)
        guard let png = image.pngData() else { return nil }
        return "data:image/png;base64,\(png.base64EncodedString())"
    }

    private func errorBanner(_ message: String) -> some View {
        Text(message)
            .font(SnoutTheme.bodySM)
            .foregroundStyle(SnoutTheme.onSurface)
            .padding(SnoutTheme.Spacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SnoutTheme.cotton.opacity(0.6))
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
    }
}

// MARK: - PencilKit signature wrapper

private struct SignatureCanvas: UIViewRepresentable {
    @Binding var canvas: PKCanvasView
    @Binding var hasInk: Bool

    func makeUIView(context: Context) -> PKCanvasView {
        canvas.delegate = context.coordinator
        return canvas
    }

    func updateUIView(_ uiView: PKCanvasView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(hasInk: $hasInk)
    }

    final class Coordinator: NSObject, PKCanvasViewDelegate {
        let hasInk: Binding<Bool>

        init(hasInk: Binding<Bool>) {
            self.hasInk = hasInk
        }

        func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
            let nonEmpty = !canvasView.drawing.bounds.isEmpty
            if hasInk.wrappedValue != nonEmpty {
                DispatchQueue.main.async {
                    self.hasInk.wrappedValue = nonEmpty
                }
            }
        }
    }
}
