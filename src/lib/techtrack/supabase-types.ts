export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      workdays: {
        Row: {
          id: string
          user_id: string
          date: string
          start_time: number | null
          end_time: number | null
          status: string
          last_new_job_prompt_time: number | null
          last_job_completion_prompt_time: number | null
          current_job_id: string | null
          start_location_latitude: number | null
          start_location_longitude: number | null
          start_location_timestamp: number | null
          end_location_latitude: number | null
          end_location_longitude: number | null
          end_location_timestamp: number | null
          created_at?: string
          updated_at?: string
        }
        Insert: {
          id: string
          user_id: string
          date: string
          start_time?: number | null
          end_time?: number | null
          status: string
          last_new_job_prompt_time?: number | null
          last_job_completion_prompt_time?: number | null
          current_job_id?: string | null
          start_location_latitude?: number | null
          start_location_longitude?: number | null
          start_location_timestamp?: number | null
          end_location_latitude?: number | null
          end_location_longitude?: number | null
          end_location_timestamp?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          date?: string
          start_time?: number | null
          end_time?: number | null
          status?: string
          last_new_job_prompt_time?: number | null
          last_job_completion_prompt_time?: number | null
          current_job_id?: string | null
          start_location_latitude?: number | null
          start_location_longitude?: number | null
          start_location_timestamp?: number | null
          end_location_latitude?: number | null
          end_location_longitude?: number | null
          end_location_timestamp?: number | null
          created_at?: string
          updated_at?: string
        }
      }
      jobs: {
        Row: {
          id: string
          workday_id: string
          description: string
          start_time: number | null
          end_time: number | null
          summary: string | null
          ai_summary: string | null
          status: string
          start_location_latitude: number | null
          start_location_longitude: number | null
          start_location_timestamp: number | null
          start_location_accuracy: number | null
          end_location_latitude: number | null
          end_location_longitude: number | null
          end_location_timestamp: number | null
          created_at?: string
        }
        Insert: {
          id: string
          workday_id: string
          description: string
          start_time?: number | null
          end_time?: number | null
          summary?: string | null
          ai_summary?: string | null
          status: string
          start_location_latitude?: number | null
          start_location_longitude?: number | null
          start_location_timestamp?: number | null
          start_location_accuracy?: number | null
          end_location_latitude?: number | null
          end_location_longitude?: number | null
          end_location_timestamp?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          workday_id?: string
          description?: string
          start_time?: number | null
          end_time?: number | null
          summary?: string | null
          ai_summary?: string | null
          status?: string
          start_location_latitude?: number | null
          start_location_longitude?: number | null
          start_location_timestamp?: number | null
          start_location_accuracy?: number | null
          end_location_latitude?: number | null
          end_location_longitude?: number | null
          end_location_timestamp?: number | null
          created_at?: string
        }
      }
      pause_intervals: {
        Row: {
          id: string
          workday_id: string
          start_time: number | null
          end_time: number | null
          start_location_latitude: number | null
          start_location_longitude: number | null
          start_location_timestamp: number | null
          start_location_accuracy: number | null
          end_location_latitude: number | null
          end_location_longitude: number | null
          end_location_timestamp: number | null
          created_at?: string
        }
        Insert: {
          id: string
          workday_id: string
          start_time?: number | null
          end_time?: number | null
          start_location_latitude?: number | null
          start_location_longitude?: number | null
          start_location_timestamp?: number | null
          start_location_accuracy?: number | null
          end_location_latitude?: number | null
          end_location_longitude?: number | null
          end_location_timestamp?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          workday_id?: string
          start_time?: number | null
          end_time?: number | null
          start_location_latitude?: number | null
          start_location_longitude?: number | null
          start_location_timestamp?: number | null
          start_location_accuracy?: number | null
          end_location_latitude?: number | null
          end_location_longitude?: number | null
          end_location_timestamp?: number | null
          created_at?: string
        }
      }
      events: {
        Row: {
          id: string
          workday_id: string
          type: string
          timestamp: number | null
          job_id: string | null
          details: string | null
          location_latitude: number | null
          location_longitude: number | null
          location_timestamp: number | null
          location_accuracy: number | null
          created_at?: string
        }
        Insert: {
          id: string
          workday_id: string
          type: string
          timestamp?: number | null
          job_id?: string | null
          details?: string | null
          location_latitude?: number | null
          location_longitude?: number | null
          location_timestamp?: number | null
          location_accuracy?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          workday_id?: string
          type?: string
          timestamp?: number | null
          job_id?: string | null
          details?: string | null
          location_latitude?: number | null
          location_longitude?: number | null
          location_timestamp?: number | null
          location_accuracy?: number | null
          created_at?: string
        }
      }
      locations: {
        Row: {
          id?: number // Assuming auto-increment or similar if not specified
          workday_id: string
          latitude: number
          longitude: number
          timestamp: number | null
          accuracy: number | null
          created_at?: string
        }
        Insert: {
          id?: number
          workday_id: string
          latitude: number
          longitude: number
          timestamp?: number | null
          accuracy?: number | null
          created_at?: string
        }
        Update: {
          id?: number
          workday_id?: string
          latitude?: number
          longitude?: number
          timestamp?: number | null
          accuracy?: number | null
          created_at?: string
        }
      }
      raw_locations: {
        Row: {
          id: string
          device_id: string
          latitude: number
          longitude: number
          timestamp: string  // ISO 8601 string stored as timestamptz
          speed: number | null
          bearing: number | null
          altitude: number | null
          accuracy: number | null
          battery: number | null
          battery_is_charging: boolean | null
          event: string | null
          is_moving: boolean | null
          odometer: number | null
          activity_type: string | null
          created_at: string
          processed: boolean
        }
        Insert: {
          id?: string
          device_id: string
          latitude: number
          longitude: number
          timestamp: string  // ISO 8601 string
          speed?: number | null
          bearing?: number | null
          altitude?: number | null
          accuracy?: number | null
          battery?: number | null
          battery_is_charging?: boolean | null
          event?: string | null
          is_moving?: boolean | null
          odometer?: number | null
          activity_type?: string | null
          created_at?: string
          processed?: boolean
        }
        Update: {
          id?: string
          device_id?: string
          latitude?: number
          longitude?: number
          timestamp?: string
          speed?: number | null
          bearing?: number | null
          altitude?: number | null
          accuracy?: number | null
          battery?: number | null
          battery_is_charging?: boolean | null
          event?: string | null
          is_moving?: boolean | null
          odometer?: number | null
          activity_type?: string | null
          created_at?: string
          processed?: boolean
        }
      }
    }
  }
}
