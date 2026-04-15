import type { FreeAnalysisResponse } from "@/lib/aie/types";

type AnalysisResultProps = {
  result: FreeAnalysisResponse;
};

const EVIDENCE_GAP_PATTERN =
  /absence of error messages|lack of error messages|without an error message|no obvious console errors|no error messages|not a runtime exception/i;
const GENERIC_DIAGNOSIS_PATTERN =
  /component or object|critical object or component|missing or incorrect reference|missing reference|misconfiguration|disconnection|state management|physics settings|collision detection logic/i;
const CONCRETE_ANCHOR_PATTERN =
  /\b(?:Rigidbody2D|NavMeshAgent|Cinemachine|Animator|CanvasGroup|SceneManager|NullReferenceException|MissingReferenceException|Transform|Button|Slider|Image|Update|Start|Awake|FixedUpdate|MovePosition|AddForce|onClick|FadeOut)\b|[A-Za-z_]+\.[A-Za-z_]+/;

function shouldShowLowEvidenceCue(result: FreeAnalysisResponse): boolean {
  const supportingText = [result.what_happened, ...result.what_matters].join(" ");
  const hasEvidenceGapSignal = EVIDENCE_GAP_PATTERN.test(supportingText);
  const hasGenericDiagnosisSignal = GENERIC_DIAGNOSIS_PATTERN.test(supportingText);
  const hasConcreteAnchor = CONCRETE_ANCHOR_PATTERN.test(supportingText);
  const hedgedDiagnosis = /\b(?:most likely|likely|probably)\b/i.test(result.what_happened);

  return hasEvidenceGapSignal || hasGenericDiagnosisSignal || (hedgedDiagnosis && !hasConcreteAnchor);
}

export function AnalysisResult({ result }: AnalysisResultProps) {
  const [confirmFirstStep, ...followUpSteps] = result.what_to_do_next;
  const showLowEvidenceCue = shouldShowLowEvidenceCue(result);

  return (
    <div className="grid gap-5">
      <section className="glass-card rounded-[1.75rem] p-6 shadow-float sm:p-7">
        <p className="section-label">Diagnosis</p>
        {showLowEvidenceCue ? (
          <p className="mt-2 text-xs leading-6 body-muted sm:text-sm">
            Given the current details, this is the most likely explanation.
          </p>
        ) : null}
        <p className="mt-3 text-sm leading-7 text-ink/90 sm:text-base">{result.what_happened}</p>
      </section>
      <section className="glass-card rounded-[1.75rem] p-6 shadow-float sm:p-7">
        <p className="section-label">Why this is the likely cause</p>
        <ul className="mt-4 space-y-3 text-sm leading-7 text-ink/90 sm:text-base">
          {result.what_matters.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section className="glass-card rounded-[1.75rem] p-6 shadow-float sm:p-7">
        <p className="section-label">What to do next</p>
        <p className="mt-3 text-sm leading-7 body-muted">Start with the first check before making broader changes.</p>
        {confirmFirstStep ? (
          <div className="mt-4 rounded-[1.25rem] border border-ocean/15 bg-ocean/5 p-4">
            <p className="section-label">Confirm first</p>
            <p className="mt-2 text-sm leading-7 text-ink/90 sm:text-base">1. {confirmFirstStep}</p>
          </div>
        ) : null}
        {followUpSteps.length > 0 ? (
          <div className="mt-4">
            <p className="section-label">Then continue</p>
            <ol className="mt-3 space-y-3 text-sm leading-7 text-ink/90 sm:text-base">
              {followUpSteps.map((item, index) => (
                <li key={item}>{index + 2}. {item}</li>
              ))}
            </ol>
          </div>
        ) : null}
        <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/40 p-4">
          <p className="text-sm leading-7 text-ink/90 sm:text-base">After you try the first step, what did you observe?</p>
          <input
            type="text"
            aria-label="Optional follow-up observation"
            placeholder="Optional note for your next debugging pass"
            className="mt-3 w-full rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm text-ink outline-none placeholder:text-slate"
          />
        </div>
      </section>
    </div>
  );
}