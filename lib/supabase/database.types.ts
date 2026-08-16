/**
 * Hand-written types matching supabase/migrations/0001_init.sql through
 * 0010_design_engine.sql, following the shape that
 * `supabase gen types typescript` produces. Once a live Supabase project
 * exists, running the codegen and dropping the output in here should be a
 * minimal diff.
 */

import type { MissionState } from "@/lib/workflow/mission-state";
import type { DomainEventType } from "@/lib/events/types";
import type { DecisionType } from "@/lib/repositories/decision-repository";

/** Generic JSON type for jsonb columns. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type OrganizationPlan = "trial" | "starter" | "pro" | "agency" | "white_label";
export type OrganizationRole = "owner" | "admin" | "member";
export type AnalysisStatus = "pending" | "running" | "complete" | "failed";
/** Shared by design_briefs and website_designs (0010_design_engine.sql) — same job-execution-status domain as AnalysisStatus, reused rather than duplicated since both new tables are the same kind of async run record. */
export type GenerationStatus = "pending" | "running" | "complete" | "failed";
/** Lead Hunter's own lifecycle (supabase/migrations/0018_lead_hunter.sql) — deliberately not AnalysisStatus/GenerationStatus, which are job-execution states; a lead's status is a business/qualification outcome, a different kind of state entirely. */
export type LeadStatus = "pending" | "candidate" | "rejected" | "promoted";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string | null;
          full_name: string | null;
          avatar_url: string | null;
          default_organization_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          default_organization_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          full_name?: string | null;
          avatar_url?: string | null;
          default_organization_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_default_organization_id_fkey";
            columns: ["default_organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          plan: OrganizationPlan;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          plan?: OrganizationPlan;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          plan?: OrganizationPlan;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      organization_members: {
        Row: {
          organization_id: string;
          user_id: string;
          role: OrganizationRole;
          created_at: string;
        };
        Insert: {
          organization_id: string;
          user_id: string;
          role?: OrganizationRole;
          created_at?: string;
        };
        Update: {
          organization_id?: string;
          user_id?: string;
          role?: OrganizationRole;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      missions: {
        Row: {
          id: string;
          owner_id: string;
          organization_id: string;
          company_id: string | null;
          business_name: string;
          website_url: string;
          state: MissionState;
          state_changed_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          organization_id: string;
          company_id?: string | null;
          business_name: string;
          website_url: string;
          state?: MissionState;
          state_changed_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          organization_id?: string;
          company_id?: string | null;
          business_name?: string;
          website_url?: string;
          state?: MissionState;
          state_changed_at?: string;
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
          },
          {
            foreignKeyName: "missions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "missions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      mission_events: {
        Row: {
          id: string;
          mission_id: string;
          organization_id: string;
          event_type: DomainEventType;
          message: string;
          metadata: Json;
          actor: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          mission_id: string;
          organization_id: string;
          event_type: DomainEventType;
          message: string;
          metadata?: Json;
          actor?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          mission_id?: string;
          organization_id?: string;
          event_type?: DomainEventType;
          message?: string;
          metadata?: Json;
          actor?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mission_events_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mission_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
      decisions: {
        Row: {
          id: string;
          mission_id: string;
          organization_id: string;
          created_at: string;
          decision_type: DecisionType;
          ai_recommendation: string | null;
          user_action: string | null;
          before_value: Json | null;
          after_value: Json | null;
          industry: string | null;
          opportunity_score: number | null;
          website_score: number | null;
          proposal_price: number | null;
          email_subject: string | null;
          email_length: number | null;
          website_theme: string | null;
          business_category: string | null;
          metadata: Json;
        };
        Insert: {
          id?: string;
          mission_id: string;
          organization_id: string;
          created_at?: string;
          decision_type: DecisionType;
          ai_recommendation?: string | null;
          user_action?: string | null;
          before_value?: Json | null;
          after_value?: Json | null;
          industry?: string | null;
          opportunity_score?: number | null;
          website_score?: number | null;
          proposal_price?: number | null;
          email_subject?: string | null;
          email_length?: number | null;
          website_theme?: string | null;
          business_category?: string | null;
          metadata?: Json;
        };
        Update: {
          id?: string;
          mission_id?: string;
          organization_id?: string;
          created_at?: string;
          decision_type?: DecisionType;
          ai_recommendation?: string | null;
          user_action?: string | null;
          before_value?: Json | null;
          after_value?: Json | null;
          industry?: string | null;
          opportunity_score?: number | null;
          website_score?: number | null;
          proposal_price?: number | null;
          email_subject?: string | null;
          email_length?: number | null;
          website_theme?: string | null;
          business_category?: string | null;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "decisions_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "decisions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          }
        ];
      };
      companies: {
        Row: {
          id: string;
          organization_id: string;
          business_name: string;
          website_url: string;
          industry: string | null;
          business_category: string | null;
          first_discovered_at: string;
          last_mission_id: string | null;
          total_missions_count: number;
          last_contacted_at: string | null;
          last_proposal_amount: number | null;
          last_proposal_sent_at: string | null;
          follow_up_date: string | null;
          design_preferences: Json;
          do_not_contact: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          business_name: string;
          website_url: string;
          industry?: string | null;
          business_category?: string | null;
          first_discovered_at?: string;
          last_mission_id?: string | null;
          total_missions_count?: number;
          last_contacted_at?: string | null;
          last_proposal_amount?: number | null;
          last_proposal_sent_at?: string | null;
          follow_up_date?: string | null;
          design_preferences?: Json;
          do_not_contact?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          business_name?: string;
          website_url?: string;
          industry?: string | null;
          business_category?: string | null;
          first_discovered_at?: string;
          last_mission_id?: string | null;
          total_missions_count?: number;
          last_contacted_at?: string | null;
          last_proposal_amount?: number | null;
          last_proposal_sent_at?: string | null;
          follow_up_date?: string | null;
          design_preferences?: Json;
          do_not_contact?: boolean;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "companies_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "companies_last_mission_id_fkey";
            columns: ["last_mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          }
        ];
      };
      website_analyses: {
        Row: {
          id: string;
          mission_id: string;
          organization_id: string;
          company_id: string | null;
          status: AnalysisStatus;
          crawl_result: Json | null;
          mobile_result: Json | null;
          seo_result: Json | null;
          accessibility_result: Json | null;
          lighthouse_result: Json | null;
          tech_detection_result: Json | null;
          mobile_score: number | null;
          mobile_findings: Json | null;
          seo_score: number | null;
          seo_findings: Json | null;
          accessibility_score: number | null;
          accessibility_findings: Json | null;
          lighthouse_performance: number | null;
          lighthouse_accessibility: number | null;
          lighthouse_best_practices: number | null;
          lighthouse_seo: number | null;
          technology_stack: Json | null;
          opportunity_score: number | null;
          screenshot_url: string | null;
          above_fold_screenshot_url: string | null;
          error_message: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          mission_id: string;
          organization_id: string;
          company_id?: string | null;
          status?: AnalysisStatus;
          crawl_result?: Json | null;
          mobile_result?: Json | null;
          seo_result?: Json | null;
          accessibility_result?: Json | null;
          lighthouse_result?: Json | null;
          tech_detection_result?: Json | null;
          mobile_score?: number | null;
          mobile_findings?: Json | null;
          seo_score?: number | null;
          seo_findings?: Json | null;
          accessibility_score?: number | null;
          accessibility_findings?: Json | null;
          lighthouse_performance?: number | null;
          lighthouse_accessibility?: number | null;
          lighthouse_best_practices?: number | null;
          lighthouse_seo?: number | null;
          technology_stack?: Json | null;
          opportunity_score?: number | null;
          screenshot_url?: string | null;
          above_fold_screenshot_url?: string | null;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          mission_id?: string;
          organization_id?: string;
          company_id?: string | null;
          status?: AnalysisStatus;
          crawl_result?: Json | null;
          mobile_result?: Json | null;
          seo_result?: Json | null;
          accessibility_result?: Json | null;
          lighthouse_result?: Json | null;
          tech_detection_result?: Json | null;
          mobile_score?: number | null;
          mobile_findings?: Json | null;
          seo_score?: number | null;
          seo_findings?: Json | null;
          accessibility_score?: number | null;
          accessibility_findings?: Json | null;
          lighthouse_performance?: number | null;
          lighthouse_accessibility?: number | null;
          lighthouse_best_practices?: number | null;
          lighthouse_seo?: number | null;
          technology_stack?: Json | null;
          opportunity_score?: number | null;
          screenshot_url?: string | null;
          above_fold_screenshot_url?: string | null;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "website_analyses_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "website_analyses_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "website_analyses_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          }
        ];
      };
      leads: {
        Row: {
          id: string;
          organization_id: string;
          business_name: string;
          website_url: string | null;
          industry: string | null;
          business_category: string | null;
          location: string | null;
          latitude: number | null;
          longitude: number | null;
          discovery_source: string;
          discovery_external_id: string;
          status: LeadStatus;
          rejection_reason: string | null;
          website_score: number | null;
          opportunity_score: number | null;
          confidence_score: number | null;
          main_weaknesses: Json;
          main_opportunity: string | null;
          recommended_hero_pattern: string | null;
          recommended_design_strategy: string | null;
          contact_evidence: Json | null;
          social_links: Json | null;
          crawl_result: Json | null;
          company_id: string | null;
          mission_id: string | null;
          error_message: string | null;
          discovered_at: string;
          qualified_at: string | null;
          promoted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          business_name: string;
          website_url?: string | null;
          industry?: string | null;
          business_category?: string | null;
          location?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          discovery_source: string;
          discovery_external_id: string;
          status?: LeadStatus;
          rejection_reason?: string | null;
          website_score?: number | null;
          opportunity_score?: number | null;
          confidence_score?: number | null;
          main_weaknesses?: Json;
          main_opportunity?: string | null;
          recommended_hero_pattern?: string | null;
          recommended_design_strategy?: string | null;
          contact_evidence?: Json | null;
          social_links?: Json | null;
          crawl_result?: Json | null;
          company_id?: string | null;
          mission_id?: string | null;
          error_message?: string | null;
          discovered_at?: string;
          qualified_at?: string | null;
          promoted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          business_name?: string;
          website_url?: string | null;
          industry?: string | null;
          business_category?: string | null;
          location?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          discovery_source?: string;
          discovery_external_id?: string;
          status?: LeadStatus;
          rejection_reason?: string | null;
          website_score?: number | null;
          opportunity_score?: number | null;
          confidence_score?: number | null;
          main_weaknesses?: Json;
          main_opportunity?: string | null;
          recommended_hero_pattern?: string | null;
          recommended_design_strategy?: string | null;
          contact_evidence?: Json | null;
          social_links?: Json | null;
          crawl_result?: Json | null;
          company_id?: string | null;
          mission_id?: string | null;
          error_message?: string | null;
          discovered_at?: string;
          qualified_at?: string | null;
          promoted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leads_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leads_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          }
        ];
      };
      design_briefs: {
        Row: {
          id: string;
          mission_id: string;
          organization_id: string;
          company_id: string | null;
          status: GenerationStatus;
          industry_bucket: string | null;
          brief: Json | null;
          design_memory: Json | null;
          reasoning: string | null;
          self_critique: Json | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          error_message: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          mission_id: string;
          organization_id: string;
          company_id?: string | null;
          status?: GenerationStatus;
          industry_bucket?: string | null;
          brief?: Json | null;
          design_memory?: Json | null;
          reasoning?: string | null;
          self_critique?: Json | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          mission_id?: string;
          organization_id?: string;
          company_id?: string | null;
          status?: GenerationStatus;
          industry_bucket?: string | null;
          brief?: Json | null;
          design_memory?: Json | null;
          reasoning?: string | null;
          self_critique?: Json | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "design_briefs_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "design_briefs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "design_briefs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "design_briefs_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          }
        ];
      };
      website_designs: {
        Row: {
          id: string;
          design_brief_id: string;
          mission_id: string;
          organization_id: string;
          status: GenerationStatus;
          wireframe: Json | null;
          components: Json | null;
          refined_design: Json | null;
          qa_result: Json | null;
          error_message: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          design_brief_id: string;
          mission_id: string;
          organization_id: string;
          status?: GenerationStatus;
          wireframe?: Json | null;
          components?: Json | null;
          refined_design?: Json | null;
          qa_result?: Json | null;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          design_brief_id?: string;
          mission_id?: string;
          organization_id?: string;
          status?: GenerationStatus;
          wireframe?: Json | null;
          components?: Json | null;
          refined_design?: Json | null;
          qa_result?: Json | null;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "website_designs_design_brief_id_fkey";
            columns: ["design_brief_id"];
            isOneToOne: false;
            referencedRelation: "design_briefs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "website_designs_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "website_designs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
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
