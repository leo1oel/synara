// FILE: UsageAnalyticsPanel.tsx
// Purpose: The Usage Analytics tab: cost and tokens by day, provider, model, and
//          project, plus cache use, turn origin, and weekly rhythm. "In Synara" uses
//          Synara's own records; "This Mac" also reads Claude Code and Codex session
//          files. Cost is at API rates: the provider's own figure when it reports
//          one, else the tokens at API list prices.
// Layer: Web settings feature
// Exports: UsageAnalyticsPanel

import type { StatsUsageAnalyticsScope } from "@synara/contracts";
import { formatCompact, formatNumber } from "@synara/profile-ui/formatting";
import { InsightRow, ModelUsageRow, StatTileGrid } from "@synara/profile-ui/sections";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";

import { isSynaraEmbedMode } from "~/embedMode";
import { type t as translateFn, useTranslation } from "~/i18n";
import { serverUsageAnalyticsQueryOptions } from "~/lib/serverReactQuery";
import { cn } from "~/lib/utils";
import { SegmentedPicker } from "../SegmentedPicker";
import { ProviderIcon } from "../ProviderIcon";
import { Button } from "../ui/button";
import { ChartLegend, DailyBarChart, ProviderLineChart, RhythmChart } from "./UsageAnalyticsCharts";
import {
  buildUsageAnalyticsView,
  localDayKey,
  percentChange,
  PROVIDER_SERIES_COLOR,
  providerLabel,
  type UsageAnalyticsMetric,
  type UsageAnalyticsProvider,
  type UsageAnalyticsProviderTotal,
  type UsageAnalyticsRange,
  type UsageAnalyticsView,
  type UsageAnalyticsWindow,
  usageAnalyticsWindow,
} from "./usageAnalytics.logic";
import { SettingsCard, SettingsListRow } from "./SettingsPanelPrimitives";

const USD = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  currencyDisplay: "narrowSymbol",
});

const RANGES: ReadonlyArray<UsageAnalyticsRange> = ["7d", "30d", "90d", "1y"];

/** The server request for a window: it includes the period before, when fetched. */
function analyticsRequest(window: UsageAnalyticsWindow, scope: StatsUsageAnalyticsScope) {
  return {
    from: (window.previousFrom ?? window.from).toISOString(),
    to: window.to.toISOString(),
    scope,
  };
}

function formatUsd(value: number): string {
  return USD.format(value);
}

/** Axis and tooltip money: whole dollars once amounts are large. */
function formatUsdShort(value: number): string {
  if (value >= 1000) return `$${formatCompact(value)}`;
  if (value >= 10) return `$${Math.round(value)}`;
  return USD.format(value);
}

function formatTokens(value: number): string {
  return formatCompact(value);
}

/** A section heading with a one-line explanation and an optional control on the right. */
function SectionTitle(props: { title: string; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 space-y-0.5">
        <h3 className="text-ui-lg font-semibold text-foreground">{props.title}</h3>
        {props.detail ? <p className="text-ui text-muted-foreground">{props.detail}</p> : null}
      </div>
      {props.action}
    </div>
  );
}

/** The app the "In …" scope counts: Lattice's panel, or Synara on its own. */
function analyticsAppName(): string {
  return isSynaraEmbedMode() ? "Lattice" : "Synara";
}

/** "A, B" for a provider list; Chinese lists take the enumeration comma "、". */
function joinNames(names: ReadonlyArray<string>, formatLocale: string): string {
  return names.join(formatLocale.toLowerCase().startsWith("zh") ? "、" : ", ");
}

function ChangeLabel(props: { change: number | null }) {
  const { t } = useTranslation();
  if (props.change === null) return null;
  const up = props.change >= 0;
  return (
    <span className={cn("text-ui-sm", up ? "text-info" : "text-muted-foreground")}>
      {t("lattice:usageAnalyticsChange", {
        arrow: up ? "↑" : "↓",
        percent: Math.abs(props.change),
      })}
    </span>
  );
}

function ShareBar(props: { share: number; color: string }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-foreground/[0.07]">
      <div
        className="h-1 rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, props.share))}%`, background: props.color }}
      />
    </div>
  );
}

