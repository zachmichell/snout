//
//  ConversationView.swift
//  Snout
//
//  Brand-tinted thread view with attachment support (images + PDFs).
//
//  Sending an attachment:
//    1. Tap the paperclip → confirmationDialog with Photo / Document.
//    2. Photo picks an image from the library; Document opens .fileImporter
//       restricted to PDFs (we deliberately don't accept arbitrary types
//       to keep the inbox manageable for staff).
//    3. The picked file is uploaded to the `message-attachments` storage
//       bucket immediately. While uploading it appears as a chip with a
//       progress spinner above the text composer.
//    4. The user can keep typing, pick more attachments, or tap a chip's ✕
//       to remove it before sending.
//    5. Tap Send → a `messages` row is inserted with body (may be empty if
//       attachments-only) plus the attachments JSON array.
//
//  Rendering an attachment:
//    - Images: thumbnail inside the bubble, tap to open fullscreen.
//    - Documents: chip with paperclip + filename + size, tap to open in
//      the system QuickLook preview.
//

import SwiftUI
import UIKit
import Supabase
import PhotosUI
import QuickLook

// MARK: - Pending-upload state for the composer

/// One in-flight attachment chip in the composer. Holds local bytes so we
/// can show a preview while the upload runs, plus the eventual remote
/// metadata once the upload completes.
struct PendingAttachment: Identifiable, Equatable {
    enum Kind: String { case image, document }
    enum Status: Equatable {
        case uploading
        case uploaded(MessageAttachment)
        case failed(String)
    }

    let id = UUID()
    let kind: Kind
    let mimeType: String
    let name: String
    let sizeBytes: Int
    /// For images: original (compressed) JPEG so we can show a preview chip
    /// while the upload runs. nil for documents (we don't preview PDFs).
    let imageData: Data?
    var status: Status

    var isUploaded: Bool {
        if case .uploaded = status { return true }
        return false
    }
    var attachment: MessageAttachment? {
        if case .uploaded(let a) = status { return a }
        return nil
    }

    static func == (lhs: PendingAttachment, rhs: PendingAttachment) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - View model

@MainActor
final class ConversationViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var draft: String = ""
    @Published var isSending: Bool = false
    @Published var loadError: String?

    /// Attachments the user has picked but not yet sent.
    @Published var pendingAttachments: [PendingAttachment] = []

    private let client = SupabaseClientProvider.shared
    private var realtimeChannel: RealtimeChannelV2?

    /// Bucket attachments live in. Private — signed URLs only.
    private static let bucket = "message-attachments"
    /// Signed URL TTL when minting a per-attachment URL on send. 7 days
    /// strikes a balance between not minting on every render and not
    /// outliving practical staleness for a chat thread.
    private static let signedUrlTTL: Int = 60 * 60 * 24 * 7

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

    /// Marks every unread staff message in this conversation as read AND
    /// zeros out conversations.unread_owner — atomically — by calling the
    /// `mark_conversation_read_by_owner` RPC.
    func markAsRead(conversationId: String) async {
        struct Params: Encodable { let p_conversation_id: String }
        do {
            try await client
                .rpc("mark_conversation_read_by_owner",
                     params: Params(p_conversation_id: conversationId))
                .execute()
        } catch {
            #if DEBUG
            print("[ConversationViewModel] markAsRead failed: \(error)")
            #endif
        }
    }

    // MARK: - Attachment picking + upload

    /// Stage an image picked from PhotosPicker. Compresses to ~1600px on
    /// the longest edge and JPEG-encodes at 0.85 — small enough for fast
    /// uploads on cell signal, large enough to look fine fullscreen on
    /// modern devices. Then kicks off the upload.
    func ingestPickedImage(data: Data, organizationId: String, conversationId: String) {
        guard let jpeg = compressForUpload(data) else { return }
        let pending = PendingAttachment(
            kind: .image,
            mimeType: "image/jpeg",
            name: "photo-\(Int(Date().timeIntervalSince1970)).jpg",
            sizeBytes: jpeg.count,
            imageData: jpeg,
            status: .uploading
        )
        pendingAttachments.append(pending)
        Task { await upload(pending: pending,
                            data: jpeg,
                            organizationId: organizationId,
                            conversationId: conversationId) }
    }

