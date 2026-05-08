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
  // MoeGo column maps. MoeGo is grooming-first SaaS popular with
  // independent salons. Their CSV exports use friendly column names
  // ("Customer Name", "Pet Name") rather than the system-y headers
  // some others use. The candidate lists below cover headers seen in
  // MoeGo's standard customer / pet / appointment exports — operators
  // exporting from a customized MoeGo report may need to fall through
  // to the manual-mapping step.
  moego: {
    owners: {
      first_name: ["First Name", "Customer First Name"],
      last_name: ["Last Name", "Customer Last Name"],
      email: ["Email", "Customer Email"],
      phone: ["Phone", "Mobile", "Cell"],
      home_phone: ["Home Phone"],
      street_address: ["Address", "Address 1", "Street"],
      city: ["City"],
      state_province: ["State", "Province"],
      postal_code: ["Zip", "Postal Code"],
      notes: ["Notes", "Customer Notes"],
    },
    pets: {
      name: ["Pet Name", "Pet"],
      species: ["Species", "Type"],
      breed: ["Breed"],
      sex: ["Gender", "Sex"],
      is_fixed: ["Spayed/Neutered", "Fixed"],
      date_of_birth: ["Birthday", "DOB", "Date of Birth"],
      weight_lbs: ["Weight"],
      color: ["Color", "Coat Color"],
      microchip_id: ["Microchip"],
      veterinarian: ["Vet", "Veterinarian"],
      owner_email: ["Owner Email", "Customer Email"],
    },
    vaccinations: {
      pet_name: ["Pet Name"],
      owner_email: ["Owner Email", "Customer Email"],
      vaccine_name: ["Vaccine", "Vaccination"],
      administered_date: ["Date Given", "Vaccination Date"],
      expiry_date: ["Expiration", "Expires"],
      vet_name: ["Vet"],
      vet_clinic: ["Clinic"],
    },
    reservations: {
      owner_email: ["Owner Email", "Customer Email"],
      pet_name: ["Pet Name", "Pet"],
      service_name: ["Service", "Appointment Type"],
      start_at: ["Start Time", "Appointment Time", "Drop Off"],
      end_at: ["End Time", "Pick Up"],
      notes: ["Notes", "Comments"],
    },
  },
  // Time To Pet column maps. TTP is dog-walking-first but used by some
  // boarding/daycare operators too. Their exports tend to use
  // capitalized two-word headers ("First Name", "Pet Name", etc.).
  timetopet: {
    owners: {
      first_name: ["First Name"],
      last_name: ["Last Name"],
      email: ["Email"],
      phone: ["Phone", "Mobile Phone", "Cell"],
      home_phone: ["Home Phone"],
      street_address: ["Address", "Address Line 1"],
      city: ["City"],
      state_province: ["State"],
      postal_code: ["Zip", "Zip Code"],
      notes: ["Notes"],
    },
    pets: {
      name: ["Pet Name", "Pet"],
      species: ["Species", "Animal Type"],
      breed: ["Breed"],
      sex: ["Sex", "Gender"],
      is_fixed: ["Spayed/Neutered"],
      date_of_birth: ["Date of Birth", "Birthday"],
      weight_lbs: ["Weight"],
      color: ["Color"],
      microchip_id: ["Microchip Number", "Microchip"],
      veterinarian: ["Veterinarian", "Vet"],
      owner_email: ["Client Email", "Owner Email"],
    },
    vaccinations: {
      pet_name: ["Pet Name"],
      owner_email: ["Client Email", "Owner Email"],
      vaccine_name: ["Vaccine"],
      administered_date: ["Vaccination Date"],
      expiry_date: ["Expiration Date"],
      vet_name: ["Vet"],
      vet_clinic: ["Clinic"],
    },
    reservations: {
      owner_email: ["Client Email", "Owner Email"],
      pet_name: ["Pet Name"],
      service_name: ["Service", "Service Type"],
      start_at: ["Start Date", "Visit Date"],
      end_at: ["End Date"],
      notes: ["Notes", "Visit Notes"],
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
