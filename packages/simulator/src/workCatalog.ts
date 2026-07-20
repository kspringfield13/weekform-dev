import type { WorkCategory } from "../../domain/src/models";

/** Weekform-owned, same-origin surfaces available to local simulation playback. */
export type SandboxSurface =
  | "bi"
  | "chat"
  | "code"
  | "crm"
  | "documents"
  | "email"
  | "meetings"
  | "projects";

export type PersonaId =
  | "data-analyst"
  | "software-engineer"
  | "product-manager"
  | "product-designer"
  | "customer-support-lead"
  | "sales-account-executive"
  | "marketing-manager"
  | "finance-analyst"
  | "operations-manager"
  | "consultant";

export type WorkPriority = "normal" | "high" | "urgent";

export interface PersonaDuty {
  id: string;
  title: string;
  deliverable: string;
  responsibility: string;
  category: WorkCategory;
  preferredSurface: SandboxSurface;
  typicalMinutes: number;
  priority: WorkPriority;
}

export interface PersonaCommunicationPattern {
  channel: "chat" | "email" | "meeting" | "comment";
  purpose: string;
  subject: string;
  direction: "inbound" | "outbound" | "collaborative";
}

export interface PersonaBusinessMeasure {
  label: string;
  unit: string;
  baseline: number;
  target: number;
  plausibleMin: number;
  plausibleMax: number;
  higherIsBetter: boolean;
  sourceSurface: SandboxSurface;
}

export interface PersonaWorkCatalog {
  personaId: PersonaId;
  duties: PersonaDuty[];
  communicationPatterns: PersonaCommunicationPattern[];
  businessMeasures: PersonaBusinessMeasure[];
}

/**
 * Synthetic-safe role catalogs used to generate coherent work over long spans.
 * Every entry describes a concrete deliverable and a bounded operating measure;
 * no customer, employee, or organization identity is embedded in the fixtures.
 */
