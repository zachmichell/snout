//
//  CalendarView.swift
//  Snout
//
//  Month-grid calendar of the owner's reservations. Days with one or more
//  visits get an accent dot; tapping a day reveals a panel below the grid with
//  that day's reservations.
//
//  Data: pulls reservations for the signed-in owner via primary_owner_id and
//  filters to visits that overlap the displayed month. Realtime updates aren't
//  wired here yet — pull-to-refresh is the catch-up.
//

import SwiftUI

/// Maps a service `module` to a Boho Rainbow color so the calendar dots
/// communicate "what kind of visit" at a glance. Modules that don't have
/// a dedicated tone (or unknowns) fall back to Soft Camel (the brand accent).
enum CalendarModule: String, CaseIterable, Hashable {
    case daycare
    case boarding
    case grooming
    case training
    case retail
    case other

    init(module: String?) {
        switch module?.lowercased() {
        case "daycare":  self = .daycare
        case "boarding": self = .boarding
        case "grooming": self = .grooming
        case "training": self = .training
        case "retail":   self = .retail
        default:         self = .other
        }
    }

    var color: Color {
        // High-frequency services (daycare, boarding, grooming) get the three
        // most-contrasting hues from Boho Rainbow — warm pink, cool blue-grey,
        // and sage green — so they're easy to tell apart at a glance.
        // Lower-frequency tiers reuse warm-family tones (close to cotton) since
        // they're rare enough that a casual glance won't confuse them.
        switch self {
        case .daycare:   return SnoutTheme.cotton    // warm pink (hue ~14°)
        case .boarding:  return SnoutTheme.frost     // cool blue-grey (hue ~187°)
        case .grooming:  return SnoutTheme.mist      // sage green (hue ~102°)
        case .training:  return SnoutTheme.vanilla   // warm cream — secondary tier
        case .retail:    return SnoutTheme.blueberry // dusty rose — secondary tier
        case .other:     return SnoutTheme.accent    // soft camel fallback
        }
    }

    var label: String {
        switch self {
        case .daycare:  return "Daycare"
        case .boarding: return "Boarding"
        case .grooming: return "Grooming"
        case .training: return "Training"
        case .retail:   return "Retail"
        case .other:    return "Other"
        }
    }
}

@MainActor
final class CalendarViewModel: ObservableObject {
    @Published var reservations: [Reservation] = []
    @Published var services: [Service] = []
    @Published var isLoading: Bool = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared

    func load(ownerId: String, organizationId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            // Reservations and services in parallel — services are needed to
            // map each reservation's service_id to a module, which drives the
            // dot color on each day cell.
            async let resTask: [Reservation] = client
                .from("reservations")
                .select()
                .eq("primary_owner_id", value: ownerId)
                .is("deleted_at", value: nil)
                .order("start_at", ascending: true)
                .limit(300)
                .execute()
                .value
            async let svcTask: [Service] = client
                .from("services")
                .select()
                .eq("organization_id", value: organizationId)
                .is("deleted_at", value: nil)
                .execute()
                .value

            reservations = (try? await resTask) ?? []
            services     = (try? await svcTask) ?? []
            loadError = nil
        } catch {
            loadError = error.localizedDescription
        }
    }

    /// Reservations that overlap the given calendar day in `America/Regina`.
    func reservations(on day: Date, calendar: Calendar) -> [Reservation] {
        let startOfDay = calendar.startOfDay(for: day)
        guard let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay) else { return [] }
        return reservations.filter { r in
            r.startAt < endOfDay && r.endAt > startOfDay
        }
    }

    func hasReservation(on day: Date, calendar: Calendar) -> Bool {
        !reservations(on: day, calendar: calendar).isEmpty
    }

    /// Up-to-3 distinct module dots for a given day, ordered by visit start time.
    /// Used by the calendar grid to render colored markers under the day number.
    func modules(on day: Date, calendar: Calendar) -> [CalendarModule] {
        let visits = reservations(on: day, calendar: calendar)
        var seen = Set<CalendarModule>()
        var result: [CalendarModule] = []
        for r in visits {
            let mod = module(for: r)
            if !seen.contains(mod) {
                seen.insert(mod)
                result.append(mod)
                if result.count >= 3 { break }
            }
        }
        return result
    }

    /// Module for a single reservation — looks up the service by id.
    func module(for reservation: Reservation) -> CalendarModule {
        guard let svcId = reservation.serviceId,
              let svc = services.first(where: { $0.id == svcId }) else {
            return .other
        }
        return CalendarModule(module: svc.module)
    }

    /// Modules that appear in *any* of the loaded reservations. Used for the
    /// legend so we only show pills for service types the user actually uses.
    var legendModules: [CalendarModule] {
        var seen = Set<CalendarModule>()
        var ordered: [CalendarModule] = []
        for r in reservations {
            let mod = module(for: r)
            if !seen.contains(mod) {
                seen.insert(mod)
                ordered.append(mod)
            }
        }
        // Keep a stable display order matching the enum.
        return CalendarModule.allCases.filter(seen.contains)
    }
}

