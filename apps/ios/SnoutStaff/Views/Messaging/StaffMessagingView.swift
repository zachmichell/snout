//
//  StaffMessagingView.swift
//  Snout Staff
//
//  Two-way messaging with pet parents. Lists the org's conversations
//  (newest first, with unread count), opens a thread, and sends staff
//  messages. Same conversations/messages tables as the web + client app;
//  staff access is gated by the is_org_staff message policies.
//

import SwiftUI
import Supabase

struct ConversationRow: Decodable, Identifiable, Hashable {
    let id: String
    let lastMessageAt: Date?
    let lastMessagePreview: String?
    let unreadStaff: Int
    let owner: OwnerRef?

    enum CodingKeys: String, CodingKey {
        case id, owner
        case lastMessageAt = "last_message_at"
        case lastMessagePreview = "last_message_preview"
        case unreadStaff = "unread_staff"
    }
    struct OwnerRef: Decodable, Hashable {
        let id: String; let firstName: String?; let lastName: String?
        enum CodingKeys: String, CodingKey { case id; case firstName = "first_name"; case lastName = "last_name" }
    }
    var ownerName: String { [owner?.firstName, owner?.lastName].compactMap { $0 }.joined(separator: " ").trimmingCharacters(in: .whitespaces) }
}

@MainActor
final class StaffMessagingViewModel: ObservableObject {
    @Published var conversations: [ConversationRow] = []
    @Published var isLoading = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared

    func load(organizationId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            conversations = try await client.from("conversations")
                .select("id, last_message_at, last_message_preview, unread_staff, owner:owners(id, first_name, last_name)")
                .eq("organization_id", value: organizationId)
                .order("last_message_at", ascending: false)
                .execute().value
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct StaffMessagingView: View {
    @EnvironmentObject private var staff: CurrentStaffService
    @StateObject private var vm = StaffMessagingViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(spacing: SnoutTheme.Spacing.sm) {
                    if vm.isLoading && vm.conversations.isEmpty {
                        ProgressView().tint(SnoutTheme.accent).frame(maxWidth: .infinity).padding(.top, SnoutTheme.Spacing.xxl)
                    } else if vm.conversations.isEmpty {
                        emptyState
                    } else {
                        ForEach(vm.conversations) { c in
                            NavigationLink { StaffThreadView(conversation: c) } label: { row(c) }
                                .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, SnoutTheme.Spacing.xl)
                .padding(.top, SnoutTheme.Spacing.sm)
            }
            .scrollContentBackground(.hidden)
            .refreshable { await reload() }
        }
        .task { await reload() }
    }

    private func reload() async {
        guard let org = staff.organizationId else { return }
        await vm.load(organizationId: org)
    }

    private func row(_ c: ConversationRow) -> some View {
        HStack(spacing: SnoutTheme.Spacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(c.ownerName.isEmpty ? "Pet parent" : c.ownerName)
                    .font(SnoutTheme.body(16, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
                if let p = c.lastMessagePreview, !p.isEmpty {
                    Text(p).font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted).lineLimit(1)
                }
            }
            Spacer()
            if c.unreadStaff > 0 {
                Text("\(c.unreadStaff)")
                    .font(SnoutTheme.labelSM).foregroundStyle(SnoutTheme.onAccent)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(SnoutTheme.accent).clipShape(Capsule())
            }
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.sm) {
            Image(systemName: "message").font(.system(size: 28)).foregroundStyle(SnoutTheme.onSurfaceFaint)
            Text("No conversations yet").font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurfaceMuted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, SnoutTheme.Spacing.xxl)
    }
}

// MARK: - Thread

@MainActor
final class StaffThreadViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var isLoading = false
    @Published var isSending = false
    @Published var error: String?

    private let client = SupabaseClientProvider.shared

    func load(conversationId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            messages = try await client.from("messages")
                .select()
                .eq("conversation_id", value: conversationId)
                .order("created_at", ascending: true)
                .execute().value
            await markRead(conversationId: conversationId)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func send(_ body: String, conversationId: String, senderId: String?) async {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let senderId else { return }
        isSending = true
        defer { isSending = false }
        struct Insert: Encodable {
            let conversation_id: String
            let sender_id: String
            let sender_type: String
            let body: String
        }
        do {
            try await client.from("messages")
                .insert(Insert(conversation_id: conversationId, sender_id: senderId, sender_type: "staff", body: trimmed))
                .execute()
            await load(conversationId: conversationId)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func markRead(conversationId: String) async {
        struct Patch: Encodable { let unread_staff: Int }
        _ = try? await client.from("conversations").update(Patch(unread_staff: 0)).eq("id", value: conversationId).execute()
    }
}

struct StaffThreadView: View {
    let conversation: ConversationRow
    @EnvironmentObject private var staff: CurrentStaffService
    @StateObject private var vm = StaffThreadViewModel()
    @State private var draft = ""

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: SnoutTheme.Spacing.sm) {
                            ForEach(vm.messages) { m in bubble(m).id(m.id) }
                        }
                        .padding(SnoutTheme.Spacing.lg)
                    }
                    .scrollContentBackground(.hidden)
                    .onChange(of: vm.messages.count) { _, _ in
                        if let last = vm.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                    }
                }
                composer
            }
        }
        .navigationTitle(conversation.ownerName.isEmpty ? "Conversation" : conversation.ownerName)
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load(conversationId: conversation.id) }
    }

    private func bubble(_ m: Message) -> some View {
        let isStaff = m.senderType == .staff
        return HStack {
            if isStaff { Spacer(minLength: SnoutTheme.Spacing.xl) }
            VStack(alignment: isStaff ? .trailing : .leading, spacing: 2) {
                if !m.body.isEmpty {
                    Text(m.body)
                        .font(SnoutTheme.bodyMD)
                        .foregroundStyle(isStaff ? SnoutTheme.onAccent : SnoutTheme.onSurface)
                        .padding(.horizontal, SnoutTheme.Spacing.md).padding(.vertical, SnoutTheme.Spacing.sm)
                        .background(isStaff ? SnoutTheme.accent : SnoutTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
                }
                ForEach(m.attachments) { att in
                    Text(att.isImage ? "📷 \(att.name)" : "📎 \(att.name)")
                        .font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                Text(m.createdAt.formatted(.dateTime.hour().minute()))
                    .font(SnoutTheme.labelSM).foregroundStyle(SnoutTheme.onSurfaceFaint)
            }
            if !isStaff { Spacer(minLength: SnoutTheme.Spacing.xl) }
        }
    }

    private var composer: some View {
        HStack(spacing: SnoutTheme.Spacing.sm) {
            TextField("Message…", text: $draft, axis: .vertical)
                .lineLimit(1...4)
                .font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurface)
                .padding(.horizontal, SnoutTheme.Spacing.md).padding(.vertical, SnoutTheme.Spacing.sm)
                .background(SnoutTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous).stroke(SnoutTheme.divider, lineWidth: 1))
            Button {
                let body = draft; draft = ""
                Task { await vm.send(body, conversationId: conversation.id, senderId: staff.profileId) }
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 30))
                    .foregroundStyle(canSend ? SnoutTheme.accent : SnoutTheme.onSurfaceFaint)
            }
            .buttonStyle(.plain).disabled(!canSend)
        }
        .padding(SnoutTheme.Spacing.md)
        .background(SnoutTheme.background)
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !vm.isSending
    }
}
