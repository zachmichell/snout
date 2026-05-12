//
//  BookingWizardViewModel.swift
//  Snout
//
//  Drives the four-step pet-parent booking wizard. Mirrors apps/web/src/components/
//  portal-owner/booking-wizard/BookingWizard.tsx end-to-end.
//
//  Steps: Service → Pets → Date & Time → Review → Submit.
//  Submit inserts a `reservations` row (status='requested', source='owner_self_serve')
//  and a `reservation_pets` row per selected pet — same shape as the web wizard.
//
//  Out of scope for this v1 vs the web wizard:
//   - Module filtering (we show all active services; web filters by enabled modules).
//   - Vaccination warnings (no vaxStatus surfaced yet on iOS).
//   - Facility-hours-driven default times (we use FALLBACK_* constants from the
//     same path the web wizard falls back to when location_hours is unset).
//

import Foundation
import Supabase

@MainActor
final class BookingWizardViewModel: ObservableObject {
    /// Every step we *might* render. Which subset is active depends on the
    /// service module — grooming flows skip `.dateTime` and route through
    /// `.groomer` + `.slot` instead. See `effectiveSteps`.
    enum Step: Int, CaseIterable {
        case service  = 0
        case pets     = 1
        case dateTime = 2   // non-grooming flows
        case groomer  = 3   // grooming flows
        case slot     = 4   // grooming flows
        case review   = 5

        var label: String {
            switch self {
            case .service:  return "Service"
            case .pets:     return "Pets"
            case .dateTime: return "Date & Time"
            case .groomer:  return "Groomer"
            case .slot:     return "Pick a time"
            case .review:   return "Review"
            }
        }
    }

    enum SubmitState: Equatable {
        case idle
        case submitting
        case error(String)
        case success(reservationId: String)
    }

    // MARK: - Wizard state
    @Published var currentStep: Step = .service
    @Published var selectedService: Service?
    @Published var selectedPets: [Pet] = []
    @Published var selectedLocationId: String?
    @Published var date: String = ""             // "yyyy-MM-dd"
    @Published var endDate: String = ""          // overnight only
    @Published var startTime: String = ""        // "HH:mm"
    @Published var endTime: String = ""          // "HH:mm" (skip for hourly)
    @Published var hours: Int = 1                // hourly only
    @Published var notes: String = ""
    @Published var submitState: SubmitState = .idle

    // Grooming-flow state
    @Published var selectedGroomer: Groomer?
    @Published var availableSlots: [String] = []   // "HH:mm" strings from RPC
    @Published var selectedSlot: String?
    @Published var isLoadingSlots: Bool = false

    /// Set of yyyy-MM-dd strings the selected groomer has availability rows for.
    /// Drives the calendar grid in SlotPickerStep — days not in this set are
    /// rendered disabled so parents can't pick them.
    @Published var availableDates: Set<String> = []
    @Published var isLoadingDates: Bool = false

    // MARK: - Loaded data
    @Published var services: [Service] = []
    @Published var pets: [Pet] = []
    @Published var locations: [Location] = []
    @Published var groomers: [Groomer] = []
    @Published var isLoadingInitial: Bool = false

    private let client = SupabaseClientProvider.shared
    private var hasInitializedDateTime: Bool = false
    private var hasInitializedGroomerDate: Bool = false
    private var hasAutoSelectedPet: Bool = false

    /// True when the chosen service routes through the grooming-specific flow
    /// (Service → Pets → Groomer → Slot → Review).
    var isGroomingFlow: Bool { selectedService?.isGroomingFlow ?? false }

    /// Steps that are actually rendered for the current flow. Drives the step
    /// indicator and next/back navigation.
    var effectiveSteps: [Step] {
        if isGroomingFlow {
            return [.service, .pets, .groomer, .slot, .review]
        }
        return [.service, .pets, .dateTime, .review]
    }

    /// Index of the current step within `effectiveSteps` (0..n). -1 if the
    /// current step somehow isn't in the effective set (shouldn't happen in
    /// normal navigation).
    var currentEffectiveIndex: Int {
        effectiveSteps.firstIndex(of: currentStep) ?? -1
    }

    // MARK: - Step navigation

    func next() {
        // Walk effectiveSteps so we skip steps that don't apply to this flow.
        let steps = effectiveSteps
        guard let idx = steps.firstIndex(of: currentStep), idx < steps.count - 1 else { return }
        let nextStep = steps[idx + 1]
        currentStep = nextStep
        if nextStep == .dateTime { initializeDateTimeIfNeeded() }
        if nextStep == .slot { initializeGroomerDateIfNeeded() }
    }

