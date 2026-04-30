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

@MainActor
final class CalendarViewModel: ObservableObject {
    @Published var reservations: [Reservation] = []
    @Published var isLoading: Bool = false
    @Published var loadError: String?

    private let client = SupabaseClientProvider.shared

    func load(ownerId: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            // Pull a generous window so navigating ±a few months doesn't refetch on
            // every swipe. Server-side filter could be tighter if this gets heavy.
            let rows: [Reservation] = try await client
                .from("reservations")
                .select()
                .eq("primary_owner_id", value: ownerId)
                .is("deleted_at", value: nil)
                .order("start_at", ascending: true)
                .limit(300)
                .execute()
                .value
            reservations = rows
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
            // overlaps if start < endOfDay && end >= startOfDay
            r.startAt < endOfDay && r.endAt > startOfDay
        }
    }

    func hasReservation(on day: Date, calendar: Calendar) -> Bool {
        !reservations(on: day, calendar: calendar).isEmpty
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
        if let owner = currentOwner.ownerId {
            await vm.load(ownerId: owner)
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
        let hasVisit = entry.date.map { vm.hasReservation(on: $0, calendar: calendar) } ?? false

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
                Circle()
                    .fill(hasVisit ? (isSelected ? SnoutTheme.onAccent : SnoutTheme.accent) : Color.clear)
                    .frame(width: 5, height: 5)
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
        HStack(spacing: SnoutTheme.Spacing.md) {
            ZStack {
                Circle().fill(SnoutTheme.surface).frame(width: 36, height: 36)
                Image(systemName: "pawprint.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(SnoutTheme.accent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(timeRange(r))
                    .font(SnoutTheme.body(15, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                Text(statusLabel(r.status))
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
