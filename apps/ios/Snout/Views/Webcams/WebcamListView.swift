//
//  WebcamListView.swift
//  Snout
//
//  Live cameras for the org. Shown when:
//   - the camera has no location_id (org-wide), OR
//   - the user has an active reservation (status confirmed or checked_in) at that location.
//

import SwiftUI

@MainActor
final class WebcamListViewModel: ObservableObject {
    @Published var visibleCams: [Webcam] = []
    @Published var isLoading: Bool = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared

    func load(organizationId: String, ownerId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            // 1) fetch all enabled cams for the org
            let cams: [Webcam] = try await client
                .from("webcams")
                .select()
                .eq("organization_id", value: organizationId)
                .eq("enabled", value: true)
                .is("deleted_at", value: nil)
                .execute()
                .value

            // 2) fetch active reservations to compute allowed location ids
            let activeReservations: [Reservation] = try await client
                .from("reservations")
                .select("id, location_id, status, primary_owner_id, organization_id, start_at, end_at, created_at, updated_at, source, is_recurring")
                .eq("primary_owner_id", value: ownerId)
                .in("status", values: ["confirmed", "checked_in"])
                .is("deleted_at", value: nil)
                .execute()
                .value

            let allowedLocationIds = Set(activeReservations.compactMap { $0.locationId })

            visibleCams = cams.filter { cam in
                if cam.locationId == nil { return true }    // org-wide
                if let id = cam.locationId, allowedLocationIds.contains(id) { return true }
                return false
            }
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct WebcamListView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = WebcamListViewModel()

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Cameras")
                .task { await loadIfReady() }
                .refreshable { await loadIfReady() }
        }
    }

    private func loadIfReady() async {
        if let org = currentOwner.organizationId, let owner = currentOwner.ownerId {
            await vm.load(organizationId: org, ownerId: owner)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let err = currentOwner.loadError {
            errorState(err)
        } else if vm.isLoading && vm.visibleCams.isEmpty {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let err = vm.loadError {
            errorState(err)
        } else if vm.visibleCams.isEmpty {
            emptyState
        } else {
            list
        }
    }

    private var list: some View {
        List(vm.visibleCams) { cam in
            NavigationLink(value: cam) {
                WebcamRow(cam: cam)
            }
        }
        .listStyle(.plain)
        .navigationDestination(for: Webcam.self) { cam in
            WebcamPlayerView(cam: cam)
        }
    }

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            Image(systemName: "video.slash")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text("No cameras available")
                .font(SnoutTheme.body(17, weight: .semibold))
            Text("Live cameras turn on while your pet is checked in for a visit.")
                .font(SnoutTheme.body(14))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, SnoutTheme.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            SnoutGlyph("exclamationmark.triangle", size: 40)
                .foregroundStyle(.orange)
            Text("Couldn't load cameras")
                .font(SnoutTheme.body(17, weight: .semibold))
            Text(message)
                .font(SnoutTheme.body(13))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, SnoutTheme.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct WebcamRow: View {
    let cam: Webcam

    var body: some View {
        HStack(spacing: SnoutTheme.Spacing.md) {
            SnoutGlyph("video.fill", size: 16)
                .foregroundStyle(SnoutTheme.accent)
                .frame(width: 36, height: 36)
                .background(SnoutTheme.accent.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(cam.name)
                    .font(SnoutTheme.body(15, weight: .semibold))
                if let desc = cam.description, !desc.isEmpty {
                    Text(desc)
                        .font(SnoutTheme.body(13))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            Text(cam.sourceKind.rawValue.uppercased())
                .font(SnoutTheme.body(11, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(Color.gray.opacity(0.15))
                .clipShape(Capsule())
        }
        .padding(.vertical, 4)
    }
}