struct CalendarView: View {
    @EnvironmentObject private var currentOwner: CurrentOwnerService
    @StateObject private var vm = CalendarViewModel()

    @State private var displayedMonth: Date = Date()
    @State private var selectedDay: Date?

    private let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/Regina") ?? .current
        c.firstWeekday = 1  // Sunday
        return c
    }()

    var body: some View {
        NavigationStack {
            ZStack {
                SnoutTheme.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: SnoutTheme.Spacing.lg) {
                        header
                        monthHeader
                        weekdayLabels
                        monthGrid
                        legend
                        if let selected = selectedDay {
                            daySheet(for: selected)
                        }
                        Spacer(minLength: 120)
                    }
                    .padding(.horizontal, SnoutTheme.Spacing.xl)
                    .padding(.top, SnoutTheme.Spacing.xl)
                }
                .scrollContentBackground(.hidden)
                .refreshable { await loadIfReady() }
            }
            .navigationBarHidden(true)
            .task { await loadIfReady() }
        }
    }

    private func loadIfReady() async {
        if let owner = currentOwner.ownerId,
           let org   = currentOwner.organizationId {
            await vm.load(ownerId: owner, organizationId: org)
        }
    }

    // MARK: - Title

    private var header: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text("CALENDAR")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Text(headlineMonth)
                .font(SnoutTheme.titleXL)
                .foregroundStyle(SnoutTheme.onSurface)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var headlineMonth: String {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.dateFormat = "MMMM yyyy"
        return f.string(from: displayedMonth)
    }

    // MARK: - Month nav

    private var monthHeader: some View {
        HStack {
            Button {
                shiftMonth(by: -1)
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                    .frame(width: 36, height: 36)
                    .background(SnoutTheme.surface)
                    .clipShape(Circle())
                    .shadow(color: SnoutTheme.cardShadowColor,
                            radius: SnoutTheme.cardShadowRadius, x: 0, y: SnoutTheme.cardShadowY)
            }
            .buttonStyle(.plain)
            Spacer()
            Button {
                displayedMonth = Date()
                selectedDay = Date()
            } label: {
                Text("Today")
                    .font(SnoutTheme.body(13, weight: .semibold))
                    .foregroundStyle(SnoutTheme.accent)
                    .padding(.horizontal, SnoutTheme.Spacing.md)
                    .padding(.vertical, 8)
                    .background(SnoutTheme.surface)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
            Spacer()
            Button {
                shiftMonth(by: 1)
            } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                    .frame(width: 36, height: 36)
                    .background(SnoutTheme.surface)
                    .clipShape(Circle())
                    .shadow(color: SnoutTheme.cardShadowColor,
                            radius: SnoutTheme.cardShadowRadius, x: 0, y: SnoutTheme.cardShadowY)
            }
            .buttonStyle(.plain)
        }
    }

    private func shiftMonth(by months: Int) {
        if let next = calendar.date(byAdding: .month, value: months, to: displayedMonth) {
            withAnimation(.easeInOut(duration: 0.2)) {
                displayedMonth = next
            }
        }
    }

    // MARK: - Weekday header

    private var weekdayLabels: some View {
        let symbols = calendar.shortStandaloneWeekdaySymbols // ["Sun", "Mon", ...]
        return HStack(spacing: 0) {
            ForEach(symbols, id: \.self) { sym in
                Text(sym.uppercased())
                    .font(SnoutTheme.labelSM)
                    .tracking(0.6)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - Month grid

    private var monthGrid: some View {
        let days = monthDays(of: displayedMonth)
        let columns = Array(repeating: GridItem(.flexible(), spacing: 6), count: 7)
        return LazyVGrid(columns: columns, spacing: 8) {
            ForEach(days, id: \.self) { day in
                dayCell(day)
            }
        }
    }

    private func dayCell(_ entry: DayEntry) -> some View {
        let isToday = entry.date.map { calendar.isDateInToday($0) } ?? false
        let isSelected = entry.date.map { d in
            selectedDay.map { calendar.isDate($0, inSameDayAs: d) } ?? false
        } ?? false
        // Up to 3 distinct module colors for the day's visits.
        let modules: [CalendarModule] = entry.date.map {
            vm.modules(on: $0, calendar: calendar)
        } ?? []

        return Button {
            if let d = entry.date {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                    selectedDay = d
                }
            }
        } label: {
            VStack(spacing: 4) {
                Text(entry.dayNumber.map { "\($0)" } ?? "")
                    .font(SnoutTheme.body(15, weight: isToday ? .semibold : .regular))
                    .foregroundStyle(
                        isSelected ? SnoutTheme.onAccent :
                        (entry.date == nil ? SnoutTheme.onSurfaceFaint : SnoutTheme.onSurface)
                    )
                // Module dots: one Boho-tone circle per distinct service type
                // on this day (max 3). When the day is selected, dots flip to
                // a single white pip so they read against the accent fill.
                if isSelected && !modules.isEmpty {
                    Circle()
                        .fill(SnoutTheme.onAccent)
                        .frame(width: 5, height: 5)
                } else if !modules.isEmpty {
                    HStack(spacing: 3) {
                        ForEach(modules.indices, id: \.self) { i in
                            Circle()
                                .fill(modules[i].color)
                                .frame(width: 5, height: 5)
                        }
                    }
                } else {
                    Circle().fill(Color.clear).frame(width: 5, height: 5)
                }
            }
            .frame(height: 44)
            .frame(maxWidth: .infinity)
            .background(
                isSelected ? AnyView(Capsule().fill(SnoutTheme.accent))
                : (isToday ? AnyView(Capsule().fill(SnoutTheme.cotton.opacity(0.6))) : AnyView(Color.clear))
            )
        }
        .buttonStyle(.plain)
        .disabled(entry.date == nil)
    }

    // MARK: - Legend

    /// Pills showing which Boho tone maps to which service type. Only shows
    /// modules the user actually has visits for, so brand-new accounts don't
    /// see a meaningless full-spectrum row. Hidden entirely until visits load.
    @ViewBuilder
    private var legend: some View {
        let modules = vm.legendModules
        if !modules.isEmpty {
            VStack(alignment: .leading, spacing: SnoutTheme.Spacing.sm) {
                Text("WHAT THE DOTS MEAN")
                    .font(SnoutTheme.labelSM)
                    .tracking(0.8)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: SnoutTheme.Spacing.sm) {
                        ForEach(modules, id: \.self) { module in
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(module.color)
                                    .frame(width: 8, height: 8)
                                Text(module.label)
                                    .font(SnoutTheme.labelMD)
                                    .foregroundStyle(SnoutTheme.onSurface)
                            }
                            .padding(.horizontal, SnoutTheme.Spacing.md)
                            .padding(.vertical, 6)
                            .background(SnoutTheme.surface)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(SnoutTheme.divider, lineWidth: 1))
                        }
                    }
                }
                .scrollClipDisabled() // Let pill shadows breathe past the scroll edge.
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Day detail

    private func daySheet(for day: Date) -> some View {
        let visits = vm.reservations(on: day, calendar: calendar)
        return VStack(alignment: .leading, spacing: SnoutTheme.Spacing.md) {
            HStack {
                Text(dayHeading(day))
                    .font(SnoutTheme.titleMD)
                    .foregroundStyle(SnoutTheme.onSurface)
                Spacer()
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { selectedDay = nil }
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                        .frame(width: 28, height: 28)
                        .background(SnoutTheme.surface)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
            if visits.isEmpty {
                Text("No visits scheduled.")
                    .font(SnoutTheme.bodyMD)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            } else {
                ForEach(visits, id: \.id) { v in
                    visitRow(v)
                }
            }
        }
        .snoutTinted(SnoutTheme.mist)
    }

    private func visitRow(_ r: Reservation) -> some View {
        let module = vm.module(for: r)
        return HStack(spacing: SnoutTheme.Spacing.md) {
            // Module-tinted avatar so the dot color from the calendar grid
            // carries through to the detail panel — same color = same kind
            // of visit.
            ZStack {
                Circle().fill(module.color.opacity(0.6)).frame(width: 36, height: 36)
                Image(systemName: "pawprint.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(timeRange(r))
                    .font(SnoutTheme.body(15, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                Text(module.label)
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
            Spacer()
            SnoutBadge(
                text: statusLabel(r.status),
                background: SnoutTheme.statusBackground(for: r.status),
                foreground: SnoutTheme.statusForeground(for: r.status)
            )
        }
    }

    private func timeRange(_ r: Reservation) -> String {
        let f = DateFormatter()
        f.timeZone = calendar.timeZone
        f.dateFormat = "h:mm a"
        return "\(f.string(from: r.startAt)) – \(f.string(from: r.endAt))"
    }

    private func statusLabel(_ s: ReservationStatus) -> String {
        switch s {
        case .requested:    return "Requested"
        case .confirmed:    return "Confirmed"
        case .checkedIn:    return "Checked in"
        case .checkedOut:   return "Checked out"
        case .cancelled:    return "Cancelled"
        case .noShow:       return "No show"
        }
    }

    private func dayHeading(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.dateFormat = "EEEE, MMM d"
        return f.string(from: d)
    }

    // MARK: - Date math

    private struct DayEntry: Hashable {
        let date: Date?         // nil for leading/trailing padding cells
        let dayNumber: Int?
    }

    private func monthDays(of anchor: Date) -> [DayEntry] {
        guard let monthInterval = calendar.dateInterval(of: .month, for: anchor) else { return [] }
        let firstDay = monthInterval.start
        // Number of leading blanks based on weekday of the 1st (1=Sunday with firstWeekday=1)
        let firstWeekday = calendar.component(.weekday, from: firstDay) // 1...7
        let leadingBlanks = (firstWeekday - calendar.firstWeekday + 7) % 7
        let daysInMonth = calendar.range(of: .day, in: .month, for: firstDay)?.count ?? 30

        var entries: [DayEntry] = []
        for _ in 0..<leadingBlanks {
            entries.append(.init(date: nil, dayNumber: nil))
        }
        for day in 1...daysInMonth {
            if let d = calendar.date(byAdding: .day, value: day - 1, to: firstDay) {
                entries.append(.init(date: d, dayNumber: day))
            }
        }
        // Trailing blanks to complete the last row (multiple of 7).
        let trailing = (7 - entries.count % 7) % 7
        for _ in 0..<trailing {
            entries.append(.init(date: nil, dayNumber: nil))
        }
        return entries
    }
}

#Preview {
    CalendarView()
        .environmentObject(CurrentOwnerService())
}
