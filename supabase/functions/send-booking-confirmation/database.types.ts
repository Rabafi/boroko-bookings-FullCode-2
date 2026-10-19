/**
 * Operation-scoped schema for the pinned Supabase client used by
 * send-booking-confirmation. Keep this subset tied to the migration sources
 * cited in the typecheck evidence; it is not a complete database schema.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface SendBookingConfirmationDatabase {
  public: {
    Tables: {
      bookings: {
        Row: {
          id: string
          lodge_id: string
          room_id: string | null
          customer_id: string | null
          check_in: string
          check_out: string
          adults: number | null
          children: number | null
          total_amount: number | null
          notes: string | null
          source: string
          create_idempotency_key: string | null
          online_confirmation_token: string | null
        }
        Insert: never
        Update: { online_confirmation_token: string | null }
        Relationships: [
          {
            foreignKeyName: 'bookings_room_id_fkey'
            columns: ['room_id']
            isOneToOne: false
            referencedRelation: 'rooms'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'bookings_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          }
        ]
      }
      rooms: {
        Row: { id: string; room_number: string; room_type: string }
        Insert: never
        Update: never
        Relationships: []
      }
      customers: {
        Row: {
          id: string
          first_name: string | null
          last_name: string | null
          email: string | null
          phone: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      settings: {
        Row: {
          lodge_id: string
          lodge_name: string | null
          company_name: string | null
          phone: string | null
          email: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: {
      record_booking_email_delivery: {
        Args: {
          p_lodge_id: string | null
          // The early not-found path forwards the original, unvalidated JSON
          // value after isUuid coerces it with String(). It cannot soundly be
          // narrowed to the PostgreSQL uuid wire type without changing that
          // request/error behavior.
          p_booking_id: unknown
          p_reference: string | null
          p_delivery_status: string
          p_recipient: string | null
          p_error_message: string | null
          p_metadata: Json
        }
        Returns: Json
      }
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}