export const PERSONA_WORK_CATALOGS: PersonaWorkCatalog[] = [
  {
    personaId: "data-analyst",
    duties: [
      {
        id: "data-analyst-weekly-funnel-analysis",
        title: "Explain the weekly funnel movement",
        deliverable: "An annotated analysis memo separating material segment changes from normal variation.",
        responsibility: "Translate a business question into a reproducible, decision-ready analysis.",
        category: "Planned analysis / project work",
        preferredSurface: "bi",
        typicalMinutes: 150,
        priority: "high",
      },
      {
        id: "data-analyst-dashboard-metric-migration",
        title: "Migrate an operating dashboard metric",
        deliverable: "A validated dashboard tile backed by the current metric definition and comparison totals.",
        responsibility: "Maintain dependable dashboards while preserving agreed metric definitions.",
        category: "Dashboard development / edits",
        preferredSurface: "bi",
        typicalMinutes: 120,
        priority: "normal",
      },
      {
        id: "data-analyst-source-quality-reconciliation",
        title: "Reconcile a source-data discrepancy",
        deliverable: "A reconciliation table with the affected rows, root cause, and corrected source total.",
        responsibility: "Validate data quality before recurring reports reach decision makers.",
        category: "QA / data validation",
        preferredSurface: "code",
        typicalMinutes: 90,
        priority: "urgent",
      },
      {
        id: "data-analyst-cohort-request",
        title: "Answer a stakeholder cohort request",
        deliverable: "A filtered cohort table with assumptions, exclusions, and a concise interpretation.",
        responsibility: "Respond to time-sensitive questions without losing analytical traceability.",
        category: "Ad hoc stakeholder requests",
        preferredSurface: "documents",
        typicalMinutes: 75,
        priority: "high",
      },
    ],
    communicationPatterns: [
      {
        channel: "chat",
        purpose: "Clarify the requested population, decision deadline, and acceptable caveats before analysis begins.",
        subject: "Cohort definition and decision deadline",
        direction: "collaborative",
      },
      {
        channel: "email",
        purpose: "Distribute a recurring metric readout with the largest movements and known data limitations.",
        subject: "Weekly operating metrics readout",
        direction: "outbound",
      },
      {
        channel: "meeting",
        purpose: "Resolve conflicting metric definitions and record which definition governs future reporting.",
        subject: "Metric definition review",
        direction: "collaborative",
      },
    ],
    businessMeasures: [
      { label: "Recurring reports delivered on time", unit: "percent", baseline: 88, target: 96, plausibleMin: 65, plausibleMax: 100, higherIsBetter: true, sourceSurface: "bi" },
      { label: "Dashboard validation exceptions", unit: "exceptions", baseline: 6, target: 2, plausibleMin: 0, plausibleMax: 18, higherIsBetter: false, sourceSurface: "bi" },
      { label: "Median analysis request turnaround", unit: "hours", baseline: 30, target: 20, plausibleMin: 4, plausibleMax: 72, higherIsBetter: false, sourceSurface: "projects" },
    ],
  },
  {
    personaId: "software-engineer",
    duties: [
      {
        id: "software-engineer-feature-slice",
        title: "Implement an approval workflow slice",
        deliverable: "A reviewable code change with typed states, failure handling, and focused automated coverage.",
        responsibility: "Deliver usable product behavior without weakening reliability or user control.",
        category: "Planned analysis / project work",
        preferredSurface: "code",
        typicalMinutes: 180,
        priority: "high",
      },
      {
        id: "software-engineer-defect-investigation",
        title: "Diagnose a production workflow defect",
        deliverable: "A reproducible failure case, documented root cause, scoped repair, and regression check.",
        responsibility: "Restore dependable behavior while preserving evidence about the failure mode.",
        category: "Debugging / issue investigation",
        preferredSurface: "code",
        typicalMinutes: 135,
        priority: "urgent",
      },
      {
        id: "software-engineer-code-review",
        title: "Review a dependency-sensitive change",
        deliverable: "Actionable review comments covering correctness, failure states, compatibility, and test evidence.",
        responsibility: "Protect system quality by reviewing changes at their integration boundaries.",
        category: "QA / data validation",
        preferredSurface: "projects",
        typicalMinutes: 45,
        priority: "normal",
      },
      {
        id: "software-engineer-release-verification",
        title: "Verify a release candidate build",
        deliverable: "A completed release checklist with build output, affected-flow smoke results, and known limitations.",
        responsibility: "Provide truthful readiness evidence before a release is promoted.",
        category: "QA / data validation",
        preferredSurface: "code",
        typicalMinutes: 75,
        priority: "high",
      },
    ],
    communicationPatterns: [
      {
        channel: "comment",
        purpose: "Explain a correctness or compatibility concern at the exact code boundary where it occurs.",
        subject: "Pull request review finding",
        direction: "outbound",
      },
      {
        channel: "chat",
        purpose: "Coordinate incident ownership, current impact, next diagnostic step, and update cadence.",
        subject: "Workflow incident coordination",
        direction: "collaborative",
      },
      {
        channel: "meeting",
        purpose: "Align product and design partners on implementation tradeoffs before committing the technical approach.",
        subject: "Implementation design review",
        direction: "collaborative",
      },
    ],
    businessMeasures: [
      { label: "Release verification pass rate", unit: "percent", baseline: 91, target: 97, plausibleMin: 70, plausibleMax: 100, higherIsBetter: true, sourceSurface: "code" },
      { label: "Median defect resolution time", unit: "hours", baseline: 18, target: 10, plausibleMin: 1, plausibleMax: 72, higherIsBetter: false, sourceSurface: "projects" },
      { label: "Escaped defects per release", unit: "defects", baseline: 4, target: 1, plausibleMin: 0, plausibleMax: 12, higherIsBetter: false, sourceSurface: "projects" },
    ],
  },
  {
    personaId: "product-manager",
    duties: [
      {
        id: "product-manager-roadmap-prioritization",
        title: "Prioritize the next roadmap increment",
        deliverable: "A ranked opportunity set with user evidence, expected outcome, dependencies, and explicit exclusions.",
        responsibility: "Make product priorities understandable and defensible across functions.",
        category: "Planned analysis / project work",
        preferredSurface: "projects",
        typicalMinutes: 120,
        priority: "high",
      },
      {
        id: "product-manager-requirements-brief",
        title: "Draft a decision-ready requirements brief",
        deliverable: "A requirements brief defining the user problem, acceptance evidence, risks, and open decisions.",
        responsibility: "Turn product intent into a bounded outcome the delivery team can evaluate.",
        category: "Documentation / requirement clarification",
        preferredSurface: "documents",
        typicalMinutes: 105,
        priority: "high",
      },
      {
        id: "product-manager-discovery-synthesis",
        title: "Synthesize a customer discovery round",
        deliverable: "A themed evidence summary separating repeated needs, outliers, and unresolved questions.",
        responsibility: "Ground product decisions in reviewable customer evidence rather than anecdotes.",
        category: "Planned analysis / project work",
        preferredSurface: "documents",
        typicalMinutes: 90,
        priority: "normal",
      },
      {
        id: "product-manager-launch-readiness",
        title: "Close the launch readiness review",
        deliverable: "A launch decision log with owners, remaining risks, rollback conditions, and approved scope.",
        responsibility: "Coordinate a truthful cross-functional readiness decision before launch.",
        category: "Meetings / stakeholder syncs",
        preferredSurface: "meetings",
        typicalMinutes: 60,
        priority: "urgent",
      },
    ],
    communicationPatterns: [
      {
        channel: "chat",
        purpose: "Resolve a scope ambiguity quickly and record the resulting decision for the delivery team.",
        subject: "Scope decision needed for current increment",
        direction: "collaborative",
      },
      {
        channel: "email",
        purpose: "Share launch status, material risks, accountable owners, and the next decision point.",
        subject: "Launch readiness status and open risks",
        direction: "outbound",
      },
      {
        channel: "meeting",
        purpose: "Review evidence and tradeoffs with engineering and design before ranking roadmap work.",
        subject: "Product priority review",
        direction: "collaborative",
      },
    ],
    businessMeasures: [
      { label: "Committed roadmap outcomes delivered", unit: "percent", baseline: 76, target: 88, plausibleMin: 45, plausibleMax: 100, higherIsBetter: true, sourceSurface: "projects" },
      { label: "Median open-decision age", unit: "days", baseline: 6, target: 3, plausibleMin: 0, plausibleMax: 18, higherIsBetter: false, sourceSurface: "projects" },
      { label: "Launch readiness checks complete", unit: "percent", baseline: 72, target: 96, plausibleMin: 35, plausibleMax: 100, higherIsBetter: true, sourceSurface: "documents" },
    ],
  },
  {
    personaId: "product-designer",
    duties: [
      {
        id: "product-designer-workflow-prototype",
        title: "Prototype a complex review workflow",
        deliverable: "A linked interaction prototype covering the primary path, corrections, and meaningful failure states.",
        responsibility: "Turn a user problem into a testable interaction model before implementation.",
        category: "Planned analysis / project work",
        preferredSurface: "documents",
        typicalMinutes: 150,
        priority: "high",
      },
      {
        id: "product-designer-usability-study",
        title: "Run a focused usability study",
        deliverable: "A structured observation log and findings summary tied to the study questions.",
        responsibility: "Validate whether people understand and can complete the intended workflow.",
        category: "Meetings / stakeholder syncs",
        preferredSurface: "meetings",
        typicalMinutes: 90,
        priority: "high",
      },
      {
        id: "product-designer-component-specification",
        title: "Specify an accessible interface component",
        deliverable: "A component specification with states, keyboard behavior, responsive rules, and reusable tokens.",
        responsibility: "Maintain coherent and accessible interaction patterns across the product.",
        category: "Documentation / requirement clarification",
        preferredSurface: "documents",
        typicalMinutes: 105,
        priority: "normal",
      },
      {
        id: "product-designer-implementation-review",
        title: "Review an implemented workflow for fidelity",
        deliverable: "A prioritized implementation review covering hierarchy, interaction, accessibility, and edge states.",
        responsibility: "Preserve the intended user experience through the implementation boundary.",
        category: "QA / data validation",
        preferredSurface: "projects",
        typicalMinutes: 60,
        priority: "urgent",
      },
    ],
    communicationPatterns: [
      {
        channel: "comment",
        purpose: "Attach a specific interaction or accessibility correction to the relevant design state.",
        subject: "Prototype review annotation",
        direction: "outbound",
      },
      {
        channel: "chat",
        purpose: "Clarify feasibility and preserve the user outcome when implementation constraints appear.",
        subject: "Design and engineering implementation question",
        direction: "collaborative",
      },
      {
        channel: "meeting",
        purpose: "Critique a workflow against the user problem, evidence, and established design vocabulary.",
        subject: "Cross-functional design critique",
        direction: "collaborative",
      },
    ],
    businessMeasures: [
      { label: "Usability task completion", unit: "percent", baseline: 72, target: 88, plausibleMin: 35, plausibleMax: 100, higherIsBetter: true, sourceSurface: "documents" },
      { label: "Post-review design rework", unit: "hours", baseline: 14, target: 7, plausibleMin: 1, plausibleMax: 36, higherIsBetter: false, sourceSurface: "projects" },
      { label: "Open accessibility findings", unit: "findings", baseline: 8, target: 2, plausibleMin: 0, plausibleMax: 24, higherIsBetter: false, sourceSurface: "projects" },
    ],
  },
  {
    personaId: "customer-support-lead",
    duties: [
      {
        id: "customer-support-lead-queue-triage",
        title: "Rebalance the daily support queue",
        deliverable: "A prioritized queue plan with urgent cases, workload ownership, and aging-risk flags.",
        responsibility: "Keep response commitments dependable while matching work to available coverage.",
        category: "Admin / coordination",
        preferredSurface: "projects",
        typicalMinutes: 45,
        priority: "urgent",
      },
      {
        id: "customer-support-lead-escalation-resolution",
        title: "Resolve a complex customer escalation",
        deliverable: "A documented resolution with reproduction evidence, customer-safe explanation, and follow-up owner.",
        responsibility: "Restore customer progress and preserve useful evidence for product improvement.",
        category: "Ad hoc stakeholder requests",
        preferredSurface: "crm",
        typicalMinutes: 75,
        priority: "urgent",
      },
      {
        id: "customer-support-lead-knowledge-refresh",
        title: "Refresh a high-volume knowledge article",
        deliverable: "A tested support article with current steps, decision points, and escalation conditions.",
        responsibility: "Reduce avoidable queue demand through accurate self-service guidance.",
        category: "Documentation / requirement clarification",
        preferredSurface: "documents",
        typicalMinutes: 90,
        priority: "normal",
      },
      {
        id: "customer-support-lead-coaching-calibration",
        title: "Calibrate case quality with the team",
        deliverable: "A coaching summary with scored examples, agreed standards, and individual practice actions.",
        responsibility: "Improve service consistency through evidence-based coaching and shared standards.",
        category: "Meetings / stakeholder syncs",
        preferredSurface: "meetings",
        typicalMinutes: 60,
        priority: "high",
      },
    ],
    communicationPatterns: [
      {
        channel: "chat",
        purpose: "Route an urgent escalation to the right owner and keep impact and next update visible.",
        subject: "Urgent support escalation ownership",
        direction: "collaborative",
      },
      {
        channel: "email",
        purpose: "Provide a clear resolution summary and next step without exposing internal diagnostic details.",
        subject: "Escalation resolution and follow-up",
        direction: "outbound",
      },
      {
        channel: "meeting",
        purpose: "Review queue trends, recurring failure themes, and coaching opportunities with the support team.",
        subject: "Weekly service quality calibration",
        direction: "collaborative",
      },
    ],
    businessMeasures: [
      { label: "Median first response time", unit: "minutes", baseline: 38, target: 22, plausibleMin: 5, plausibleMax: 120, higherIsBetter: false, sourceSurface: "crm" },
      { label: "Cases resolved within service target", unit: "percent", baseline: 84, target: 94, plausibleMin: 55, plausibleMax: 100, higherIsBetter: true, sourceSurface: "crm" },
      { label: "Case reopen rate", unit: "percent", baseline: 12, target: 7, plausibleMin: 1, plausibleMax: 28, higherIsBetter: false, sourceSurface: "bi" },
    ],
  },
  {
    personaId: "sales-account-executive",
    duties: [
      {
        id: "sales-account-executive-discovery-plan",
        title: "Prepare a qualified discovery plan",
        deliverable: "A discovery brief covering the business problem, stakeholders, decision process, and evidence gaps.",
        responsibility: "Qualify opportunities through substantive business discovery rather than activity volume.",
        category: "Planned analysis / project work",
        preferredSurface: "crm",
        typicalMinutes: 60,
        priority: "high",
      },
      {
        id: "sales-account-executive-solution-demonstration",
        title: "Run a scenario-based product demonstration",
        deliverable: "A tailored demonstration and written recap tied to the prospect's confirmed evaluation criteria.",
        responsibility: "Help a prospective customer evaluate fit against a real operating scenario.",
        category: "Meetings / stakeholder syncs",
        preferredSurface: "meetings",
        typicalMinutes: 75,
        priority: "high",
      },
      {
        id: "sales-account-executive-mutual-action-plan",
        title: "Update a mutual evaluation action plan",
        deliverable: "A sequenced action plan with owners, dates, decision dependencies, and exit criteria.",
        responsibility: "Coordinate a transparent evaluation process across commercial and customer stakeholders.",
        category: "Documentation / requirement clarification",
        preferredSurface: "documents",
        typicalMinutes: 45,
        priority: "normal",
      },
      {
        id: "sales-account-executive-forecast-hygiene",
        title: "Reconcile the weekly opportunity forecast",
        deliverable: "An updated forecast with evidence-backed stage, close timing, value, and next action for each opportunity.",
        responsibility: "Maintain an accurate pipeline view for capacity and revenue planning.",
        category: "Recurring reporting",
        preferredSurface: "crm",
        typicalMinutes: 60,
        priority: "urgent",
      },
    ],
    communicationPatterns: [
      {
        channel: "email",
        purpose: "Confirm discovery findings, unresolved questions, and the agreed next evaluation step.",
        subject: "Discovery recap and next evaluation step",
        direction: "outbound",
      },
      {
        channel: "chat",
        purpose: "Coordinate technical or commercial support needed for an active evaluation.",
        subject: "Evaluation support request",
        direction: "collaborative",
      },
      {
        channel: "meeting",
        purpose: "Review opportunity evidence, forecast risk, and next actions with the commercial team.",
        subject: "Weekly pipeline and forecast review",
        direction: "collaborative",
      },
    ],
    businessMeasures: [
      { label: "Qualified pipeline coverage", unit: "multiple", baseline: 2.4, target: 3.2, plausibleMin: 0.8, plausibleMax: 5.5, higherIsBetter: true, sourceSurface: "crm" },
      { label: "Qualified opportunity win rate", unit: "percent", baseline: 24, target: 31, plausibleMin: 8, plausibleMax: 55, higherIsBetter: true, sourceSurface: "crm" },
      { label: "Forecast variance", unit: "percent", baseline: 18, target: 9, plausibleMin: 0, plausibleMax: 40, higherIsBetter: false, sourceSurface: "bi" },
    ],
  },
  {
    personaId: "marketing-manager",
    duties: [
      {
        id: "marketing-manager-campaign-brief",
        title: "Build an integrated campaign brief",
        deliverable: "A campaign brief with audience, proposition, channels, assets, measures, owners, and launch dates.",
        responsibility: "Translate a market objective into coordinated, measurable campaign work.",
        category: "Planned analysis / project work",
        preferredSurface: "documents",
        typicalMinutes: 120,
        priority: "high",
      },
      {
        id: "marketing-manager-asset-readiness",
        title: "Review campaign assets for readiness",
        deliverable: "An asset review log covering message consistency, required approvals, links, and channel specifications.",
        responsibility: "Protect launch quality by resolving creative and operational gaps before publication.",
        category: "QA / data validation",
        preferredSurface: "projects",
        typicalMinutes: 75,
        priority: "urgent",
      },
      {
        id: "marketing-manager-performance-analysis",
        title: "Analyze campaign performance by channel",
        deliverable: "A channel performance summary with conversion movement, cost drivers, and a recommended adjustment.",
        responsibility: "Use observed campaign evidence to improve allocation and message decisions.",
        category: "Planned analysis / project work",
        preferredSurface: "bi",
        typicalMinutes: 90,
        priority: "high",
      },
      {
        id: "marketing-manager-budget-pacing",
        title: "Reconcile monthly campaign budget pacing",
        deliverable: "A pacing workbook with actuals, commitments, remaining budget, and flagged overrun risk.",
        responsibility: "Keep campaign investment within approved limits while preserving priority outcomes.",
        category: "Recurring reporting",
        preferredSurface: "bi",
        typicalMinutes: 60,
        priority: "normal",
      },
    ],
    communicationPatterns: [
      {
        channel: "comment",
        purpose: "Give specific revision direction on message, audience fit, evidence, or channel requirements.",
        subject: "Campaign asset revision request",
        direction: "outbound",
      },
      {
        channel: "chat",
        purpose: "Coordinate a launch dependency across content, creative, product, and commercial owners.",
        subject: "Campaign launch dependency",
        direction: "collaborative",
      },
      {
        channel: "meeting",
        purpose: "Review performance signals and agree which channel or message experiment changes next.",
        subject: "Campaign performance review",
        direction: "collaborative",
      },
    ],
    businessMeasures: [
      { label: "Qualified campaign responses", unit: "responses", baseline: 120, target: 155, plausibleMin: 45, plausibleMax: 260, higherIsBetter: true, sourceSurface: "bi" },
      { label: "Cost per qualified response", unit: "currency units", baseline: 78, target: 62, plausibleMin: 30, plausibleMax: 145, higherIsBetter: false, sourceSurface: "bi" },
      { label: "Landing-page conversion rate", unit: "percent", baseline: 3.2, target: 4.4, plausibleMin: 1.1, plausibleMax: 8.5, higherIsBetter: true, sourceSurface: "bi" },
    ],
  },
  {
    personaId: "finance-analyst",
    duties: [
      {
        id: "finance-analyst-close-variance",
        title: "Explain the monthly operating variance",
        deliverable: "A variance bridge separating volume, rate, timing, and one-time drivers with supporting evidence.",
        responsibility: "Explain financial outcomes accurately enough to support operating decisions.",
        category: "Recurring reporting",
        preferredSurface: "bi",
        typicalMinutes: 120,
        priority: "urgent",
      },
      {
        id: "finance-analyst-rolling-forecast",
        title: "Update the rolling operating forecast",
        deliverable: "A forecast model with refreshed actuals, documented assumptions, scenarios, and review checks.",
        responsibility: "Maintain a credible forward view of resources and financial outcomes.",
        category: "Planned analysis / project work",
        preferredSurface: "documents",
        typicalMinutes: 180,
        priority: "high",
      },
      {
        id: "finance-analyst-account-reconciliation",
        title: "Reconcile a material ledger balance",
        deliverable: "A signed reconciliation with source tie-out, explained differences, and correcting action.",
        responsibility: "Protect reporting integrity through timely control validation.",
        category: "QA / data validation",
        preferredSurface: "documents",
        typicalMinutes: 90,
        priority: "urgent",
      },
      {
        id: "finance-analyst-planning-pack",
        title: "Prepare a department planning pack",
        deliverable: "A planning pack with prior trend, current run rate, scenario ranges, and assumption questions.",
        responsibility: "Help operating partners make resource decisions using consistent financial evidence.",
        category: "Dashboard development / edits",
        preferredSurface: "bi",
        typicalMinutes: 105,
        priority: "normal",
      },
    ],
    communicationPatterns: [
      {
        channel: "email",
        purpose: "Receive an updated operating assumption and determine whether it changes the forecast base case.",
        subject: "Updated forecast assumption from operating partner",
        direction: "inbound",
      },
      {
        channel: "comment",
        purpose: "Document the evidence and disposition for a reconciliation difference in the review record.",
        subject: "Reconciliation variance explanation",
        direction: "outbound",
      },
      {
        channel: "meeting",
        purpose: "Challenge forecast assumptions and agree a defensible base case with operating partners.",
        subject: "Operating forecast review",
        direction: "collaborative",
      },
    ],
    businessMeasures: [
      { label: "Absolute forecast variance", unit: "percent", baseline: 9.5, target: 5, plausibleMin: 0.5, plausibleMax: 22, higherIsBetter: false, sourceSurface: "bi" },
      { label: "Close cycle duration", unit: "business days", baseline: 7, target: 5, plausibleMin: 3, plausibleMax: 12, higherIsBetter: false, sourceSurface: "projects" },
      { label: "Reconciliations completed on time", unit: "percent", baseline: 86, target: 97, plausibleMin: 60, plausibleMax: 100, higherIsBetter: true, sourceSurface: "documents" },
    ],
  },
  {
    personaId: "operations-manager",
    duties: [
      {
        id: "operations-manager-service-review",
        title: "Run the daily service health review",
        deliverable: "A prioritized operating log with current exceptions, owners, next checks, and escalation thresholds.",
        responsibility: "Maintain dependable service flow by making emerging risk visible early.",
        category: "Recurring reporting",
        preferredSurface: "bi",
        typicalMinutes: 45,
        priority: "urgent",
      },
      {
        id: "operations-manager-incident-analysis",
        title: "Complete an operating incident analysis",
        deliverable: "An incident timeline with contributing conditions, corrective actions, owners, and follow-up dates.",
        responsibility: "Reduce recurrence by converting service failures into owned system improvements.",
        category: "Debugging / issue investigation",
        preferredSurface: "documents",
        typicalMinutes: 105,
        priority: "urgent",
      },
      {
        id: "operations-manager-capacity-plan",
        title: "Balance the next operating capacity plan",
        deliverable: "A demand-and-coverage plan with volume assumptions, constraints, and contingency triggers.",
        responsibility: "Match expected demand to realistic operating coverage before commitments are made.",
        category: "Planned analysis / project work",
        preferredSurface: "bi",
        typicalMinutes: 120,
        priority: "high",
      },
      {
        id: "operations-manager-process-redesign",
        title: "Redesign a high-friction operating process",
        deliverable: "A current-to-future process map with control points, accountable owners, and rollout checks.",
        responsibility: "Improve service flow without obscuring ownership or control requirements.",
        category: "Documentation / requirement clarification",
        preferredSurface: "projects",
        typicalMinutes: 150,
        priority: "normal",
      },
    ],
    communicationPatterns: [
      {
        channel: "chat",
        purpose: "Coordinate an active operating exception with clear impact, owner, and next update time.",
        subject: "Operating exception coordination",
        direction: "collaborative",
      },
      {
        channel: "email",
        purpose: "Distribute the weekly service summary with trends, missed targets, and corrective owners.",
        subject: "Weekly service performance summary",
        direction: "outbound",
      },
      {
        channel: "meeting",
        purpose: "Resolve cross-team dependencies that put the operating plan or service target at risk.",
        subject: "Operations dependency review",
        direction: "collaborative",
      },
    ],
    businessMeasures: [
      { label: "Work completed within service target", unit: "percent", baseline: 82, target: 94, plausibleMin: 55, plausibleMax: 100, higherIsBetter: true, sourceSurface: "bi" },
      { label: "Median operating cycle time", unit: "hours", baseline: 31, target: 22, plausibleMin: 8, plausibleMax: 68, higherIsBetter: false, sourceSurface: "bi" },
      { label: "Material service incidents", unit: "incidents per month", baseline: 7, target: 3, plausibleMin: 0, plausibleMax: 18, higherIsBetter: false, sourceSurface: "projects" },
    ],
  },
  {
    personaId: "consultant",
    duties: [
      {
        id: "consultant-hypothesis-workplan",
        title: "Structure a diagnostic hypothesis workplan",
        deliverable: "A sequenced workplan linking hypotheses to required evidence, analyses, interviews, and decisions.",
        responsibility: "Turn an ambiguous client question into a testable and manageable body of work.",
        category: "Planned analysis / project work",
        preferredSurface: "projects",
        typicalMinutes: 90,
        priority: "high",
      },
      {
        id: "consultant-diagnostic-model",
        title: "Build an operating performance diagnostic",
        deliverable: "A quality-checked model showing baseline performance, driver decomposition, and scenario ranges.",
        responsibility: "Develop evidence that distinguishes root causes from visible symptoms.",
        category: "SQL / data modeling / query work",
        preferredSurface: "bi",
        typicalMinutes: 180,
        priority: "high",
      },
      {
        id: "consultant-working-session",
        title: "Facilitate a decision working session",
        deliverable: "A decision record capturing agreed direction, unresolved issues, owners, and dated next actions.",
        responsibility: "Help stakeholders convert analysis into explicit, owned decisions.",
        category: "Meetings / stakeholder syncs",
        preferredSurface: "meetings",
        typicalMinutes: 90,
        priority: "urgent",
      },
      {
        id: "consultant-executive-recommendation",
        title: "Develop an executive recommendation narrative",
        deliverable: "A concise recommendation deck linking evidence, options, tradeoffs, decision, and implementation path.",
        responsibility: "Communicate a defensible course of action to senior decision makers.",
        category: "Documentation / requirement clarification",
        preferredSurface: "documents",
        typicalMinutes: 150,
        priority: "high",
      },
    ],
    communicationPatterns: [
      {
        channel: "email",
        purpose: "Receive a scoped source-data handoff and surface any evidence gaps before analysis begins.",
        subject: "Diagnostic source-data handoff",
        direction: "inbound",
      },
      {
        channel: "chat",
        purpose: "Coordinate workstream dependencies and flag a finding that changes another analysis path.",
        subject: "Cross-workstream finding and dependency",
        direction: "collaborative",
      },
      {
        channel: "meeting",
        purpose: "Test the emerging recommendation with client stakeholders and record remaining objections.",
        subject: "Recommendation alignment checkpoint",
        direction: "collaborative",
      },
    ],
    businessMeasures: [
      { label: "Milestones delivered on schedule", unit: "percent", baseline: 83, target: 95, plausibleMin: 55, plausibleMax: 100, higherIsBetter: true, sourceSurface: "projects" },
      { label: "Open client decisions past due", unit: "decisions", baseline: 6, target: 2, plausibleMin: 0, plausibleMax: 16, higherIsBetter: false, sourceSurface: "projects" },
      { label: "Recommendations accepted for implementation", unit: "percent", baseline: 68, target: 82, plausibleMin: 30, plausibleMax: 100, higherIsBetter: true, sourceSurface: "documents" },
    ],
  },
];

export function getPersonaWorkCatalog(personaId: string): PersonaWorkCatalog | undefined {
  return PERSONA_WORK_CATALOGS.find((catalog) => catalog.personaId === personaId);
}
