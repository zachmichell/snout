//
//  ConversationListView.swift
//  Snout
//
//  Brand-tinted conversation list. Pulls org name for the row title.
//

import SwiftUI

@MainActor
final class ConversationListViewModel: ObservableObject {
    @Published var conversations: [Conversation] = []
    @Published var orgName: String?
    @Published var isLoading: Bool = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared

    func load(ownerId: String, organizationId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            let rows: [Conversation] = try await client
                .from("conversations")
                .select()
                .eq("owner_id", value: ownerId)
                .order("last_message_at", ascending: false)
                .execute()
                .value
            conversations = rows

            struct Org: Decodable { let name: String }
            let orgRows: [Org] = try await client
                .from("organizations")
                .select("name")
                .eq("id", value: organizationId)
                .limit(1)
                .execute()
                .value
            orgName = orgRows.first?.name
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct ConversationListView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = ConversationListViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                SnoutTheme.background.ignoresSafeArea()
                content
            }
            .navigationTitle("Messages")
            .navigationBarTitleDisplayMode(.large)
            .task { await loadIfReady() }
            .refreshable { await loadIfReady() }
        }
    }

    private func loadIfReady() async {
        if let owner = currentOwner.ownerId, let org = currentOwner.organizationId {
            await vm.load(ownerId: owner, organizationId: org)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let err = currentOwner.loadError {
            errorState(err)
        } else if vm.isLoading && vm.conversations.isEmpty {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let err = vm.loadError {
            errorState(err)
        } else if vm.conversations.isEmpty {
            emptyState
        } else {
            list
        }
    }

    private var list: some View {
        ScrollView {
            VStack(spacing: SnoutTheme.Spacing.md) {
                ForEach(vm.conversations) { conv in
                    NavigationLink {
                        ConversationView(conversation: conv, orgName: vm.orgName)
                    } label: {
                        ConversationRowCard(conversation: conv, orgName: vm.orgName)
                    }
                    .buttonStyle(.plain)
                }
                Spacer(minLength: SnoutTheme.Spacing.xxl)
            }
            .padding(.horizontal, SnoutTheme.Spacing.xl)
            .padding(.top, SnoutTheme.Spacing.md)
        }
        .scrollContentBackground(.hidden)
    }

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            Image(systemName: "bubble.left")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(SnoutTheme.onSurfaceFaint)
            Text("No messages yet")
                .font(SnoutTheme.titleMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Text("Reach out to your facility from their portal — your conversation will appear here.")
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, SnoutTheme.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            SnoutGlyph("exclamationmark.triangle", size: 40)
                .foregroundStyle(SnoutTheme.accent)
            Text("Couldn't load messages")
                .font(SnoutTheme.titleMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Text(message)
                .font(SnoutTheme.bodySM)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, SnoutTheme.Spacing.xl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct ConversationRowCard: View {
    let conversation: Conversation
    let orgName: String?

    var body: some View {
        HStack(spacing: SnoutTheme.Spacing.lg) {
            ZStack {
                Circle().fill(SnoutTheme.mist).frame(width: 52, height: 52)
                Text(initials)
                    .font(SnoutTheme.body(18, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(orgName ?? "Your facility")
                        .font(SnoutTheme.titleSM)
                        .foregroundStyle(SnoutTheme.onSurface)
                    Spacer()
                    if let last = conversation.lastMessageAt {
                        Text(timeLabel(last))
                            .font(SnoutTheme.labelSM)
                            .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    }
                }
                HStack {
                    Text(conversation.lastMessagePreview ?? "No messages yet.")
                        .font(SnoutTheme.bodySM)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                        .lineLimit(2)
                    Spacer()
                    if conversation.unreadOwner > 0 {
                        Text("\(conversation.unreadOwner)")
                            .font(SnoutTheme.body(12, weight: .semibold))
                            .foregroundStyle(SnoutTheme.onAccent)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(SnoutTheme.accent)
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .snoutCard()
    }

    private var initials: String {
        let trimmed = (orgName ?? "Your facility").trimmingCharacters(in: .whitespaces)
        let parts = trimmed.split(separator: " ").prefix(2)
        return parts.compactMap { $0.first.map(String.init) }.joined().uppercased()
    }

    private func timeLabel(_ date: Date) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(date) {
            let f = DateFormatter(); f.timeStyle = .short
            return f.string(from: date)
        }
        if cal.isDateInYesterday(date) { return "Yesterday" }
        let f = DateFormatter(); f.dateFormat = "MMM d"
        return f.string(from: date)
    }
}
