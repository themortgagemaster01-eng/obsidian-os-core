import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import type { DomainEvent } from "@/lib/events/types";
import {
  missionEventRepository,
  type MissionEventRow,
} from "@/lib/repositories/mission-event-repository";

type TypedClient = SupabaseClient<Database>;

type EventHandler = (event: DomainEvent) => void | Promise<void>;

/**
 * Port for publishing and subscribing to domain events. Defined as an
 * interface (port/adapter pattern) specifically so the persistence +
 * fan-out mechanism can be swapped without touching call sites — see the
 * SupabaseEventBus doc comment below for why that matters starting
 * Sprint 3.
 */
export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  /** Returns an unsubscribe function. */
  subscribe(handler: EventHandler): () => void;
}

/** Maps a human-readable message for the mission timeline from a DomainEvent. */
function describeEvent(event: DomainEvent): string {
  switch (event.type) {
    case "MissionStarted":
      return `Mission started for ${event.payload.businessName} (${event.payload.websiteUrl})`;
    case "WebsiteScanned":
      return `Website scanned: ${event.payload.websiteUrl}`;
    case "SEOComplete":
      return `SEO check complete${
        event.payload.score !== undefined ? ` (score ${event.payload.score})` : ""
      }`;
    case "AnalysisFailed":
      return `Analysis failed${
        event.payload.stage ? ` at ${event.payload.stage}` : ""
      }: ${event.payload.errorMessage}`;
    case "DesignBriefReady":
      return `Design Brief ready (${event.payload.industryBucket}, ${event.payload.citationCount} citation(s))`;
    case "DesignBriefFailed":
      return `Design Brief failed: ${event.payload.errorMessage}`;
    case "DesignBriefApproved":
      return `Design Brief approved by ${event.payload.approvedBy}${event.payload.wasEdited ? " (with edits)" : ""}`;
    case "WebsiteDesignReady":
      return `Website design ready: ${event.payload.sectionCount} section(s), ${event.payload.layoutFamily} layout`;
    case "WebsiteDesignFailed":
      return `Website design failed: ${event.payload.errorMessage}`;
    case "DesignQaComplete":
      return `Design QA complete: ${event.payload.overallVerdict}${
        event.payload.renderedQaAvailable ? "" : " (Rendered QA unavailable)"
      }`;
    case "DesignQaFailed":
      return `Design QA failed: ${event.payload.errorMessage}`;
    case "PreviewScreenshotCaptured":
      return "Real preview screenshot captured (desktop + mobile)";
    case "PreviewScreenshotFailed":
      return `Preview screenshot capture failed: ${event.payload.errorMessage}`;
    case "ProposalReady":
      return "Proposal ready";
    case "EmailDraftReady":
      return "Email draft ready";
    case "MissionApproved":
      return `Mission approved by ${event.payload.approvedBy}`;
    case "MissionRejected":
      return `Mission rejected${
        event.payload.reason ? `: ${event.payload.reason}` : ""
      }`;
    case "MissionArchived":
      return "Mission archived";
    case "StateChanged":
      return `State changed from ${event.payload.fromState} to ${event.payload.toState}`;
    case "DecisionLogged":
      return `Decision logged: ${event.payload.decisionType}`;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/**
 * The only EventBus implementation Sprint 2 needs: persists every published
 * event as a row in mission_events (via the mission-event repository) AND
 * fans it out synchronously, in-process, to any subscribers registered on
 * this instance.
 *
 * IMPORTANT: the in-process subscriber fan-out is NOT durable and NOT
 * cross-process — it's a same-request convenience only (e.g. a caller that
 * wants to react to an event it just published without a second round
 * trip). It does not survive a server restart, does not fan out to other
 * server instances, and nothing subscribes to it yet in Sprint 2. Once
 * Sprint 3+ introduces real background agents running as separate workers
 * (Research, SEO, Copywriter, Designer, QA, Proposal, Email, Deployment),
 * a durable, cross-process transport — Supabase Realtime, or a job queue
 * like Inngest/Trigger.dev — should be swapped in behind the same EventBus
 * interface. That's exactly why EventBus is an interface with a swappable
 * implementation (port/adapter pattern) rather than every call site
 * talking to Supabase directly.
 */
export class SupabaseEventBus implements EventBus {
  private readonly client: TypedClient;
  private readonly handlers = new Set<EventHandler>();

  constructor(client: TypedClient) {
    this.client = client;
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.persist(event);

    for (const handler of this.handlers) {
      await handler(event);
    }
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  private async persist(event: DomainEvent): Promise<MissionEventRow> {
    return missionEventRepository.insert(this.client, {
      mission_id: event.missionId,
      organization_id: event.organizationId,
      event_type: event.type,
      message: describeEvent(event),
      metadata: event.payload as unknown as Json,
      actor: "system",
    });
  }
}

/** Builds a fresh SupabaseEventBus for a given Supabase client. */
export function createEventBus(client: TypedClient): EventBus {
  return new SupabaseEventBus(client);
}
