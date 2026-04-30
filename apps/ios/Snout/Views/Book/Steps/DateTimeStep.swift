//
//  DateTimeStep.swift
//  Snout — booking wizard step 3
//
//  Different layout per duration_type:
//   • hourly        — date + start time + 1–4 hour duration
//   • half/full day — date + drop-off + pick-up
//   • overnight / multi-night — check-in date + check-out date + check-in/out times
//
//  Live price estimate at the bottom updates as the user changes inputs.
//

import SwiftUI

struct DateTimeStep: View {
    @ObservedObject var vm: BookingWizardViewModel

    private static let timeSlots = BookingHelpers.generateTimeSlots()

    var body: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            if let svc = vm.selectedService {
                switch svc.durationType {
                case .halfDay, .fullDay:
                    halfFullDayInputs
                case .overnight, .multiNight:
                    overnightInputs
                case .hourly:
                    hourlyInputs
                case .flat:
                    flatInputs
                }
            }

            estimateCard
        }
    }

    // MARK: - Inputs per duration type

    private var halfFullDayInputs: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            datePicker(label: "DATE", binding: $vm.date, minDate: BookingHelpers.tomorrowISODate())
            HStack(spacing: SnoutTheme.Spacing.md) {
                timeMenu(label: "DROP-OFF", binding: $vm.startTime)
                timeMenu(label: "PICK-UP", binding: $vm.endTime)
            }
        }
    }

    private var overnightInputs: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            HStack(spacing: SnoutTheme.Spacing.md) {
                datePicker(label: "CHECK-IN", binding: $vm.date, minDate: BookingHelpers.tomorrowISODate())
                datePicker(label: "CHECK-OUT", binding: $vm.endDate, minDate: vm.date.isEmpty ? BookingHelpers.tomorrowISODate() : vm.date)
            }
            Text("\(vm.nights) night\(vm.nights == 1 ? "" : "s")")
                .font(SnoutTheme.bodySM)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            HStack(spacing: SnoutTheme.Spacing.md) {
                timeMenu(label: "CHECK-IN TIME", binding: $vm.startTime)
                timeMenu(label: "CHECK-OUT TIME", binding: $vm.endTime)
            }
        }
    }

    private var hourlyInputs: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            datePicker(label: "DATE", binding: $vm.date, minDate: BookingHelpers.tomorrowISODate())
            HStack(spacing: SnoutTheme.Spacing.md) {
                timeMenu(label: "START TIME", binding: $vm.startTime)
                durationMenu
            }
        }
    }

    private var flatInputs: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.lg) {
            datePicker(label: "DATE", binding: $vm.date, minDate: BookingHelpers.tomorrowISODate())
            timeMenu(label: "START TIME", binding: $vm.startTime)
            // Quiet note explaining there's no duration input — the flat fee
            // covers the appointment regardless of length, and the facility
            // sets the actual end time when they confirm.
            Text("Flat fee — your facility will set the actual end time when they confirm.")
                .font(SnoutTheme.bodySM)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
                .padding(SnoutTheme.Spacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(SnoutTheme.background)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusSM, style: .continuous))
        }
    }

    // MARK: - Reusable controls

    private func datePicker(label: String, binding: Binding<String>, minDate: String) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text(label)
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)

            // SwiftUI DatePicker works on Date, so convert to/from yyyy-MM-dd.
            DatePicker(
                "",
                selection: dateBinding(for: binding, fallback: minDate),
                in: dateBound(minDate: minDate)...,
                displayedComponents: .date
            )
            .labelsHidden()
            .datePickerStyle(.compact)
            .padding(.horizontal, SnoutTheme.Spacing.md)
            .padding(.vertical, SnoutTheme.Spacing.sm)
            .background(SnoutTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous)
                    .stroke(SnoutTheme.divider, lineWidth: 1)
            )
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func timeMenu(label: String, binding: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text(label)
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Menu {
                ForEach(Self.timeSlots, id: \.value) { slot in
                    Button(slot.label) { binding.wrappedValue = slot.value }
                }
            } label: {
                HStack {
                    Text(timeLabel(for: binding.wrappedValue))
                        .font(SnoutTheme.bodyMD)
                        .foregroundStyle(SnoutTheme.onSurface)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                .padding(SnoutTheme.Spacing.md)
                .background(SnoutTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous)
                        .stroke(SnoutTheme.divider, lineWidth: 1)
                )
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var durationMenu: some View {
        VStack(alignment: .leading, spacing: SnoutTheme.Spacing.xs) {
            Text("DURATION")
                .font(SnoutTheme.labelSM)
                .tracking(0.8)
                .foregroundStyle(SnoutTheme.onSurfaceMuted)
            Menu {
                ForEach(1...4, id: \.self) { h in
                    Button("\(h) hour\(h == 1 ? "" : "s")") { vm.hours = h }
                }
            } label: {
                HStack {
                    Text("\(vm.hours) hour\(vm.hours == 1 ? "" : "s")")
                        .font(SnoutTheme.bodyMD)
                        .foregroundStyle(SnoutTheme.onSurface)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(SnoutTheme.onSurfaceMuted)
                }
                .padding(SnoutTheme.Spacing.md)
                .background(SnoutTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: SnoutTheme.radiusCard, style: .continuous)
                        .stroke(SnoutTheme.divider, lineWidth: 1)
                )
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Estimate card

    private var estimateCard: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Estimated total")
                    .font(SnoutTheme.body(14, weight: .semibold))
                    .foregroundStyle(SnoutTheme.onSurface)
                Text("Final price set by staff when they confirm.")
                    .font(SnoutTheme.bodySM)
                    .foregroundStyle(SnoutTheme.onSurfaceMuted)
            }
            Spacer()
            Text(Money.formatCents(vm.estimatedPriceCents))
                .font(SnoutTheme.display(22, weight: .regular))
                .foregroundStyle(SnoutTheme.onSurface)
        }
        .snoutTinted(SnoutTheme.cotton)
    }

    // MARK: - Date conversion

    private func dateBinding(for stringBinding: Binding<String>, fallback: String) -> Binding<Date> {
        Binding(
            get: {
                BookingHelpers.combineDateTime(dateStr: stringBinding.wrappedValue.isEmpty ? fallback : stringBinding.wrappedValue, timeStr: "00:00")
                    ?? Date()
            },
            set: { newDate in
                let f = DateFormatter()
                f.dateFormat = "yyyy-MM-dd"
                f.timeZone = TimeZone(identifier: "America/Regina") ?? .current
                stringBinding.wrappedValue = f.string(from: newDate)
            }
        )
    }

    private func dateBound(minDate: String) -> Date {
        BookingHelpers.combineDateTime(dateStr: minDate, timeStr: "00:00") ?? Date()
    }

    private func timeLabel(for value: String) -> String {
        Self.timeSlots.first(where: { $0.value == value })?.label ?? "—"
    }
}
