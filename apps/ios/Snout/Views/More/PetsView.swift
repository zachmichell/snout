//
//  PetsView.swift
//  Snout
//
//  Pet parents reach their own pets through the `pet_owners` join table.
//  This file holds:
//    - PetsListView         (the list, with avatars + add CTA)
//    - PetEditView          (one form for both add and edit modes)
//    - DeletePetDialog      (Boho-styled destructive confirm)
//
//  Photo upload is intentionally deferred — the list shows initial-letter
//  avatars and the form has no photo picker yet. PhotosPicker + image
//  resize + pet-photos storage upload + photo_url UPDATE is its own polish
//  turn.
//

import SwiftUI
import UIKit
import PhotosUI
import Supabase

// MARK: - Pets list

@MainActor
final class PetsListViewModel: ObservableObject {
    @Published var pets: [Pet] = []
    @Published var isLoading: Bool = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared

    func load(ownerId: String) async {
        isLoading = true
        defer { isLoading = false }
        loadError = nil
        do {
            struct Envelope: Decodable { let pet: Pet }
            let rows: [Envelope] = try await client
                .from("pet_owners")
                .select("pet:pets(*)")
                .eq("owner_id", value: ownerId)
                .execute()
                .value
            self.pets = rows.map(\.pet)
                .filter { $0.deletedAt == nil }
                .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        } catch {
            loadError = error.localizedDescription
        }
    }
}