/** The provider's icon; a neutral dot when the provider is unknown. */
function ProviderMark(props: { provider: UsageAnalyticsProvider }) {
  return props.provider === "unknown" ? (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ background: PROVIDER_SERIES_COLOR.unknown }}
    />
  ) : (
    <ProviderIcon provider={props.provider} className="size-3.5 shrink-0" />
  );
}

function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
}

export function UsageAnalyticsPanel() {
  const { t } = useTranslation();
  const app = analyticsAppName();
  const [range, setRange] = useState<UsageAnalyticsRange>("30d");
  const [metricChoice, setMetricChoice] = useState<UsageAnalyticsMetric | null>(null);
  const [scope, setScope] = useState<StatsUsageAnalyticsScope>("synara");
  const todayKey = localDayKey(new Date());
  // Recomputed once a day so the query keys stay stable within a day.
  const windows = useMemo(() => {
    const noon = new Date(`${todayKey}T12:00:00`);
    return new Map(RANGES.map((option) => [option, usageAnalyticsWindow(option, noon)]));
  }, [todayKey]);
  const window = windows.get(range) ?? usageAnalyticsWindow(range, new Date());
  const query = useQuery(serverUsageAnalyticsQueryOptions(analyticsRequest(window, scope)));
  // While a new period loads, the previous result stays on screen with its own
  // window, so its numbers are never laid over the new period's days.
  const data = query.data;
  const dataWindow = useMemo(() => {
    if (!data) return window;
    return (
      [...windows.values()].find((candidate) => {
        const request = analyticsRequest(candidate, data.scope);
        return request.from === data.from && request.to === data.to;
      }) ?? window
    );
  }, [data, window, windows]);
  const view = useMemo(
    () => (data ? buildUsageAnalyticsView(data, dataWindow) : null),
    [data, dataWindow],
  );
  const loadingNewPeriod = query.isPlaceholderData;
  const metric: UsageAnalyticsMetric =
    metricChoice ?? (view && view.totals.costUsd > 0 ? "cost" : "tokens");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedPicker<UsageAnalyticsMetric>
            ariaLabel={t("lattice:usageAnalyticsMetric")}
            className="w-44"
            value={metric}
            onValueChange={setMetricChoice}
            options={[
              { value: "cost", label: t("lattice:usageAnalyticsCost") },
              { value: "tokens", label: t("lattice:usageAnalyticsTokens") },
            ]}
          />
          <SegmentedPicker<UsageAnalyticsRange>
            ariaLabel={t("lattice:usageAnalyticsPeriod")}
            className="w-60"
            value={range}
            onValueChange={setRange}
            options={[
              { value: "7d", label: t("lattice:usageAnalyticsRange7d") },
              { value: "30d", label: t("lattice:usageAnalyticsRange30d") },
              { value: "90d", label: t("lattice:usageAnalyticsRange90d") },
              { value: "1y", label: t("lattice:usageAnalyticsRange1y") },
            ]}
          />
        </div>
        <SegmentedPicker<StatsUsageAnalyticsScope>
          ariaLabel={t("lattice:usageAnalyticsScope")}
          className="w-52"
          value={scope}
          onValueChange={setScope}
          options={[
            { value: "synara", label: t("lattice:usageAnalyticsScopeInApp", { app }) },
            { value: "mac", label: t("lattice:usageAnalyticsScopeThisMac") },
          ]}
        />
      </div>
      {query.isError && !view ? (
        <SettingsCard>
          <SettingsListRow
            title={t("lattice:usageAnalyticsLoadFailed")}
            actions={
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                {t("lattice:usageAnalyticsTryAgain")}
              </Button>
            }
          />
        </SettingsCard>
      ) : !view ? (
        <SettingsCard>
          <SettingsListRow title={t("lattice:usageAnalyticsLoading")} />
        </SettingsCard>
      ) : view.totals.tokens === 0 && view.totals.costUsd === 0 && view.totals.turns === 0 ? (
        <SettingsCard>
          <SettingsListRow
            title={t("lattice:usageAnalyticsEmptyTitle")}
            description={
              scope === "mac"
                ? t("lattice:usageAnalyticsEmptyMac", { app })
                : t("lattice:usageAnalyticsEmptyApp", { app })
            }
          />
        </SettingsCard>
      ) : (
        <div
          aria-busy={loadingNewPeriod}
          className={cn("transition-opacity duration-150", loadingNewPeriod && "opacity-50")}
        >
          <UsageAnalyticsBody view={view} metric={metric} rangeDays={dataWindow.days.length} />
        </div>
      )}
    </div>
  );
}

