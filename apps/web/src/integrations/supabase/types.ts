export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
          organization_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
          organization_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_templates: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          organization_id: string
          required_for: string
          required_service_ids: string[]
          status: string
          type: string
          updated_at: string
          version: number
        }
        Insert: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          organization_id: string
          required_for?: string
          required_service_ids?: string[]
          status?: string
          type?: string
          updated_at?: string
          version?: number
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          required_for?: string
          required_service_ids?: string[]
          status?: string
          type?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      auto_reply_settings: {
        Row: {
          active_days: number[]
          business_hours_end: string
          business_hours_start: string
          created_at: string
          enabled: boolean
          id: string
          message: string
          organization_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          active_days?: number[]
          business_hours_end?: string
          business_hours_start?: string
          created_at?: string
          enabled?: boolean
          id?: string
          message?: string
          organization_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          active_days?: number[]
          business_hours_end?: string
          business_hours_start?: string
          created_at?: string
          enabled?: boolean
          id?: string
          message?: string
          organization_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_reply_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      breeds: {
        Row: {
          avg_weight_max: number | null
          avg_weight_min: number | null
          created_at: string
          id: string
          name: string
          organization_id: string
          size_category: string | null
          species: string
          status: string
          updated_at: string
        }
        Insert: {
          avg_weight_max?: number | null
          avg_weight_min?: number | null
          created_at?: string
          id?: string
          name: string
          organization_id: string
          size_category?: string | null
          species?: string
          status?: string
          updated_at?: string
        }
        Update: {
          avg_weight_max?: number | null
          avg_weight_min?: number | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          size_category?: string | null
          species?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "breeds_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_logs: {
        Row: {
          call_at: string
          created_at: string
          direction: string
          duration_seconds: number
          follow_up_completed_at: string | null
          follow_up_required: boolean
          id: string
          notes: string | null
          organization_id: string
          owner_id: string | null
          phone: string
          staff_user_id: string | null
          updated_at: string
        }
        Insert: {
          call_at?: string
          created_at?: string
          direction?: string
          duration_seconds?: number
          follow_up_completed_at?: string | null
          follow_up_required?: boolean
          id?: string
          notes?: string | null
          organization_id: string
          owner_id?: string | null
          phone: string
          staff_user_id?: string | null
          updated_at?: string
        }
        Update: {
          call_at?: string
          created_at?: string
          direction?: string
          duration_seconds?: number
          follow_up_completed_at?: string | null
          follow_up_required?: boolean
          id?: string
          notes?: string | null
          organization_id?: string
          owner_id?: string | null
          phone?: string
          staff_user_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellation_policies: {
        Row: {
          created_at: string
          free_cancel_hours: number
          id: string
          late_cancel_fee_type: string
          late_cancel_fee_value: number
          noshow_fee_type: string
          noshow_fee_value: number
          organization_id: string
          service_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          free_cancel_hours?: number
          id?: string
          late_cancel_fee_type?: string
          late_cancel_fee_value?: number
          noshow_fee_type?: string
          noshow_fee_value?: number
          organization_id: string
          service_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          free_cancel_hours?: number
          id?: string
          late_cancel_fee_type?: string
          late_cancel_fee_value?: number
          noshow_fee_type?: string
          noshow_fee_value?: number
          organization_id?: string
          service_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancellation_policies_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      cancellation_reasons: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_default: boolean
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_reasons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      capacity_settings: {
        Row: {
          created_at: string
          id: string
          max_per_day: number | null
          max_per_window: number | null
          organization_id: string
          overbooking_buffer: number
          service_id: string
          updated_at: string
          weekday_max: number | null
          weekend_max: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          max_per_day?: number | null
          max_per_window?: number | null
          organization_id: string
          overbooking_buffer?: number
          service_id: string
          updated_at?: string
          weekday_max?: number | null
          weekend_max?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          max_per_day?: number | null
          max_per_window?: number | null
          organization_id?: string
          overbooking_buffer?: number
          service_id?: string
          updated_at?: string
          weekday_max?: number | null
          weekend_max?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "capacity_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capacity_settings_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      changelog_entries: {
        Row: {
          affects_modules: Database["public"]["Enums"]["module_enum"][] | null
          author_id: string | null
          body_md: string
          created_at: string
          deleted_at: string | null
          id: string
          organization_id: string | null
          published_at: string | null
          severity: string
          title: string
          updated_at: string
        }
        Insert: {
          affects_modules?: Database["public"]["Enums"]["module_enum"][] | null
          author_id?: string | null
          body_md: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string | null
          published_at?: string | null
          severity?: string
          title: string
          updated_at?: string
        }
        Update: {
          affects_modules?: Database["public"]["Enums"]["module_enum"][] | null
          author_id?: string | null
          body_md?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string | null
          published_at?: string | null
          severity?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "changelog_entries_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "changelog_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      changelog_reads: {
        Row: {
          entry_id: string
          profile_id: string
          read_at: string
        }
        Insert: {
          entry_id: string
          profile_id: string
          read_at?: string
        }
        Update: {
          entry_id?: string
          profile_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "changelog_reads_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "changelog_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "changelog_reads_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_completions: {
        Row: {
          completed_items: Json
          completion_date: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          organization_id: string
          template_id: string
          updated_at: string
        }
        Insert: {
          completed_items?: Json
          completion_date: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          template_id: string
          updated_at?: string
        }
        Update: {
          completed_items?: Json
          completion_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_completions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_completions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          active: boolean
          created_at: string
          deleted_at: string | null
          department: string | null
          description: string | null
          id: string
          items: Json
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          deleted_at?: string | null
          department?: string | null
          description?: string | null
          id?: string
          items?: Json
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          deleted_at?: string | null
          department?: string | null
          description?: string | null
          id?: string
          items?: Json
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      class_enrollments: {
        Row: {
          attended: boolean | null
          cancelled_at: string | null
          class_instance_id: string
          created_at: string
          enrolled_at: string
          enrolled_by: string | null
          id: string
          invoice_id: string | null
          organization_id: string
          owner_id: string
          payment_status: string
          pet_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attended?: boolean | null
          cancelled_at?: string | null
          class_instance_id: string
          created_at?: string
          enrolled_at?: string
          enrolled_by?: string | null
          id?: string
          invoice_id?: string | null
          organization_id: string
          owner_id: string
          payment_status?: string
          pet_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attended?: boolean | null
          cancelled_at?: string | null
          class_instance_id?: string
          created_at?: string
          enrolled_at?: string
          enrolled_by?: string | null
          id?: string
          invoice_id?: string | null
          organization_id?: string
          owner_id?: string
          payment_status?: string
          pet_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_enrollments_class_instance_id_fkey"
            columns: ["class_instance_id"]
            isOneToOne: false
            referencedRelation: "class_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrollments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrollments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrollments_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      class_instances: {
        Row: {
          auto_generated: boolean
          class_type_id: string
          created_at: string
          deleted_at: string | null
          end_at: string
          id: string
          instructor_user_id: string | null
          location_id: string | null
          notes: string | null
          organization_id: string
          start_at: string
          status: string
          updated_at: string
        }
        Insert: {
          auto_generated?: boolean
          class_type_id: string
          created_at?: string
          deleted_at?: string | null
          end_at: string
          id?: string
          instructor_user_id?: string | null
          location_id?: string | null
          notes?: string | null
          organization_id: string
          start_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          auto_generated?: boolean
          class_type_id?: string
          created_at?: string
          deleted_at?: string | null
          end_at?: string
          id?: string
          instructor_user_id?: string | null
          location_id?: string | null
          notes?: string | null
          organization_id?: string
          start_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_instances_class_type_id_fkey"
            columns: ["class_type_id"]
            isOneToOne: false
            referencedRelation: "class_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_instances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      class_types: {
        Row: {
          category: string
          created_at: string
          deleted_at: string | null
          description: string | null
          duration_minutes: number
          id: string
          instructor_user_id: string | null
          location_id: string | null
          max_enrollment: number
          name: string
          organization_id: string
          prerequisites: string | null
          price_cents: number
          schedule_day_of_week: number | null
          schedule_time: string | null
          status: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          instructor_user_id?: string | null
          location_id?: string | null
          max_enrollment?: number
          name: string
          organization_id: string
          prerequisites?: string | null
          price_cents?: number
          schedule_day_of_week?: number | null
          schedule_time?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          duration_minutes?: number
          id?: string
          instructor_user_id?: string | null
          location_id?: string | null
          max_enrollment?: number
          name?: string
          organization_id?: string
          prerequisites?: string | null
          price_cents?: number
          schedule_day_of_week?: number | null
          schedule_time?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_types_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          organization_id: string
          owner_id: string
          unread_owner: number
          unread_staff: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          organization_id: string
          owner_id: string
          unread_owner?: number
          unread_staff?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          organization_id?: string
          owner_id?: string
          unread_owner?: number
          unread_staff?: number
          updated_at?: string
        }
        Relationships: []
      }
      credit_ledger: {
        Row: {
          actor_kind: string
          actor_label: string | null
          created_at: string
          delta_full: number
          delta_half: number
          delta_nights: number
          expires_at: string | null
          id: string
          kind: Database["public"]["Enums"]["credit_ledger_kind"]
          note: string | null
          organization_id: string
          owner_id: string
          reference_id: string | null
          reference_type: string | null
          source_purchase_id: string | null
          staff_code_id: string | null
        }
        Insert: {
          actor_kind?: string
          actor_label?: string | null
          created_at?: string
          delta_full?: number
          delta_half?: number
          delta_nights?: number
          expires_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["credit_ledger_kind"]
          note?: string | null
          organization_id: string
          owner_id: string
          reference_id?: string | null
          reference_type?: string | null
          source_purchase_id?: string | null
          staff_code_id?: string | null
        }
        Update: {
          actor_kind?: string
          actor_label?: string | null
          created_at?: string
          delta_full?: number
          delta_half?: number
          delta_nights?: number
          expires_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["credit_ledger_kind"]
          note?: string | null
          organization_id?: string
          owner_id?: string
          reference_id?: string | null
          reference_type?: string | null
          source_purchase_id?: string | null
          staff_code_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_source_purchase_id_fkey"
            columns: ["source_purchase_id"]
            isOneToOne: false
            referencedRelation: "credit_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_staff_code_id_fkey"
            columns: ["staff_code_id"]
            isOneToOne: false
            referencedRelation: "staff_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      deposit_settings: {
        Row: {
          amount_type: string
          created_at: string
          default_amount_cents: number
          default_percentage_bp: number
          enabled: boolean
          id: string
          organization_id: string
          refund_cutoff_hours: number
          refund_policy: string
          updated_at: string
        }
        Insert: {
          amount_type?: string
          created_at?: string
          default_amount_cents?: number
          default_percentage_bp?: number
          enabled?: boolean
          id?: string
          organization_id: string
          refund_cutoff_hours?: number
          refund_policy?: string
          updated_at?: string
        }
        Update: {
          amount_type?: string
          created_at?: string
          default_amount_cents?: number
          default_percentage_bp?: number
          enabled?: boolean
          id?: string
          organization_id?: string
          refund_cutoff_hours?: number
          refund_policy?: string
          updated_at?: string
        }
        Relationships: []
      }
      deposits: {
        Row: {
          amount_cents: number
          created_at: string
          forfeited_at: string | null
          id: string
          notes: string | null
          organization_id: string
          owner_id: string
          paid_at: string | null
          pet_id: string | null
          refunded_at: string | null
          reservation_id: string | null
          service_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          forfeited_at?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          owner_id: string
          paid_at?: string | null
          pet_id?: string | null
          refunded_at?: string | null
          reservation_id?: string | null
          service_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          forfeited_at?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          owner_id?: string
          paid_at?: string | null
          pet_id?: string | null
          refunded_at?: string | null
          reservation_id?: string | null
          service_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      dismissed_duplicates: {
        Row: {
          dismissed_at: string
          dismissed_by: string | null
          entity_type: string
          id: string
          organization_id: string
          record_id_1: string
          record_id_2: string
        }
        Insert: {
          dismissed_at?: string
          dismissed_by?: string | null
          entity_type: string
          id?: string
          organization_id: string
          record_id_1: string
          record_id_2: string
        }
        Update: {
          dismissed_at?: string
          dismissed_by?: string | null
          entity_type?: string
          id?: string
          organization_id?: string
          record_id_1?: string
          record_id_2?: string
        }
        Relationships: [
          {
            foreignKeyName: "dismissed_duplicates_dismissed_by_fkey"
            columns: ["dismissed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dismissed_duplicates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          mime_type: string | null
          name: string
          organization_id: string
          owner_id: string | null
          pet_id: string | null
          size_bytes: number | null
          updated_at: string
          uploaded_by: string | null
          url: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          mime_type?: string | null
          name: string
          organization_id: string
          owner_id?: string | null
          pet_id?: string | null
          size_bytes?: number | null
          updated_at?: string
          uploaded_by?: string | null
          url: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          organization_id?: string
          owner_id?: string | null
          pet_id?: string | null
          size_bytes?: number | null
          updated_at?: string
          uploaded_by?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          body: string
          created_at: string
          id: string
          name: string
          organization_id: string
          recipient_count: number
          segment: string
          sent_at: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          name: string
          organization_id: string
          recipient_count?: number
          segment?: string
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          recipient_count?: number
          segment?: string
          sent_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_log: {
        Row: {
          email_type: string
          error_message: string | null
          id: string
          message_id: string | null
          organization_id: string | null
          recipient_email: string
          sent_at: string
          status: string
          subject: string
        }
        Insert: {
          email_type: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          organization_id?: string | null
          recipient_email: string
          sent_at?: string
          status: string
          subject: string
        }
        Update: {
          email_type?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          organization_id?: string | null
          recipient_email?: string
          sent_at?: string
          status?: string
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_settings: {
        Row: {
          created_at: string
          id: string
          invoice_created_enabled: boolean
          organization_id: string
          report_card_published_enabled: boolean
          reservation_confirmation_enabled: boolean
          sender_name: string | null
          updated_at: string
          waiver_reminder_enabled: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_created_enabled?: boolean
          organization_id: string
          report_card_published_enabled?: boolean
          reservation_confirmation_enabled?: boolean
          sender_name?: string | null
          updated_at?: string
          waiver_reminder_enabled?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          invoice_created_enabled?: boolean
          organization_id?: string
          report_card_published_enabled?: boolean
          reservation_confirmation_enabled?: boolean
          sender_name?: string | null
          updated_at?: string
          waiver_reminder_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "email_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_contacts: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          organization_id: string
          owner_id: string
          phone: string
          relationship: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          organization_id: string
          owner_id: string
          phone: string
          relationship?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          organization_id?: string
          owner_id?: string
          phone?: string
          relationship?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_contacts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      groomer_availability: {
        Row: {
          created_at: string
          date: string
          end_time: string
          groomer_id: string
          id: string
          start_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          end_time: string
          groomer_id: string
          id?: string
          start_time: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string
          groomer_id?: string
          id?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groomer_availability_groomer_id_fkey"
            columns: ["groomer_id"]
            isOneToOne: false
            referencedRelation: "groomers"
            referencedColumns: ["id"]
          },
        ]
      }
      groomer_working_hours: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          groomer_id: string
          id: string
          start_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time: string
          groomer_id: string
          id?: string
          start_time: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          groomer_id?: string
          id?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groomer_working_hours_groomer_id_fkey"
            columns: ["groomer_id"]
            isOneToOne: false
            referencedRelation: "groomers"
            referencedColumns: ["id"]
          },
        ]
      }
      groomers: {
        Row: {
          bio: string | null
          certifications: string[]
          commission_rate_percent: number | null
          created_at: string
          display_name: string
          id: string
          max_appointments_per_day: number
          organization_id: string
          specialties: string[]
          staff_member_id: string | null
          status: string
          updated_at: string
          working_days: string[]
        }
        Insert: {
          bio?: string | null
          certifications?: string[]
          commission_rate_percent?: number | null
          created_at?: string
          display_name: string
          id?: string
          max_appointments_per_day?: number
          organization_id: string
          specialties?: string[]
          staff_member_id?: string | null
          status?: string
          updated_at?: string
          working_days?: string[]
        }
        Update: {
          bio?: string | null
          certifications?: string[]
          commission_rate_percent?: number | null
          created_at?: string
          display_name?: string
          id?: string
          max_appointments_per_day?: number
          organization_id?: string
          specialties?: string[]
          staff_member_id?: string | null
          status?: string
          updated_at?: string
          working_days?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "groomers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groomers_staff_member_id_fkey"
            columns: ["staff_member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      grooming_appointments: {
        Row: {
          appointment_date: string
          check_in_time: string | null
          completed_time: string | null
          created_at: string
          estimated_duration_minutes: number
          groomer_id: string
          id: string
          notes: string | null
          organization_id: string
          owner_id: string
          pet_id: string
          price_cents: number
          reservation_id: string | null
          services_requested: string[]
          start_time: string
          status: string
          tip_cents: number | null
          updated_at: string
        }
        Insert: {
          appointment_date: string
          check_in_time?: string | null
          completed_time?: string | null
          created_at?: string
          estimated_duration_minutes?: number
          groomer_id: string
          id?: string
          notes?: string | null
          organization_id: string
          owner_id: string
          pet_id: string
          price_cents?: number
          reservation_id?: string | null
          services_requested?: string[]
          start_time: string
          status?: string
          tip_cents?: number | null
          updated_at?: string
        }
        Update: {
          appointment_date?: string
          check_in_time?: string | null
          completed_time?: string | null
          created_at?: string
          estimated_duration_minutes?: number
          groomer_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          owner_id?: string
          pet_id?: string
          price_cents?: number
          reservation_id?: string | null
          services_requested?: string[]
          start_time?: string
          status?: string
          tip_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grooming_appointments_groomer_id_fkey"
            columns: ["groomer_id"]
            isOneToOne: false
            referencedRelation: "groomers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_appointments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_appointments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_appointments_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grooming_appointments_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      helcim_accounts: {
        Row: {
          account_id: string | null
          api_token_secret_id: string
          business_name: string | null
          charges_enabled: boolean
          created_at: string
          currency: string
          deleted_at: string | null
          id: string
          last_verification_error: string | null
          last_verified_at: string | null
          organization_id: string
          status: string
          updated_at: string
          webhook_verifier_secret_id: string | null
        }
        Insert: {
          account_id?: string | null
          api_token_secret_id: string
          business_name?: string | null
          charges_enabled?: boolean
          created_at?: string
          currency?: string
          deleted_at?: string | null
          id?: string
          last_verification_error?: string | null
          last_verified_at?: string | null
          organization_id: string
          status?: string
          updated_at?: string
          webhook_verifier_secret_id?: string | null
        }
        Update: {
          account_id?: string | null
          api_token_secret_id?: string
          business_name?: string | null
          charges_enabled?: boolean
          created_at?: string
          currency?: string
          deleted_at?: string | null
          id?: string
          last_verification_error?: string | null
          last_verified_at?: string | null
          organization_id?: string
          status?: string
          updated_at?: string
          webhook_verifier_secret_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "helcim_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      helcim_processed_events: {
        Row: {
          event_type: string
          helcim_event_id: string
          id: string
          organization_id: string | null
          received_at: string
        }
        Insert: {
          event_type: string
          helcim_event_id: string
          id?: string
          organization_id?: string | null
          received_at?: string
        }
        Update: {
          event_type?: string
          helcim_event_id?: string
          id?: string
          organization_id?: string | null
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "helcim_processed_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          column_mapping: Json
          created_at: string
          created_by: string | null
          data_type: string
          error_count: number
          error_log: Json
          file_name: string | null
          id: string
          imported_count: number
          organization_id: string
          skipped_count: number
          source_system: string
          status: string
          total_rows: number
          updated_at: string
        }
        Insert: {
          column_mapping?: Json
          created_at?: string
          created_by?: string | null
          data_type: string
          error_count?: number
          error_log?: Json
          file_name?: string | null
          id?: string
          imported_count?: number
          organization_id: string
          skipped_count?: number
          source_system: string
          status?: string
          total_rows?: number
          updated_at?: string
        }
        Update: {
          column_mapping?: Json
          created_at?: string
          created_by?: string | null
          data_type?: string
          error_count?: number
          error_log?: Json
          file_name?: string | null
          id?: string
          imported_count?: number
          organization_id?: string
          skipped_count?: number
          source_system?: string
          status?: string
          total_rows?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_pets: {
        Row: {
          created_at: string
          id: string
          incident_id: string
          injury_description: string | null
          organization_id: string
          pet_id: string
          role: string
        }
        Insert: {
          created_at?: string
          id?: string
          incident_id: string
          injury_description?: string | null
          organization_id: string
          pet_id: string
          role?: string
        }
        Update: {
          created_at?: string
          id?: string
          incident_id?: string
          injury_description?: string | null
          organization_id?: string
          pet_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_pets_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          action_taken: string | null
          created_at: string
          description: string
          follow_up_completed_at: string | null
          follow_up_notes: string | null
          follow_up_required: boolean
          id: string
          incident_at: string
          incident_type: string
          location_id: string | null
          organization_id: string
          owner_notified: boolean
          owner_notified_at: string | null
          owner_visible: boolean
          reported_by: string | null
          reservation_id: string | null
          severity: string
          updated_at: string
        }
        Insert: {
          action_taken?: string | null
          created_at?: string
          description: string
          follow_up_completed_at?: string | null
          follow_up_notes?: string | null
          follow_up_required?: boolean
          id?: string
          incident_at: string
          incident_type: string
          location_id?: string | null
          organization_id: string
          owner_notified?: boolean
          owner_notified_at?: string | null
          owner_visible?: boolean
          reported_by?: string | null
          reservation_id?: string | null
          severity: string
          updated_at?: string
        }
        Update: {
          action_taken?: string | null
          created_at?: string
          description?: string
          follow_up_completed_at?: string | null
          follow_up_notes?: string | null
          follow_up_required?: boolean
          id?: string
          incident_at?: string
          incident_type?: string
          location_id?: string | null
          organization_id?: string
          owner_notified?: boolean
          owner_notified_at?: string | null
          owner_visible?: boolean
          reported_by?: string | null
          reservation_id?: string | null
          severity?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoice_lines: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          line_total_cents: number
          line_type: string
          organization_id: string
          quantity: number
          service_id: string | null
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          line_total_cents: number
          line_type?: string
          organization_id: string
          quantity?: number
          service_id?: string | null
          unit_price_cents: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          line_total_cents?: number
          line_type?: string
          organization_id?: string
          quantity?: number
          service_id?: string | null
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_taxes: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          invoice_id: string
          name: string
          organization_id: string
          rate_basis_points: number
          tax_rule_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          invoice_id: string
          name: string
          organization_id: string
          rate_basis_points: number
          tax_rule_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          invoice_id?: string
          name?: string
          organization_id?: string
          rate_basis_points?: number
          tax_rule_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_taxes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_taxes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_taxes_tax_rule_id_fkey"
            columns: ["tax_rule_id"]
            isOneToOne: false
            referencedRelation: "tax_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid_cents: number
          balance_due_cents: number | null
          cashier_user_id: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_enum"]
          deleted_at: string | null
          due_at: string | null
          helcim_checkout_expires_at: string | null
          helcim_checkout_secret_token: string | null
          helcim_checkout_token: string | null
          id: string
          invoice_number: string | null
          issued_at: string | null
          location_id: string | null
          notes: string | null
          organization_id: string
          owner_id: string
          paid_at: string | null
          promotion_discount_cents: number
          promotion_id: string | null
          reservation_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          store_credit_applied_cents: number
          stripe_checkout_session_id: string | null
          subtotal_cents: number
          surcharge_cents: number
          tax_cents: number
          total_cents: number
          updated_at: string
        }
        Insert: {
          amount_paid_cents?: number
          balance_due_cents?: number | null
          cashier_user_id?: string | null
          created_at?: string
          currency: Database["public"]["Enums"]["currency_enum"]
          deleted_at?: string | null
          due_at?: string | null
          helcim_checkout_expires_at?: string | null
          helcim_checkout_secret_token?: string | null
          helcim_checkout_token?: string | null
          id?: string
          invoice_number?: string | null
          issued_at?: string | null
          location_id?: string | null
          notes?: string | null
          organization_id: string
          owner_id: string
          paid_at?: string | null
          promotion_discount_cents?: number
          promotion_id?: string | null
          reservation_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          store_credit_applied_cents?: number
          stripe_checkout_session_id?: string | null
          subtotal_cents?: number
          surcharge_cents?: number
          tax_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Update: {
          amount_paid_cents?: number
          balance_due_cents?: number | null
          cashier_user_id?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_enum"]
          deleted_at?: string | null
          due_at?: string | null
          helcim_checkout_expires_at?: string | null
          helcim_checkout_secret_token?: string | null
          helcim_checkout_token?: string | null
          id?: string
          invoice_number?: string | null
          issued_at?: string | null
          location_id?: string | null
          notes?: string | null
          organization_id?: string
          owner_id?: string
          paid_at?: string | null
          promotion_discount_cents?: number
          promotion_id?: string | null
          reservation_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          store_credit_applied_cents?: number
          stripe_checkout_session_id?: string | null
          subtotal_cents?: number
          surcharge_cents?: number
          tax_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      kennel_run_assignments: {
        Row: {
          assigned_at: string
          assigned_by_user_id: string | null
          created_at: string
          id: string
          kennel_run_id: string
          organization_id: string
          pet_id: string
          removed_at: string | null
          reservation_id: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by_user_id?: string | null
          created_at?: string
          id?: string
          kennel_run_id: string
          organization_id: string
          pet_id: string
          removed_at?: string | null
          reservation_id?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by_user_id?: string | null
          created_at?: string
          id?: string
          kennel_run_id?: string
          organization_id?: string
          pet_id?: string
          removed_at?: string | null
          reservation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kennel_run_assignments_kennel_run_id_fkey"
            columns: ["kennel_run_id"]
            isOneToOne: false
            referencedRelation: "kennel_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kennel_run_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kennel_run_assignments_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kennel_run_assignments_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      kennel_runs: {
        Row: {
          active: boolean
          capacity: number
          created_at: string
          daily_rate_modifier_cents: number
          deleted_at: string | null
          id: string
          location_id: string | null
          name: string
          organization_id: string
          run_type: Database["public"]["Enums"]["kennel_run_type"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          capacity?: number
          created_at?: string
          daily_rate_modifier_cents?: number
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          name: string
          organization_id: string
          run_type?: Database["public"]["Enums"]["kennel_run_type"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          capacity?: number
          created_at?: string
          daily_rate_modifier_cents?: number
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          name?: string
          organization_id?: string
          run_type?: Database["public"]["Enums"]["kennel_run_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kennel_runs_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kennel_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          converted_owner_id: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          pet_breed: string | null
          pet_name: string | null
          phone: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          converted_owner_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          pet_breed?: string | null
          pet_name?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          converted_owner_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          pet_breed?: string | null
          pet_name?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_converted_owner_id_fkey"
            columns: ["converted_owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_hours: {
        Row: {
          close_time: string | null
          closed: boolean
          created_at: string
          day_of_week: number
          id: string
          location_id: string
          open_time: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          close_time?: string | null
          closed?: boolean
          created_at?: string
          day_of_week: number
          id?: string
          location_id: string
          open_time?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          close_time?: string | null
          closed?: boolean
          created_at?: string
          day_of_week?: number
          id?: string
          location_id?: string
          open_time?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_hours_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          active: boolean
          city: string | null
          country: string | null
          created_at: string
          deleted_at: string | null
          email: string | null
          id: string
          name: string
          organization_id: string
          phone: string | null
          postal_code: string | null
          state_province: string | null
          street_address: string | null
          timezone: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          city?: string | null
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          name: string
          organization_id: string
          phone?: string | null
          postal_code?: string | null
          state_province?: string | null
          street_address?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          city?: string | null
          country?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          id?: string
          name?: string
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          state_province?: string | null
          street_address?: string | null
          timezone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_rewards: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
          points_cost: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          points_cost?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          points_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_rewards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_settings: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          organization_id: string
          points_per_dollar: number
          redemption_points: number
          redemption_value_cents: number
          referral_bonus_points: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          organization_id: string
          points_per_dollar?: number
          redemption_points?: number
          redemption_value_cents?: number
          referral_bonus_points?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          organization_id?: string
          points_per_dollar?: number
          redemption_points?: number
          redemption_value_cents?: number
          referral_bonus_points?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_transactions: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          invoice_id: string | null
          organization_id: string
          owner_id: string
          points: number
          reward_id: string | null
          type: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          organization_id: string
          owner_id: string
          points: number
          reward_id?: string | null
          type?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          organization_id?: string
          owner_id?: string
          points?: number
          reward_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "loyalty_rewards"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          active: boolean
          created_at: string
          id: string
          location_ids: string[] | null
          organization_id: string
          profile_id: string
          role: Database["public"]["Enums"]["membership_role"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          location_ids?: string[] | null
          organization_id: string
          profile_id: string
          role: Database["public"]["Enums"]["membership_role"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          location_ids?: string[] | null
          organization_id?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          active: boolean
          body: string
          category: string
          channel: string
          created_at: string
          deleted_at: string | null
          event_type: string | null
          id: string
          name: string
          organization_id: string
          service_module: Database["public"]["Enums"]["module_enum"] | null
          subject: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deleted_at?: string | null
          event_type?: string | null
          id?: string
          name: string
          organization_id: string
          service_module?: Database["public"]["Enums"]["module_enum"] | null
          subject?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          body?: string
          category?: string
          channel?: string
          created_at?: string
          deleted_at?: string | null
          event_type?: string | null
          id?: string
          name?: string
          organization_id?: string
          service_module?: Database["public"]["Enums"]["module_enum"] | null
          subject?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: Json
          body: string
          conversation_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string
          sender_type: Database["public"]["Enums"]["message_sender_type"]
        }
        Insert: {
          attachments?: Json
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id: string
          sender_type: Database["public"]["Enums"]["message_sender_type"]
        }
        Update: {
          attachments?: Json
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string
          sender_type?: Database["public"]["Enums"]["message_sender_type"]
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          channel: string
          created_at: string
          enabled: boolean
          event_type: string
          id: string
          organization_id: string
          template_text: string
          updated_at: string
        }
        Insert: {
          channel?: string
          created_at?: string
          enabled?: boolean
          event_type: string
          id?: string
          organization_id: string
          template_text?: string
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          enabled?: boolean
          event_type?: string
          id?: string
          organization_id?: string
          template_text?: string
          updated_at?: string
        }
        Relationships: []
      }
      organizations: {
        Row: {
          cancellation_policy_hours: number
          country: Database["public"]["Enums"]["country_enum"]
          created_at: string
          credit_expiration_days: number | null
          currency: Database["public"]["Enums"]["currency_enum"]
          deleted_at: string | null
          grooming_cancellation_policy_hours: number
          id: string
          invoice_counter: number
          name: string
          payment_processor: Database["public"]["Enums"]["payment_processor_kind"]
          slug: string
          status: Database["public"]["Enums"]["org_status_enum"]
          timezone: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          cancellation_policy_hours?: number
          country: Database["public"]["Enums"]["country_enum"]
          created_at?: string
          credit_expiration_days?: number | null
          currency: Database["public"]["Enums"]["currency_enum"]
          deleted_at?: string | null
          grooming_cancellation_policy_hours?: number
          id?: string
          invoice_counter?: number
          name: string
          payment_processor?: Database["public"]["Enums"]["payment_processor_kind"]
          slug: string
          status?: Database["public"]["Enums"]["org_status_enum"]
          timezone?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          cancellation_policy_hours?: number
          country?: Database["public"]["Enums"]["country_enum"]
          created_at?: string
          credit_expiration_days?: number | null
          currency?: Database["public"]["Enums"]["currency_enum"]
          deleted_at?: string | null
          grooming_cancellation_policy_hours?: number
          id?: string
          invoice_counter?: number
          name?: string
          payment_processor?: Database["public"]["Enums"]["payment_processor_kind"]
          slug?: string
          status?: Database["public"]["Enums"]["org_status_enum"]
          timezone?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      owner_subscriptions: {
        Row: {
          created_at: string
          id: string
          next_billing_date: string | null
          organization_id: string
          owner_id: string
          package_id: string
          purchased_at: string
          remaining_credits: Json
          status: string
          stripe_checkout_session_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          next_billing_date?: string | null
          organization_id: string
          owner_id: string
          package_id: string
          purchased_at?: string
          remaining_credits?: Json
          status?: string
          stripe_checkout_session_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          next_billing_date?: string | null
          organization_id?: string
          owner_id?: string
          package_id?: string
          purchased_at?: string
          remaining_credits?: Json
          status?: string
          stripe_checkout_session_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      owner_tags: {
        Row: {
          color: string
          created_at: string
          created_by: string | null
          id: string
          label: string
          organization_id: string
          owner_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          organization_id: string
          owner_id: string
        }
        Update: {
          color?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          organization_id?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "owner_tags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owner_tags_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      owners: {
        Row: {
          boarding_night_credits: number
          city: string | null
          communication_preference: Database["public"]["Enums"]["communication_pref"]
          created_at: string
          daycare_full_day_credits: number
          daycare_half_day_credits: number
          deleted_at: string | null
          email: string | null
          external_id: string | null
          external_source: string | null
          first_name: string
          id: string
          last_name: string
          lifetime_points: number
          loyalty_points: number
          notes: string | null
          organization_id: string
          phone: string | null
          postal_code: string | null
          profile_id: string | null
          referral_source: string | null
          referred_by_owner_id: string | null
          state_province: string | null
          store_credit_cents: number
          street_address: string | null
          updated_at: string
        }
        Insert: {
          boarding_night_credits?: number
          city?: string | null
          communication_preference?: Database["public"]["Enums"]["communication_pref"]
          created_at?: string
          daycare_full_day_credits?: number
          daycare_half_day_credits?: number
          deleted_at?: string | null
          email?: string | null
          external_id?: string | null
          external_source?: string | null
          first_name: string
          id?: string
          last_name: string
          lifetime_points?: number
          loyalty_points?: number
          notes?: string | null
          organization_id: string
          phone?: string | null
          postal_code?: string | null
          profile_id?: string | null
          referral_source?: string | null
          referred_by_owner_id?: string | null
          state_province?: string | null
          store_credit_cents?: number
          street_address?: string | null
          updated_at?: string
        }
        Update: {
          boarding_night_credits?: number
          city?: string | null
          communication_preference?: Database["public"]["Enums"]["communication_pref"]
          created_at?: string
          daycare_full_day_credits?: number
          daycare_half_day_credits?: number
          deleted_at?: string | null
          email?: string | null
          external_id?: string | null
          external_source?: string | null
          first_name?: string
          id?: string
          last_name?: string
          lifetime_points?: number
          loyalty_points?: number
          notes?: string | null
          organization_id?: string
          phone?: string | null
          postal_code?: string | null
          profile_id?: string | null
          referral_source?: string | null
          referred_by_owner_id?: string | null
          state_province?: string | null
          store_credit_cents?: number
          street_address?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "owners_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owners_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "owners_referred_by_owner_id_fkey"
            columns: ["referred_by_owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          card_brand: string
          card_last_four: string
          created_at: string
          expiry_month: number
          expiry_year: number
          id: string
          is_default: boolean
          organization_id: string
          owner_id: string
          stripe_payment_method_id: string | null
          updated_at: string
        }
        Insert: {
          card_brand: string
          card_last_four: string
          created_at?: string
          expiry_month: number
          expiry_year: number
          id?: string
          is_default?: boolean
          organization_id: string
          owner_id: string
          stripe_payment_method_id?: string | null
          updated_at?: string
        }
        Update: {
          card_brand?: string
          card_last_four?: string
          created_at?: string
          expiry_month?: number
          expiry_year?: number
          id?: string
          is_default?: boolean
          organization_id?: string
          owner_id?: string
          stripe_payment_method_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_methods_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          card_funding: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_enum"]
          deleted_at: string | null
          expected_payout_at: string | null
          helcim_invoice_number: string | null
          helcim_transaction_id: string | null
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method_enum"]
          organization_id: string
          processed_at: string | null
          refund_notes: string | null
          refund_reason_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          card_funding?: string | null
          created_at?: string
          currency: Database["public"]["Enums"]["currency_enum"]
          deleted_at?: string | null
          expected_payout_at?: string | null
          helcim_invoice_number?: string | null
          helcim_transaction_id?: string | null
          id?: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method_enum"]
          organization_id: string
          processed_at?: string | null
          refund_notes?: string | null
          refund_reason_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          card_funding?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_enum"]
          deleted_at?: string | null
          expected_payout_at?: string | null
          helcim_invoice_number?: string | null
          helcim_transaction_id?: string | null
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method_enum"]
          organization_id?: string
          processed_at?: string | null
          refund_notes?: string | null
          refund_reason_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_refund_reason_id_fkey"
            columns: ["refund_reason_id"]
            isOneToOne: false
            referencedRelation: "refund_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_invitations: {
        Row: {
          consumed_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string | null
          organization_id: string
          role: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: string
        }
        Relationships: []
      }
      pet_care_logs: {
        Row: {
          created_at: string
          id: string
          log_type: string
          logged_at: string
          logged_by: string | null
          notes: string | null
          organization_id: string
          pet_id: string
          reference_id: string | null
          reservation_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          log_type: string
          logged_at?: string
          logged_by?: string | null
          notes?: string | null
          organization_id: string
          pet_id: string
          reference_id?: string | null
          reservation_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          log_type?: string
          logged_at?: string
          logged_by?: string | null
          notes?: string | null
          organization_id?: string
          pet_id?: string
          reference_id?: string | null
          reservation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pet_care_logs_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_care_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_care_logs_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_care_logs_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_feeding_schedules: {
        Row: {
          amount: string | null
          created_at: string
          food_type: string
          frequency: string | null
          id: string
          instructions: string | null
          is_active: boolean
          organization_id: string
          pet_id: string
          timing: string | null
          updated_at: string
        }
        Insert: {
          amount?: string | null
          created_at?: string
          food_type: string
          frequency?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean
          organization_id: string
          pet_id: string
          timing?: string | null
          updated_at?: string
        }
        Update: {
          amount?: string | null
          created_at?: string
          food_type?: string
          frequency?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean
          organization_id?: string
          pet_id?: string
          timing?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_feeding_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_feeding_schedules_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_medications: {
        Row: {
          created_at: string
          dosage: string | null
          frequency: string | null
          id: string
          instructions: string | null
          is_active: boolean
          name: string
          organization_id: string
          pet_id: string
          timing: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          dosage?: string | null
          frequency?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean
          name: string
          organization_id: string
          pet_id: string
          timing?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          dosage?: string | null
          frequency?: string | null
          id?: string
          instructions?: string | null
          is_active?: boolean
          name?: string
          organization_id?: string
          pet_id?: string
          timing?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_medications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_medications_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_owners: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          owner_id: string
          pet_id: string
          relationship: Database["public"]["Enums"]["pet_owner_relationship"]
          role: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          owner_id: string
          pet_id: string
          relationship?: Database["public"]["Enums"]["pet_owner_relationship"]
          role?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          owner_id?: string
          pet_id?: string
          relationship?: Database["public"]["Enums"]["pet_owner_relationship"]
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "pet_owners_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_owners_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pet_owners_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      pet_traits: {
        Row: {
          added_by: string | null
          category: string
          created_at: string
          id: string
          label: string
          notes: string | null
          organization_id: string
          pet_id: string
          severity: string
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          category: string
          created_at?: string
          id?: string
          label: string
          notes?: string | null
          organization_id: string
          pet_id: string
          severity?: string
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          category?: string
          created_at?: string
          id?: string
          label?: string
          notes?: string | null
          organization_id?: string
          pet_id?: string
          severity?: string
          updated_at?: string
        }
        Relationships: []
      }
      pets: {
        Row: {
          allergies: string | null
          behavioral_notes: string | null
          breed: string | null
          breed_id: string | null
          color: string | null
          created_at: string
          date_of_birth: string | null
          deactivated_at: string | null
          deactivation_notes: string | null
          deactivation_reason: string | null
          deleted_at: string | null
          external_id: string | null
          external_source: string | null
          feeding_notes: string | null
          id: string
          intake_status: Database["public"]["Enums"]["intake_status_enum"]
          markings: string | null
          medication_notes: string | null
          microchip_id: string | null
          name: string
          organization_id: string
          photo_url: string | null
          sex: Database["public"]["Enums"]["sex_enum"]
          spayed_neutered: boolean | null
          species: Database["public"]["Enums"]["species_enum"]
          temperament_tags: string[]
          updated_at: string
          vet_id: string | null
          weight_kg: number | null
        }
        Insert: {
          allergies?: string | null
          behavioral_notes?: string | null
          breed?: string | null
          breed_id?: string | null
          color?: string | null
          created_at?: string
          date_of_birth?: string | null
          deactivated_at?: string | null
          deactivation_notes?: string | null
          deactivation_reason?: string | null
          deleted_at?: string | null
          external_id?: string | null
          external_source?: string | null
          feeding_notes?: string | null
          id?: string
          intake_status?: Database["public"]["Enums"]["intake_status_enum"]
          markings?: string | null
          medication_notes?: string | null
          microchip_id?: string | null
          name: string
          organization_id: string
          photo_url?: string | null
          sex?: Database["public"]["Enums"]["sex_enum"]
          spayed_neutered?: boolean | null
          species?: Database["public"]["Enums"]["species_enum"]
          temperament_tags?: string[]
          updated_at?: string
          vet_id?: string | null
          weight_kg?: number | null
        }
        Update: {
          allergies?: string | null
          behavioral_notes?: string | null
          breed?: string | null
          breed_id?: string | null
          color?: string | null
          created_at?: string
          date_of_birth?: string | null
          deactivated_at?: string | null
          deactivation_notes?: string | null
          deactivation_reason?: string | null
          deleted_at?: string | null
          external_id?: string | null
          external_source?: string | null
          feeding_notes?: string | null
          id?: string
          intake_status?: Database["public"]["Enums"]["intake_status_enum"]
          markings?: string | null
          medication_notes?: string | null
          microchip_id?: string | null
          name?: string
          organization_id?: string
          photo_url?: string | null
          sex?: Database["public"]["Enums"]["sex_enum"]
          spayed_neutered?: boolean | null
          species?: Database["public"]["Enums"]["species_enum"]
          temperament_tags?: string[]
          updated_at?: string
          vet_id?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pets_breed_id_fkey"
            columns: ["breed_id"]
            isOneToOne: false
            referencedRelation: "breeds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pets_vet_id_fkey"
            columns: ["vet_id"]
            isOneToOne: false
            referencedRelation: "veterinarians"
            referencedColumns: ["id"]
          },
        ]
      }
      playgroup_assignments: {
        Row: {
          assigned_at: string
          assigned_by_user_id: string | null
          created_at: string
          id: string
          organization_id: string
          pet_id: string
          playgroup_id: string
          removed_at: string | null
          reservation_id: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by_user_id?: string | null
          created_at?: string
          id?: string
          organization_id: string
          pet_id: string
          playgroup_id: string
          removed_at?: string | null
          reservation_id?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by_user_id?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          pet_id?: string
          playgroup_id?: string
          removed_at?: string | null
          reservation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playgroup_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playgroup_assignments_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playgroup_assignments_playgroup_id_fkey"
            columns: ["playgroup_id"]
            isOneToOne: false
            referencedRelation: "playgroups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playgroup_assignments_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      playgroups: {
        Row: {
          active: boolean
          capacity: number | null
          color: string
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          location_id: string | null
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          capacity?: number | null
          color?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          location_id?: string | null
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          capacity?: number | null
          color?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          location_id?: string | null
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playgroups_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playgroups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_settings: {
        Row: {
          booking_rules: Json
          business_name: string | null
          created_at: string
          feature_toggles: Json
          id: string
          lead_form_enabled: boolean
          lead_form_fields: Json
          logo_url: string | null
          organization_id: string
          primary_color: string
          updated_at: string
          welcome_message: string
        }
        Insert: {
          booking_rules?: Json
          business_name?: string | null
          created_at?: string
          feature_toggles?: Json
          id?: string
          lead_form_enabled?: boolean
          lead_form_fields?: Json
          logo_url?: string | null
          organization_id: string
          primary_color?: string
          updated_at?: string
          welcome_message?: string
        }
        Update: {
          booking_rules?: Json
          business_name?: string | null
          created_at?: string
          feature_toggles?: Json
          id?: string
          lead_form_enabled?: boolean
          lead_form_fields?: Json
          logo_url?: string | null
          organization_id?: string
          primary_color?: string
          updated_at?: string
          welcome_message?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_cart_items: {
        Row: {
          cart_id: string
          created_at: string
          id: string
          item_kind: string
          line_total_cents: number
          name: string
          organization_id: string
          package_id: string | null
          product_id: string | null
          quantity: number
          service_id: string | null
          unit_price_cents: number
        }
        Insert: {
          cart_id: string
          created_at?: string
          id?: string
          item_kind: string
          line_total_cents?: number
          name: string
          organization_id: string
          package_id?: string | null
          product_id?: string | null
          quantity?: number
          service_id?: string | null
          unit_price_cents?: number
        }
        Update: {
          cart_id?: string
          created_at?: string
          id?: string
          item_kind?: string
          line_total_cents?: number
          name?: string
          organization_id?: string
          package_id?: string | null
          product_id?: string | null
          quantity?: number
          service_id?: string | null
          unit_price_cents?: number
        }
        Relationships: []
      }
      pos_carts: {
        Row: {
          applied_store_credit_cents: number
          cashier_user_id: string | null
          charged_at: string | null
          created_at: string
          discount_cents: number
          id: string
          invoice_id: string | null
          notes: string | null
          organization_id: string
          owner_id: string
          promotion_id: string | null
          status: string
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          updated_at: string
          voided_at: string | null
        }
        Insert: {
          applied_store_credit_cents?: number
          cashier_user_id?: string | null
          charged_at?: string | null
          created_at?: string
          discount_cents?: number
          id?: string
          invoice_id?: string | null
          notes?: string | null
          organization_id: string
          owner_id: string
          promotion_id?: string | null
          status?: string
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          updated_at?: string
          voided_at?: string | null
        }
        Update: {
          applied_store_credit_cents?: number
          cashier_user_id?: string | null
          charged_at?: string | null
          created_at?: string
          discount_cents?: number
          id?: string
          invoice_id?: string | null
          notes?: string | null
          organization_id?: string
          owner_id?: string
          promotion_id?: string | null
          status?: string
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          updated_at?: string
          voided_at?: string | null
        }
        Relationships: []
      }
      precheck_settings: {
        Row: {
          created_at: string
          enabled: boolean
          hours_before: number
          id: string
          organization_id: string
          questions: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          hours_before?: number
          id?: string
          organization_id: string
          questions?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          hours_before?: number
          id?: string
          organization_id?: string
          questions?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "precheck_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      precheck_submissions: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          owner_id: string
          pet_id: string
          reservation_id: string
          responses: Json
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          owner_id: string
          pet_id: string
          reservation_id: string
          responses?: Json
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          owner_id?: string
          pet_id?: string
          reservation_id?: string
          responses?: Json
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "precheck_submissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "precheck_submissions_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "precheck_submissions_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "precheck_submissions_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_rules: {
        Row: {
          applies_to_services: string[]
          conditions: Json
          created_at: string
          description: string | null
          discount_type: string
          discount_value: number
          end_date: string | null
          id: string
          name: string
          organization_id: string
          priority: number
          rule_type: string
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          applies_to_services?: string[]
          conditions?: Json
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          end_date?: string | null
          id?: string
          name: string
          organization_id: string
          priority?: number
          rule_type: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          applies_to_services?: string[]
          conditions?: Json
          created_at?: string
          description?: string | null
          discount_type?: string
          discount_value?: number
          end_date?: string | null
          id?: string
          name?: string
          organization_id?: string
          priority?: number
          rule_type?: string
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      promotions: {
        Row: {
          active: boolean
          code: string
          created_at: string
          deleted_at: string | null
          description: string | null
          discount_type: string
          discount_value: number
          id: string
          max_uses: number | null
          organization_id: string
          updated_at: string
          usage_count: number
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          max_uses?: number | null
          organization_id: string
          updated_at?: string
          usage_count?: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          discount_type?: string
          discount_value?: number
          id?: string
          max_uses?: number | null
          organization_id?: string
          updated_at?: string
          usage_count?: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          deleted_at: string | null
          endpoint: string
          id: string
          last_seen_at: string
          p256dh: string
          profile_id: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          deleted_at?: string | null
          endpoint: string
          id?: string
          last_seen_at?: string
          p256dh: string
          profile_id: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          deleted_at?: string | null
          endpoint?: string
          id?: string
          last_seen_at?: string
          p256dh?: string
          profile_id?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_tax_code_rates: {
        Row: {
          applicable_on: string | null
          created_at: string
          id: string
          organization_id: string
          rate_type: string | null
          tax_code_id: string
          tax_rate_id: string
        }
        Insert: {
          applicable_on?: string | null
          created_at?: string
          id?: string
          organization_id: string
          rate_type?: string | null
          tax_code_id: string
          tax_rate_id: string
        }
        Update: {
          applicable_on?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          rate_type?: string | null
          tax_code_id?: string
          tax_rate_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_tax_code_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_tax_code_rates_tax_code_id_fkey"
            columns: ["tax_code_id"]
            isOneToOne: false
            referencedRelation: "qbo_tax_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qbo_tax_code_rates_tax_rate_id_fkey"
            columns: ["tax_rate_id"]
            isOneToOne: false
            referencedRelation: "qbo_tax_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_tax_codes: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          last_synced_at: string
          name: string
          organization_id: string
          qbo_id: string
          tax_group: string
          taxable: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          last_synced_at?: string
          name: string
          organization_id: string
          qbo_id: string
          tax_group?: string
          taxable?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          last_synced_at?: string
          name?: string
          organization_id?: string
          qbo_id?: string
          tax_group?: string
          taxable?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_tax_codes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_tax_rates: {
        Row: {
          active: boolean
          agency_name: string | null
          created_at: string
          id: string
          last_synced_at: string
          name: string
          organization_id: string
          qbo_id: string
          rate_basis_points: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          agency_name?: string | null
          created_at?: string
          id?: string
          last_synced_at?: string
          name: string
          organization_id: string
          qbo_id: string
          rate_basis_points: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          agency_name?: string | null
          created_at?: string
          id?: string
          last_synced_at?: string
          name?: string
          organization_id?: string
          qbo_id?: string
          rate_basis_points?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_tax_rates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quickbooks_accounts: {
        Row: {
          access_token_expires_at: string | null
          access_token_secret_id: string
          company_name: string | null
          created_at: string
          default_deposit_account_id: string | null
          default_deposit_account_name: string | null
          default_income_account_id: string | null
          default_income_account_name: string | null
          deleted_at: string | null
          environment: string
          id: string
          last_verification_error: string | null
          last_verified_at: string | null
          organization_id: string
          realm_id: string
          refresh_token_secret_id: string
          status: string
          updated_at: string
        }
        Insert: {
          access_token_expires_at?: string | null
          access_token_secret_id: string
          company_name?: string | null
          created_at?: string
          default_deposit_account_id?: string | null
          default_deposit_account_name?: string | null
          default_income_account_id?: string | null
          default_income_account_name?: string | null
          deleted_at?: string | null
          environment?: string
          id?: string
          last_verification_error?: string | null
          last_verified_at?: string | null
          organization_id: string
          realm_id: string
          refresh_token_secret_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          access_token_expires_at?: string | null
          access_token_secret_id?: string
          company_name?: string | null
          created_at?: string
          default_deposit_account_id?: string | null
          default_deposit_account_name?: string | null
          default_income_account_id?: string | null
          default_income_account_name?: string | null
          deleted_at?: string | null
          environment?: string
          id?: string
          last_verification_error?: string | null
          last_verified_at?: string | null
          organization_id?: string
          realm_id?: string
          refresh_token_secret_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quickbooks_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quickbooks_entity_mappings: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          organization_id: string
          payload_hash: string | null
          qbo_entity_type: string
          qbo_id: string
          snout_id: string
          snout_table: string
          sync_state: string
          sync_token: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id: string
          payload_hash?: string | null
          qbo_entity_type: string
          qbo_id: string
          snout_id: string
          snout_table: string
          sync_state?: string
          sync_token?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          organization_id?: string
          payload_hash?: string | null
          qbo_entity_type?: string
          qbo_id?: string
          snout_id?: string
          snout_table?: string
          sync_state?: string
          sync_token?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "quickbooks_entity_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quickbooks_oauth_pending: {
        Row: {
          created_at: string
          expires_at: string
          initiated_by: string | null
          organization_id: string
          return_to: string | null
          state: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          initiated_by?: string | null
          organization_id: string
          return_to?: string | null
          state: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          initiated_by?: string | null
          organization_id?: string
          return_to?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "quickbooks_oauth_pending_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quickbooks_oauth_pending_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quickbooks_sync_queue: {
        Row: {
          attempts: number
          created_at: string
          enqueued_at: string
          id: string
          last_error: string | null
          next_attempt_at: string
          op: string
          organization_id: string
          processed_at: string | null
          snout_id: string
          snout_table: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          enqueued_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          op?: string
          organization_id: string
          processed_at?: string | null
          snout_id: string
          snout_table: string
        }
        Update: {
          attempts?: number
          created_at?: string
          enqueued_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          op?: string
          organization_id?: string
          processed_at?: string | null
          snout_id?: string
          snout_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "quickbooks_sync_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_reservation_groups: {
        Row: {
          created_at: string
          created_by: string | null
          days_of_week: number[]
          end_date: string | null
          end_time: string
          id: string
          location_id: string | null
          max_occurrences: number | null
          notes: string | null
          organization_id: string
          owner_id: string
          pet_ids: string[]
          service_id: string | null
          start_date: string
          start_time: string
          status: string
          suite_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          days_of_week?: number[]
          end_date?: string | null
          end_time: string
          id?: string
          location_id?: string | null
          max_occurrences?: number | null
          notes?: string | null
          organization_id: string
          owner_id: string
          pet_ids?: string[]
          service_id?: string | null
          start_date: string
          start_time: string
          status?: string
          suite_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          days_of_week?: number[]
          end_date?: string | null
          end_time?: string
          id?: string
          location_id?: string | null
          max_occurrences?: number | null
          notes?: string | null
          organization_id?: string
          owner_id?: string
          pet_ids?: string[]
          service_id?: string | null
          start_date?: string
          start_time?: string
          status?: string
          suite_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      refund_reasons: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_default: boolean
          name: string
          organization_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          organization_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          organization_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_reasons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      report_cards: {
        Row: {
          appetite: string | null
          created_at: string
          created_by: string | null
          energy_level: string | null
          id: string
          mood: string | null
          organization_id: string
          overall_rating: string | null
          pet_id: string
          photo_urls: string[]
          published: boolean
          published_at: string | null
          reservation_id: string
          sociability: string | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          appetite?: string | null
          created_at?: string
          created_by?: string | null
          energy_level?: string | null
          id?: string
          mood?: string | null
          organization_id: string
          overall_rating?: string | null
          pet_id: string
          photo_urls?: string[]
          published?: boolean
          published_at?: string | null
          reservation_id: string
          sociability?: string | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          appetite?: string | null
          created_at?: string
          created_by?: string | null
          energy_level?: string | null
          id?: string
          mood?: string | null
          organization_id?: string
          overall_rating?: string | null
          pet_id?: string
          photo_urls?: string[]
          published?: boolean
          published_at?: string | null
          reservation_id?: string
          sociability?: string | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_cards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_cards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_cards_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_cards_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      report_templates: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_belongings: {
        Row: {
          condition_notes: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          item_name: string
          notes: string | null
          organization_id: string
          quantity: number
          reservation_id: string
          returned_at: string | null
          returned_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          condition_notes?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          item_name: string
          notes?: string | null
          organization_id: string
          quantity?: number
          reservation_id: string
          returned_at?: string | null
          returned_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          condition_notes?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          item_name?: string
          notes?: string | null
          organization_id?: string
          quantity?: number
          reservation_id?: string
          returned_at?: string | null
          returned_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_belongings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_belongings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_belongings_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_belongings_returned_by_fkey"
            columns: ["returned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reservation_pets: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          pet_id: string
          reservation_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          pet_id: string
          reservation_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          pet_id?: string
          reservation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservation_pets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_pets_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_pets_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: true
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          cancellation_notes: string | null
          cancellation_reason_id: string | null
          cancelled_at: string | null
          cancelled_reason: string | null
          checked_in_at: string | null
          checked_in_by_user_id: string | null
          checked_out_at: string | null
          checked_out_by_user_id: string | null
          confirmed_at: string | null
          confirmed_by_user_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          end_at: string
          id: string
          is_recurring: boolean
          location_id: string | null
          notes: string | null
          organization_id: string
          parent_reservation_id: string | null
          primary_owner_id: string | null
          recurring_group_id: string | null
          requested_at: string | null
          service_id: string | null
          source: Database["public"]["Enums"]["reservation_source"]
          start_at: string
          status: Database["public"]["Enums"]["reservation_status"]
          suite_id: string | null
          tip_cents: number | null
          updated_at: string
        }
        Insert: {
          cancellation_notes?: string | null
          cancellation_reason_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          checked_in_at?: string | null
          checked_in_by_user_id?: string | null
          checked_out_at?: string | null
          checked_out_by_user_id?: string | null
          confirmed_at?: string | null
          confirmed_by_user_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          end_at: string
          id?: string
          is_recurring?: boolean
          location_id?: string | null
          notes?: string | null
          organization_id: string
          parent_reservation_id?: string | null
          primary_owner_id?: string | null
          recurring_group_id?: string | null
          requested_at?: string | null
          service_id?: string | null
          source?: Database["public"]["Enums"]["reservation_source"]
          start_at: string
          status?: Database["public"]["Enums"]["reservation_status"]
          suite_id?: string | null
          tip_cents?: number | null
          updated_at?: string
        }
        Update: {
          cancellation_notes?: string | null
          cancellation_reason_id?: string | null
          cancelled_at?: string | null
          cancelled_reason?: string | null
          checked_in_at?: string | null
          checked_in_by_user_id?: string | null
          checked_out_at?: string | null
          checked_out_by_user_id?: string | null
          confirmed_at?: string | null
          confirmed_by_user_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          end_at?: string
          id?: string
          is_recurring?: boolean
          location_id?: string | null
          notes?: string | null
          organization_id?: string
          parent_reservation_id?: string | null
          primary_owner_id?: string | null
          recurring_group_id?: string | null
          requested_at?: string | null
          service_id?: string | null
          source?: Database["public"]["Enums"]["reservation_source"]
          start_at?: string
          status?: Database["public"]["Enums"]["reservation_status"]
          suite_id?: string | null
          tip_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_cancellation_reason_id_fkey"
            columns: ["cancellation_reason_id"]
            isOneToOne: false
            referencedRelation: "cancellation_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_parent_reservation_id_fkey"
            columns: ["parent_reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_recurring_group_id_fkey"
            columns: ["recurring_group_id"]
            isOneToOne: false
            referencedRelation: "recurring_reservation_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_suite_id_fkey"
            columns: ["suite_id"]
            isOneToOne: false
            referencedRelation: "suites"
            referencedColumns: ["id"]
          },
        ]
      }
      retail_products: {
        Row: {
          active: boolean
          category: string
          cost_cents: number
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          manufacturer: string | null
          name: string
          organization_id: string
          photo_url: string | null
          price_cents: number
          reorder_point: number
          sku: string | null
          stock_quantity: number
          updated_at: string
          vendor: string | null
        }
        Insert: {
          active?: boolean
          category?: string
          cost_cents?: number
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          manufacturer?: string | null
          name: string
          organization_id: string
          photo_url?: string | null
          price_cents?: number
          reorder_point?: number
          sku?: string | null
          stock_quantity?: number
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          active?: boolean
          category?: string
          cost_cents?: number
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          manufacturer?: string | null
          name?: string
          organization_id?: string
          photo_url?: string | null
          price_cents?: number
          reorder_point?: number
          sku?: string | null
          stock_quantity?: number
          updated_at?: string
          vendor?: string | null
        }
        Relationships: []
      }
      service_deposit_overrides: {
        Row: {
          amount_cents: number
          amount_type: string
          created_at: string
          enabled: boolean
          id: string
          organization_id: string
          percentage_bp: number
          service_id: string
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          amount_type?: string
          created_at?: string
          enabled?: boolean
          id?: string
          organization_id: string
          percentage_bp?: number
          service_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          amount_type?: string
          created_at?: string
          enabled?: boolean
          id?: string
          organization_id?: string
          percentage_bp?: number
          service_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      services: {
        Row: {
          active: boolean
          base_price_cents: number
          created_at: string
          default_duration_minutes: number | null
          deleted_at: string | null
          description: string | null
          duration_minutes: number | null
          duration_type: Database["public"]["Enums"]["duration_type_enum"]
          id: string
          is_addon: boolean
          location_id: string | null
          max_pets_per_booking: number | null
          module: Database["public"]["Enums"]["module_enum"]
          name: string
          organization_id: string
          time_windows: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_price_cents?: number
          created_at?: string
          default_duration_minutes?: number | null
          deleted_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          duration_type: Database["public"]["Enums"]["duration_type_enum"]
          id?: string
          is_addon?: boolean
          location_id?: string | null
          max_pets_per_booking?: number | null
          module: Database["public"]["Enums"]["module_enum"]
          name: string
          organization_id: string
          time_windows?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_price_cents?: number
          created_at?: string
          default_duration_minutes?: number | null
          deleted_at?: string | null
          description?: string | null
          duration_minutes?: number | null
          duration_type?: Database["public"]["Enums"]["duration_type_enum"]
          id?: string
          is_addon?: boolean
          location_id?: string | null
          max_pets_per_booking?: number | null
          module?: Database["public"]["Enums"]["module_enum"]
          name?: string
          organization_id?: string
          time_windows?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_templates: {
        Row: {
          color: string
          created_at: string
          deleted_at: string | null
          department: string | null
          end_time: string
          id: string
          name: string
          organization_id: string
          start_time: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          deleted_at?: string | null
          department?: string | null
          end_time: string
          id?: string
          name: string
          organization_id: string
          start_time: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          deleted_at?: string | null
          department?: string | null
          end_time?: string
          id?: string
          name?: string
          organization_id?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      signed_agreements: {
        Row: {
          created_at: string
          id: string
          ip_address: string | null
          organization_id: string
          owner_id: string
          pet_id: string | null
          rendered_body: string
          signature_data: string
          signed_at: string
          signer_name: string
          template_id: string
          template_version: number
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: string | null
          organization_id: string
          owner_id: string
          pet_id?: string | null
          rendered_body?: string
          signature_data: string
          signed_at?: string
          signer_name: string
          template_id: string
          template_version?: number
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: string | null
          organization_id?: string
          owner_id?: string
          pet_id?: string | null
          rendered_body?: string
          signature_data?: string
          signed_at?: string
          signer_name?: string
          template_id?: string
          template_version?: number
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signed_agreements_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "agreement_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_codes: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          last_used_at: string | null
          organization_id: string
          pin_code: string | null
          pin_hash: string | null
          profile_id: string | null
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          organization_id: string
          pin_code?: string | null
          pin_hash?: string | null
          profile_id?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          organization_id?: string
          pin_code?: string | null
          pin_hash?: string | null
          profile_id?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_codes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_codes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_notices: {
        Row: {
          body: string | null
          created_at: string
          created_by: string | null
          id: string
          notice_date: string
          organization_id: string
          title: string
          updated_at: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notice_date: string
          organization_id: string
          title: string
          updated_at?: string
        }
        Update: {
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notice_date?: string
          organization_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_notices_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_shifts: {
        Row: {
          created_at: string
          deleted_at: string | null
          department: string | null
          end_time: string
          id: string
          notes: string | null
          organization_id: string
          shift_date: string
          shift_template_id: string | null
          start_time: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          department?: string | null
          end_time: string
          id?: string
          notes?: string | null
          organization_id: string
          shift_date: string
          shift_template_id?: string | null
          start_time: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          department?: string | null
          end_time?: string
          id?: string
          notes?: string | null
          organization_id?: string
          shift_date?: string
          shift_template_id?: string | null
          start_time?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_shifts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_shifts_shift_template_id_fkey"
            columns: ["shift_template_id"]
            isOneToOne: false
            referencedRelation: "shift_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_connect_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["connect_account_type"]
          charges_enabled: boolean
          created_at: string
          deleted_at: string | null
          details_submitted: boolean
          id: string
          organization_id: string
          payouts_enabled: boolean
          status: string
          stripe_account_id: string
          updated_at: string
        }
        Insert: {
          account_type?: Database["public"]["Enums"]["connect_account_type"]
          charges_enabled?: boolean
          created_at?: string
          deleted_at?: string | null
          details_submitted?: boolean
          id?: string
          organization_id: string
          payouts_enabled?: boolean
          status?: string
          stripe_account_id: string
          updated_at?: string
        }
        Update: {
          account_type?: Database["public"]["Enums"]["connect_account_type"]
          charges_enabled?: boolean
          created_at?: string
          deleted_at?: string | null
          details_submitted?: boolean
          id?: string
          organization_id?: string
          payouts_enabled?: boolean
          status?: string
          stripe_account_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_connect_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_processed_events: {
        Row: {
          event_type: string
          id: string
          processed_at: string
          stripe_event_id: string
        }
        Insert: {
          event_type: string
          id?: string
          processed_at?: string
          stripe_event_id: string
        }
        Update: {
          event_type?: string
          id?: string
          processed_at?: string
          stripe_event_id?: string
        }
        Relationships: []
      }
      subscription_modules: {
        Row: {
          created_at: string
          deleted_at: string | null
          enabled: boolean
          id: string
          location_id: string | null
          module: Database["public"]["Enums"]["module_enum"]
          organization_id: string
          price_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          enabled?: boolean
          id?: string
          location_id?: string | null
          module: Database["public"]["Enums"]["module_enum"]
          organization_id: string
          price_cents?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          enabled?: boolean
          id?: string
          location_id?: string | null
          module?: Database["public"]["Enums"]["module_enum"]
          organization_id?: string
          price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_modules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_modules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_packages: {
        Row: {
          active: boolean
          billing_cycle: string
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          included_credits: Json
          name: string
          organization_id: string
          price_cents: number
          service_type: string | null
          updated_at: string
          validity_days: number | null
        }
        Insert: {
          active?: boolean
          billing_cycle?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          included_credits?: Json
          name: string
          organization_id: string
          price_cents?: number
          service_type?: string | null
          updated_at?: string
          validity_days?: number | null
        }
        Update: {
          active?: boolean
          billing_cycle?: string
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          included_credits?: Json
          name?: string
          organization_id?: string
          price_cents?: number
          service_type?: string | null
          updated_at?: string
          validity_days?: number | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          deleted_at: string | null
          id: string
          last_payment_date: string | null
          organization_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_checkout_session_id: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          deleted_at?: string | null
          id?: string
          last_payment_date?: string | null
          organization_id: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          deleted_at?: string | null
          id?: string
          last_payment_date?: string | null
          organization_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_checkout_session_id?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suites: {
        Row: {
          capacity: number
          created_at: string
          daily_rate_cents: number
          deleted_at: string | null
          id: string
          location_id: string | null
          name: string
          organization_id: string
          status: Database["public"]["Enums"]["suite_status_enum"]
          type: Database["public"]["Enums"]["suite_type_enum"]
          updated_at: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          daily_rate_cents?: number
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          name: string
          organization_id: string
          status?: Database["public"]["Enums"]["suite_status_enum"]
          type?: Database["public"]["Enums"]["suite_type_enum"]
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          daily_rate_cents?: number
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          name?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["suite_status_enum"]
          type?: Database["public"]["Enums"]["suite_type_enum"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "suites_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      surcharge_settings: {
        Row: {
          applies_to_credit_only: boolean
          created_at: string
          customer_notice_text: string | null
          deleted_at: string | null
          enabled: boolean
          id: string
          organization_id: string
          rate_basis_points: number
          registered_with_card_networks: boolean
          updated_at: string
        }
        Insert: {
          applies_to_credit_only?: boolean
          created_at?: string
          customer_notice_text?: string | null
          deleted_at?: string | null
          enabled?: boolean
          id?: string
          organization_id: string
          rate_basis_points?: number
          registered_with_card_networks?: boolean
          updated_at?: string
        }
        Update: {
          applies_to_credit_only?: boolean
          created_at?: string
          customer_notice_text?: string | null
          deleted_at?: string | null
          enabled?: boolean
          id?: string
          organization_id?: string
          rate_basis_points?: number
          registered_with_card_networks?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "surcharge_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          created_at: string
          feedback: string | null
          id: string
          organization_id: string
          owner_id: string
          pet_id: string | null
          rating: number | null
          reservation_id: string | null
          responded_at: string | null
          sent_at: string
          updated_at: string
          would_recommend: boolean | null
        }
        Insert: {
          created_at?: string
          feedback?: string | null
          id?: string
          organization_id: string
          owner_id: string
          pet_id?: string | null
          rating?: number | null
          reservation_id?: string | null
          responded_at?: string | null
          sent_at?: string
          updated_at?: string
          would_recommend?: boolean | null
        }
        Update: {
          created_at?: string
          feedback?: string | null
          id?: string
          organization_id?: string
          owner_id?: string
          pet_id?: string | null
          rating?: number | null
          reservation_id?: string | null
          responded_at?: string | null
          sent_at?: string
          updated_at?: string
          would_recommend?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_settings: {
        Row: {
          created_at: string
          enabled: boolean
          feedback_prompt: string
          id: string
          organization_id: string
          send_hours_after_checkout: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          feedback_prompt?: string
          id?: string
          organization_id: string
          send_hours_after_checkout?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          feedback_prompt?: string
          id?: string
          organization_id?: string
          send_hours_after_checkout?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_rules: {
        Row: {
          active: boolean
          created_at: string
          deleted_at: string | null
          id: string
          location_id: string | null
          name: string
          organization_id: string
          rate_basis_points: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          name: string
          organization_id: string
          rate_basis_points: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          deleted_at?: string | null
          id?: string
          location_id?: string | null
          name?: string
          organization_id?: string
          rate_basis_points?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_rules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vaccinations: {
        Row: {
          administered_on: string | null
          created_at: string
          deleted_at: string | null
          document_url: string | null
          expires_on: string | null
          id: string
          notes: string | null
          organization_id: string
          pet_id: string
          updated_at: string
          vaccine_type: Database["public"]["Enums"]["vaccine_type_enum"]
          verified: boolean
          verified_at: string | null
          verified_by_user_id: string | null
          vet_clinic: string | null
          vet_name: string | null
        }
        Insert: {
          administered_on?: string | null
          created_at?: string
          deleted_at?: string | null
          document_url?: string | null
          expires_on?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          pet_id: string
          updated_at?: string
          vaccine_type: Database["public"]["Enums"]["vaccine_type_enum"]
          verified?: boolean
          verified_at?: string | null
          verified_by_user_id?: string | null
          vet_clinic?: string | null
          vet_name?: string | null
        }
        Update: {
          administered_on?: string | null
          created_at?: string
          deleted_at?: string | null
          document_url?: string | null
          expires_on?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          pet_id?: string
          updated_at?: string
          vaccine_type?: Database["public"]["Enums"]["vaccine_type_enum"]
          verified?: boolean
          verified_at?: string | null
          verified_by_user_id?: string | null
          vet_clinic?: string | null
          vet_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vaccinations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vaccinations_pet_id_fkey"
            columns: ["pet_id"]
            isOneToOne: false
            referencedRelation: "pets"
            referencedColumns: ["id"]
          },
        ]
      }
      veterinarians: {
        Row: {
          address: string | null
          clinic_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          organization_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          clinic_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          organization_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          clinic_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          organization_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "veterinarians_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      waiver_signatures: {
        Row: {
          created_at: string
          id: string
          ip_address: string | null
          organization_id: string
          owner_id: string
          signature_data: string | null
          signed_at: string
          user_agent: string | null
          waiver_id: string
          waiver_version: number
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: string | null
          organization_id: string
          owner_id: string
          signature_data?: string | null
          signed_at?: string
          user_agent?: string | null
          waiver_id: string
          waiver_version?: number
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: string | null
          organization_id?: string
          owner_id?: string
          signature_data?: string | null
          signed_at?: string
          user_agent?: string | null
          waiver_id?: string
          waiver_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "waiver_signatures_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiver_signatures_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "owners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waiver_signatures_waiver_id_fkey"
            columns: ["waiver_id"]
            isOneToOne: false
            referencedRelation: "waivers"
            referencedColumns: ["id"]
          },
        ]
      }
      waivers: {
        Row: {
          active: boolean
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          organization_id: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          organization_id?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "waivers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webcams: {
        Row: {
          created_at: string
          deleted_at: string | null
          description: string | null
          enabled: boolean
          id: string
          location_id: string | null
          name: string
          organization_id: string
          provider: string | null
          source_kind: Database["public"]["Enums"]["webcam_source_kind"]
          source_url: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          location_id?: string | null
          name: string
          organization_id: string
          provider?: string | null
          source_kind?: Database["public"]["Enums"]["webcam_source_kind"]
          source_url: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          location_id?: string | null
          name?: string
          organization_id?: string
          provider?: string | null
          source_kind?: Database["public"]["Enums"]["webcam_source_kind"]
          source_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webcams_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webcams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_credit_adjustment: {
        Args: {
          p_actor_kind: string
          p_actor_label: string
          p_delta_full: number
          p_delta_half: number
          p_delta_nights: number
          p_note: string
          p_owner_id: string
          p_staff_code_id: string
        }
        Returns: Json
      }
      apply_helcim_payment: {
        Args: {
          _amount_cents: number
          _card_funding?: string
          _currency: string
          _helcim_invoice_number?: string
          _helcim_transaction_id: string
          _invoice_id: string
          _method?: string
        }
        Returns: undefined
      }
      apply_stripe_payment:
        | {
            Args: {
              _amount_cents: number
              _currency: string
              _invoice_id: string
              _method?: string
              _payment_intent_id: string
            }
            Returns: undefined
          }
        | {
            Args: {
              _amount_cents: number
              _card_funding?: string
              _currency: string
              _expected_payout_at?: string
              _invoice_id: string
              _method?: string
              _payment_intent_id: string
            }
            Returns: undefined
          }
      client_retention_stats: {
        Args: { _org_id: string; _range_from: string }
        Returns: {
          retention30: number
          retention60: number
          retention90: number
          total_prior_owners: number
        }[]
      }
      consume_credits: {
        Args: {
          p_actor_kind: string
          p_actor_label: string
          p_need_full: number
          p_need_half: number
          p_need_nights: number
          p_owner_id: string
          p_reservation_id: string
          p_staff_code_id: string
        }
        Returns: Json
      }
      consume_quickbooks_oauth_pending: {
        Args: { _state: string }
        Returns: {
          organization_id: string
          return_to: string
        }[]
      }
      create_membership: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["membership_role"]
        }
        Returns: string
      }
      create_organization_with_owner: {
        Args: {
          _country: string
          _currency: string
          _name: string
          _slug: string
          _timezone: string
        }
        Returns: string
      }
      create_quickbooks_oauth_pending: {
        Args: {
          _initiated_by: string
          _org_id: string
          _return_to?: string
          _state: string
        }
        Returns: undefined
      }
      create_staff_code: {
        Args: { _display_name: string; _pin: string; _role: string }
        Returns: string
      }
      current_org_id: { Args: never; Returns: string }
      decrement_product_stock: {
        Args: {
          _allow_negative?: boolean
          _product_id: string
          _quantity: number
        }
        Returns: undefined
      }
      detach_helcim_account: { Args: { _org_id: string }; Returns: undefined }
      detach_quickbooks_account: {
        Args: { _org_id: string }
        Returns: undefined
      }
      expire_credits: { Args: { p_organization_id: string }; Returns: Json }
      get_groomer_available_dates: {
        Args: { p_end_date: string; p_groomer_id: string; p_start_date: string }
        Returns: Json
      }
      get_groomer_available_slots: {
        Args: {
          p_date: string
          p_duration_minutes?: number
          p_groomer_id: string
          p_slot_step_minutes?: number
        }
        Returns: Json
      }
      get_helcim_api_token: { Args: { _org_id: string }; Returns: string }
      get_helcim_webhook_verifier: {
        Args: { _org_id: string }
        Returns: string
      }
      get_quickbooks_tokens: {
        Args: { _org_id: string }
        Returns: {
          access_token: string
          access_token_expires_at: string
          environment: string
          realm_id: string
          refresh_token: string
        }[]
      }
      invoke_quickbooks_process_queue: { Args: never; Returns: number }
      is_org_admin: { Args: { _org_id: string }; Returns: boolean }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
      mark_conversation_read_by_owner: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      mark_invoice_paid_offline: {
        Args: { invoice_id: string; method?: string }
        Returns: undefined
      }
      next_invoice_number: { Args: { _org_id: string }; Returns: string }
      qbo_enqueue_unsynced_invoices: {
        Args: { _limit?: number; _org_id: string }
        Returns: number
      }
      qbo_enqueue_unsynced_payments: {
        Args: { _limit?: number; _org_id: string }
        Returns: number
      }
      qbo_mapping_counts: {
        Args: { _org_id: string }
        Returns: {
          n: number
          snout_table: string
          sync_state: string
        }[]
      }
      qbo_mark_queue_failed: {
        Args: { _error: string; _id: string }
        Returns: undefined
      }
      qbo_mark_queue_processed: { Args: { _id: string }; Returns: undefined }
      qbo_pickup_queue_batch: {
        Args: { _limit?: number }
        Returns: {
          attempts: number
          id: string
          op: string
          organization_id: string
          snout_id: string
          snout_table: string
        }[]
      }
      qbo_reset_failed_mappings: {
        Args: { _org_id: string; _snout_table?: string }
        Returns: number
      }
      qbo_retry_failed_mapping: {
        Args: { _mapping_id: string }
        Returns: undefined
      }
      qbo_sync_queue_status: {
        Args: { _org_id: string }
        Returns: {
          failed_in_queue_count: number
          last_processed_at: string
          oldest_pending_at: string
          pending_count: number
          processing_count: number
        }[]
      }
      qbo_tax_codes_for_org: {
        Args: { _org: string }
        Returns: {
          combined_rate_basis_points: number
          description: string
          id: string
          name: string
          qbo_id: string
          rate_summary: string
          taxable: boolean
        }[]
      }
      qbo_unsynced_invoice_ids: {
        Args: { _limit?: number; _org_id: string }
        Returns: {
          invoice_id: string
        }[]
      }
      qbo_unsynced_owner_ids: {
        Args: { _limit?: number; _org_id: string }
        Returns: {
          owner_id: string
        }[]
      }
      qbo_unsynced_payment_ids: {
        Args: { _limit?: number; _org_id: string }
        Returns: {
          payment_id: string
        }[]
      }
      qbo_unsynced_service_ids: {
        Args: { _limit?: number; _org_id: string }
        Returns: {
          service_id: string
        }[]
      }
      refresh_owner_credit_cache: {
        Args: { p_owner_id: string }
        Returns: undefined
      }
      set_helcim_api_token: {
        Args: { _api_token: string; _org_id: string }
        Returns: string
      }
      set_helcim_webhook_verifier: {
        Args: { _org_id: string; _verifier: string }
        Returns: undefined
      }
      set_member_active: {
        Args: { _active: boolean; _membership_id: string }
        Returns: undefined
      }
      set_quickbooks_tokens: {
        Args: {
          _access_expires_at: string
          _access_token: string
          _company_name: string
          _environment: string
          _org_id: string
          _realm_id: string
          _refresh_token: string
        }
        Returns: string
      }
      update_helcim_verification: {
        Args: {
          _account_id: string
          _business_name: string
          _charges_enabled: boolean
          _currency: string
          _org_id: string
          _verification_error?: string
        }
        Returns: undefined
      }
      update_member_role: {
        Args: {
          _membership_id: string
          _new_role: Database["public"]["Enums"]["membership_role"]
        }
        Returns: undefined
      }
      update_quickbooks_tokens: {
        Args: {
          _access_expires_at: string
          _access_token: string
          _org_id: string
          _refresh_token: string
        }
        Returns: undefined
      }
      update_staff_code_pin: {
        Args: { _id: string; _new_pin: string }
        Returns: undefined
      }
      verify_staff_pin: {
        Args: { _org_id: string; _pin: string }
        Returns: string
      }
    }
    Enums: {
      communication_pref: "email" | "sms" | "both"
      connect_account_type: "standard" | "express" | "custom"
      country_enum: "CA" | "US"
      credit_ledger_kind:
        | "opening_balance"
        | "purchase"
        | "consumption"
        | "refund"
        | "expiration"
        | "manual_adjustment"
      currency_enum: "CAD" | "USD"
      duration_type_enum:
        | "hourly"
        | "half_day"
        | "full_day"
        | "overnight"
        | "multi_night"
        | "flat"
      intake_status_enum:
        | "pending_review"
        | "approved"
        | "restricted"
        | "banned"
      invoice_status: "draft" | "sent" | "paid" | "partial" | "overdue" | "void"
      kennel_run_type: "standard" | "large" | "suite" | "indoor" | "outdoor"
      membership_role: "owner" | "admin" | "manager" | "staff" | "customer"
      message_sender_type: "staff" | "owner"
      module_enum: "daycare" | "boarding" | "grooming" | "training" | "retail"
      org_status_enum: "trial" | "active" | "paused" | "past_due" | "cancelled"
      payment_method_enum: "card" | "ach" | "in_person"
      payment_processor_kind: "stripe" | "helcim"
      payment_status: "pending" | "succeeded" | "failed" | "refunded"
      pet_owner_relationship: "primary" | "secondary" | "emergency_only"
      reservation_source: "staff_created" | "owner_self_serve"
      reservation_status:
        | "requested"
        | "confirmed"
        | "checked_in"
        | "checked_out"
        | "cancelled"
        | "no_show"
      sex_enum: "M" | "F" | "U"
      species_enum: "dog" | "cat" | "other"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "cancelled"
        | "paused"
      suite_status_enum: "active" | "inactive"
      suite_type_enum: "standard" | "deluxe" | "presidential"
      vaccine_type_enum:
        | "rabies"
        | "dapp"
        | "dhpp"
        | "bordetella"
        | "lepto"
        | "lyme"
        | "influenza"
        | "fvrcp"
        | "other"
      webcam_source_kind: "hls" | "mp4" | "iframe"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      communication_pref: ["email", "sms", "both"],
      connect_account_type: ["standard", "express", "custom"],
      country_enum: ["CA", "US"],
      credit_ledger_kind: [
        "opening_balance",
        "purchase",
        "consumption",
        "refund",
        "expiration",
        "manual_adjustment",
      ],
      currency_enum: ["CAD", "USD"],
      duration_type_enum: [
        "hourly",
        "half_day",
        "full_day",
        "overnight",
        "multi_night",
        "flat",
      ],
      intake_status_enum: [
        "pending_review",
        "approved",
        "restricted",
        "banned",
      ],
      invoice_status: ["draft", "sent", "paid", "partial", "overdue", "void"],
      kennel_run_type: ["standard", "large", "suite", "indoor", "outdoor"],
      membership_role: ["owner", "admin", "manager", "staff", "customer"],
      message_sender_type: ["staff", "owner"],
      module_enum: ["daycare", "boarding", "grooming", "training", "retail"],
      org_status_enum: ["trial", "active", "paused", "past_due", "cancelled"],
      payment_method_enum: ["card", "ach", "in_person"],
      payment_processor_kind: ["stripe", "helcim"],
      payment_status: ["pending", "succeeded", "failed", "refunded"],
      pet_owner_relationship: ["primary", "secondary", "emergency_only"],
      reservation_source: ["staff_created", "owner_self_serve"],
      reservation_status: [
        "requested",
        "confirmed",
        "checked_in",
        "checked_out",
        "cancelled",
        "no_show",
      ],
      sex_enum: ["M", "F", "U"],
      species_enum: ["dog", "cat", "other"],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "cancelled",
        "paused",
      ],
      suite_status_enum: ["active", "inactive"],
      suite_type_enum: ["standard", "deluxe", "presidential"],
      vaccine_type_enum: [
        "rabies",
        "dapp",
        "dhpp",
        "bordetella",
        "lepto",
        "lyme",
        "influenza",
        "fvrcp",
        "other",
      ],
      webcam_source_kind: ["hls", "mp4", "iframe"],
    },
  },
} as const
A new version of Supabase CLI is available: v2.98.2 (currently installed v2.90.0)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