    /// Stage a PDF (or other document) picked via .fileImporter.
    func ingestPickedDocument(url: URL, organizationId: String, conversationId: String) {
        // The fileImporter hands us a security-scoped URL; we have to
        // beg Foundation's permission before reading.
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        let pending = PendingAttachment(
            kind: .document,
            mimeType: mimeType(forExtension: url.pathExtension),
            name: url.lastPathComponent,
            sizeBytes: data.count,
            imageData: nil,
            status: .uploading
        )
        pendingAttachments.append(pending)
        Task { await upload(pending: pending,
                            data: data,
                            organizationId: organizationId,
                            conversationId: conversationId) }
    }

    /// Drop a chip the user no longer wants in the message. If it's already
    /// uploaded, best-effort delete the storage object so we don't leak.
    func cancel(_ pending: PendingAttachment) {
        if let attachment = pending.attachment {
            Task {
                try? await client.storage
                    .from(Self.bucket)
                    .remove(paths: [attachment.path])
            }
        }
        pendingAttachments.removeAll { $0.id == pending.id }
    }

    /// True when the composer can send: either a non-empty body, or at
    /// least one attachment that has finished uploading. Failed uploads
    /// don't count.
    var canSend: Bool {
        let hasText = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let hasUploaded = pendingAttachments.contains { $0.isUploaded }
        let hasInFlight = pendingAttachments.contains { $0.status == .uploading }
        return (hasText || hasUploaded) && !hasInFlight
    }

    private func upload(
        pending: PendingAttachment,
        data: Data,
        organizationId: String,
        conversationId: String
    ) async {
        let safeName = pending.name.replacingOccurrences(of: "/", with: "_")
        let path = "\(organizationId)/\(conversationId)/\(Int(Date().timeIntervalSince1970 * 1000))-\(safeName)"
        let opts = FileOptions(contentType: pending.mimeType, upsert: false)

        do {
            _ = try await client.storage
                .from(Self.bucket)
                .upload(path, data: data, options: opts)

            // Bucket is private — mint a signed URL we can persist on the
            // message JSON. Failed render fallback: a future polish turn
            // can re-mint on 403 by `path`.
            let signed = try await client.storage
                .from(Self.bucket)
                .createSignedURL(path: path, expiresIn: Self.signedUrlTTL)

            let attachment = MessageAttachment(
                path: path,
                url: signed.absoluteString,
                mimeType: pending.mimeType,
                sizeBytes: pending.sizeBytes,
                name: pending.name,
                kind: pending.kind.rawValue
            )
            updateStatus(for: pending.id, to: .uploaded(attachment))
        } catch {
            updateStatus(for: pending.id, to: .failed(error.localizedDescription))
        }
    }

    private func updateStatus(for id: UUID, to status: PendingAttachment.Status) {
        if let idx = pendingAttachments.firstIndex(where: { $0.id == id }) {
            var updated = pendingAttachments[idx]
            updated.status = status
            pendingAttachments[idx] = updated
        }
    }

    // MARK: - Send

    func send(conversationId: String) async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let attachments: [MessageAttachment] = pendingAttachments.compactMap { $0.attachment }
        // Body is NOT NULL in Postgres; if the user is sending attachments-
        // only we still need to write the empty string.
        guard !body.isEmpty || !attachments.isEmpty else { return }
        isSending = true
        defer { isSending = false }
        do {
            let user = try await client.auth.user()
            struct NewMessage: Encodable {
                let conversation_id: String
                let sender_id: String
                let sender_type: String
                let body: String
                let attachments: [MessageAttachment]
            }
            let payload = NewMessage(
                conversation_id: conversationId,
                sender_id: user.id.uuidString.lowercased(),
                sender_type: "owner",
                body: body,
                attachments: attachments
            )
            try await client.from("messages").insert(payload).execute()
            draft = ""
            pendingAttachments.removeAll()
        } catch {
            loadError = error.localizedDescription
        }
    }

    // MARK: - Helpers

    private func compressForUpload(_ data: Data, maxSide: CGFloat = 1600, quality: CGFloat = 0.85) -> Data? {
        guard let src = UIImage(data: data) else { return nil }
        let w = src.size.width, h = src.size.height
        let longest = max(w, h)
        let scale = longest > maxSide ? maxSide / longest : 1.0
        let target = CGSize(width: floor(w * scale), height: floor(h * scale))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        let resized = renderer.image { _ in
            src.draw(in: CGRect(origin: .zero, size: target))
        }
        return resized.jpegData(compressionQuality: quality)
    }

    private func mimeType(forExtension ext: String) -> String {
        switch ext.lowercased() {
        case "pdf":  return "application/pdf"
        case "png":  return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "heic": return "image/heic"
        default:     return "application/octet-stream"
        }
    }
}