function UsageAnalyticsBody(props: {
  view: UsageAnalyticsView;
  metric: UsageAnalyticsMetric;
  rangeDays: number;
}) {
  const { view, metric } = props;
  const { t, formatLocale } = useTranslation();
  const app = analyticsAppName();
  const [hidden, setHidden] = useState<ReadonlySet<UsageAnalyticsProvider>>(() => new Set());
  const format = metric === "cost" ? formatUsdShort : formatTokens;
  const valueOf = (amount: { tokens: number; costUsd: number }) =>
    metric === "cost" ? amount.costUsd : amount.tokens;
  const total = valueOf(view.totals);
  const providers = view.providers.filter((provider) => valueOf(provider) > 0);
  const legendProviders = providers.map((provider) => provider.provider);
  const seriesProviders = legendProviders.filter((provider) => !hidden.has(provider));
  const toggleProvider = (provider: UsageAnalyticsProvider) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  const legend = (
    <ChartLegend providers={legendProviders} hidden={hidden} onToggle={toggleProvider} />
  );
  const peakDay = view.days.reduce<(typeof view.days)[number] | null>(
    (best, day) => (!best || valueOf(day) > valueOf(best) ? day : best),
    null,
  );
  const weekdays = view.days.filter((day) => day.date.getDay() !== 0 && day.date.getDay() !== 6);
  const weekdayAverage = weekdays.length
    ? weekdays.reduce((sum, day) => sum + valueOf(day), 0) / weekdays.length
    : 0;
  const providerNames = (source: UsageAnalyticsProviderTotal["costSource"]) =>
    view.providers
      .filter(
        (provider) =>
          provider.costSource === source &&
          (provider.tokens > 0 || provider.costUsd > 0) &&
          provider.provider !== "unknown",
      )
      .map((provider) => providerLabel(provider.provider));
  const reportedNames = providerNames("reported");
  const estimatedNames = providerNames("estimated");
  // Providers with unpriced tokens are explained by the notes about those tokens.
  const tokenOnlyNames = view.providers
    .filter(
      (provider) =>
        provider.costSource === null &&
        provider.tokens > 0 &&
        provider.provider !== "unknown" &&
        !view.unpriced.providers.has(provider.provider),
    )
    .map((provider) => providerLabel(provider.provider));
  const pricesUpdated = view.pricing.fetchedAt
    ? new Date(view.pricing.fetchedAt).toLocaleDateString(formatLocale, {
        month: "short",
        day: "numeric",
      })
    : null;
  const originTotal = view.origins.user + view.origins.automation + view.origins.agent;
  // Ranked by the metric on screen, so "Cost" shows the most expensive first.
  const byMetric = <T extends { tokens: number; costUsd: number }>(left: T, right: T) =>
    valueOf(right) - valueOf(left) || right.tokens - left.tokens;
  const models = view.models.toSorted(byMetric);
  const projects = view.projects.filter((project) => valueOf(project) > 0).toSorted(byMetric);
  const modelMax = Math.max(1, ...models.map((model) => valueOf(model)));
  const projectTotal = projects.reduce((sum, project) => sum + valueOf(project), 0);

  return (
    // Layout follows the settings column, not the window: the sidebar takes a
    // varying share of the window.
    <div className="@container flex flex-col gap-12">
      <section className="flex flex-col gap-6">
        <div className="flex flex-col gap-8 @3xl:flex-row @3xl:gap-10">
          <div className="flex flex-col gap-1.5 @3xl:w-60 @3xl:shrink-0">
            <span className="text-ui-sm tracking-wide text-muted-foreground uppercase">
              {metric === "cost"
                ? t("lattice:usageAnalyticsApiCost")
                : t("lattice:usageAnalyticsTokensProcessed")}
            </span>
            <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
              {metric === "cost" ? formatUsd(total) : formatNumber(total)}
            </span>
            <ChangeLabel
              change={
                // Claude Code deletes old session files, so an earlier period on
                // this Mac can look emptier than it was.
                view.scope === "mac"
                  ? null
                  : percentChange(total, view.previous ? valueOf(view.previous) : null)
              }
            />
            <span className="text-ui-sm text-muted-foreground">
              {metric === "cost"
                ? t("lattice:usageAnalyticsAtApiRates")
                : t("lattice:usageAnalyticsReadFromCache", {
                    tokens: formatTokens(view.totals.cacheReadTokens),
                  })}
            </span>
            <ul className="mt-4 flex flex-col gap-3.5">
              {providers.map((provider) => (
                <ModelUsageRow
                  key={provider.provider}
                  icon={<ProviderMark provider={provider.provider} />}
                  model={providerLabel(provider.provider)}
                  detail={t("lattice:usageAnalyticsTurnCount", {
                    count: provider.turns,
                    turns: formatNumber(provider.turns),
                  })}
                  percent={percentOf(valueOf(provider), total)}
                  stat={`${format(valueOf(provider))} · ${percentOf(valueOf(provider), total)}%`}
                  barColor={PROVIDER_SERIES_COLOR[provider.provider]}
                />
              ))}
            </ul>
          </div>
          <div className="@container/daily flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-ui font-semibold text-foreground">
                {metric === "cost"
                  ? t("lattice:usageAnalyticsDailyCost")
                  : t("lattice:usageAnalyticsDailyTokens")}
              </span>
              {legend}
            </div>
            <DailyBarChart
              days={view.days}
              providers={seriesProviders}
              metric={metric}
              format={format}
              width={540}
              height={200}
            />
            <dl className="grid gap-x-6 gap-y-1.5 border-t pt-3 @md/daily:grid-cols-3">
              <InsightRow
                label={t("lattice:usageAnalyticsPeakDay")}
                value={
                  peakDay && valueOf(peakDay) > 0
                    ? `${peakDay.date.toLocaleDateString(formatLocale, { month: "short", day: "numeric" })} · ${format(valueOf(peakDay))}`
                    : "—"
                }
              />
              <InsightRow
                label={t("lattice:usageAnalyticsWeekdayAverage")}
                value={format(weekdayAverage)}
              />
              <InsightRow
                label={t("lattice:usageAnalyticsActiveDays")}
                value={t("lattice:usageAnalyticsActiveDaysOf", {
                  active: view.activeDays,
                  total: props.rangeDays,
                })}
              />
            </dl>
          </div>
        </div>
        <StatTileGrid
          fitContainer
          tiles={[
            {
              label: t("lattice:usageAnalyticsProcessedTokens"),
              value: formatTokens(view.totals.tokens),
              detail: t("lattice:usageAnalyticsPerActiveDay", {
                tokens: formatTokens(view.activeDays ? view.totals.tokens / view.activeDays : 0),
              }),
            },
            {
              label: t("lattice:usageAnalyticsCacheReads"),
              value: formatTokens(view.totals.cacheReadTokens),
              detail: t("lattice:usageAnalyticsPercentOfTokens", {
                percent: percentOf(view.totals.cacheReadTokens, view.totals.tokens),
              }),
            },
            {
              label: t("lattice:usageAnalyticsTurns"),
              value: formatNumber(view.totals.turns),
              detail: t("lattice:usageAnalyticsEndedInError", {
                failed: formatNumber(view.totals.failedTurns),
              }),
            },
            {
              label: t("lattice:usageAnalyticsApiCost"),
              value: formatUsd(view.totals.costUsd),
              detail:
                view.totals.turns > 0
                  ? t("lattice:usageAnalyticsPerTurn", {
                      cost: formatUsd(view.totals.costUsd / view.totals.turns),
                    })
                  : t("lattice:usageAnalyticsNoTurns"),
            },
            {
              label: t("lattice:usageAnalyticsActiveDays"),
              value: `${view.activeDays}`,
              detail: t("lattice:usageAnalyticsOfDaysInPeriod", { days: props.rangeDays }),
            },
          ]}
        />
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle
          title={
            metric === "cost"
              ? t("lattice:usageAnalyticsCostByProvider")
              : t("lattice:usageAnalyticsTokensByProvider")
          }
          detail={t("lattice:usageAnalyticsProviderLinesDetail")}
          action={legend}
        />
        <ProviderLineChart
          days={view.days}
          providers={seriesProviders}
          metric={metric}
          format={format}
        />
      </section>

      <section className="flex flex-col gap-4">
        <SectionTitle
          title={t("lattice:usageAnalyticsModels")}
          detail={
            models[0]
              ? metric === "cost"
                ? t("lattice:usageAnalyticsModelCostMost", { model: models[0].model })
                : t("lattice:usageAnalyticsModelMostWork", { model: models[0].model })
              : t("lattice:usageAnalyticsNoModelActivity")
          }
        />
        <SettingsCard>
          <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_5rem] items-center gap-3 px-3 py-2 text-ui-sm text-muted-foreground @md:grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_5.5rem] @xl:grid-cols-[minmax(0,1fr)_4rem_5rem_6rem_6rem]">
            <span>{t("lattice:usageAnalyticsModel")}</span>
            <span className="hidden text-right @md:block">{t("lattice:usageAnalyticsTurns")}</span>
            <span className="text-right">{t("lattice:usageAnalyticsTokens")}</span>
            <span className="text-right">{t("lattice:usageAnalyticsCost")}</span>
            <span className="hidden @xl:block">{t("lattice:usageAnalyticsShare")}</span>
          </div>
          {models.slice(0, 12).map((model) => (
            <div
              key={`${model.provider}-${model.model}`}
              className="grid grid-cols-[minmax(0,1fr)_4.5rem_5rem] items-center gap-3 border-t px-3 py-2.5 text-ui @md:grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_5.5rem] @xl:grid-cols-[minmax(0,1fr)_4rem_5rem_6rem_6rem]"
            >
              <span className="flex min-w-0 items-center gap-2 text-foreground">
                <ProviderMark provider={model.provider} />
                <span className="truncate" title={model.model}>
                  {model.model}
                </span>
              </span>
              <span className="hidden text-right tabular-nums text-foreground @md:block">
                {formatNumber(model.turns)}
              </span>
              <span className="text-right tabular-nums text-foreground">
                {formatTokens(model.tokens)}
              </span>
              <span className="text-right tabular-nums text-muted-foreground">
                {model.costUsd > 0 ? formatUsd(model.costUsd) : "—"}
              </span>
              <span className="hidden @xl:block">
                <ShareBar
                  share={(valueOf(model) / modelMax) * 100}
                  color={PROVIDER_SERIES_COLOR[model.provider]}
                />
              </span>
            </div>
          ))}
        </SettingsCard>
      </section>

      <section className="grid gap-10 @3xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <SectionTitle
            title={t("lattice:usageAnalyticsProjects")}
            detail={t("lattice:usageAnalyticsProjectsDetail")}
          />
          <ul className="flex flex-col gap-3.5">
            {projects.slice(0, 8).map((project) => (
              <ModelUsageRow
                key={project.projectId ?? "chats"}
                icon={null}
                model={project.projectId ? project.title : t("lattice:usageAnalyticsChats")}
                {...(project.projectId
                  ? {}
                  : { detail: t("lattice:usageAnalyticsOutsideProjects") })}
                percent={percentOf(valueOf(project), projectTotal)}
                stat={`${format(valueOf(project))} · ${percentOf(valueOf(project), projectTotal)}%`}
                barColor="var(--foreground)"
              />
            ))}
          </ul>
        </div>
        {originTotal > 0 ? (
          <div className="flex flex-col gap-4">
            <SectionTitle
              title={t("lattice:usageAnalyticsWhoStarted")}
              detail={
                view.scope === "mac"
                  ? t("lattice:usageAnalyticsOriginDetailMac", { app })
                  : t("lattice:usageAnalyticsOriginDetail")
              }
            />
            <dl className="flex flex-col gap-2.5">
              {(
                [
                  ["user", t("lattice:usageAnalyticsOriginYou")],
                  ["agent", t("lattice:usageAnalyticsOriginAgents")],
                  ["automation", t("lattice:usageAnalyticsOriginAutomations")],
                ] as const
              ).map(([origin, label]) => (
                <InsightRow
                  key={origin}
                  label={label}
                  value={`${formatTokens(view.origins[origin])} · ${percentOf(view.origins[origin], originTotal)}%`}
                />
              ))}
            </dl>
          </div>
        ) : null}
      </section>

      <section className="grid gap-10 @3xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <SectionTitle
            title={t("lattice:usageAnalyticsWhenYouWork")}
            detail={t("lattice:usageAnalyticsWhenYouWorkDetail")}
          />
          <RhythmChart rhythm={view.rhythm} format={formatTokens} />
        </div>
        <div className="flex flex-col gap-4">
          <SectionTitle title={t("lattice:usageAnalyticsAbout")} />
          <ul className="flex list-disc flex-col gap-2 pl-4 text-ui text-muted-foreground marker:text-foreground/30">
            {aboutTheseNumbers({
              t,
              formatLocale,
              app,
              view,
              reportedNames,
              estimatedNames,
              tokenOnlyNames,
              pricesUpdated,
            }).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

/** The notes under "About these numbers", each one sentence in the interface language. */
function aboutTheseNumbers(input: {
  t: typeof translateFn;
  formatLocale: string;
  app: string;
  view: UsageAnalyticsView;
  reportedNames: ReadonlyArray<string>;
  estimatedNames: ReadonlyArray<string>;
  tokenOnlyNames: ReadonlyArray<string>;
  pricesUpdated: string | null;
}): string[] {
  const { t, formatLocale, app, view } = input;
  const names = (list: ReadonlyArray<string>) => joinNames(list, formatLocale);
  const notes = [t("lattice:usageAnalyticsNoteApiRates")];
  if (input.reportedNames.length > 0) {
    notes.push(t("lattice:usageAnalyticsNoteReported", { providers: names(input.reportedNames) }));
  }
  if (input.estimatedNames.length > 0) {
    notes.push(
      input.pricesUpdated
        ? t("lattice:usageAnalyticsNoteEstimatedUpdated", {
            providers: names(input.estimatedNames),
            date: input.pricesUpdated,
          })
        : t("lattice:usageAnalyticsNoteEstimated", { providers: names(input.estimatedNames) }),
    );
  }
  if (view.unpriced.tokens > 0) {
    const tokens = formatTokens(view.unpriced.tokens);
    notes.push(
      view.pricing.status === "unavailable"
        ? t("lattice:usageAnalyticsNotePricesUnavailable", { tokens })
        : t("lattice:usageAnalyticsNoteUnpricedModels", {
            count: Math.max(1, view.unpriced.models.length),
            models:
              view.unpriced.models.length > 0
                ? names(view.unpriced.models)
                : t("lattice:usageAnalyticsSomeModels"),
            tokens,
          }),
    );
  }
  if (view.unpriced.unsplitTokens > 0) {
    notes.push(
      t("lattice:usageAnalyticsNoteUnsplit", { tokens: formatTokens(view.unpriced.unsplitTokens) }),
    );
  }
  if (input.tokenOnlyNames.length > 0) {
    notes.push(
      t("lattice:usageAnalyticsNoteTokenOnly", { providers: names(input.tokenOnlyNames) }),
    );
  }
  if (view.unavailableProviders.length > 0) {
    notes.push(
      t("lattice:usageAnalyticsNoteNoUsageReported", {
        providers: names(view.unavailableProviders.map((provider) => providerLabel(provider))),
      }),
    );
  }
  notes.push(
    view.scope === "mac" && view.sessionFileProviders.length > 0
      ? t("lattice:usageAnalyticsNoteSessionFiles", {
          providers: names(view.sessionFileProviders.map((provider) => providerLabel(provider))),
          app,
        })
      : t("lattice:usageAnalyticsNoteAppOnly", { app }),
  );
  if (view.scope === "mac" && view.sessionFileProviders.includes("claudeAgent")) {
    notes.push(t("lattice:usageAnalyticsNoteClaudeRetention"));
  }
  return notes;
}
