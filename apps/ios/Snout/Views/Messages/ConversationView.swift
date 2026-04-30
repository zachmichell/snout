//
//  ConversationView.swift
//  Snout
//
//  Brand-tinted thread view. Owner messages right-aligned in accent fill;
//  staff messages left-aligned in Cotton tinted bubbles. Day separators between
//  message clusters.
//

import SwiftUI
import Supabase

@MainActor
final class ConversationViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var draft: String = ""
    @Published var isSending: Bool = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared
    private var realtimeChannel: RealtimeChannelV2?

    func load(conversationId: String) async {
        do {
            let rows: [Message] = try await client
                .from("messages")
                .select()
                .eq("conversation_id", value: conversationId)
                .order("created_at", ascending: true)
                .limit(200)
                .execute()
                .value
            messages = rows
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    func subscribe(conversationId: String) async {
        if let channel = realtimeChannel {
            await channel.unsubscribe()
            realtimeChannel = nil
        }
        let channel = client.realtimeV2.channel("messages:\(conversationId)")
        let inserts = channel.postgresChange(
            InsertAction.self,
            schema: "public",
            table: "messages",
            filter: .eq("conversation_id", value: conversationId)
        )
        try? await channel.subscribeWithError()
        realtimeChannel = channel

        Task { [weak self] in
            for await _ in inserts {
                guard let self else { break }
                await self.load(conversationId: conversationId)
            }
        }
    }

    func unsubscribe() async {
        if let channel = realtimeChannel {
            await channel.unsubscribe()
            realtimeChannel = nil
        }
    }

    /// Marks every unread staff message in this conversation as read AND zeros
    /// out conversations.unread_owner — atomically — by calling the
    /// `mark_conversation_read_by_owner` RPC. The RPC is SECURITY DEFINER and
    /// authorizes the caller against `auth.uid()`, so it's safe to invoke any
    /// time the conversation view appears.
    func markAsRead(conversationId: String) async {
        struct Params: Encodable { let p_conversation_id: String }
        do {
            try await client
                .rpc("mark_conversation_read_by_owner",
                     params: Params(p_conversation_id: conversationId))
                .execute()
        } catch {
            // Non-fatal: leave the unread state alone if the call fails so we
            // don't visually claim "read" when the server didn't agree.
            #if DEBUG
            print("[ConversationViewModel] markAsRead failed: \(error)")
            #endif
        }
    }

    func send(conversationId: String) async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        isSending = true
        defer { isSending = false }
        do {
            let user = try await client.auth.user()
            struct NewMessage: Encodable {
                let conversation_id: String
                let sender_id: String
                let sender_type: String
                let body: String
            }
            let payload = NewMessage(
                conversation_id: conversationId,
                sender_id: user.id.uuidString.lowercased(),
                sender_type: "owner",
                body: body
            )
            try await client.from("messages").insert(payload).execute()
            draft = ""
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct ConversationView: View {
    let conversation: Conversation
    let orgName: String?
    @StateObject private var vm = ConversationViewModel()
    // Pulled from the environment so we can refresh the tab-bar unread badge
    // immediately after the RPC zeroes out unread_owner on the server.
    @EnvironmentObject private var unread: UnreadMessagesService
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    // Hide the floating tab bar while the user is in a conversation so the
    // composer has room and isn't covered by chrome. Restored on dismiss.
    @EnvironmentObject private var tabBar: TabBarVisibility

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            VStack(spacing: 0) {
                messageList
                composer
            }
        }
        .navigationTitle(orgName ?? "Your facility")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear  { tabBar.isVisible = false }
        .onDisappear {
            tabBar.isVisible = true
            Task { await vm.unsubscribe() }
        }
        .task {
            await vm.load(conversationId: conversation.id)
            // Mark as read BEFORE refreshing the badge so the badge reads the
            // post-update unread_owner value.
            await vm.markAsRead(conversationId: conversation.id)
            await unread.refresh(ownerId: currentOwner.ownerId)
            await vm.subscribe(conversationId: conversation.id)
        }
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
                    ForEach(vm.messages) { message in
                        MessageBubbleRow(message: message)
                            .id(message.id)
                    }
                }
                .padding(.horizontal, SnoutTheme.Spacing.lg)
                .padding(.vertical, SnoutTheme.Spacing.lg)
            }
            .scrollContentBackground(.hidden)
            .onChange(of: vm.messages.count) { _, _ in
                if let last = vm.messages.last?.id {
                    withAnimation { proxy.scrollTo(last, anchor: .bottom) }
                }
            }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: SnoutTheme.Spacing.sm) {
            TextField("Message", text: $vm.draft, axis: .vertical)
                .lineLimit(1...4)
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurface)
                .padding(SnoutTheme.Spacing.md)
                .background(SnoutTheme.background)
                .overlay(
                    RoundedRectangle(cornerRadius: SnoutTheme.radiusPill, style: .continuous)
                        .stroke(SnoutTheme.divider, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusPill, style: .continuous))

            Button {
                Task { await vm.send(conversationId: conversation.id) }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(SnoutTheme.onAccent)
                    .frame(width: 40, height: 40)
                    .background(canSend ? SnoutTheme.accent : SnoutTheme.onSurfaceFaint)
                    .clipShape(Circle())
            }
            .disabled(!canSend || vm.isSending)
        }
        .padding(.horizontal, SnoutTheme.Spacing.md)
        .padding(.vertical, SnoutTheme.Spacing.sm)
        .background(SnoutTheme.surface)
        .overlay(
            Rectangle()
                .fill(SnoutTheme.divider)
                .frame(height: 1),
            alignment: .top
        )
    }

    private var canSend: Bool {
        !vm.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct MessageBubbleRow: View {
    let message: Message

    var isOwner: Bool { message.senderType == .owner }

    var body: some View {
        HStack {
            if isOwner { Spacer(minLength: 48) }
            VStack(alignment: isOwner ? .trailing : .leading, spacing: 4) {
                Text(message.body)
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(isOwner ? SnoutTheme.onAccent : SnoutTheme.onSurface)
                    .padding(.horizontal, SnoutTheme.Spacing.lg)
                    .padding(.vertical, SnoutTheme.Spacing.md)
                    .background(isOwner ? SnoutTheme.accent : SnoutTheme.cotton.opacity(0.55))
                    .clipShape(BubbleShape(isOwner: isOwner))
                Text(timeLabel)
                    .font(SnoutTheme.caption)
                    .foregroundStyle(SnoutTheme.onSurfaceFaint)
                    .padding(.horizontal, 6)
            }
            if !isOwner { Spacer(minLength: 48) }
        }
    }

    private var timeLabel: String {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f.string(from: message.createdAt)
    }
}

private struct BubbleShape: Shape {
    let isOwner: Bool

    func path(in rect: CGRect) -> Path {
        let radius: CGFloat = SnoutTheme.radiusTile
        let smallRadius: CGFloat = 4
        let topLeft     = isOwner ? radius : radius
        let topRight    = isOwner ? radius : radius
        let bottomLeft  = isOwner ? radius : smallRadius
        let bottomRight = isOwner ? smallRadius : radius

        var path = Path()
        path.move(to: CGPoint(x: rect.minX + topLeft, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - topRight, y: rect.minY))
        path.addArc(center: CGPoint(x: rect.maxX - topRight, y: rect.minY + topRight),
                    radius: topRight, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - bottomRight))
        path.addArc(center: CGPoint(x: rect.maxX - bottomRight, y: rect.maxY - bottomRight),
                    radius: bottomRight, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        path.addLine(to: CGPoint(x: rect.minX + bottomLeft, y: rect.maxY))
        path.addArc(center: CGPoint(x: rect.minX + bottomLeft, y: rect.maxY - bottomLeft),
                    radius: bottomLeft, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + topLeft))
        path.addArc(center: CGPoint(x: rect.minX + topLeft, y: rect.minY + topLeft),
                    radius: topLeft, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        path.closeSubpath()
        return path
    }
}
