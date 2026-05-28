//
//  StaffReportCardEditor.swift
//  Snout Staff
//
//  Author / edit a pet's report card for a visit. Mirrors the web
//  ReportCardEditor: pick a template (or classic), fill fields, write a
//  summary, attach photos (library + camera), then Save draft or Publish.
//  Filled template sections are snapshotted onto report_cards.custom_sections
//  so owners / the client app render them without a join (same shape the
//  web + iOS render paths already read).
//

import SwiftUI
import PhotosUI
import UIKit
import Supabase

// MARK: - Template definition models (report_card_templates.sections)

struct RCTemplate: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let sections: [RCTemplateSection]
}
struct RCTemplateSection: Decodable, Hashable {
    let id: String
    let title: String
    let fields: [RCTemplateField]
}
struct RCTemplateField: Decodable, Hashable {
    let id: String
    let label: String
    let type: String          // text | textarea | select | rating | boolean
    let options: [String]?
}

// Classic overall-rating options (match the web RATING_OPTIONS values so the
// owner side renders them consistently).
private let kRatingOptions: [(value: String, label: String, emoji: String)] = [
    ("excellent", "Excellent", "🌟"),
    ("good", "Good", "😊"),
    ("fair", "Fair", "🙂"),
    ("needs_attention", "Needs attention", "⚠️"),
]

private let kMaxPhotos = 5

// MARK: - Filled output (encoded into custom_sections)

private struct FilledFieldOut: Encodable {
    let label: String
    let type: String
    let value: ReportCardFieldValue
    let options: [String]?
}
private struct FilledSectionOut: Encodable {
    let title: String
    let fields: [FilledFieldOut]
}

// MARK: - View model

@MainActor
final class StaffReportCardEditorViewModel: ObservableObject {
    @Published var templates: [RCTemplate] = []
    @Published var templateId: String?       // nil = classic
    @Published var fieldValues: [String: ReportCardFieldValue] = [:]
    @Published var rating: String = ""
    @Published var summary: String = ""
    @Published var existingPhotos: [String] = []
    @Published var photoSignedURLs: [String: URL] = [:]
    @Published var pendingJPEGs: [Data] = []
    @Published var existingCardId: String?
    @Published var isPublished = false
    @Published var isLoading = false
    @Published var isSaving = false
    @Published var error: String?
    @Published var didFinish = false

    private let client = SupabaseClientProvider.shared
    private static let bucket = "report-card-photos"

    var usingTemplate: Bool { templateId != nil }
    var photoCount: Int { existingPhotos.count + pendingJPEGs.count }