    func back() {
        let steps = effectiveSteps
        guard let idx = steps.firstIndex(of: currentStep), idx > 0 else { return }
        currentStep = steps[idx - 1]
    }

    func reset() {
        currentStep = .service
        selectedService = nil
        selectedPets = []
        date = ""
        endDate = ""
        startTime = ""
        endTime = ""
        hours = 1
        notes = ""
        submitState = .idle
        selectedGroomer = nil
        availableSlots = []
        selectedSlot = nil
        availableDates = []
        hasInitializedDateTime = false
        hasInitializedGroomerDate = false
        hasAutoSelectedPet = false
        // Keep selectedLocationId / loaded data — same session, same facility.
    }

    // MARK: - Initial load

    func loadInitialData(organizationId: String, ownerId: String) async {
        isLoadingInitial = true
        defer { isLoadingInitial = false }

        async let svcTask = loadServices(organizationId: organizationId)
        async let petsTask = loadPets(ownerId: ownerId)
        async let locTask = loadLocations(organizationId: organizationId)
        async let groomerTask = loadGroomers(organizationId: organizationId)

        let svcs  = (try? await svcTask)     ?? []
        let pts   = (try? await petsTask)    ?? []
        let locs  = (try? await locTask)     ?? []
        let grs   = (try? await groomerTask) ?? []

        services  = svcs
        pets      = pts
        locations = locs
        groomers  = grs

        // Single-location convenience: pre-pick.
        if locations.count == 1 {
            selectedLocationId = locations.first?.id
        }

        // Auto-select pet when there's only one — matches web's autoSelected ref.
        if pts.count == 1, !hasAutoSelectedPet, selectedPets.isEmpty {
            selectedPets = [pts[0]]
            hasAutoSelectedPet = true
        }
    }

    private func loadGroomers(organizationId: String) async throws -> [Groomer] {
        try await client
            .from("groomers")
            .select()
            .eq("organization_id", value: organizationId)
            .eq("status", value: "active")
            .order("display_name", ascending: true)
            .execute()
            .value
    }

    /// Initializes the slot-picker date the first time the user lands on
    /// `.slot`. Defaults to tomorrow.
    private func initializeGroomerDateIfNeeded() {
        guard !hasInitializedGroomerDate else { return }
        hasInitializedGroomerDate = true
        if date.isEmpty {
            date = BookingHelpers.tomorrowISODate()
        }
    }

    /// Calls the `get_groomer_available_dates` RPC for the picked groomer over
    /// the next 90 days. Result populates `availableDates`, which the calendar
    /// grid uses to disable non-working days. Run once per groomer pick.
    func refreshAvailableDates() async {
        guard let groomer = selectedGroomer else {
            availableDates = []
            return
        }
        isLoadingDates = true
        defer { isLoadingDates = false }

        let cal = Calendar(identifier: .gregorian)
        let today = Date()
        guard let endDate = cal.date(byAdding: .day, value: 90, to: today) else { return }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "America/Regina") ?? .current

        struct Params: Encodable {
            let p_groomer_id: String
            let p_start_date: String
            let p_end_date: String
        }
        struct DatesResponse: Decodable { let dates: [String]? }

