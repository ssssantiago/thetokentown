/**
 * Install and uninstall across every tool: plan, show the diff, ask per
 * tool, apply, remember. SPEC §7.
 */

import type { HookRecord, HookTool } from "../store.ts";
import { readConfig, updateConfig } from "../store.ts";
import { detectedSources } from "../sources.ts";
import { bold, confirm, dim, green, red, yellow } from "../ui.ts";
import type { HookPlan, PlanOutcome } from "./common.ts";
import { applyPlan, unifiedDiff } from "./common.ts";
import { claudeInstallPlan, claudeInstalled, claudeUninstallPlan } from "./claude.ts";
import { codexInstallPlan, codexInstalled, codexUninstallPlan } from "./codex.ts";
import { grokActivate, grokInstallPlan, grokInstalled, grokUninstallPlan } from "./grok.ts";

export interface HookOutcome {
  tool: HookTool;
  label: string;
  result: "applied" | "skipped" | "noop" | "refused" | "failed";
  detail: string;
}

function printDiff(plan: HookPlan): void {
  console.log(`\n  ${bold(plan.label)} → ${plan.file}`);
  if (plan.extras?.length) {
    for (const extra of plan.extras) console.log(dim(`  also writes ${extra.path}`));
  }
  if (plan.remove?.length) {
    for (const path of plan.remove) console.log(dim(`  also removes ${path}`));
  }
  const diff = unifiedDiff(plan.before, plan.after);
  for (const line of diff.split("\n")) {
    const painted = line.startsWith("+") ? green(line) : line.startsWith("-") ? red(line) : dim(line);
    console.log(`    ${painted}`);
  }
}

async function runPlans(
  outcomes: { tool: HookTool; outcome: PlanOutcome }[],
  options: { yes: boolean; verb: "install" | "remove"; onApplied: (plan: HookPlan) => void },
): Promise<HookOutcome[]> {
  const results: HookOutcome[] = [];
  for (const { tool, outcome } of outcomes) {
    if (outcome.kind === "noop") {
      console.log(`  ${dim("·")} ${outcome.label}: ${outcome.reason}`);
      results.push({ tool, label: outcome.label, result: "noop", detail: outcome.reason });
      continue;
    }
    if (outcome.kind === "refuse") {
      console.log(`  ${yellow("!")} ${outcome.label}: ${outcome.reason}`);
      results.push({ tool, label: outcome.label, result: "refused", detail: outcome.reason });
      continue;
    }
    const plan = outcome.plan;
    printDiff(plan);
    const ok = await confirm(`  ${options.verb === "install" ? "Apply" : "Remove"} for ${plan.label}?`, options.yes);
    if (!ok) {
      console.log(`  ${dim("·")} ${plan.label}: skipped`);
      results.push({ tool, label: plan.label, result: "skipped", detail: "declined" });
      continue;
    }
    try {
      const { backup, note } = applyPlan(plan, { backup: options.verb === "install" });
      options.onApplied(plan);
      const bits = [backup ? `backup ${backup}` : null, note ?? null].filter(Boolean).join("; ");
      console.log(`  ${green("✓")} ${plan.label}: ${options.verb === "install" ? "installed" : "removed"}${bits ? ` ${dim(`(${bits})`)}` : ""}`);
      results.push({ tool, label: plan.label, result: "applied", detail: bits });
    } catch (error) {
      const message = (error as Error).message;
      console.log(`  ${red("✗")} ${plan.label}: ${message}`);
      results.push({ tool, label: plan.label, result: "failed", detail: message });
    }
  }
  return results;
}

export async function installHooks(options: { yes: boolean }): Promise<HookOutcome[]> {
  const detected = detectedSources().map((source) => source.id);
  const plans: { tool: HookTool; outcome: PlanOutcome }[] = [];
  if (detected.includes("claude")) plans.push({ tool: "claude", outcome: claudeInstallPlan() });
  if (detected.includes("codex")) plans.push({ tool: "codex", outcome: codexInstallPlan() });
  if (detected.includes("grok")) {
    const sole = detected.filter((id) => id !== "cursor").length === 1;
    plans.push({ tool: "grok", outcome: grokInstallPlan(sole) });
  }
  if (plans.length === 0) {
    console.log("  No supported tool found (Claude Code, Codex CLI, Grok CLI).");
    return [];
  }

  return runPlans(plans, {
    yes: options.yes,
    verb: "install",
    onApplied: (plan) => {
      if (!plan.record) return;
      const record: HookRecord = plan.record;
      if (plan.tool === "grok") {
        const note = grokActivate(record);
        if (note) console.log(`    ${dim(note)}`);
      }
      updateConfig((config) => {
        config.hooks = { ...(config.hooks ?? {}), [plan.tool]: record };
      });
    },
  });
}

export async function uninstallHooks(options: { yes: boolean }): Promise<HookOutcome[]> {
  const config = readConfig();
  const records = config.hooks ?? {};
  const plans: { tool: HookTool; outcome: PlanOutcome }[] = [
    { tool: "claude", outcome: claudeUninstallPlan(records.claude) },
    { tool: "codex", outcome: codexUninstallPlan(records.codex) },
    { tool: "grok", outcome: records.grok || grokInstalled() ? grokUninstallPlan(records.grok) : { kind: "noop", label: "Grok CLI", reason: "no schedule installed" } },
  ];

  return runPlans(plans, {
    yes: options.yes,
    verb: "remove",
    onApplied: (plan) => {
      updateConfig((current) => {
        if (current.hooks) delete current.hooks[plan.tool];
        if (current.hooks && Object.keys(current.hooks).length === 0) delete current.hooks;
      });
    },
  });
}

/** What is actually in the tools' files right now, whatever config.json says. */
export function installedHooks(): Record<HookTool, boolean> {
  return { claude: claudeInstalled(), codex: codexInstalled(), grok: grokInstalled() };
}

export const anyHookInstalled = (): boolean => Object.values(installedHooks()).some(Boolean);
