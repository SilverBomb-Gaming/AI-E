import { readOutcomeRecords, type OutcomeRecord } from "./outcomeLearning";

export const MAX_RETRIES_PER_FEATURE = 3;

export type RetryDecision = {
	feature: string;
	lastResult: "fail" | "partial";
	retryRecommended: boolean;
	reason: string;
	strategyAdjustment?: string;
};

export type RetrySuggestionResult = {
	projectPath: string;
	latestOutcome?: OutcomeRecord;
	retryCount: number;
	maxRetries: number;
	decision?: RetryDecision;
	reason: string;
};

export type AutoRetryTask = {
	feature: string;
	lastResult: "fail" | "partial";
	retryCount: number;
	title: string;
	behaviorDescription: string;
	reason: string;
	strategyAdjustment: string;
	executionPlan: string[];
};

export type AutoRetryResult = {
	projectPath: string;
	suggestion: RetrySuggestionResult;
	task?: AutoRetryTask;
};

function normalizeFeatureKey(feature: string): string {
	return feature.trim().toLowerCase();
}

function isRetryableResult(result: OutcomeRecord["result"]): result is "fail" | "partial" {
	return result === "fail" || result === "partial";
}

function countConsecutiveRetryableOutcomes(records: OutcomeRecord[], feature: string): number {
	const normalizedFeature = normalizeFeatureKey(feature);
	let count = 0;

	for (let index = records.length - 1; index >= 0; index -= 1) {
		const record = records[index];
		if (normalizeFeatureKey(record.feature) !== normalizedFeature) {
			continue;
		}

		if (!isRetryableResult(record.result)) {
			break;
		}

		count += 1;
	}

	return count;
}

function deriveRetryCount(records: OutcomeRecord[], latestOutcome: OutcomeRecord): number {
	if (typeof latestOutcome.retryCount === "number") {
		return latestOutcome.retryCount;
	}

	if (!isRetryableResult(latestOutcome.result)) {
		return 0;
	}

	return countConsecutiveRetryableOutcomes(records, latestOutcome.feature);
}

function buildStrategyAdjustment(latestOutcome: OutcomeRecord, retryCount: number): string | undefined {
	if (latestOutcome.result === "fail" && retryCount >= 2) {
		return "Change implementation approach";
	}

	if (latestOutcome.result === "fail" && (latestOutcome.errors?.length ?? 0) > 0) {
		return "Fix runtime errors before retry";
	}

	if (latestOutcome.result === "partial" && (latestOutcome.gameplayEvents?.length ?? 0) > 0) {
		return "Refine feature behavior, not structure";
	}

	if (latestOutcome.result === "fail") {
		return "Retry with a smaller guarded change";
	}

	return "Tighten the feature behavior before expanding scope";
}

function buildRetryReason(latestOutcome: OutcomeRecord, retryCount: number): string {
	if (retryCount >= MAX_RETRIES_PER_FEATURE) {
		return `Retry limit reached for ${latestOutcome.feature} (${retryCount}/${MAX_RETRIES_PER_FEATURE}).`;
	}

	if (latestOutcome.result === "fail" && retryCount >= 2) {
		return `Previous attempt failed repeatedly for ${latestOutcome.feature}.`;
	}

	if (latestOutcome.result === "fail" && (latestOutcome.errors?.length ?? 0) > 0) {
		return `Previous attempt failed with ${latestOutcome.errors?.length ?? 0} runtime error(s).`;
	}

	if (latestOutcome.result === "partial" && (latestOutcome.gameplayEvents?.length ?? 0) > 0) {
		return `Previous attempt was partial and still emitted ${latestOutcome.gameplayEvents?.length ?? 0} gameplay event(s).`;
	}

	return latestOutcome.result === "fail"
		? `Previous attempt failed for ${latestOutcome.feature}.`
		: `Previous attempt partially succeeded for ${latestOutcome.feature}.`;
}