        do {
            let response: DatesResponse = try await client
                .rpc("get_groomer_available_dates",
                     params: Params(
                        p_groomer_id: groomer.id,
                        p_start_date: f.string(from: today),
                        p_end_date: f.string(from: endDate)
                     ))
                .execute()
                .value
            availableDates = Set(response.dates ?? [])
            // If currently picked date isn't available, clear it.
            if !date.isEmpty, !availableDates.contains(date) {
                date = ""
                selectedSlot = nil
                availableSlots = []
            }
            // If no date picked yet, default to the first available one.
            if date.isEmpty, let first = response.dates?.first {
                date = first
            }
        } catch {
            availableDates = []
            #if DEBUG
            print("[BookingWizardViewModel] refreshAvailableDates failed: \(error)")
            #endif
        }
    }

    /// Calls the `get_groomer_available_slots` RPC for the current groomer
    /// and date, and updates `availableSlots`. Selected slot is cleared if
    /// it's no longer in the list.
    func refreshSlots() async {
        guard let groomer = selectedGroomer, !date.isEmpty,
              let svc = selectedService else {
            availableSlots = []
            return
        }
        isLoadingSlots = true
        defer { isLoadingSlots = false }

        struct Params: Encodable {
            let p_groomer_id: String
            let p_date: String
            let p_duration_minutes: Int?
            let p_slot_step_minutes: Int?
        }
        struct SlotsResponse: Decodable { let slots: [String] }

        let duration = svc.defaultDurationMinutes ?? BookingHelpers.flatServiceDefaultDurationMinutes
        do {
            let response: SlotsResponse = try await client
                .rpc("get_groomer_available_slots",
                     params: Params(
                        p_groomer_id: groomer.id,
                        p_date: date,
                        p_duration_minutes: duration,
                        p_slot_step_minutes: 15
                     ))
                .execute()
                .value
            availableSlots = response.slots
            // Drop the previous pick if the new list doesn't include it.
            if let pick = selectedSlot, !response.slots.contains(pick) {
                selectedSlot = nil
            }
        } catch {
            availableSlots = []
            #if DEBUG
            print("[BookingWizardViewModel] refreshSlots failed: \(error)")
            #endif
        }
    }

    private func loadServices(organizationId: String) async throws -> [Service] {
        try await client
            .from("services")
            .select()
            .eq("organization_id", value: organizationId)
            .eq("active", value: true)
            .is("deleted_at", value: nil)
            .order("name", ascending: true)
            .execute()
            .value
    }

    private func loadPets(ownerId: String) async throws -> [Pet] {
        struct PetOwnerJoin: Decodable { let pet: Pet }
        let rows: [PetOwnerJoin] = try await client
            .from("pet_owners")
            .select("pet:pets(*)")
            .eq("owner_id", value: ownerId)
            .execute()
            .value
        return rows.map(\.pet).filter { $0.deletedAt == nil }
    }

    private func loadLocations(organizationId: String) async throws -> [Location] {
        try await client
            .from("locations")
            .select()
            .eq("organization_id", value: organizationId)
            .is("deleted_at", value: nil)
            .order("created_at", ascending: true)
            .execute()
            .value
    }

    // MARK: - Filtering / derived state

    /// Services available for the picked location (or org-wide if no location set).
    var visibleServices: [Service] {
        services.filter { svc in
            // location_id null on the service = available everywhere.
            guard let locId = selectedLocationId else { return svc.locationId == nil }
            return svc.locationId == nil || svc.locationId == locId
        }
    }

    var hasMultipleLocations: Bool { locations.count > 1 }

    var nights: Int {
        BookingHelpers.diffNights(checkIn: date, checkOut: endDate)
    }

    var estimatedPriceCents: Int {
        guard let svc = selectedService else { return 0 }
        return BookingHelpers.estimatePriceCents(
            basePriceCents: svc.basePriceCents,
            durationType: svc.durationType,
            petCount: selectedPets.count,
            nights: nights,
            hours: hours
        )
    }

    /// Sensible defaults the first time a user lands on the date/time step.
    /// Mirror of the FALLBACK_* constants in StepDateTime.tsx.
    private func initializeDateTimeIfNeeded() {
        guard !hasInitializedDateTime, let svc = selectedService else { return }
        hasInitializedDateTime = true
        let tomorrow = BookingHelpers.tomorrowISODate()
        switch svc.durationType {
        case .overnight:
            date = tomorrow
            endDate = addDays(to: tomorrow, days: 1) ?? tomorrow
            startTime = "14:00"
            endTime = "11:00"
        case .multiNight:
            date = tomorrow
            endDate = addDays(to: tomorrow, days: 2) ?? tomorrow
            startTime = "14:00"
            endTime = "11:00"
        case .hourly:
            date = tomorrow
            startTime = "09:00"
            hours = 1
        case .halfDay, .fullDay:
            date = tomorrow
            startTime = "07:00"
            endTime = "18:00"
        case .flat:
            // Per-appointment service: only date + start time matter.
            // end_at is computed from start_at + flatServiceDefaultDurationMinutes.
            date = tomorrow
            startTime = "10:00"
        }
    }

    private func addDays(to dateStr: String, days: Int) -> String? {
        guard let d = BookingHelpers.combineDateTime(dateStr: dateStr, timeStr: "00:00"),
              let next = Calendar.current.date(byAdding: .day, value: days, to: d) else { return nil }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "America/Regina") ?? .current
        return f.string(from: next)
    }

    // MARK: - Validation

    var canContinueFromService: Bool {
        selectedService != nil && (locations.count <= 1 || selectedLocationId != nil)
    }

    var canContinueFromPets: Bool { !selectedPets.isEmpty }

    var canContinueFromDateTime: Bool {
        guard let svc = selectedService else { return false }
        guard !date.isEmpty else { return false }
        switch svc.durationType {
        case .overnight, .multiNight:
            return !endDate.isEmpty && nights >= 1 && !startTime.isEmpty
        case .hourly:
            return !startTime.isEmpty && hours >= 1
        case .halfDay, .fullDay:
            guard !startTime.isEmpty, !endTime.isEmpty else { return false }
            guard let s = BookingHelpers.combineDateTime(dateStr: date, timeStr: startTime),
                  let e = BookingHelpers.combineDateTime(dateStr: date, timeStr: endTime) else { return false }
            return e > s
        case .flat:
            // Only need a start. End is computed from the default duration.
            return !startTime.isEmpty
        }
    }

    var canContinueFromGroomer: Bool { selectedGroomer != nil }

    var canContinueFromSlot: Bool {
        selectedGroomer != nil && !date.isEmpty && selectedSlot != nil
    }

    var canSubmit: Bool {
        guard canContinueFromService && canContinueFromPets else { return false }
        guard submitState != .submitting else { return false }
        if isGroomingFlow {
            return canContinueFromSlot
        }
        return canContinueFromDateTime
    }

    // MARK: - Submit

    func submit(ownerId: String, organizationId: String, userId: String?) async {
        guard let svc = selectedService else { return }
        if isGroomingFlow {
            await submitGrooming(svc: svc, ownerId: ownerId, organizationId: organizationId, userId: userId)
        } else {
            await submitStandard(svc: svc, ownerId: ownerId, organizationId: organizationId, userId: userId)
        }
    }

    /// Standard reservation submit (daycare, boarding, hourly, flat). One INSERT
    /// to `reservations` plus N rows to `reservation_pets`.
    private func submitStandard(svc: Service, ownerId: String, organizationId: String, userId: String?) async {
        submitState = .submitting

        guard let (startISO, endISO) = computeStartEnd(svc: svc) else {
            submitState = .error("Invalid date or time. Please go back and adjust.")
            return
        }

        do {
            let payload = ReservationPayload(
                organization_id: organizationId,
                location_id: selectedLocationId ?? svc.locationId,
                service_id: svc.id,
                primary_owner_id: ownerId,
                start_at: startISO,
                end_at: endISO,
                status: "requested",
                source: "owner_self_serve",
                requested_at: ISO8601DateFormatter().string(from: Date()),
                notes: notes.isEmpty ? nil : notes,
                created_by: userId
            )

            let inserted: [InsertedRes] = try await client
                .from("reservations")
                .insert(payload)
                .select("id")
                .execute()
                .value

            guard let reservationId = inserted.first?.id else {
                submitState = .error("Couldn't create the reservation.")
                return
            }

            let petRows = selectedPets.map { pet in
                ReservationPetPayload(
                    organization_id: organizationId,
                    reservation_id: reservationId,
                    pet_id: pet.id
                )
            }
            try await client.from("reservation_pets").insert(petRows).execute()

            submitState = .success(reservationId: reservationId)
        } catch {
            submitState = .error(error.localizedDescription)
        }
    }

    /// Grooming submit. Creates THREE related rows in order:
    ///   1. A `reservations` row — parent record so the appointment shows up
    ///      in the unified calendar/visits view alongside non-grooming bookings.
    ///   2. A `reservation_pets` row — one pet per grooming appointment per spec.
    ///   3. A `grooming_appointments` row — the groomer-specific record with
    ///      `groomer_id`, `start_time`, `estimated_duration_minutes`, etc.
    ///      `reservation_id` links back to the parent.
    /// All three are created with status='requested'; staff confirm on the web side.
    private func submitGrooming(svc: Service, ownerId: String, organizationId: String, userId: String?) async {
        guard let groomer = selectedGroomer,
              let slot = selectedSlot,
              let pet = selectedPets.first,
              !date.isEmpty else {
            submitState = .error("Missing groomer, slot, or pet.")
            return
        }
        submitState = .submitting

        // Compute start/end timestamps from date + slot + service duration.
        let durationMinutes = svc.defaultDurationMinutes
            ?? BookingHelpers.flatServiceDefaultDurationMinutes
        guard let startDate = BookingHelpers.combineDateTime(dateStr: date, timeStr: slot) else {
            submitState = .error("Invalid date or time slot.")
            return
        }
        let endDateValue = Calendar.current.date(
            byAdding: .minute, value: durationMinutes, to: startDate
        ) ?? startDate
        let iso = ISO8601DateFormatter()
        let startISO = iso.string(from: startDate)
        let endISO   = iso.string(from: endDateValue)

        do {
            // 1. Parent reservation row.
            let resPayload = ReservationPayload(
                organization_id: organizationId,
                location_id: selectedLocationId ?? svc.locationId,
                service_id: svc.id,
                primary_owner_id: ownerId,
                start_at: startISO,
                end_at: endISO,
                status: "requested",
                source: "owner_self_serve",
                requested_at: ISO8601DateFormatter().string(from: Date()),
                notes: notes.isEmpty ? nil : notes,
                created_by: userId
            )
            let inserted: [InsertedRes] = try await client
                .from("reservations").insert(resPayload).select("id").execute().value

            guard let reservationId = inserted.first?.id else {
                submitState = .error("Couldn't create the reservation.")
                return
            }

            // 2. Pet join.
            let petRow = ReservationPetPayload(
                organization_id: organizationId,
                reservation_id: reservationId,
                pet_id: pet.id
            )
            try await client.from("reservation_pets").insert(petRow).execute()

            // 3. Groomer-specific appointment row.
            struct GroomingApptPayload: Encodable {
                let organization_id: String
                let groomer_id: String
                let pet_id: String
                let owner_id: String
                let appointment_date: String   // "yyyy-MM-dd"
                let start_time: String         // "HH:mm:ss"
                let estimated_duration_minutes: Int
                let services_requested: [String]
                let price_cents: Int
                let status: String
                let reservation_id: String?
                let notes: String?
            }
            let apptPayload = GroomingApptPayload(
                organization_id: organizationId,
                groomer_id: groomer.id,
                pet_id: pet.id,
                owner_id: ownerId,
                appointment_date: date,
                start_time: "\(slot):00",   // DB stores seconds-precision time
                estimated_duration_minutes: durationMinutes,
                services_requested: [svc.id],
                price_cents: svc.basePriceCents,
                status: "requested",
                reservation_id: reservationId,
                notes: notes.isEmpty ? nil : notes
            )
            try await client.from("grooming_appointments").insert(apptPayload).execute()

            submitState = .success(reservationId: reservationId)
        } catch {
            submitState = .error(error.localizedDescription)
        }
    }

    // Shared payload structs so both submit paths use the same shape.
    private struct ReservationPayload: Encodable {
        let organization_id: String
        let location_id: String?
        let service_id: String
        let primary_owner_id: String
        let start_at: String
        let end_at: String
        let status: String
        let source: String
        let requested_at: String
        let notes: String?
        let created_by: String?
    }
    private struct ReservationPetPayload: Encodable {
        let organization_id: String
        let reservation_id: String
        let pet_id: String
    }
    private struct InsertedRes: Decodable { let id: String }

    /// Compute (startISO, endISO) for the reservation insert based on the
    /// duration type and current state. Returns nil if anything's missing.
    private func computeStartEnd(svc: Service) -> (String, String)? {
        let iso = ISO8601DateFormatter()
        switch svc.durationType {
        case .overnight, .multiNight:
            guard let s = BookingHelpers.combineDateTime(dateStr: date, timeStr: startTime),
                  let e = BookingHelpers.combineDateTime(
                      dateStr: endDate,
                      timeStr: endTime.isEmpty ? "11:00" : endTime
                  ) else { return nil }
            return (iso.string(from: s), iso.string(from: e))
        case .hourly:
            guard let s = BookingHelpers.combineDateTime(dateStr: date, timeStr: startTime) else { return nil }
            let e = Calendar.current.date(byAdding: .hour, value: max(1, hours), to: s) ?? s
            return (iso.string(from: s), iso.string(from: e))
        case .halfDay, .fullDay:
            guard let s = BookingHelpers.combineDateTime(dateStr: date, timeStr: startTime),
                  let e = BookingHelpers.combineDateTime(dateStr: date, timeStr: endTime.isEmpty ? startTime : endTime) else { return nil }
            return (iso.string(from: s), iso.string(from: e))
        case .flat:
            // Per-appointment: derive end_at from the default duration. Staff
            // can adjust the actual end time when they confirm/check-in.
            guard let s = BookingHelpers.combineDateTime(dateStr: date, timeStr: startTime) else { return nil }
            let e = Calendar.current.date(
                byAdding: .minute,
                value: BookingHelpers.flatServiceDefaultDurationMinutes,
                to: s
            ) ?? s
            return (iso.string(from: s), iso.string(from: e))
        }
    }
}