struct PetsListView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = PetsListViewModel()

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
                    if vm.pets.isEmpty && !vm.isLoading {
                        emptyState
                    } else {
                        ForEach(vm.pets) { pet in
                            NavigationLink {
                                PetEditView(pet: pet, onChange: reload)
                            } label: {
                                petRow(pet)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    if let err = vm.loadError {
                        errorBanner(err)
                    }
                    addPetButton
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
            .refreshable { await reload() }
        }
        .navigationTitle("My pets")
        .navigationBarTitleDisplayMode(.inline)
        .task { await reload() }
    }

    private func reload() async {
        guard let id = currentOwner.ownerId else { return }
        await vm.load(ownerId: id)
    }

    // MARK: - Row

    private func petRow(_ pet: Pet) -> some View {
        HStack(spacing: SnoutTheme.Spacing.lg) {
            avatar(for: pet)
            VStack(alignment: .leading, spacing: 2) {
                Text(pet.name)
                    .font(SnoutTheme.body(16, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                Text(petSubtitle(pet))
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

    private func avatar(for pet: Pet) -> some View {
        PetAvatar(pet: pet, size: 44)
    }

    private func petSubtitle(_ pet: Pet) -> String {
        var parts: [String] = []
        switch pet.species {
        case .dog:   parts.append("Dog")
        case .cat:   parts.append("Cat")
        case .other: parts.append("Pet")
        }
        if let breed = pet.breed, !breed.isEmpty { parts.append(breed) }
        return parts.joined(separator: " · ")
    }

    // MARK: - Empty / errors / add CTA

    private var emptyState: some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            ZStack {
                Circle().fill(SnoutTheme.cotton.opacity(0.6)).frame(width: 72, height: 72)
                SnoutGlyph("pawprint", size: 28, weight: .regular)
                    .foregroundStyle(SnoutTheme.onSurface)
            }
            Text("No pets yet")
                .font(SnoutTheme.titleMD)
                .foregroundStyle(SnoutTheme.onSurface)
            Text("Add your first pet so your facility knows who's coming.")
                .font(SnoutTheme.bodyMD)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, SnoutTheme.Spacing.xxl)
    }

    private var addPetButton: some View {
        NavigationLink {
            PetEditView(pet: nil, onChange: reload)
        } label: {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                Image(systemName: "plus.circle.fill")
                    .font(.system(size: 16, weight: .semibold))
                Text("Add a pet")
                    .font(SnoutTheme.body(15, weight: .semibold))
            }
            .foregroundStyle(SnoutTheme.onAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, SnoutTheme.Spacing.md)
            .background(SnoutTheme.accent)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
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

// MARK: - Pet edit / add (one form for both modes)

@MainActor
final class PetEditViewModel: ObservableObject {
    @Published var name: String = ""
    @Published var species: Species = .dog
    @Published var sex: Sex = .unknown
    @Published var breed: String = ""
    @Published var weightKg: String = ""
    @Published var dateOfBirth: Date = Date()
    @Published var hasDateOfBirth: Bool = false
    @Published var color: String = ""
    @Published var microchipId: String = ""
    /// Three-state spayed/neutered (yes / no / unknown). Postgres stores nil
    /// for unknown; bool true/false for the explicit answers.
    @Published var spayedNeutered: SpayedState = .unknown
    @Published var allergies: String = ""
    @Published var feedingNotes: String = ""
    @Published var medicationNotes: String = ""
    @Published var behavioralNotes: String = ""

    @Published var isSaving: Bool = false
    @Published var isDeleting: Bool = false
    @Published var saveError: String?
    @Published var didFinish: Bool = false

    // Photo state.
    //
    // existingPhotoURL is hydrated from the pet on edit mode and rendered as
    // an AsyncImage. When the user picks a new image (via PhotosPicker in
    // PetEditView) we compress it to pendingPhotoJPEG and show it inline as
    // a preview. On save, the bytes upload to the pet-photos bucket and we
    // update pets.photo_url.
    //
    // photoCleared is set when the user explicitly removes the existing
    // photo. On save, photo_url becomes null and we (best-effort) delete
    // the old object from storage.
    @Published var existingPhotoURL: URL?
    @Published var pendingPhotoJPEG: Data?
    @Published var photoCleared: Bool = false
    /// Path in the pet-photos bucket for the existing photo (extracted from
    /// the public URL on hydrate). Used so we can delete it when the user
    /// replaces or clears the photo.
    private var existingPhotoPath: String?

    enum SpayedState: String, CaseIterable {
        case yes, no, unknown
        var bool: Bool? {
            switch self {
            case .yes:     return true
            case .no:      return false
            case .unknown: return nil
            }
        }
        static func from(_ b: Bool?) -> SpayedState {
            switch b {
            case true?:  return .yes
            case false?: return .no
            default:     return .unknown
            }
        }
    }

    private let client = SupabaseClientProvider.shared

    func hydrate(from pet: Pet) {
        name = pet.name
        species = pet.species
        sex = pet.sex
        breed = pet.breed ?? ""
        weightKg = pet.weightKg.map { String($0) } ?? ""
        if let dob = pet.dateOfBirth, let parsed = Self.dateFromIsoDay(dob) {
            dateOfBirth = parsed
            hasDateOfBirth = true
        }
        color = pet.color ?? ""
        microchipId = pet.microchipId ?? ""
        spayedNeutered = SpayedState.from(pet.spayedNeutered)
        allergies = pet.allergies ?? ""
        feedingNotes = pet.feedingNotes ?? ""
        medicationNotes = pet.medicationNotes ?? ""
        behavioralNotes = pet.behavioralNotes ?? ""
        if let urlString = pet.photoURL, let url = URL(string: urlString) {
            existingPhotoURL = url
            existingPhotoPath = Self.extractPetPhotosPath(from: url)
        }
    }

    /// Pull the bucket-relative path out of a public URL like
    /// `https://<project>.supabase.co/storage/v1/object/public/pet-photos/<org>/<pet>/<file>`.
    /// Returns nil if the URL doesn't match the expected shape.
    private static func extractPetPhotosPath(from url: URL) -> String? {
        let s = url.absoluteString
        if let range = s.range(of: "/pet-photos/") {
            return String(s[range.upperBound...])
        }
        return nil
    }

    /// Public-URL builder for pet-photos. The bucket is `public: true`, so
    /// `getPublicURL` returns a deterministic URL without a server round-trip.
    private func publicPetPhotoURL(path: String) -> URL? {
        try? client.storage.from("pet-photos").getPublicURL(path: path)
    }

    /// Reset the picked photo state (called when the picker yields nothing
    /// or user cancels mid-pick).
    func clearPickedPhoto() {
        pendingPhotoJPEG = nil
    }

    /// Mark the existing photo for removal. Saving will null out photo_url
    /// and best-effort delete the storage object.
    func markPhotoCleared() {
        photoCleared = true
        pendingPhotoJPEG = nil
    }

    /// Hand the picker's transferable data to the model — converts to
    /// UIImage, downsizes to ~1024px on the longest edge, and JPEG-encodes
    /// at quality 0.85. Returns true on success.
    @discardableResult
    func ingestPickedImage(data: Data) -> Bool {
        guard let jpeg = Self.compressForUpload(data) else { return false }
        pendingPhotoJPEG = jpeg
        photoCleared = false
        return true
    }

    /// Resize + JPEG-encode an image. Targets a 1024px-longest-edge bitmap so
    /// the upload is small and the avatar circle still looks crisp. Returns
    /// nil if the source data isn't a decodable image.
    static func compressForUpload(_ data: Data, maxSide: CGFloat = 1024, quality: CGFloat = 0.85) -> Data? {
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

    var canSave: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && !isSaving && !isDeleting
    }

    /// Insert a brand new pet AND its pet_owners join row. There's no DB
    /// transaction across two PostgREST calls; if the pet_owners insert
    /// fails after the pet insert succeeds, the pet is stranded but stays
    /// invisible to the parent (no join row). v1 acceptable; long-term fix
    /// is a SECURITY DEFINER RPC.
    func saveNew(organizationId: String, ownerId: String) async {
        isSaving = true
        defer { isSaving = false }
        saveError = nil

        struct PetInsert: Encodable {
            let organization_id: String
            let name: String
            let species: String
            let sex: String
            let breed: String?
            let date_of_birth: String?
            let weight_kg: Double?
            let color: String?
            let microchip_id: String?
            let spayed_neutered: Bool?
            let allergies: String?
            let feeding_notes: String?
            let medication_notes: String?
            let behavioral_notes: String?
        }
        struct InsertedPet: Decodable { let id: String }

        let petPayload = PetInsert(
            organization_id: organizationId,
            name: name.trimmingCharacters(in: .whitespaces),
            species: species.rawValue,
            sex: sex.rawValue,
            breed: nilIfBlank(breed),
            date_of_birth: hasDateOfBirth ? Self.isoDay(from: dateOfBirth) : nil,
            weight_kg: parsedWeight(),
            color: nilIfBlank(color),
            microchip_id: nilIfBlank(microchipId),
            spayed_neutered: spayedNeutered.bool,
            allergies: nilIfBlank(allergies),
            feeding_notes: nilIfBlank(feedingNotes),
            medication_notes: nilIfBlank(medicationNotes),
            behavioral_notes: nilIfBlank(behavioralNotes)
        )

        do {
            let inserted: [InsertedPet] = try await client
                .from("pets")
                .insert(petPayload)
                .select("id")
                .execute()
                .value
            guard let petId = inserted.first?.id else {
                saveError = "Pet was created but no id returned."
                return
            }

            struct JoinInsert: Encodable {
                let organization_id: String
                let pet_id: String
                let owner_id: String
                let relationship: String
            }
            try await client
                .from("pet_owners")
                .insert(JoinInsert(
                    organization_id: organizationId,
                    pet_id: petId,
                    owner_id: ownerId,
                    relationship: "primary"
                ))
                .execute()

            // Upload the picked photo (if any) now that we have the pet id.
            // Failures here don't roll back the pet — the parent can retry
            // by editing the pet later. We surface the error but still
            // mark didFinish so the pet creation isn't blocked.
            if let jpeg = pendingPhotoJPEG {
                do {
                    try await uploadPhoto(jpeg, organizationId: organizationId, petId: petId)
                } catch {
                    saveError = "Pet saved, but photo upload failed: \(error.localizedDescription)"
                }
            }

            didFinish = true
        } catch {
            saveError = error.localizedDescription
        }
    }

    /// Update an existing pet row.
    func saveEdit(petId: String) async {
        isSaving = true
        defer { isSaving = false }
        saveError = nil

        struct PetUpdate: Encodable {
            let name: String
            let species: String
            let sex: String
            let breed: String?
            let date_of_birth: String?
            let weight_kg: Double?
            let color: String?
            let microchip_id: String?
            let spayed_neutered: Bool?
            let allergies: String?
            let feeding_notes: String?
            let medication_notes: String?
            let behavioral_notes: String?
        }

        let payload = PetUpdate(
            name: name.trimmingCharacters(in: .whitespaces),
            species: species.rawValue,
            sex: sex.rawValue,
            breed: nilIfBlank(breed),
            date_of_birth: hasDateOfBirth ? Self.isoDay(from: dateOfBirth) : nil,
            weight_kg: parsedWeight(),
            color: nilIfBlank(color),
            microchip_id: nilIfBlank(microchipId),
            spayed_neutered: spayedNeutered.bool,
            allergies: nilIfBlank(allergies),
            feeding_notes: nilIfBlank(feedingNotes),
            medication_notes: nilIfBlank(medicationNotes),
            behavioral_notes: nilIfBlank(behavioralNotes)
        )

        do {
            try await client
                .from("pets")
                .update(payload)
                .eq("id", value: petId)
                .execute()

            // Photo updates after the row update so a partial photo failure
            // doesn't lose the parent's text edits.
            if let jpeg = pendingPhotoJPEG {
                // Need org id for the storage path. Fetch from the row we
                // just updated — cheap RTT and avoids passing it as a param.
                struct OrgRow: Decodable { let organization_id: String }
                let rows: [OrgRow] = try await client
                    .from("pets")
                    .select("organization_id")
                    .eq("id", value: petId)
                    .limit(1)
                    .execute()
                    .value
                if let org = rows.first?.organization_id {
                    do {
                        try await uploadPhoto(jpeg, organizationId: org, petId: petId)
                    } catch {
                        saveError = "Saved, but photo upload failed: \(error.localizedDescription)"
                    }
                }
            } else if photoCleared {
                struct ClearPayload: Encodable { let photo_url: String? }
                _ = try? await client
                    .from("pets")
                    .update(ClearPayload(photo_url: nil))
                    .eq("id", value: petId)
                    .execute()
                if let path = existingPhotoPath {
                    _ = try? await client.storage
                        .from("pet-photos")
                        .remove(paths: [path])
                }
            }

            didFinish = true
        } catch {
            saveError = error.localizedDescription
        }
    }

    /// Upload the JPEG to pet-photos at `{org}/{pet}/{epoch}.jpg`, then
    /// UPDATE pets.photo_url with the public URL. Best-effort delete of any
    /// previously-stored photo on success, so we don't leak old objects when
    /// the parent replaces the photo.
    private func uploadPhoto(_ jpeg: Data, organizationId: String, petId: String) async throws {
        let path = "\(organizationId)/\(petId)/\(Int(Date().timeIntervalSince1970)).jpg"
        let opts = FileOptions(contentType: "image/jpeg", upsert: true)
        _ = try await client.storage
            .from("pet-photos")
            .upload(path, data: jpeg, options: opts)

        guard let publicURL = publicPetPhotoURL(path: path) else {
            throw NSError(domain: "PetEditViewModel", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Couldn't build photo URL."])
        }

        struct UrlPayload: Encodable { let photo_url: String }
        try await client
            .from("pets")
            .update(UrlPayload(photo_url: publicURL.absoluteString))
            .eq("id", value: petId)
            .execute()

        // Best-effort: delete the previous photo file if we replaced one.
        if let oldPath = existingPhotoPath, oldPath != path {
            _ = try? await client.storage
                .from("pet-photos")
                .remove(paths: [oldPath])
        }
        existingPhotoPath = path
        existingPhotoURL = publicURL
        pendingPhotoJPEG = nil
    }

    /// Soft-delete: set deleted_at = NOW(). The pet_owners join is left in
    /// place; queries filter by `deleted_at IS NULL` everywhere.
    func delete(petId: String) async {
        isDeleting = true
        defer { isDeleting = false }
        saveError = nil

        struct DelPayload: Encodable {
            let deleted_at: String
        }
        do {
            try await client
                .from("pets")
                .update(DelPayload(deleted_at: ISO8601DateFormatter().string(from: Date())))
                .eq("id", value: petId)
                .execute()
            didFinish = true
        } catch {
            saveError = error.localizedDescription
        }
    }

    // MARK: - Helpers

    private func nilIfBlank(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? nil : t
    }

    private func parsedWeight() -> Double? {
        let trimmed = weightKg.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        return Double(trimmed.replacingOccurrences(of: ",", with: "."))
    }

    private static let isoDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    static func isoDay(from date: Date) -> String {
        isoDayFormatter.string(from: date)
    }

    static func dateFromIsoDay(_ s: String) -> Date? {
        isoDayFormatter.date(from: s)
    }
}

struct PetEditView: View {
    /// nil → add mode; non-nil → edit mode for that pet.
    let pet: Pet?
    /// Called after a successful save or delete so the list can refresh.
    var onChange: () async -> Void = {}

    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = PetEditViewModel()
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Field?
    @State private var showDeleteConfirm: Bool = false
    @State private var photoPickerItem: PhotosPickerItem?

    enum Field { case name, breed, weight, color, microchip, allergies, feeding, medication, behavioral }

    private var isEdit: Bool { pet != nil }
    private var title: String { isEdit ? (pet?.name ?? "Pet") : "Add a pet" }

    var body: some View {
        ZStack {
            SnoutTheme.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xl) {
                    photoSection
                    basicsSection
                    identitySection
                    healthSection
                    careNotesSection
                    if let err = vm.saveError {
                        errorBanner(err)
                    }
                    saveButton
                    if isEdit {
                        deleteButton
                    }
                    Spacer(minLength: SnoutTheme.Spacing.xxl)
                }
                .padding(SnoutTheme.Spacing.xl)
            }
            .scrollContentBackground(.hidden)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focused = nil }
                    .foregroundStyle(SnoutTheme.accent)
            }
        }
        .task {
            if let pet { vm.hydrate(from: pet) }
        }
        .onChange(of: vm.didFinish) { _, new in
            if new {
                Task {
                    await onChange()
                    dismiss()
                }
            }
        }
        .overlay {
            if showDeleteConfirm {
                DeletePetDialog(
                    petName: pet?.name ?? "this pet",
                    isDeleting: vm.isDeleting,
                    onConfirm: {
                        guard let id = pet?.id else { return }
                        Task {
                            await vm.delete(petId: id)
                            showDeleteConfirm = false
                        }
                    },
                    onCancel: { showDeleteConfirm = false }
                )
                .transition(.opacity.combined(with: .scale(scale: 0.96)))
                .zIndex(10)
            }
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: showDeleteConfirm)
    }

    // MARK: - Sections

    /// Pet photo. Three render states: pending (just-picked, JPEG in memory),
    /// existing (AsyncImage of the public URL), or empty (initial-letter
    /// fallback identical to the list view). The picker yields a
    /// PhotosPickerItem that we asynchronously resolve into Data, then hand
    /// to the view-model for compression + staging.
    private var photoSection: some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            ZStack {
                Circle().fill(petTint).frame(width: 96, height: 96)
                Group {
                    if let jpeg = vm.pendingPhotoJPEG, let img = UIImage(data: jpeg) {
                        Image(uiImage: img)
                            .resizable()
                            .scaledToFill()
                    } else if !vm.photoCleared, let url = vm.existingPhotoURL {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image.resizable().scaledToFill()
                            case .failure:
                                fallbackInitial
                            case .empty:
                                ProgressView().tint(SnoutTheme.onSurface)
                            @unknown default:
                                fallbackInitial
                            }
                        }
                    } else {
                        fallbackInitial
                    }
                }
                .frame(width: 96, height: 96)
                .clipShape(Circle())
            }

            HStack(spacing: SnoutTheme.Spacing.sm) {
                PhotosPicker(
                    selection: $photoPickerItem,
                    matching: .images,
                    photoLibrary: .shared()
                ) {
                    Text(hasAnyPhoto ? "Change photo" : "Add photo")
                        .font(SnoutTheme.body(13, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurface)
                        .padding(.horizontal, SnoutTheme.Spacing.md)
                        .padding(.vertical, SnoutTheme.Spacing.sm)
                        .background(SnoutTheme.surface)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(SnoutTheme.divider, lineWidth: 1))
                }
                if hasAnyPhoto {
                    Button {
                        photoPickerItem = nil
                        vm.markPhotoCleared()
                    } label: {
                        Text("Remove")
                            .font(SnoutTheme.body(13, weight: .semibold))
                            .foregroundStyle(SnoutTheme.destructive)
                            .padding(.horizontal, SnoutTheme.Spacing.md)
                            .padding(.vertical, SnoutTheme.Spacing.sm)
                            .background(SnoutTheme.surface)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(SnoutTheme.destructive.opacity(0.4), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        .onChange(of: photoPickerItem) { _, newItem in
            guard let item = newItem else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    _ = vm.ingestPickedImage(data: data)
                }
            }
        }
    }

    private var hasAnyPhoto: Bool {
        vm.pendingPhotoJPEG != nil || (!vm.photoCleared && vm.existingPhotoURL != nil)
    }

    private var fallbackInitial: some View {
        Text(initialFallback)
            .font(SnoutTheme.body(36, weight: .semibold))
            .foregroundStyle(SnoutTheme.onSurface)
    }

    private var initialFallback: String {
        let trimmed = vm.name.trimmingCharacters(in: .whitespaces)
        guard let ch = trimmed.first else { return "🐾" }
        return String(ch).uppercased()
    }

    /// Same name-seeded Boho hue the list view uses, so the avatar is
    /// consistent across screens.
    private var petTint: Color {
        let palette: [Color] = [
            SnoutTheme.cotton, SnoutTheme.vanilla, SnoutTheme.frost,
            SnoutTheme.mist, SnoutTheme.blueberry
        ]
        let key = vm.name.isEmpty ? "?" : vm.name
        let hash = abs(key.hashValue)
        return palette[hash % palette.count].opacity(0.85)
    }

    private var basicsSection: some View {
        formCard {
            BohoFormField(
                label: "Name",
                text: $vm.name,
                placeholder: "Pet's name",
                capitalization: .words
            )
            .focused($focused, equals: .name)

            VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
                Text("Species")
                    .font(SnoutTheme.labelSM)
                    .tracking(0.4)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                BohoSegmented(
                    options: [("dog", "Dog"), ("cat", "Cat"), ("other", "Other")],
                    selection: Binding(
                        get: { vm.species.rawValue },
                        set: { if let s = Species(rawValue: $0) { vm.species = s } }
                    )
                )
            }

            VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
                Text("Sex")
                    .font(SnoutTheme.labelSM)
                    .tracking(0.4)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                BohoSegmented(
                    options: [("F", "Female"), ("M", "Male"), ("U", "Unknown")],
                    selection: Binding(
                        get: { vm.sex.rawValue },
                        set: { if let s = Sex(rawValue: $0) { vm.sex = s } }
                    )
                )
            }
        }
    }

    private var identitySection: some View {
        sectionWithLabel("Identity") {
            formCard {
                BohoFormField(
                    label: "Breed",
                    text: $vm.breed,
                    placeholder: "Golden retriever",
                    capitalization: .words
                )
                .focused($focused, equals: .breed)

                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
                    Toggle(isOn: $vm.hasDateOfBirth) {
                        Text("Date of birth")
                            .font(SnoutTheme.labelSM)
                            .tracking(0.4)
                            .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    }
                    .tint(SnoutTheme.accent)
                    if vm.hasDateOfBirth {
                        DatePicker(
                            "",
                            selection: $vm.dateOfBirth,
                            in: ...Date(),
                            displayedComponents: .date
                        )
                        .labelsHidden()
                        .datePickerStyle(.compact)
                    }
                }

                BohoFormField(
                    label: "Weight (kg)",
                    text: $vm.weightKg,
                    placeholder: "12.5",
                    keyboard: .decimalPad
                )
                .focused($focused, equals: .weight)

                BohoFormField(
                    label: "Color",
                    text: $vm.color,
                    placeholder: "Brown / black / etc.",
                    capitalization: .words
                )
                .focused($focused, equals: .color)

                BohoFormField(
                    label: "Microchip ID",
                    text: $vm.microchipId,
                    placeholder: "Optional",
                    capitalization: .characters
                )
                .focused($focused, equals: .microchip)
            }
        }
    }

    private var healthSection: some View {
        sectionWithLabel("Health") {
            formCard {
                VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
                    Text("Spayed / neutered")
                        .font(SnoutTheme.labelSM)
                        .tracking(0.4)
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    BohoSegmented(
                        options: [
                            ("yes", "Yes"),
                            ("no", "No"),
                            ("unknown", "Unknown")
                        ],
                        selection: Binding(
                            get: { vm.spayedNeutered.rawValue },
                            set: { if let s = PetEditViewModel.SpayedState(rawValue: $0) { vm.spayedNeutered = s } }
                        )
                    )
                }

                BohoMultilineField(
                    label: "Allergies",
                    text: $vm.allergies,
                    placeholder: "Food, environmental, medications…"
                )
                .focused($focused, equals: .allergies)
            }
        }
    }

    private var careNotesSection: some View {
        sectionWithLabel("Care notes") {
            formCard {
                BohoMultilineField(
                    label: "Feeding",
                    text: $vm.feedingNotes,
                    placeholder: "Brand, portions, schedule"
                )
                .focused($focused, equals: .feeding)

                BohoMultilineField(
                    label: "Medication",
                    text: $vm.medicationNotes,
                    placeholder: "Dose and timing"
                )
                .focused($focused, equals: .medication)

                BohoMultilineField(
                    label: "Behavior",
                    text: $vm.behavioralNotes,
                    placeholder: "Anything we should know — likes, dislikes, triggers"
                )
                .focused($focused, equals: .behavioral)
            }
        }
    }

    // MARK: - Actions

    private var saveButton: some View {
        Button {
            Task {
                if let pet {
                    await vm.saveEdit(petId: pet.id)
                } else {
                    guard let org = currentOwner.organizationId,
                          let owner = currentOwner.ownerId else { return }
                    await vm.saveNew(organizationId: org, ownerId: owner)
                }
            }
        } label: {
            HStack(spacing: SnoutTheme.Spacing.sm) {
                if vm.isSaving { ProgressView().tint(SnoutTheme.onAccent) }
                Text(vm.isSaving ? (isEdit ? "Saving…" : "Adding…")
                                 : (isEdit ? "Save changes" : "Add pet"))
                    .font(SnoutTheme.body(15, weight: .semibold))
            }
            .foregroundStyle(SnoutTheme.onAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, SnoutTheme.Spacing.md)
            .background(vm.canSave ? SnoutTheme.accent : SnoutTheme.accent.opacity(0.4))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!vm.canSave)
    }

    private var deleteButton: some View {
        Button {
            showDeleteConfirm = true
        } label: {
            Text("Remove pet")
                .font(SnoutTheme.body(15, weight: .semibold))
                .foregroundStyle(SnoutTheme.destructive)
                .frame(maxWidth: .infinity)
                .padding(.vertical, SnoutTheme.Spacing.md)
                .background(SnoutTheme.surface)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(SnoutTheme.destructive.opacity(0.4), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .disabled(vm.isSaving || vm.isDeleting)
    }

    // MARK: - Section helpers

    @ViewBuilder
    private func formCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            content()
        }
        .padding(SnoutTheme.Spacing.lg)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
    }

    @ViewBuilder
    private func sectionWithLabel<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            Text(title.uppercased())
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .padding(.horizontal, SnoutTheme.Spacing.xs)
            content()
        }
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