export function buildRetrySuggestionFromRecords(projectPath: string, records: OutcomeRecord[]): RetrySuggestionResult {
	const latestOutcome = records[records.length - 1];

	if (!latestOutcome) {
		return {
			projectPath,
			retryCount: 0,
			maxRetries: MAX_RETRIES_PER_FEATURE,
			reason: "No stored outcomes available yet.",
		};
	}

	if (!isRetryableResult(latestOutcome.result)) {
		return {
			projectPath,
			latestOutcome,
			retryCount: 0,
			maxRetries: MAX_RETRIES_PER_FEATURE,
			reason: "No retry needed",
		};
	}

	const retryCount = deriveRetryCount(records, latestOutcome);
	const reason = buildRetryReason(latestOutcome, retryCount);
	const strategyAdjustment = buildStrategyAdjustment(latestOutcome, retryCount);
	const retryRecommended = retryCount < MAX_RETRIES_PER_FEATURE;

	return {
		projectPath,
		latestOutcome,
		retryCount,
		maxRetries: MAX_RETRIES_PER_FEATURE,
		reason,
		decision: {
			feature: latestOutcome.feature,
			lastResult: latestOutcome.result,
			retryRecommended,
			reason,
			strategyAdjustment,
		},
	};
}

export async function suggestRetryForLatestOutcome(projectPath: string): Promise<RetrySuggestionResult> {
	const records = await readOutcomeRecords(projectPath);
	return buildRetrySuggestionFromRecords(projectPath, records);
}

export function buildAutoRetryTask(suggestion: RetrySuggestionResult): AutoRetryTask | undefined {
	if (!suggestion.decision || !suggestion.latestOutcome || !suggestion.decision.retryRecommended) {
		return undefined;
	}

	const strategyAdjustment = suggestion.decision.strategyAdjustment ?? "Retry with guarded follow-up validation";

	return {
		feature: suggestion.decision.feature,
		lastResult: suggestion.decision.lastResult,
		retryCount: suggestion.retryCount,
		title: `Retry ${suggestion.decision.feature} with adjusted strategy`,
		behaviorDescription: `Rework ${suggestion.decision.feature} after a ${suggestion.decision.lastResult} outcome using the adjustment: ${strategyAdjustment}.`,
		reason: suggestion.decision.reason,
		strategyAdjustment,
		executionPlan: [
			`Review the latest stored outcome evidence for ${suggestion.decision.feature}.`,
			`Apply this strategy adjustment: ${strategyAdjustment}.`,
			`Keep the retry bounded to ${suggestion.decision.feature} before widening scope.`,
			"Re-run the Unity playtest and auto-record the next outcome.",
		],
	};
}

export async function generateAutoRetryTask(projectPath: string): Promise<AutoRetryResult> {
	const suggestion = await suggestRetryForLatestOutcome(projectPath);
	return {
		projectPath,
		suggestion,
		task: buildAutoRetryTask(suggestion),
	};
}

export function renderRetrySuggestion(result: RetrySuggestionResult): string {
	return [
		"RETRY SUGGESTION",
		"",
		`Feature: ${result.latestOutcome?.feature ?? "n/a"}`,
		`Last Result: ${result.latestOutcome?.result ?? "n/a"}`,
		`Retry Recommended: ${result.decision?.retryRecommended ? "YES" : "NO"}`,
		`Reason: ${result.decision?.reason ?? result.reason}`,
		`Strategy Adjustment: ${result.decision?.strategyAdjustment ?? "n/a"}`,
		`Retry Count: ${result.retryCount}`,
		`Max Retries: ${result.maxRetries}`,
	].join("\n");
}

export function renderAutoRetryResult(result: AutoRetryResult): string {
	if (!result.task) {
		return [
			"No retry needed",
			`Reason: ${result.suggestion.decision?.reason ?? result.suggestion.reason}`,
		].join("\n");
	}

	return [
		"AUTO RETRY TASK",
		"",
		`Feature: ${result.task.feature}`,
		`Last Result: ${result.task.lastResult}`,
		`Retry Count: ${result.task.retryCount}`,
		`Reason: ${result.task.reason}`,
		`Strategy Adjustment: ${result.task.strategyAdjustment}`,
		`Title: ${result.task.title}`,
		`Behavior: ${result.task.behaviorDescription}`,
		"",
		"Execution Plan:",
		...result.task.executionPlan.map((step, index) => `${index + 1}. ${step}`),
	].join("\n");
}