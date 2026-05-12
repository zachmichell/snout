//
//  BookView.swift
//  Snout
//
//  The Book tab. Hosts the native booking wizard end-to-end.
//

import SwiftUI

struct BookView: View {
    var body: some View {
        BookingWizardView()
    }
}

#Preview {
    BookView()
        .environmentObject(CurrentOwnerService())
}