    func load(visit: PetVisit, organizationId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            // Templates for the org.
            templates = try await client.from("report_card_templates")
                .select("id, name, sections")
                .eq("organization_id", value: organizationId)
                .is("deleted_at", value: nil)
                .eq("active", value: true)
                .order("name")
                .execute().value

            // Existing card for this reservation + pet, if any.
            struct CardRow: Decodable {
                let id: String
                let overall_rating: String?
                let summary: String?
                let photo_urls: [String]?
                let template_id: String?
                let published: Bool
            }
            let cards: [CardRow] = try await client.from("report_cards")
                .select("id, overall_rating, summary, photo_urls, template_id, published")
                .eq("reservation_id", value: visit.reservationId)
                .eq("pet_id", value: visit.petId)
                .limit(1)
                .execute().value

            if let c = cards.first {
                existingCardId = c.id
                rating = c.overall_rating ?? ""
                summary = c.summary ?? ""
                existingPhotos = c.photo_urls ?? []
                isPublished = c.published
                templateId = c.template_id
                await signExistingPhotos()
                if c.template_id != nil { hydrateFieldValuesForCurrentTemplate() }
            } else if let def = templates.first(where: { _ in false }) {
                _ = def // no default-template concept here; staff picks
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func applyTemplate(_ id: String?) {
        templateId = id
        fieldValues = [:]
        if let id, let tpl = templates.first(where: { $0.id == id }) {
            for section in tpl.sections {
                for f in section.fields {
                    fieldValues[f.id] = blankValue(for: f.type)
                }
            }
        }
    }

    private func hydrateFieldValuesForCurrentTemplate() {
        guard let id = templateId, let tpl = templates.first(where: { $0.id == id }) else { return }
        for section in tpl.sections {
            for f in section.fields where fieldValues[f.id] == nil {
                fieldValues[f.id] = blankValue(for: f.type)
            }
        }
    }

    private func blankValue(for type: String) -> ReportCardFieldValue {
        switch type {
        case "boolean": return .bool(false)
        case "rating":  return .number(0)
        default:        return .text("")
        }
    }

    func setValue(_ value: ReportCardFieldValue, for fieldId: String) {
        fieldValues[fieldId] = value
    }

    // MARK: Photos

    func ingest(_ data: Data) {
        guard photoCount < kMaxPhotos, let jpeg = Self.compress(data) else { return }
        pendingJPEGs.append(jpeg)
    }
    func removeExisting(_ path: String) { existingPhotos.removeAll { $0 == path } }
    func removePending(at index: Int) { if pendingJPEGs.indices.contains(index) { pendingJPEGs.remove(at: index) } }

    private func signExistingPhotos() async {
        guard !existingPhotos.isEmpty else { return }
        do {
            let signed = try await client.storage.from(Self.bucket)
                .createSignedURLs(paths: existingPhotos, expiresIn: 3600)
            // Results come back in the same order as the requested paths.
            var map: [String: URL] = [:]
            for (i, s) in signed.enumerated() where existingPhotos.indices.contains(i) {
                if let u = s.signedURL { map[existingPhotos[i]] = u }
            }
            photoSignedURLs = map
        } catch { /* non-fatal */ }
    }

    // MARK: Save

    func save(publish: Bool, visit: PetVisit, organizationId: String, userId: String?) async {
        isSaving = true
        defer { isSaving = false }
        error = nil
        do {
            // 1. Upload pending photos.
            var finalPaths = existingPhotos
            for jpeg in pendingJPEGs {
                let path = "\(organizationId)/\(visit.petId)/\(visit.reservationId)/\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString.prefix(8)).jpg"
                _ = try await client.storage.from(Self.bucket)
                    .upload(path, data: jpeg, options: FileOptions(contentType: "image/jpeg", upsert: true))
                finalPaths.append(path)
            }

            // 2. Filled custom sections (template mode only).
            let filled: [FilledSectionOut]? = usingTemplate ? buildFilledSections() : nil

            struct Payload: Encodable {
                let organization_id: String
                let pet_id: String
                let reservation_id: String
                let overall_rating: String?
                let summary: String?
                let photo_urls: [String]
                let template_id: String?
                let custom_sections: [FilledSectionOut]?
                let created_by: String?
                var published: Bool?
                var published_at: String?
            }
            var payload = Payload(
                organization_id: organizationId, pet_id: visit.petId, reservation_id: visit.reservationId,
                overall_rating: usingTemplate ? nil : (rating.isEmpty ? nil : rating),
                summary: summary.isEmpty ? nil : summary,
                photo_urls: finalPaths,
                template_id: usingTemplate ? templateId : nil,
                custom_sections: filled,
                created_by: userId, published: nil, published_at: nil
            )
            if publish {
                payload.published = true
                payload.published_at = ISO8601DateFormatter().string(from: Date())
            } else if existingCardId == nil {
                payload.published = false
            }

            if let id = existingCardId {
                try await client.from("report_cards").update(payload).eq("id", value: id).execute()
            } else {
                try await client.from("report_cards").insert(payload).execute()
            }
            didFinish = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func buildFilledSections() -> [FilledSectionOut] {
        guard let id = templateId, let tpl = templates.first(where: { $0.id == id }) else { return [] }
        return tpl.sections.map { section in
            FilledSectionOut(title: section.title, fields: section.fields.map { f in
                FilledFieldOut(label: f.label, type: f.type,
                               value: fieldValues[f.id] ?? blankValue(for: f.type),
                               options: f.options)
            })
        }
    }

    static func compress(_ data: Data, maxSide: CGFloat = 1024, quality: CGFloat = 0.85) -> Data? {
        guard let src = UIImage(data: data) else { return nil }
        let longest = max(src.size.width, src.size.height)
        let scale = longest > maxSide ? maxSide / longest : 1
        let target = CGSize(width: floor(src.size.width * scale), height: floor(src.size.height * scale))
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1; fmt.opaque = true
        let img = UIGraphicsImageRenderer(size: target, format: fmt).image { _ in src.draw(in: CGRect(origin: .zero, size: target)) }
        return img.jpegData(compressionQuality: quality)
    }
}

// MARK: - Editor view

struct StaffReportCardEditor: View {
    let visit: PetVisit
    @EnvironmentObject private var staff: CurrentStaffService
    @StateObject private var vm = StaffReportCardEditorViewModel()
    @Environment(\.dismiss) private var dismiss

    @State private var libraryItem: PhotosPickerItem?
    @State private var showCamera = false

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xl) {
                    if !vm.templates.isEmpty { templatePicker }
                    if vm.usingTemplate { templateSections } else { classicRating }
                    summarySection
                    photosSection
                    if let err = vm.error { errorBanner(err) }
                    actions
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle(vm.isPublished ? "Edit report card" : "Report card")
        .navigationBarTitleDisplayMode(.inline)
        .task { if let org = staff.organizationId { await vm.load(visit: visit, organizationId: org) } }
        .onChange(of: vm.didFinish) { _, done in if done { dismiss() } }
        .onChange(of: libraryItem) { _, item in
            guard let item else { return }
            Task { if let data = try? await item.loadTransferable(type: Data.self) { vm.ingest(data) }; libraryItem = nil }
        }
        .sheet(isPresented: $showCamera) {
            CameraPicker { data in if let data { vm.ingest(data) } }
                .ignoresSafeArea()
        }
    }

    private var templatePicker: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text("TEMPLATE").font(SnoutTheme.labelSM).tracking(0.6).foregroundStyle(SnoutTheme.onSurfaceMuted)
            Menu {
                Button("Classic (rating + summary)") { vm.applyTemplate(nil) }
                ForEach(vm.templates) { t in Button(t.name) { vm.applyTemplate(t.id) } }
            } label: {
                HStack {
                    Text(vm.templateId.flatMap { id in vm.templates.first(where: { $0.id == id })?.name } ?? "Classic (rating + summary)")
                        .font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurface)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                .padding(SnoutTheme.Spacing.md).background(SnoutTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous).stroke(SnoutTheme.divider, lineWidth: 1))
            }
        }
    }

