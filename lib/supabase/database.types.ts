/**
 * Hand-written types matching supabase/migrations/0001_init.sql, following
 * the shape that `supabase gen types typescript` produces. Once a live
 * Supabase project exists, running the codegen and dropping the output in
 * here should be a minimal diff.
 */

import type { MissionStage, MissionStatus } from "@/lib/workflow/types";

export type MissionEventType = "mission_created" | "stage_changed" | "note";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      missions: {
        Row: {
          id: string;
          owner_id: string;
          business_name: string;
          website_url: string;
          status: MissionStatus;
          stage: MissionStage;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          business_name: string;
          website_url: string;
          status?: MissionStatus;
          stage?: MissionStage;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          business_name?: string;
          website_url?: string;
          status?: MissionStatus;
          stage?: MissionStage;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "missions_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      mission_events: {
        Row: {
          id: string;
          mission_id: string;
          event_type: MissionEventType;
          message: string;
          metadata: Record<string, unknown>;
          created_at: string;
        };
        Insert: {
          id?: string;
          mission_id: string;
          event_type: MissionEventType;
          message: string;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Update: {
          id?: string;
          mission_id?: string;
          event_type?: MissionEventType;
          message?: string;
          metadata?: Record<string, unknown>;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mission_events_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