// MARK: - View

struct ConversationView: View {
    let conversation: Conversation
    let orgName: String?
    @StateObject private var vm = ConversationViewModel()
    @EnvironmentObject private var unread: UnreadMessagesService
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @EnvironmentObject private var tabBar: TabBarVisibility

    @State private var photoPickerItem: PhotosPickerItem?
    @State private var showAttachmentPicker: Bool = false
    @State private var showDocumentPicker: Bool = false
    @State private var fullscreenImageURL: URL?

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
            await vm.markAsRead(conversationId: conversation.id)
            await unread.refresh(ownerId: currentOwner.ownerId)
            await vm.subscribe(conversationId: conversation.id)
        }
        // Tap-image fullscreen viewer.
        .fullScreenCover(item: Binding(
            get: { fullscreenImageURL.map { FullscreenImage(url: $0) } },
            set: { fullscreenImageURL = $0?.url }
        )) { wrapper in
            FullscreenImageView(url: wrapper.url) {
                fullscreenImageURL = nil
            }
        }
        // Document picker (PDF) — fileImporter is SwiftUI-native.
        .fileImporter(
            isPresented: $showDocumentPicker,
            allowedContentTypes: [.pdf],
            allowsMultipleSelection: false
        ) { result in
            guard
                let org = currentOwner.organizationId,
                case .success(let urls) = result,
                let url = urls.first
            else { return }
            vm.ingestPickedDocument(url: url, organizationId: org, conversationId: conversation.id)
        }
        // Confirmation dialog: Photo vs Document.
        .confirmationDialog("Add attachment", isPresented: $showAttachmentPicker, titleVisibility: .visible) {
            // PhotosPicker wrapped as a confirmationDialog button via a
            // custom container — when the user taps Photo we just flip a
            // flag the picker observes via `isPresented:`, which doesn't
            // work directly with PhotosPicker, so we use a labeled
            // PhotosPicker INSIDE the dialog.
            // SwiftUI dialog doesn't render PhotosPicker directly; instead
            // we present the picker as a sheet by simulating a button tap.
            // Easiest path: use Button + state flag.
            Button("Photo") {
                // PhotosPicker is bound to a state below; we set a flag
                // and the picker is rendered as a sheet.
                presentPhotoPicker = true
            }
            Button("Document (PDF)") { showDocumentPicker = true }
            Button("Cancel", role: .cancel) {}
        }
        // PhotosPicker as a sheet via state; iOS handles its own UI.
        .photosPicker(
            isPresented: $presentPhotoPicker,
            selection: $photoPickerItem,
            matching: .images,
            photoLibrary: .shared()
        )
        .onChange(of: photoPickerItem) { _, newItem in
            guard let item = newItem, let org = currentOwner.organizationId else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    vm.ingestPickedImage(data: data, organizationId: org, conversationId: conversation.id)
                }
                photoPickerItem = nil
            }
        }
    }

    @State private var presentPhotoPicker: Bool = false

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
                    ForEach(vm.messages) { message in
                        MessageBubbleRow(message: message,
                                         onTapImage: { url in fullscreenImageURL = url })
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
        VStack(spacing: SnoutTheme.Spacing.sm) {
            // Pending attachments strip — only renders when there's
            // something queued. Horizontal scroll so the composer never
            // overflows the screen even if the parent picks five PDFs.
            if !vm.pendingAttachments.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: SnoutTheme.Spacing.sm) {
                        ForEach(vm.pendingAttachments) { pending in
                            PendingAttachmentChip(pending: pending) {
                                vm.cancel(pending)
                            }
                        }
                    }
                    .padding(.horizontal, SnoutTheme.Spacing.md)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(alignment: .bottom, spacing: SnoutTheme.Spacing.sm) {
                Button {
                    showAttachmentPicker = true
                } label: {
                    SnoutGlyph("paperclip", size: 18, weight: .semibold)
                        .foregroundStyle(SnoutTheme.onSurface)
                        .frame(width: 40, height: 40)
                        .background(SnoutTheme.background)
                        .clipShape(Circle())
                        .overlay(Circle().stroke(SnoutTheme.divider, lineWidth: 1))
                }
                .buttonStyle(.plain)

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
                    SnoutGlyph("arrow.up", size: 16, weight: .bold)
                        .foregroundStyle(SnoutTheme.onAccent)
                        .frame(width: 40, height: 40)
                        .background(vm.canSend ? SnoutTheme.accent : SnoutTheme.onSurfaceFaint)
                        .clipShape(Circle())
                }
                .disabled(!vm.canSend || vm.isSending)
            }
            .padding(.horizontal, SnoutTheme.Spacing.md)
        }
        .padding(.vertical, SnoutTheme.Spacing.sm)
        .background(SnoutTheme.surface)
        .overlay(
            Rectangle()
                .fill(SnoutTheme.divider)
                .frame(height: 1),
            alignment: .top
        )
    }
}