// MARK: - Boho destructive confirm dialog (pet delete)

private struct DeletePetDialog: View {
    let petName: String
    let isDeleting: Bool
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            Color(red: 0.20, green: 0.15, blue: 0.13).opacity(0.45)
                .ignoresSafeArea()

            VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
                Text("Remove \(petName)?")
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                Text("\(petName) will no longer appear on your account. Past visits and report cards stay on file with your facility.")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(spacing: SnoutTheme.Spacing.sm) {
                    Button(action: onConfirm) {
                        HStack(spacing: SnoutTheme.Spacing.sm) {
                            if isDeleting { ProgressView().tint(SnoutTheme.onDestructive) }
                            Text(isDeleting ? "Removing…" : "Confirm removal")
                                .font(SnoutTheme.body(15, weight: .semibold))
                        }
                        .foregroundStyle(SnoutTheme.onDestructive)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, SnoutTheme.Spacing.md)
                        .background(SnoutTheme.destructive)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .disabled(isDeleting)

                    Button(action: onCancel) {
                        Text("Keep pet")
                            .font(SnoutTheme.body(15, weight: .semibold))
                            .foregroundStyle(SnoutTheme.onSurface)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, SnoutTheme.Spacing.md)
                            .background(SnoutTheme.surface)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(SnoutTheme.divider, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .disabled(isDeleting)
                }
                .padding(.top, SnoutTheme.Spacing.xs)
            }
            .padding(SnoutTheme.Spacing.xl)
            .background(SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusHero, style: .continuous))
            .shadow(color: SnoutTheme.heroShadowColor,
                    radius: SnoutTheme.heroShadowRadius,
                    x: 0, y: SnoutTheme.heroShadowY)
            .padding(.horizontal, SnoutTheme.Spacing.xl)
            .frame(maxWidth: 420)
        }
    }
}
