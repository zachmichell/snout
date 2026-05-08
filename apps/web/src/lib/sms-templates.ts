// Hardcoded SMS fallback templates. Used by lib/sms.ts when an org has
// not customized a per-event SMS template via MessageTemplatesTab.
// Every fallback rendered here is the friendliest, shortest message
// that conveys the necessary information; SMS character economy
// matters because Twilio bills per 160-char segment and a pet owner
// glances at the lock-screen preview.

export function reservationReminderSms(data: {
  pet_name: string;
  service_name: string;
  start_at: string;       // already formatted, e.g. "Sat, May 10 at 9:00 AM"
  org_name: string;
}) {
  return `Hi! ${data.org_name} reminder: ${data.pet_name}'s ${data.service_name} is ${data.start_at}. Reply if you need to reschedule.`;
}

export function waiverReminderSms(data: {
  waiver_count: number;
  org_name: string;
}) {
  const noun = data.waiver_count === 1 ? "waiver needs" : "waivers need";
  return `${data.org_name}: ${data.waiver_count} ${noun} your signature before your next visit. Sign in to your portal to complete.`;
}

export function reservationConfirmationSms(data: {
  pet_name: string;
  service_name: string;
  start_at: string;
  org_name: string;
}) {
  return `Booked! ${data.pet_name}'s ${data.service_name} at ${data.org_name} is confirmed for ${data.start_at}.`;
}

export function checkInSms(data: { pet_name: string; org_name: string }) {
  return `${data.pet_name} just checked in at ${data.org_name}. We'll take great care!`;
}

export function checkOutSms(data: { pet_name: string; org_name: string }) {
  return `${data.pet_name} is ready for pickup at ${data.org_name}. Thanks for choosing us!`;
}