/// Wrapper so `fullScreenCover(item:)` has an Identifiable to bind to.
private struct FullscreenImage: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

// MARK: - Pending attachment chip

private struct PendingAttachmentChip: View {
    let pending: PendingAttachment
    let onCancel: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            content
                .frame(width: 96, height: 96)
                .background(SnoutTheme.background)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous)
                        .stroke(SnoutTheme.divider, lineWidth: 1)
                )

            Button(action: onCancel) {
                SnoutGlyph("xmark", size: 10, weight: .bold)
                    .foregroundStyle(SnoutTheme.onAccent)
                    .frame(width: 22, height: 22)
                    .background(SnoutTheme.destructive)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .offset(x: 6, y: -6)
        }
        // Status overlay: spinner while uploading, banner if failed.
        .overlay {
            switch pending.status {
            case .uploading:
                ZStack {
                    Color.black.opacity(0.25)
                    ProgressView().tint(.white)
                }
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
            case .failed:
                ZStack {
                    Color.black.opacity(0.4)
                    SnoutGlyph("exclamationmark.triangle.fill", size: 18, weight: .semibold)
                        .foregroundStyle(.white)
                }
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
            case .uploaded:
                EmptyView()
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch pending.kind {
        case .image:
            if let data = pending.imageData, let img = UIImage(data: data) {
                Image(uiImage: img)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 96, height: 96)
                    .clipped()
            } else {
                placeholderContent(symbol: "photo")
            }
        case .document:
            VStack(spacing: 4) {
                Image(systemName: "doc.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                Text(pending.name)
                    .font(SnoutTheme.body(11, weight: .medium))
                    .foregroundStyle(SnoutTheme.onSurface)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 4)
            }
        }
    }

    private func placeholderContent(symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 28))
            .foregroundStyle(SnoutTheme.onSurfaceMuted)
    }
}

// MARK: - Message bubble (now with attachments)

struct MessageBubbleRow: View {
    let message: Message
    var onTapImage: (URL) -> Void = { _ in }

    @State private var documentPreviewURL: URL?

    var isOwner: Bool { message.senderType == .owner }

    var body: some View {
        HStack {
            if isOwner { Spacer(minLength: 48) }
            VStack(alignment: isOwner ? .trailing : .leading, spacing: 4) {
                bubble
                Text(timeLabel)
                    .font(SnoutTheme.caption)
                    .foregroundStyle(SnoutTheme.onSurfaceFaint)
                    .padding(.horizontal, 6)
            }
            if !isOwner { Spacer(minLength: 48) }
        }
        .quickLookPreview($documentPreviewURL)
    }

    @ViewBuilder
    private var bubble: some View {
        // Attachments-only message: render the attachments without bubble
        // chrome so a single image fills the side cleanly. With body too,
        // we wrap everything in the bubble.
        if message.body.isEmpty && !message.attachments.isEmpty {
            attachmentStack
        } else {
            VStack(alignment: isOwner ? .trailing : .leading, spacing: SnoutTheme.Spacing.xs) {
                if !message.body.isEmpty {
                    Text(message.body)
                        .font(SnoutTheme.bodyMD)
                        .foregroundStyle(isOwner ? SnoutTheme.onAccent : SnoutTheme.onSurface)
                        .frame(maxWidth: .infinity, alignment: isOwner ? .trailing : .leading)
                }
                if !message.attachments.isEmpty {
                    attachmentStack
                }
            }
            .padding(.horizontal, SnoutTheme.Spacing.lg)
            .padding(.vertical, SnoutTheme.Spacing.md)
            .background(isOwner ? SnoutTheme.accent : SnoutTheme.cotton.opacity(0.55))
            .clipShape(BubbleShape(isOwner: isOwner))
        }
    }