    private var classicRating: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            Text("OVERALL").font(SnoutTheme.labelSM).tracking(0.6).foregroundStyle(SnoutTheme.onSurfaceMuted)
            FlowChips(options: kRatingOptions.map { ($0.value, "\($0.emoji) \($0.label)") },
                      selected: vm.rating) { vm.rating = (vm.rating == $0 ? "" : $0) }
        }
    }

    @ViewBuilder private var templateSections: some View {
        if let id = vm.templateId, let tpl = vm.templates.first(where: { $0.id == id }) {
            ForEach(tpl.sections, id: \.id) { section in
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
                    if !section.title.isEmpty {
                        Text(section.title.uppercased()).font(SnoutTheme.labelSM).tracking(0.6).foregroundStyle(SnoutTheme.onSurfaceMuted)
                    }
                    ForEach(section.fields, id: \.id) { field in
                        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
                            Text(field.label).font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurface)
                            DynamicFieldInput(field: field,
                                              value: vm.fieldValues[field.id] ?? .text(""),
                                              onChange: { vm.setValue($0, for: field.id) })
                        }
                    }
                }
            }
        }
    }

    private var summarySection: some View {
        StaffMultilineField(label: "Summary", text: $vm.summary, placeholder: "How was \(visit.petName)'s day?")
    }

    private var photosSection: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            Text("PHOTOS (\(vm.photoCount)/\(kMaxPhotos))").font(SnoutTheme.labelSM).tracking(0.6).foregroundStyle(SnoutTheme.onSurfaceMuted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: SnoutTheme.Spacing.sm) {
                    ForEach(vm.existingPhotos, id: \.self) { path in
                        photoThumb(url: vm.photoSignedURLs[path]) { vm.removeExisting(path) }
                    }
                    ForEach(Array(vm.pendingJPEGs.enumerated()), id: \.offset) { idx, data in
                        photoThumb(image: UIImage(data: data)) { vm.removePending(at: idx) }
                    }
                    if vm.photoCount < kMaxPhotos {
                        PhotosPicker(selection: $libraryItem, matching: .images) {
                            addTile(symbol: "photo.on.rectangle")
                        }
                        Button { showCamera = true } label: { addTile(symbol: "camera.fill") }
                            .buttonStyle(.plain)
                    }
                }
            }
            .scrollClipDisabled()
        }
    }

    private func addTile(symbol: String) -> some View {
        RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous)
            .stroke(SnoutTheme.divider, style: StrokeStyle(lineWidth: 1.5, dash: [4]))
            .frame(width: 80, height: 80)
            .overlay(Image(systemName: symbol).font(.system(size: 20)).foregroundStyle(SnoutTheme.onSurfaceMuted))
    }

    @ViewBuilder
    private func photoThumb(url: URL? = nil, image: UIImage? = nil, onRemove: @escaping () -> Void) -> some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let image { Image(uiImage: image).resizable().scaledToFill() }
                else if let url { AsyncImage(url: url) { $0.resizable().scaledToFill() } placeholder: { Rectangle().fill(SnoutTheme.frost.opacity(0.4)) } }
                else { Rectangle().fill(SnoutTheme.frost.opacity(0.4)) }
            }
            .frame(width: 80, height: 80).clipped()
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill").font(.system(size: 18))
                    .foregroundStyle(.white, SnoutTheme.onSurface.opacity(0.7))
            }
            .buttonStyle(.plain).padding(4)
        }
    }

    private var actions: some View {
        VStack(spacing: SnoutTheme.Spacing.sm) {
            Button { Task { await vm.save(publish: true, visit: visit, organizationId: staff.organizationId ?? "", userId: staff.profileId) } } label: {
                HStack(spacing: SnoutTheme.Spacing.sm) {
                    if vm.isSaving { ProgressView().tint(SnoutTheme.onAccent) }
                    Text(vm.isPublished ? "Re-publish" : "Publish").font(SnoutTheme.body(16, weight: .semibold))
                }
                .foregroundStyle(SnoutTheme.onAccent).frame(maxWidth: .infinity)
                .padding(.vertical, SnoutTheme.Spacing.md).background(SnoutTheme.accent).clipShape(Capsule())
            }
            .buttonStyle(.plain).disabled(vm.isSaving)

            Button { Task { await vm.save(publish: false, visit: visit, organizationId: staff.organizationId ?? "", userId: staff.profileId) } } label: {
                Text("Save draft").font(SnoutTheme.body(15, weight: .semibold)).foregroundStyle(SnoutTheme.onSurface)
                    .frame(maxWidth: .infinity).padding(.vertical, SnoutTheme.Spacing.md)
                    .background(SnoutTheme.surface).clipShape(Capsule())
                    .overlay(Capsule().stroke(SnoutTheme.divider, lineWidth: 1))
            }
            .buttonStyle(.plain).disabled(vm.isSaving)
        }
    }

    private func errorBanner(_ msg: String) -> some View {
        Text(msg).font(SnoutTheme.bodySM).foregroundStyle(SnoutTheme.onSurface)
            .padding(SnoutTheme.Spacing.md).frame(maxWidth: .infinity, alignment: .leading)
            .background(SnoutTheme.cotton.opacity(0.6)).clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
    }
}

