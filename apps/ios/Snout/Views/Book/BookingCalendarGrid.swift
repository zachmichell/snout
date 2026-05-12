//
//  BookingCalendarGrid.swift
//  Snout
//
//  Month-grid calendar used by the booking wizard's slot picker. Days that
//  aren't in `availableDates` (or that are in the past) are visually disabled
//  and not tappable; days that *are* in the set look interactive and select
//  on tap.
//
//  Reused from the visual language of the Calendar tab (CalendarView) so the
//  app feels consistent — light cotton highlight on Today, accent pill on
//  the selected day, faint chrome for non-current-month / unavailable days.
//

import SwiftUI

struct BookingCalendarGrid: View {
    /// Dates the user is allowed to pick. yyyy-MM-dd strings (DB-format).
    let availableDates: Set<String>
    /// Currently-picked date. Empty string when nothing's chosen.
    @Binding var selectedDate: String

    @State private var displayedMonth: Date = Date()

    private let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "America/Regina") ?? .current
        c.firstWeekday = 1
        return c
    }()

    private let dbDateFormat: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "America/Regina") ?? .current
        return f
    }()

    var body: some View {
        VStack(spacing: SnoutTheme.Spacing.md) {
            monthHeader
            weekdayLabels
            monthGrid
        }
        .padding(SnoutTheme.Spacing.md)
        .background(SnoutTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous)
                .stroke(SnoutTheme.divider, lineWidth: 1)
        )
        .onAppear { syncDisplayedMonthWithSelection() }
        .onChange(of: selectedDate) { _, _ in syncDisplayedMonthWithSelection() }
    }

    private func syncDisplayedMonthWithSelection() {
        guard !selectedDate.isEmpty,
              let d = dbDateFormat.date(from: selectedDate) else { return }
        if !calendar.isDate(displayedMonth, equalTo: d, toGranularity: .month) {
            displayedMonth = d
        }
    }

    // MARK: - Month nav

    private var monthHeader: some View {
        HStack {
            Button { shiftMonth(by: -1) } label: {
                SnoutGlyph("chevron.left", size: 14, weight: .semibold)
                    .foregroundStyle(SnoutTheme.onSurface)
                    .frame(width: 32, height: 32)
                    .background(SnoutTheme.background)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canShift(by: -1))
            .opacity(canShift(by: -1) ? 1 : 0.4)

            Spacer()
            Text(monthLabel)
                .font(SnoutTheme.body(15, weight: .semibold))
                .foregroundStyle(SnoutTheme.onSurface)
            Spacer()

            Button { shiftMonth(by: 1) } label: {
                SnoutGlyph("chevron.right", size: 14, weight: .semibold)
                    .foregroundStyle(SnoutTheme.onSurface)
                    .frame(width: 32, height: 32)
                    .background(SnoutTheme.background)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canShift(by: 1))
            .opacity(canShift(by: 1) ? 1 : 0.4)
        }
    }

    private var monthLabel: String {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.dateFormat = "MMMM yyyy"
        return f.string(from: displayedMonth)
    }

    private func shiftMonth(by months: Int) {
        if let next = calendar.date(byAdding: .month, value: months, to: displayedMonth) {
            withAnimation(.easeInOut(duration: 0.18)) { displayedMonth = next }
        }
    }

    /// Allow nav within ±2 months of the current selection or today, so the
    /// user can browse but doesn't get lost outside the 90-day fetched window.
    private func canShift(by months: Int) -> Bool {
        guard let candidate = calendar.date(byAdding: .month, value: months, to: displayedMonth)
        else { return false }
        let today = calendar.startOfDay(for: Date())
        let twoMonthsFromToday = calendar.date(byAdding: .month, value: 4, to: today) ?? today
        let oneMonthBackFromToday = calendar.date(byAdding: .month, value: -1, to: today) ?? today
        return candidate >= oneMonthBackFromToday && candidate <= twoMonthsFromToday
    }

    // MARK: - Weekday header

    private var weekdayLabels: some View {
        HStack(spacing: 0) {
            ForEach(calendar.shortStandaloneWeekdaySymbols, id: \.self) { sym in
                Text(sym.prefix(1).uppercased())
                    .font(SnoutTheme.labelSM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - Grid

    private var monthGrid: some View {
        let entries = monthEntries(displayedMonth)
        let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        return LazyVGrid(columns: columns, spacing: 6) {
            ForEach(entries.indices, id: \.self) { i in
                dayCell(entries[i])
            }
        }
    }

    @ViewBuilder
    private func dayCell(_ entry: DayEntry) -> some View {
        if let date = entry.date, let dayNum = entry.dayNumber {
            let dateStr = dbDateFormat.string(from: date)
            let isSelected = dateStr == selectedDate
            let isAvailable = availableDates.contains(dateStr)
            let isToday = calendar.isDateInToday(date)
            let isPast = date < calendar.startOfDay(for: Date())
            let isTappable = isAvailable && !isPast

            Button {
                if isTappable {
                    selectedDate = dateStr
                }
            } label: {
                Text("\(dayNum)")
                    .font(SnoutTheme.body(14, weight: isToday ? .semibold : .regular))
                    .foregroundStyle(
                        isSelected
                            ? SnoutTheme.onAccent
                            : (isTappable
                                ? SnoutTheme.onSurface
                                : SnoutTheme.onSurfaceFaint)
                    )
                    .frame(width: 36, height: 36)
                    .background(
                        Group {
                            if isSelected {
                                Circle().fill(SnoutTheme.accent)
                            } else if isToday && isTappable {
                                Circle().fill(SnoutTheme.cotton.opacity(0.5))
                            }
                        }
                    )
                    .opacity(isTappable ? 1 : 0.45)
            }
            .buttonStyle(.plain)
            .disabled(!isTappable)
        } else {
            // Padding cell for leading/trailing empty grid slots.
            Color.clear.frame(height: 36)
        }
    }

    // MARK: - Date math

    private struct DayEntry {
        let date: Date?
        let dayNumber: Int?
    }

    private func monthEntries(_ anchor: Date) -> [DayEntry] {
        guard let interval = calendar.dateInterval(of: .month, for: anchor) else { return [] }
        let firstDay = interval.start
        let firstWeekday = calendar.component(.weekday, from: firstDay)
        let leadingBlanks = (firstWeekday - calendar.firstWeekday + 7) % 7
        let daysInMonth = calendar.range(of: .day, in: .month, for: firstDay)?.count ?? 30

        var entries: [DayEntry] = Array(repeating: .init(date: nil, dayNumber: nil), count: leadingBlanks)
        for day in 1...daysInMonth {
            if let d = calendar.date(byAdding: .day, value: day - 1, to: firstDay) {
                entries.append(.init(date: d, dayNumber: day))
            }
        }
        let trailing = (7 - entries.count % 7) % 7
        entries.append(contentsOf: Array(repeating: .init(date: nil, dayNumber: nil), count: trailing))
        return entries
    }
}