    @ViewBuilder
    private var attachmentStack: some View {
        VStack(alignment: isOwner ? .trailing : .leading, spacing: SnoutTheme.Spacing.xs) {
            ForEach(message.attachments) { att in
                if att.isImage, let url = URL(string: att.url) {
                    Button {
                        onTapImage(url)
                    } label: {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image.resizable().scaledToFill()
                            case .empty:
                                Color.black.opacity(0.05)
                            case .failure:
                                ZStack {
                                    Color.black.opacity(0.05)
                                    Image(systemName: "photo")
                                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                                }
                            @unknown default:
                                Color.black.opacity(0.05)
                            }
                        }
                        .frame(width: 220, height: 220)
                        .clipped()
                        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusTile, style: .continuous))
                    }
                    .buttonStyle(.plain)
                } else if att.isDocument, let url = URL(string: att.url) {
                    Button {
                        downloadAndPreview(url: url, name: att.name)
                    } label: {
                        documentChip(att, isOwner: isOwner)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func documentChip(_ att: MessageAttachment, isOwner: Bool) -> some View {
        HStack(spacing: SnoutTheme.Spacing.sm) {
            ZStack {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isOwner ? Color.white.opacity(0.25) : SnoutTheme.surface)
                    .frame(width: 32, height: 40)
                Image(systemName: "doc.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(isOwner ? SnoutTheme.onAccent : SnoutTheme.onSurfaceMuted)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(att.name)
                    .font(SnoutTheme.body(13, weight: .semibold))
                    .foregroundStyle(isOwner ? SnoutTheme.onAccent : SnoutTheme.onSurface)
                    .lineLimit(2)
                Text(formatBytes(att.sizeBytes))
                    .font(SnoutTheme.caption)
                    .foregroundStyle(isOwner ? SnoutTheme.onAccent.opacity(0.7) : SnoutTheme.onSurfaceMuted)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, SnoutTheme.Spacing.md)
        .padding(.vertical, SnoutTheme.Spacing.sm)
        .frame(maxWidth: 260)
    }

    /// Pull the file down to a temp URL so QuickLook can render it. Apple's
    /// preview controller won't accept network URLs; it needs a local file.
    private func downloadAndPreview(url: URL, name: String) {
        Task {
            do {
                let (data, _) = try await URLSession.shared.data(from: url)
                let tmp = FileManager.default.temporaryDirectory
                    .appendingPathComponent(UUID().uuidString + "-" + name)
                try data.write(to: tmp)
                await MainActor.run { documentPreviewURL = tmp }
            } catch {
                // No-op: a future polish turn could surface a toast.
            }
        }
    }

    private func formatBytes(_ bytes: Int) -> String {
        let kb = Double(bytes) / 1024.0
        if kb < 1024 { return String(format: "%.0f KB", kb) }
        return String(format: "%.1f MB", kb / 1024.0)
    }

    private var timeLabel: String {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f.string(from: message.createdAt)
    }
}

// MARK: - Bubble shape (unchanged from prior version)

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

// MARK: - Fullscreen image viewer

private struct FullscreenImageView: View {
    let url: URL
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit()
                case .failure:
                    Image(systemName: "photo")
                        .font(.system(size: 48))
                        .foregroundStyle(.white)
                case .empty:
                    ProgressView().tint(.white)
                @unknown default:
                    EmptyView()
                }
            }
            .padding()

            VStack {
                HStack {
                    Spacer()
                    Button {
                        onDismiss()
                    } label: {
                        SnoutGlyph("xmark", size: 14, weight: .bold)
                            .foregroundStyle(.white)
                            .frame(width: 36, height: 36)
                            .background(Color.white.opacity(0.2))
                            .clipShape(Circle())
                    }
                    .padding()
                }
                Spacer()
            }
        }
    }
}
