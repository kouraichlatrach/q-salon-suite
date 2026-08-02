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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_job_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      appointments: {
        Row: {
          brand_id: string
          client_id: string
          client_package_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          deposit_amount: number | null
          deposit_hold_expires_at: string | null
          deposit_paid_amount: number | null
          deposit_skipped: boolean
          deposit_status: Database["public"]["Enums"]["deposit_status"] | null
          ends_at: string
          id: string
          location_id: string
          notes: string | null
          price: number | null
          reminded_at: string | null
          service_id: string | null
          staff_user_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          client_package_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deposit_amount?: number | null
          deposit_hold_expires_at?: string | null
          deposit_paid_amount?: number | null
          deposit_skipped?: boolean
          deposit_status?: Database["public"]["Enums"]["deposit_status"] | null
          ends_at: string
          id?: string
          location_id: string
          notes?: string | null
          price?: number | null
          reminded_at?: string | null
          service_id?: string | null
          staff_user_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          client_package_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deposit_amount?: number | null
          deposit_hold_expires_at?: string | null
          deposit_paid_amount?: number | null
          deposit_skipped?: boolean
          deposit_status?: Database["public"]["Enums"]["deposit_status"] | null
          ends_at?: string
          id?: string
          location_id?: string
          notes?: string | null
          price?: number | null
          reminded_at?: string | null
          service_id?: string | null
          staff_user_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_client_package_id_fkey"
            columns: ["client_package_id"]
            isOneToOne: false
            referencedRelation: "client_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_otps: {
        Row: {
          attempts: number
          brand_id: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          phone: string
        }
        Insert: {
          attempts?: number
          brand_id: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          phone: string
        }
        Update: {
          attempts?: number
          brand_id?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_otps_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_tokens: {
        Row: {
          appointment_id: string
          created_at: string
          expires_at: string | null
          token: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          expires_at?: string | null
          token: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          expires_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_tokens_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          billing_cycle: Database["public"]["Enums"]["billing_cycle"]
          created_at: string
          currency: string
          deposit_hold_minutes: number
          gift_card_denominations: number[]
          gift_card_expiry_enabled: boolean
          gift_card_expiry_months: number
          id: string
          max_advance_days: number
          max_locations: number
          max_staff_accounts: number
          min_notice_hours: number
          name: string
          owner_user_id: string
          plan: Database["public"]["Enums"]["subscription_plan"]
          refund_cutoff_hours: number
          reminder_lead_hours: number
          renewal_date: string | null
          slug: string
          sms_sender: string | null
          subscription_status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
          whatsapp_enabled: boolean
        }
        Insert: {
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"]
          created_at?: string
          currency?: string
          deposit_hold_minutes?: number
          gift_card_denominations?: number[]
          gift_card_expiry_enabled?: boolean
          gift_card_expiry_months?: number
          id?: string
          max_advance_days?: number
          max_locations?: number
          max_staff_accounts?: number
          min_notice_hours?: number
          name: string
          owner_user_id: string
          plan?: Database["public"]["Enums"]["subscription_plan"]
          refund_cutoff_hours?: number
          reminder_lead_hours?: number
          renewal_date?: string | null
          slug: string
          sms_sender?: string | null
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          whatsapp_enabled?: boolean
        }
        Update: {
          billing_cycle?: Database["public"]["Enums"]["billing_cycle"]
          created_at?: string
          currency?: string
          deposit_hold_minutes?: number
          gift_card_denominations?: number[]
          gift_card_expiry_enabled?: boolean
          gift_card_expiry_months?: number
          id?: string
          max_advance_days?: number
          max_locations?: number
          max_staff_accounts?: number
          min_notice_hours?: number
          name?: string
          owner_user_id?: string
          plan?: Database["public"]["Enums"]["subscription_plan"]
          refund_cutoff_hours?: number
          reminder_lead_hours?: number
          renewal_date?: string | null
          slug?: string
          sms_sender?: string | null
          subscription_status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          whatsapp_enabled?: boolean
        }
        Relationships: []
      }
      client_package_service_balances: {
        Row: {
          client_package_id: string
          created_at: string
          id: string
          included_count: number
          remaining_count: number
          service_id: string
          updated_at: string
        }
        Insert: {
          client_package_id: string
          created_at?: string
          id?: string
          included_count: number
          remaining_count: number
          service_id: string
          updated_at?: string
        }
        Update: {
          client_package_id?: string
          created_at?: string
          id?: string
          included_count?: number
          remaining_count?: number
          service_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_package_service_balances_client_package_id_fkey"
            columns: ["client_package_id"]
            isOneToOne: false
            referencedRelation: "client_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_package_service_balances_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      client_packages: {
        Row: {
          brand_id: string
          client_id: string
          created_at: string
          currency: string
          expires_at: string | null
          id: string
          location_id: string
          note: string | null
          package_type_id: string
          price_paid: number
          purchased_at: string
          sold_by: string | null
          status: Database["public"]["Enums"]["client_package_status"]
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id: string
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          location_id: string
          note?: string | null
          package_type_id: string
          price_paid: number
          purchased_at?: string
          sold_by?: string | null
          status?: Database["public"]["Enums"]["client_package_status"]
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          location_id?: string
          note?: string | null
          package_type_id?: string
          price_paid?: number
          purchased_at?: string
          sold_by?: string | null
          status?: Database["public"]["Enums"]["client_package_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_packages_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_packages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_packages_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_packages_package_type_id_fkey"
            columns: ["package_type_id"]
            isOneToOne: false
            referencedRelation: "package_types"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          brand_id: string
          created_at: string
          email: string | null
          id: string
          name: string
          no_show_count: number
          notes: string | null
          phone: string | null
          updated_at: string
          whatsapp_consent_source:
            | Database["public"]["Enums"]["consent_source"]
            | null
          whatsapp_opt_in: boolean
          whatsapp_opt_in_at: string | null
          whatsapp_opt_out_at: string | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          no_show_count?: number
          notes?: string | null
          phone?: string | null
          updated_at?: string
          whatsapp_consent_source?:
            | Database["public"]["Enums"]["consent_source"]
            | null
          whatsapp_opt_in?: boolean
          whatsapp_opt_in_at?: string | null
          whatsapp_opt_out_at?: string | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          no_show_count?: number
          notes?: string | null
          phone?: string | null
          updated_at?: string
          whatsapp_consent_source?:
            | Database["public"]["Enums"]["consent_source"]
            | null
          whatsapp_opt_in?: boolean
          whatsapp_opt_in_at?: string | null
          whatsapp_opt_out_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_card_redemptions: {
        Row: {
          amount: number
          appointment_id: string | null
          brand_id: string
          client_id: string | null
          created_at: string
          currency: string
          gift_card_id: string
          id: string
          redeemed_by: string | null
        }
        Insert: {
          amount: number
          appointment_id?: string | null
          brand_id: string
          client_id?: string | null
          created_at?: string
          currency?: string
          gift_card_id: string
          id?: string
          redeemed_by?: string | null
        }
        Update: {
          amount?: number
          appointment_id?: string | null
          brand_id?: string
          client_id?: string | null
          created_at?: string
          currency?: string
          gift_card_id?: string
          id?: string
          redeemed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gift_card_redemptions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_card_redemptions_gift_card_id_fkey"
            columns: ["gift_card_id"]
            isOneToOne: false
            referencedRelation: "gift_cards"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_cards: {
        Row: {
          brand_id: string
          client_id: string | null
          code: string
          created_at: string
          currency: string
          expires_at: string | null
          id: string
          initial_amount: number
          location_id: string
          note: string | null
          remaining_amount: number
          sold_by: string | null
          status: Database["public"]["Enums"]["gift_card_status"]
          updated_at: string
        }
        Insert: {
          brand_id: string
          client_id?: string | null
          code: string
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          initial_amount: number
          location_id: string
          note?: string | null
          remaining_amount: number
          sold_by?: string | null
          status?: Database["public"]["Enums"]["gift_card_status"]
          updated_at?: string
        }
        Update: {
          brand_id?: string
          client_id?: string | null
          code?: string
          created_at?: string
          currency?: string
          expires_at?: string | null
          id?: string
          initial_amount?: number
          location_id?: string
          note?: string | null
          remaining_amount?: number
          sold_by?: string | null
          status?: Database["public"]["Enums"]["gift_card_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_cards_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      income_records: {
        Row: {
          amount: number
          appointment_id: string | null
          brand_id: string
          client_package_id: string | null
          collected_at: string
          collected_by: string | null
          created_at: string
          currency: string
          gift_card_id: string | null
          id: string
          location_id: string
          method: Database["public"]["Enums"]["payment_method"]
          source: string
        }
        Insert: {
          amount: number
          appointment_id?: string | null
          brand_id: string
          client_package_id?: string | null
          collected_at?: string
          collected_by?: string | null
          created_at?: string
          currency?: string
          gift_card_id?: string | null
          id?: string
          location_id: string
          method: Database["public"]["Enums"]["payment_method"]
          source?: string
        }
        Update: {
          amount?: number
          appointment_id?: string | null
          brand_id?: string
          client_package_id?: string | null
          collected_at?: string
          collected_by?: string | null
          created_at?: string
          currency?: string
          gift_card_id?: string | null
          id?: string
          location_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "income_records_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "income_records_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "income_records_client_package_id_fkey"
            columns: ["client_package_id"]
            isOneToOne: false
            referencedRelation: "client_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "income_records_gift_card_id_fkey"
            columns: ["gift_card_id"]
            isOneToOne: false
            referencedRelation: "gift_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "income_records_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      location_stock: {
        Row: {
          created_at: string
          id: string
          location_id: string
          low_stock_threshold: number
          product_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          location_id: string
          low_stock_threshold?: number
          product_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          location_id?: string
          low_stock_threshold?: number
          product_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          brand_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          phone: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          brand_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          brand_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "locations_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      package_redemptions: {
        Row: {
          appointment_id: string | null
          brand_id: string
          client_id: string | null
          client_package_id: string
          covered_amount: number
          created_at: string
          currency: string
          id: string
          redeemed_by: string | null
          service_id: string | null
        }
        Insert: {
          appointment_id?: string | null
          brand_id: string
          client_id?: string | null
          client_package_id: string
          covered_amount?: number
          created_at?: string
          currency?: string
          id?: string
          redeemed_by?: string | null
          service_id?: string | null
        }
        Update: {
          appointment_id?: string | null
          brand_id?: string
          client_id?: string | null
          client_package_id?: string
          covered_amount?: number
          created_at?: string
          currency?: string
          id?: string
          redeemed_by?: string | null
          service_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "package_redemptions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_redemptions_client_package_id_fkey"
            columns: ["client_package_id"]
            isOneToOne: false
            referencedRelation: "client_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      package_services: {
        Row: {
          created_at: string
          id: string
          included_count: number
          package_type_id: string
          service_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          included_count: number
          package_type_id: string
          service_id: string
        }
        Update: {
          created_at?: string
          id?: string
          included_count?: number
          package_type_id?: string
          service_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_services_package_type_id_fkey"
            columns: ["package_type_id"]
            isOneToOne: false
            referencedRelation: "package_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      package_types: {
        Row: {
          brand_id: string
          created_at: string
          currency: string
          description: string | null
          expiry_months: number | null
          id: string
          name: string
          price: number
          status: Database["public"]["Enums"]["package_type_status"]
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          currency?: string
          description?: string | null
          expiry_months?: number | null
          id?: string
          name: string
          price: number
          status?: Database["public"]["Enums"]["package_type_status"]
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          currency?: string
          description?: string | null
          expiry_months?: number | null
          id?: string
          name?: string
          price?: number
          status?: Database["public"]["Enums"]["package_type_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "package_types_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          appointment_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json | null
          payment_id: string | null
          signature_verified: boolean | null
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json | null
          payment_id?: string | null
          signature_verified?: boolean | null
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
          payment_id?: string | null
          signature_verified?: boolean | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          appointment_id: string | null
          brand_id: string
          created_at: string
          currency: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["payment_kind"]
          parent_payment_id: string | null
          provider: string
          provider_ref: string | null
          state: Database["public"]["Enums"]["payment_state"]
          updated_at: string
        }
        Insert: {
          amount: number
          appointment_id?: string | null
          brand_id: string
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          kind: Database["public"]["Enums"]["payment_kind"]
          parent_payment_id?: string | null
          provider: string
          provider_ref?: string | null
          state?: Database["public"]["Enums"]["payment_state"]
          updated_at?: string
        }
        Update: {
          amount?: number
          appointment_id?: string | null
          brand_id?: string
          created_at?: string
          currency?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          kind?: Database["public"]["Enums"]["payment_kind"]
          parent_payment_id?: string | null
          provider?: string
          provider_ref?: string | null
          state?: Database["public"]["Enums"]["payment_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_parent_payment_id_fkey"
            columns: ["parent_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          brand_id: string
          cost_price: number
          created_at: string
          currency: string
          id: string
          is_active: boolean
          name: string
          sku: string | null
          supplier: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          cost_price?: number
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          name: string
          sku?: string | null
          supplier?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          cost_price?: number
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          name?: string
          sku?: string | null
          supplier?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      service_location_prices: {
        Row: {
          created_at: string
          currency: string
          id: string
          location_id: string
          price: number
          service_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          location_id: string
          price: number
          service_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          location_id?: string
          price?: number
          service_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_location_prices_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_location_prices_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      service_record_products: {
        Row: {
          created_at: string
          id: string
          product_id: string
          quantity: number
          service_record_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          quantity?: number
          service_record_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
          service_record_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_record_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_record_products_service_record_id_fkey"
            columns: ["service_record_id"]
            isOneToOne: false
            referencedRelation: "service_records"
            referencedColumns: ["id"]
          },
        ]
      }
      service_records: {
        Row: {
          appointment_id: string
          created_at: string
          formula_notes: string | null
          id: string
          notes: string | null
          service_performed: string
          technician_user_id: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          formula_notes?: string | null
          id?: string
          notes?: string | null
          service_performed: string
          technician_user_id: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          formula_notes?: string | null
          id?: string
          notes?: string | null
          service_performed?: string
          technician_user_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_records_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          brand_id: string
          category: string | null
          created_at: string
          currency: string
          default_price: number
          deposit_amount: number | null
          deposit_mandatory: boolean
          deposit_new_clients_only: boolean
          deposit_percentage: number | null
          deposit_required: boolean
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          category?: string | null
          created_at?: string
          currency?: string
          default_price?: number
          deposit_amount?: number | null
          deposit_mandatory?: boolean
          deposit_new_clients_only?: boolean
          deposit_percentage?: number | null
          deposit_required?: boolean
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          category?: string | null
          created_at?: string
          currency?: string
          default_price?: number
          deposit_amount?: number | null
          deposit_mandatory?: boolean
          deposit_new_clients_only?: boolean
          deposit_percentage?: number | null
          deposit_required?: boolean
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_leave: {
        Row: {
          created_at: string
          end_date: string
          id: string
          location_id: string
          reason: string | null
          start_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          location_id: string
          reason?: string | null
          start_date: string
          user_id: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          location_id?: string
          reason?: string | null
          start_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_leave_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_schedules: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          location_id: string
          start_time: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          location_id: string
          start_time: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          location_id?: string
          start_time?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_schedules_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_services: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          service_id: string
          user_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          service_id: string
          user_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          service_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_services_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_services_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          movement_type: Database["public"]["Enums"]["stock_movement_type"]
          notes: string | null
          product_id: string
          quantity: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          movement_type: Database["public"]["Enums"]["stock_movement_type"]
          notes?: string | null
          product_id: string
          quantity: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          movement_type?: Database["public"]["Enums"]["stock_movement_type"]
          notes?: string | null
          product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          invited_email: string | null
          location_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string | null
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          invited_email?: string | null
          location_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id?: string | null
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          invited_email?: string | null
          location_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          appointment_id: string | null
          body_preview: string | null
          brand_id: string
          client_id: string | null
          created_at: string
          error_message: string | null
          id: string
          kind: string
          provider: string
          provider_sid: string | null
          status: string
          to_phone: string
        }
        Insert: {
          appointment_id?: string | null
          body_preview?: string | null
          brand_id: string
          client_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          kind: string
          provider?: string
          provider_sid?: string | null
          status: string
          to_phone: string
        }
        Update: {
          appointment_id?: string | null
          body_preview?: string | null
          brand_id?: string
          client_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          kind?: string
          provider?: string
          provider_sid?: string | null
          status?: string
          to_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          brand_id: string | null
          content_sid: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          kind: string
          updated_at: string
        }
        Insert: {
          brand_id?: string | null
          content_sid?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          kind: string
          updated_at?: string
        }
        Update: {
          brand_id?: string | null
          content_sid?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_templates_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      appointment_balance_due: {
        Args: { _appointment_id: string }
        Returns: {
          balance: number
          currency: string
          deposit_paid: number
          total: number
        }[]
      }
      appointment_holds_slot: {
        Args: {
          _deposit_status: Database["public"]["Enums"]["deposit_status"]
          _hold_expires_at: string
          _status: Database["public"]["Enums"]["appointment_status"]
        }
        Returns: boolean
      }
      appointment_settle: {
        Args: {
          _amount: number
          _appointment_id: string
          _client_package_id?: string
          _gift_card_amount?: number
          _gift_card_code?: string
          _method: Database["public"]["Enums"]["payment_method"]
        }
        Returns: {
          cash_amount: number
          error: string
          gift_applied: number
          gift_remaining: number
          package_covered: number
          package_remaining: number
        }[]
      }
      can_manage_location: {
        Args: { _location_id: string; _user_id: string }
        Returns: boolean
      }
      claim_pending_invite: {
        Args: never
        Returns: {
          brand_id: string
          created_at: string
          id: string
          invited_email: string | null
          location_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "user_roles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      client_packages_for_service: {
        Args: {
          _brand_id: string
          _client_id: string
          _location_id?: string
          _service_id: string
        }
        Returns: {
          client_package_id: string
          covers_amount: number
          currency: string
          expires_at: string
          included_count: number
          package_name: string
          remaining_count: number
        }[]
      }
      client_packages_overview: {
        Args: { _brand_id: string; _client_id: string }
        Returns: {
          client_package_id: string
          currency: string
          effective_status: string
          expires_at: string
          package_name: string
          price_paid: number
          purchased_at: string
          services: Json
          status: string
          total_included: number
          total_remaining: number
        }[]
      }
      create_brand_with_owner_location: {
        Args: {
          _brand_name: string
          _location_address: string
          _location_name: string
          _location_phone: string
          _max_locations: number
          _max_staff_accounts: number
          _plan: Database["public"]["Enums"]["subscription_plan"]
        }
        Returns: string
      }
      dispatch_whatsapp_reminder_sweep: { Args: never; Returns: string }
      email_has_other_brand_account: {
        Args: { _brand: string; _email: string }
        Returns: boolean
      }
      expire_stale_deposit_holds: {
        Args: { _older_than_minutes?: number }
        Returns: {
          expired_count: number
        }[]
      }
      get_user_brand: { Args: { _user_id: string }; Returns: string }
      gift_card_generate_code: { Args: never; Returns: string }
      gift_card_lookup: {
        Args: { _brand_id: string; _code: string }
        Returns: {
          client_id: string
          code: string
          currency: string
          effective_status: string
          error: string
          expires_at: string
          id: string
          initial_amount: number
          remaining_amount: number
          status: string
        }[]
      }
      gift_card_normalize_code: { Args: { _code: string }; Returns: string }
      gift_card_redeem: {
        Args: {
          _amount: number
          _appointment_id: string
          _brand_id: string
          _client_id: string
          _code: string
        }
        Returns: {
          applied: number
          error: string
          gift_card_id: string
          remaining: number
        }[]
      }
      gift_card_sell: {
        Args: {
          _amount: number
          _brand_id: string
          _location_id: string
          _method: Database["public"]["Enums"]["payment_method"]
          _note?: string
        }
        Returns: {
          code: string
          error: string
          expires_at: string
          gift_card_id: string
        }[]
      }
      gift_cards_expired_with_balance: {
        Args: { _brand_id: string }
        Returns: {
          client_id: string
          client_name: string
          code: string
          created_at: string
          currency: string
          expires_at: string
          id: string
          initial_amount: number
          location_name: string
          remaining_amount: number
        }[]
      }
      has_location_access: {
        Args: { _location_id: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_brand_manager_or_owner: {
        Args: { _brand_id: string; _user_id: string }
        Returns: boolean
      }
      is_brand_member: {
        Args: { _brand_id: string; _user_id: string }
        Returns: boolean
      }
      is_brand_owner: {
        Args: { _brand_id: string; _user_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      package_extend_expiry: {
        Args: { _client_package_id: string; _new_expires_at: string }
        Returns: {
          error: string
          expires_at: string
        }[]
      }
      package_redeem: {
        Args: {
          _appointment_id: string
          _brand_id: string
          _client_id: string
          _client_package_id: string
          _location_id: string
          _service_id: string
        }
        Returns: {
          covered: number
          error: string
          remaining: number
        }[]
      }
      package_refund: {
        Args: {
          _client_package_id: string
          _method?: Database["public"]["Enums"]["payment_method"]
        }
        Returns: {
          error: string
          refunded_amount: number
        }[]
      }
      package_sell: {
        Args: {
          _brand_id: string
          _client_id: string
          _location_id: string
          _method: Database["public"]["Enums"]["payment_method"]
          _note?: string
          _package_type_id: string
        }
        Returns: {
          client_package_id: string
          error: string
          expires_at: string
        }[]
      }
      packages_expired_with_balance: {
        Args: { _brand_id: string }
        Returns: {
          client_id: string
          client_name: string
          client_package_id: string
          currency: string
          expires_at: string
          location_name: string
          package_name: string
          price_paid: number
          total_included: number
          total_remaining: number
        }[]
      }
      payment_confirm_charge: {
        Args: {
          _amount: number
          _payload: Json
          _provider: string
          _provider_ref: string
        }
        Returns: {
          applied: boolean
          appointment_id: string
          reason: string
        }[]
      }
      payment_fail_charge: {
        Args: {
          _payload: Json
          _provider: string
          _provider_ref: string
          _reason: string
        }
        Returns: {
          applied: boolean
          appointment_id: string
          reason: string
        }[]
      }
      payment_log_event: {
        Args: {
          _appointment_id: string
          _event_type: string
          _payload: Json
          _payment_id: string
          _signature_verified: boolean
        }
        Returns: string
      }
      payment_open_charge: {
        Args: {
          _amount: number
          _appointment_id: string
          _brand_id: string
          _currency: string
          _idempotency_key: string
          _provider: string
          _provider_ref: string
        }
        Returns: string
      }
      payment_record_refund: {
        Args: {
          _amount: number
          _appointment_id: string
          _brand_id: string
          _currency: string
          _failure_reason?: string
          _idempotency_key: string
          _parent_payment_id: string
          _provider: string
          _provider_ref: string
          _succeeded: boolean
        }
        Returns: string
      }
      public_book_appointment: {
        Args: {
          _brand_id: string
          _client_name: string
          _deposit_skipped?: boolean
          _location_id: string
          _notes: string
          _phone: string
          _service_id: string
          _staff_user_id: string
          _starts_at: string
        }
        Returns: {
          appointment_id: string
          deposit_amount: number
          deposit_required: boolean
          error: string
          hold_expires_at: string
          token: string
        }[]
      }
      public_cancel_by_token: {
        Args: { _token: string }
        Returns: {
          appointment_id: string
          brand_id: string
          charge_id: string
          charge_ref: string
          currency: string
          ok: boolean
          outcome: string
          refund_amount: number
          refund_due: boolean
        }[]
      }
      public_compute_slots: {
        Args: {
          _brand_id: string
          _date_from: string
          _date_to: string
          _location_id: string
          _service_id: string
          _staff_user_id: string
        }
        Returns: {
          ends_at: string
          staff_user_id: string
          starts_at: string
        }[]
      }
      public_create_otp: {
        Args: {
          _brand_id: string
          _code: string
          _phone: string
          _ttl_minutes?: number
        }
        Returns: string
      }
      public_get_appointment_by_token: {
        Args: { _token: string }
        Returns: {
          appointment_id: string
          balance_due: number
          brand_id: string
          brand_name: string
          brand_slug: string
          client_name: string
          currency: string
          deposit_amount: number
          deposit_paid_amount: number
          deposit_status: Database["public"]["Enums"]["deposit_status"]
          duration_minutes: number
          ends_at: string
          location_address: string
          location_id: string
          location_name: string
          phone: string
          price: number
          service_id: string
          service_name: string
          staff_name: string
          staff_user_id: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
        }[]
      }
      public_get_brand_by_slug: {
        Args: { _slug: string }
        Returns: {
          currency: string
          id: string
          max_advance_days: number
          min_notice_hours: number
          name: string
          slug: string
          sms_sender: string
        }[]
      }
      public_list_appointments_by_phone: {
        Args: { _brand_id: string; _phone: string }
        Returns: {
          appointment_id: string
          ends_at: string
          location_name: string
          service_name: string
          staff_name: string
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          token: string
        }[]
      }
      public_list_locations: {
        Args: { _brand_id: string }
        Returns: {
          address: string
          id: string
          name: string
          phone: string
          timezone: string
        }[]
      }
      public_list_services: {
        Args: { _brand_id: string; _location_id: string }
        Returns: {
          category: string
          currency: string
          deposit_amount: number
          deposit_mandatory: boolean
          deposit_new_clients_only: boolean
          deposit_percentage: number
          deposit_required: boolean
          description: string
          duration_minutes: number
          id: string
          name: string
          price: number
        }[]
      }
      public_list_staff_for_service: {
        Args: { _brand_id: string; _location_id: string; _service_id: string }
        Returns: {
          full_name: string
          user_id: string
        }[]
      }
      public_reschedule_by_token: {
        Args: {
          _new_staff_user_id: string
          _new_starts_at: string
          _token: string
        }
        Returns: string
      }
      public_resolve_deposit: {
        Args: {
          _brand_id: string
          _location_id: string
          _phone: string
          _service_id: string
        }
        Returns: {
          currency: string
          deposit_amount: number
          deposit_mandatory: boolean
          deposit_required: boolean
          is_new_client: boolean
        }[]
      }
      public_verify_otp: {
        Args: { _brand_id: string; _code: string; _phone: string }
        Returns: boolean
      }
      service_effective_price: {
        Args: { _location_id: string; _service_id: string }
        Returns: number
      }
      staff_request_deposit: {
        Args: { _amount?: number; _appointment_id: string }
        Returns: {
          amount: number
          brand_id: string
          currency: string
          ok: boolean
          reason: string
        }[]
      }
      whatsapp_consent_from_booking: {
        Args: {
          _appointment_id: string
          _opt_in: boolean
          _source: Database["public"]["Enums"]["consent_source"]
        }
        Returns: {
          client_id: string
          opted_in: boolean
        }[]
      }
      whatsapp_due_reminders: {
        Args: { _limit?: number }
        Returns: {
          appointment_id: string
          brand_id: string
          client_id: string
          client_name: string
          location_name: string
          phone: string
          service_name: string
          starts_at: string
          timezone: string
        }[]
      }
      whatsapp_get_template: {
        Args: { _brand_id: string; _kind: string }
        Returns: {
          content_sid: string
          is_active: boolean
        }[]
      }
      whatsapp_log_message: {
        Args: {
          _appointment_id: string
          _body_preview: string
          _brand_id: string
          _client_id: string
          _error_message: string
          _kind: string
          _provider: string
          _provider_sid: string
          _status: string
          _to_phone: string
        }
        Returns: string
      }
      whatsapp_mark_reminded: {
        Args: { _appointment_id: string }
        Returns: boolean
      }
      whatsapp_opt_in_by_phone: {
        Args: { _phone: string }
        Returns: {
          clients_updated: number
        }[]
      }
      whatsapp_opt_out_by_phone: {
        Args: { _phone: string }
        Returns: {
          clients_updated: number
        }[]
      }
      whatsapp_set_consent: {
        Args: {
          _client_id: string
          _opt_in: boolean
          _source: Database["public"]["Enums"]["consent_source"]
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "owner" | "manager" | "receptionist" | "staff"
      appointment_status: "scheduled" | "completed" | "cancelled" | "no_show"
      billing_cycle: "monthly" | "yearly"
      client_package_status: "active" | "expired" | "refunded"
      consent_source:
        | "public_booking"
        | "staff_booking"
        | "staff_manual"
        | "inbound_stop"
      deposit_status: "pending" | "paid" | "refunded" | "forfeited" | "expired"
      gift_card_status: "active" | "expired" | "redeemed" | "refunded"
      package_type_status: "active" | "inactive"
      payment_kind: "charge" | "refund"
      payment_method: "cash" | "card" | "bank_transfer"
      payment_state: "pending" | "succeeded" | "failed" | "cancelled"
      stock_movement_type: "restock" | "usage" | "waste" | "adjustment"
      subscription_plan: "starter" | "growth" | "enterprise"
      subscription_status: "active" | "expiring" | "expired" | "trial"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["owner", "manager", "receptionist", "staff"],
      appointment_status: ["scheduled", "completed", "cancelled", "no_show"],
      billing_cycle: ["monthly", "yearly"],
      client_package_status: ["active", "expired", "refunded"],
      consent_source: [
        "public_booking",
        "staff_booking",
        "staff_manual",
        "inbound_stop",
      ],
      deposit_status: ["pending", "paid", "refunded", "forfeited", "expired"],
      gift_card_status: ["active", "expired", "redeemed", "refunded"],
      package_type_status: ["active", "inactive"],
      payment_kind: ["charge", "refund"],
      payment_method: ["cash", "card", "bank_transfer"],
      payment_state: ["pending", "succeeded", "failed", "cancelled"],
      stock_movement_type: ["restock", "usage", "waste", "adjustment"],
      subscription_plan: ["starter", "growth", "enterprise"],
      subscription_status: ["active", "expiring", "expired", "trial"],
    },
  },
} as const
