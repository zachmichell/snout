-- Add two new staff tiers to the membership_role enum:
--   * supervisor — a shift-lead tier between staff and manager
--   * groomer    — a specialized role scoped to the Grooming area only
--
-- These back the web app's role-based menu restructure. Permissions for
-- each role are defined client-side in apps/web/src/lib/permissions.ts;
-- this migration only makes the enum values assignable.
--
-- ALTER TYPE ... ADD VALUE is idempotent here via IF NOT EXISTS and is
-- safe on PostgreSQL 12+ (the new labels are not used within this same
-- migration). Order in the enum is cosmetic; permissions are not derived
-- from enum ordering.

ALTER TYPE public.membership_role ADD VALUE IF NOT EXISTS 'supervisor';
ALTER TYPE public.membership_role ADD VALUE IF NOT EXISTS 'groomer';