// MARK: - Dynamic field input

private struct DynamicFieldInput: View {
    let field: RCTemplateField
    let value: ReportCardFieldValue
    let onChange: (ReportCardFieldValue) -> Void

    var body: some View {
        switch field.type {
        case "textarea":
            TextField("", text: Binding(get: { value.stringValue }, set: { onChange(.text($0)) }), axis: .vertical)
                .lineLimit(2...6).modifier(FieldBox())
        case "select":
            Menu {
                ForEach(field.options ?? [], id: \.self) { opt in Button(opt) { onChange(.text(opt)) } }
            } label: {
                HStack {
                    Text(value.stringValue.isEmpty ? "Choose…" : value.stringValue)
                        .foregroundStyle(value.stringValue.isEmpty ? SnoutTheme.onSurfaceMuted : SnoutTheme.onSurface)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                .modifier(FieldBox())
            }
        case "rating":
            HStack(spacing: SnoutTheme.Spacing.sm) {
                let current = ratingInt
                ForEach(1...5, id: \.self) { n in
                    Button { onChange(.number(Double(current == n ? 0 : n))) } label: {
                        Image(systemName: current >= n ? "star.fill" : "star")
                            .foregroundStyle(current >= n ? SnoutTheme.accent : SnoutTheme.onSurfaceFaint)
                    }
                    .buttonStyle(.plain)
                }
            }
        case "boolean":
            HStack(spacing: SnoutTheme.Spacing.sm) {
                chip("Yes", isBoolTrue) { onChange(.bool(true)) }
                chip("No", isBoolFalse) { onChange(.bool(false)) }
            }
        default:
            TextField("", text: Binding(get: { value.stringValue }, set: { onChange(.text($0)) }))
                .modifier(FieldBox())
        }
    }

    private var ratingInt: Int { if case let .number(d) = value { return Int(d) }; return 0 }
    private var isBoolTrue: Bool { if case .bool(true) = value { return true }; return false }
    private var isBoolFalse: Bool { if case .bool(false) = value { return true }; return false }

    private func chip(_ label: String, _ on: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(SnoutTheme.body(14, weight: .semibold))
                .foregroundStyle(on ? SnoutTheme.onAccent : SnoutTheme.onSurfaceMuted)
                .padding(.horizontal, SnoutTheme.Spacing.lg).padding(.vertical, SnoutTheme.Spacing.sm)
                .background(on ? SnoutTheme.accent : SnoutTheme.surface).clipShape(Capsule())
                .overlay(Capsule().stroke(on ? Color.clear : SnoutTheme.divider, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

private struct FieldBox: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(SnoutTheme.bodyMD).foregroundStyle(SnoutTheme.onSurface)
            .padding(.horizontal, SnoutTheme.Spacing.md).padding(.vertical, SnoutTheme.Spacing.sm)
            .background(SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous).stroke(SnoutTheme.divider, lineWidth: 1))
    }
}

// MARK: - Chips (classic rating)

private struct FlowChips: View {
    let options: [(value: String, label: String)]
    let selected: String
    let onTap: (String) -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
            ForEach(options, id: \.value) { opt in
                Button { onTap(opt.value) } label: {
                    Text(opt.label).font(SnoutTheme.body(15, weight: .semibold))
                        .foregroundStyle(selected == opt.value ? SnoutTheme.onAccent : SnoutTheme.onSurface)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(SnoutTheme.Spacing.md)
                        .background(selected == opt.value ? SnoutTheme.accent : SnoutTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous).stroke(selected == opt.value ? Color.clear : SnoutTheme.divider, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Camera picker

struct CameraPicker: UIViewControllerRepresentable {
    let onCapture: (Data?) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.delegate = context.coordinator
        return picker
    }
    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            let image = info[.originalImage] as? UIImage
            parent.onCapture(image?.jpegData(compressionQuality: 0.9))
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.onCapture(nil); parent.dismiss()
        }
    }
}
