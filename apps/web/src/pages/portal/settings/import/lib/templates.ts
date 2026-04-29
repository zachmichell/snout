import type { DataType, SourceSystem, ColumnMapping } from "./types";

// snoutField -> possible CSV header names (case-insensitive)
type Template = Record<string, string[]>;

const TEMPLATES: Record<SourceSystem, Record<DataType, Template>> = {
  gingr: {
    owners: {
      external_id: ["Id", "ID", "id"],
      first_name: ["First Name", "FirstName", "first_name"],
      last_name: ["Last Name", "LastName", "last_name"],
      email: ["Email", "Email Address"],
      phone: ["Cell Phone", "Mobile", "Phone"],
      home_phone: ["Home Phone"],
      street_address: ["Address 1", "Address", "Street Address", "Address Line 1"],
      city: ["City"],
      state_province: ["State", "Province", "State/Province"],
      postal_code: ["Zip", "Zip/Postal", "Postal Code"],
      referral_source: ["Referral Source"],
      notes: ["Notes"],
    },
    pets: {
      external_id: ["id", "Id", "ID"],
      name: ["name", "Pet Name", "Name"],
      owner_name: ["o_name", "Owner Name", "Owner"],
      species: ["species", "Species", "Type"],
      breed: ["breed", "Breed"],
      sex: ["gender", "Gender", "Sex"],
      is_fixed: ["fixed", "Fixed", "Spayed/Neutered"],
      date_of_birth: ["birthday", "Birthday", "DOB", "Date of Birth"],
      weight_lbs: ["weight", "Weight"],
      color: ["color", "Color"],
      microchip_id: ["microchip", "Microchip", "Chip ID"],
      veterinarian: ["vet", "Vet", "Veterinarian"],
    },
    vaccinations: {
      pet_name: ["Pet Name"],
      owner_email: ["Owner Email"],
      vaccine_name: ["Vaccine", "Vaccination"],
      administered_date: ["Date Given", "Administered"],
      expiry_date: ["Expiration", "Expires"],
      vet_name: ["Vet", "Veterinarian"],
      vet_clinic: ["Clinic"],
    },
    reservations: {
      owner_email: ["Owner Email"],
      pet_name: ["Pet Name"],
      service_name: ["Service", "Service Type"],
      start_at: ["Check In", "Start", "Drop Off"],
      end_at: ["Check Out", "End", "Pick Up"],
      notes: ["Notes"],
    },
  },
  petexec: {
    owners: {
      first_name: ["First Name"],
      last_name: ["Last Name"],
      email: ["Email"],
      phone: ["Phone"],
      street_address: ["Address 1", "Address"],
      city: ["City"],
      state_province: ["State"],
      postal_code: ["Zip"],
    },
    pets: {
      name: ["Pet Name"],
      species: ["Species"],
      breed: ["Breed"],
      sex: ["Gender"],
      date_of_birth: ["Birthdate"],
      weight_lbs: ["Weight"],
      color: ["Color"],
      microchip_id: ["Microchip"],
      owner_email: ["Owner Email"],
    },
    vaccinations: {
      pet_name: ["Pet Name"],
      owner_email: ["Owner Email"],
      vaccine_name: ["Vaccine Type"],
      administered_date: ["Last Given"],
      expiry_date: ["Expires"],
      vet_name: ["Vet"],
      vet_clinic: ["Clinic"],
    },
    reservations: {
      owner_email: ["Owner Email"],
      pet_name: ["Pet"],
      service_name: ["Service"],
      start_at: ["Start Date"],
      end_at: ["End Date"],
      notes: ["Notes"],
    },
  },
  daysmart: {
    owners: {
      first_name: ["First", "First Name"],
      last_name: ["Last", "Last Name"],
      email: ["Email"],
      phone: ["Phone", "Cell"],
      street_address: ["Address"],
      city: ["City"],
      state_province: ["State"],
      postal_code: ["Zip"],
    },
    pets: {
      name: ["Animal Name", "Pet"],
      species: ["Species"],
      breed: ["Breed"],
      sex: ["Sex"],
      date_of_birth: ["Birth Date"],
      weight_lbs: ["Weight"],
      color: ["Color"],
      microchip_id: ["Chip"],
      owner_email: ["Client Email", "Owner Email"],
    },
    vaccinations: {
      pet_name: ["Animal Name"],
      owner_email: ["Client Email"],
      vaccine_name: ["Vaccine"],
      administered_date: ["Date"],
      expiry_date: ["Expiration"],
      vet_name: ["Vet"],
      vet_clinic: ["Clinic"],
    },
    reservations: {
      owner_email: ["Client Email"],
      pet_name: ["Animal Name"],
      service_name: ["Service"],
      start_at: ["Start"],
      end_at: ["End"],
      notes: ["Comments", "Notes"],
    },
  },
  other: { owners: {}, pets: {}, vaccinations: {}, reservations: {} },
};

export function autoMap(
  source: SourceSystem,
  dataType: DataType,
  csvHeaders: string[],
): ColumnMapping {
  const template = TEMPLATES[source]?.[dataType] ?? {};
  const mapping: ColumnMapping = {};
  const lowerHeaders = csvHeaders.map((h) => h.toLowerCase().trim());

  for (const [snoutField, candidates] of Object.entries(template)) {
    for (const candidate of candidates) {
      const idx = lowerHeaders.indexOf(candidate.toLowerCase().trim());
      if (idx !== -1) {
        mapping[snoutField] = csvHeaders[idx];
        break;
      }
    }
  }
  return mapping;
}
