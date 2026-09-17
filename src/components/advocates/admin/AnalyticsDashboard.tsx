import type {
  AdvocateAnalyticsCell,
  AdvocateAnalyticsCurrency,
  AdvocateAnalyticsOriginalCurrency,
  AdvocateAnalyticsSegment,
  AdvocateAnalyticsSegmentKey,
  AdvocateAnalyticsSnapshot,
  VisibleAdvocateAnalyticsCell,
} from "@/lib/advocates/admin/analytics"

const SEGMENT_LABELS: Readonly<Record<AdvocateAnalyticsSegmentKey, string>> =
  Object.freeze({
    direct: "Direct sponsorships",
    post_visit_0_1_day: "Post visit, within 1 day",
    post_visit_1_7_days: "Post visit, after 1 day through 7 days",
    post_visit_7_30_days: "Post visit, after 7 days through 30 days",
    observed_30_365_days: "Observed, after 30 days through 365 days",
  })

const CURRENCY_SYMBOLS: Readonly<Record<AdvocateAnalyticsCurrency, string>> =
  Object.freeze({
    AUD: "A$",
    EUR: "€",
    GBP: "£",
    USD: "$",
  })

export function formatAnalyticsMinorAmount(
  amountMinor: number,
  currency: AdvocateAnalyticsCurrency,
): string {
  const whole = Math.floor(amountMinor / 100)
  const fraction = amountMinor % 100
  return `${CURRENCY_SYMBOLS[currency]}${whole.toLocaleString("en-US")}.${fraction
    .toString()
    .padStart(2, "0")} ${currency}`
}

export function formatAnalyticsAsOf(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value))
}

function SuppressedCell({ minimum }: { minimum: number }) {
  return (
    <div
      role="status"
      className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
    >
      This summary remains private until it includes at least {minimum} sponsor
      contacts.
    </div>
  )
}

function WithheldValue() {
  return (
    <span
      aria-label="Withheld for privacy"
      className="font-medium text-gray-600"
    >
      Withheld
    </span>
  )
}

function CountValue({ value }: { value: number | null }) {
  return value === null ? (
    <WithheldValue />
  ) : (
    <>{value.toLocaleString("en-US")}</>
  )
}

function MoneyValue({
  value,
  currency = "USD",
}: {
  value: number | null
  currency?: AdvocateAnalyticsCurrency
}) {
  return value === null ? (
    <WithheldValue />
  ) : (
    <>{formatAnalyticsMinorAmount(value, currency)}</>
  )
}

function SummaryValues({ cell }: { cell: VisibleAdvocateAnalyticsCell }) {
  const values = [
    { label: "Sponsorships", value: cell.sponsorships, kind: "count" },
    {
      label: "Unique sponsor contacts",
      value: cell.uniqueSponsorContacts,
      kind: "count",
    },
    {
      label: "Verified sponsor accounts",
      value: cell.verifiedSponsorAccounts,
      kind: "count",
    },
    {
      label: "Initial collected",
      value: cell.initialCollectedUsdCents,
      kind: "money",
    },
    {
      label: "Renewal collected",
      value: cell.renewalCollectedUsdCents,
      kind: "money",
    },
    {
      label: "Gross collected",
      value: cell.grossCollectedUsdCents,
      kind: "money",
    },
    {
      label: "Refunds and reversals",
      value: cell.refundsAndReversalsUsdCents,
      kind: "money",
    },
    {
      label: "Dispute funds withdrawn",
      value: cell.disputeDebitsUsdCents,
      kind: "money",
    },
    {
      label: "Dispute funds reinstated",
      value: cell.disputeCreditsUsdCents,
      kind: "money",
    },
    {
      label: "Net collected",
      value: cell.netCollectedUsdCents,
      kind: "money",
    },
    {
      label: "Active monthly commitment",
      value: cell.activeMonthlyCommitmentUsdCents,
      kind: "money",
    },
    {
      label: "Active annual commitment",
      value: cell.activeAnnualCommitmentUsdCents,
      kind: "money",
    },
    {
      label: "Annualized commitment projection",
      value: cell.annualizedCommitmentUsdCents,
      kind: "money",
    },
  ] as const

  return (
    <dl className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2">
      {values.map((item) => (
        <div key={item.label} className="border-t border-gray-100 pt-3">
          <dt className="text-sm text-gray-600">{item.label}</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-gray-950">
            {item.kind === "count" ? (
              <CountValue value={item.value} />
            ) : (
              <MoneyValue value={item.value} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function SummaryCard({
  title,
  description,
  cell,
  minimum,
}: {
  title: string
  description: string
  cell: AdvocateAnalyticsCell
  minimum: number
}) {
  return (
    <section
      aria-labelledby={`analytics-${title.toLowerCase().replaceAll(" ", "-")}`}
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h3
        id={`analytics-${title.toLowerCase().replaceAll(" ", "-")}`}
        className="text-xl font-bold text-gray-950"
      >
        {title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-gray-600">{description}</p>
      {cell.suppressed ? (
        <SuppressedCell minimum={minimum} />
      ) : (
        <SummaryValues cell={cell} />
      )}
    </section>
  )
}

function SegmentsTable({
  segments,
  minimum,
}: {
  segments: readonly AdvocateAnalyticsSegment[] | null
  minimum: number
}) {
  return (
    <section
      aria-labelledby="analytics-attribution-heading"
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h3
        id="analytics-attribution-heading"
        className="text-xl font-bold text-gray-950"
      >
        Attribution timing
      </h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
        These groups are mutually exclusive. Direct sponsorships begin on this
        portal. Post visit sponsorships begin later on the primary Creator Share
        site. Observed outcomes are shown separately and are not official
        attributed funds.
      </p>

      {segments === null ? (
        <div
          role="status"
          className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
        >
          The complete timing breakdown remains private because at least one
          group has fewer than {minimum} sponsor contacts. Hiding the entire
          breakdown prevents subtraction from revealing a smaller group.
        </div>
      ) : (
        <div
          role="region"
          aria-label="Attribution timing table"
          tabIndex={0}
          className="mt-5 overflow-x-auto rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          <table className="w-full min-w-[660px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Sponsorship outcomes by mutually exclusive attribution timing
            </caption>
            <thead>
              <tr className="border-b border-gray-200 text-gray-600">
                <th scope="col" className="px-3 py-3 font-semibold">
                  Timing
                </th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">
                  Sponsorships
                </th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">
                  Sponsor contacts
                </th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">
                  Gross USD
                </th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">
                  Net USD
                </th>
              </tr>
            </thead>
            <tbody>
              {segments.map((segment) => (
                <SegmentRow key={segment.key} segment={segment} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function SegmentRow({ segment }: { segment: AdvocateAnalyticsSegment }) {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <th scope="row" className="px-3 py-4 font-medium text-gray-900">
        {SEGMENT_LABELS[segment.key]}
      </th>
      <td className="px-3 py-4 text-right tabular-nums">
        {segment.sponsorships.toLocaleString("en-US")}
      </td>
      <td className="px-3 py-4 text-right tabular-nums">
        {segment.uniqueSponsorContacts.toLocaleString("en-US")}
      </td>
      <td className="px-3 py-4 text-right tabular-nums">
        <MoneyValue value={segment.grossCollectedUsdCents} />
      </td>
      <td className="px-3 py-4 text-right font-semibold tabular-nums">
        <MoneyValue value={segment.netCollectedUsdCents} />
      </td>
    </tr>
  )
}

function OriginalCurrencyTable({
  currencies,
  minimum,
}: {
  currencies: readonly AdvocateAnalyticsOriginalCurrency[] | null
  minimum: number
}) {
  return (
    <section
      aria-labelledby="analytics-currency-heading"
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <h3
        id="analytics-currency-heading"
        className="text-xl font-bold text-gray-950"
      >
        Original currency detail
      </h3>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
        These values preserve the currency charged by the payment provider.
        Normalized USD summaries above use the conversion evidence recorded at
        transaction time.
      </p>

      {currencies === null ? (
        <div
          role="status"
          className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
        >
          The currency breakdown remains private because at least one currency
          group has fewer than {minimum} sponsor contacts.
        </div>
      ) : currencies.length === 0 ? (
        <p className="mt-5 text-sm text-gray-600">
          No collected sponsorship funds are available yet.
        </p>
      ) : (
        <div
          role="region"
          aria-label="Original currency detail table"
          tabIndex={0}
          className="mt-5 overflow-x-auto rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <caption className="sr-only">
              Collected sponsorship funds in their original currencies
            </caption>
            <thead>
              <tr className="border-b border-gray-200 text-gray-600">
                <th scope="col" className="px-3 py-3 font-semibold">
                  Currency
                </th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">
                  Sponsorships
                </th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">
                  Contacts
                </th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">
                  Initial
                </th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">
                  Renewals
                </th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">
                  Gross
                </th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">
                  Net
                </th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((currency) => (
                <CurrencyRow key={currency.currency} cell={currency} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function CurrencyRow({ cell }: { cell: AdvocateAnalyticsOriginalCurrency }) {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <th scope="row" className="px-3 py-4 font-medium text-gray-900">
        {cell.currency}
      </th>
      <td className="px-3 py-4 text-right tabular-nums">
        {cell.sponsorships.toLocaleString("en-US")}
      </td>
      <td className="px-3 py-4 text-right tabular-nums">
        {cell.uniqueSponsorContacts.toLocaleString("en-US")}
      </td>
      <td className="px-3 py-4 text-right tabular-nums">
        {formatAnalyticsMinorAmount(cell.initialCollectedMinor, cell.currency)}
      </td>
      <td className="px-3 py-4 text-right tabular-nums">
        <MoneyValue
          value={cell.renewalCollectedMinor}
          currency={cell.currency}
        />
      </td>
      <td className="px-3 py-4 text-right tabular-nums">
        <MoneyValue value={cell.grossCollectedMinor} currency={cell.currency} />
      </td>
      <td className="px-3 py-4 text-right font-semibold tabular-nums">
        <MoneyValue value={cell.netCollectedMinor} currency={cell.currency} />
      </td>
    </tr>
  )
}

export function AnalyticsDashboard({
  advocateName,
  snapshot,
}: {
  advocateName: string
  snapshot: AdvocateAnalyticsSnapshot
}) {
  const minimum = snapshot.methodology.minimumSponsorContactsPerCell

  return (
    <div className="grid gap-6">
      <section
        aria-labelledby="advocate-analytics-heading"
        className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">
          Private portal analytics
        </p>
        <h2
          id="advocate-analytics-heading"
          className="mt-2 text-2xl font-bold text-gray-950 sm:text-3xl"
        >
          Sponsorship impact for {advocateName}
        </h2>
        <p className="mt-3 max-w-3xl leading-7 text-gray-600">
          Payment backed outcomes are reported without sponsor identities,
          contact information, browsing histories, or exact event times.
          Renewals increase collected funds, but never sponsor or sponsorship
          counts.
        </p>
        <p className="mt-3 text-sm text-gray-500">
          Data cutoff: {formatAnalyticsAsOf(snapshot.asOf)} at 12:00 AM UTC.
          Activity on or after this cutoff is not included.
        </p>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <SummaryCard
          title="Official attribution"
          description="Direct sponsorships and post visit sponsorships started within 30 days of a qualifying portal visit."
          cell={snapshot.official}
          minimum={minimum}
        />
        <SummaryCard
          title="Observed outcomes"
          description="Sponsorships created after 30 days through 365 days. These are observations, not official attributed funds."
          cell={snapshot.observed}
          minimum={minimum}
        />
      </div>

      <SegmentsTable segments={snapshot.segments} minimum={minimum} />
      <OriginalCurrencyTable
        currencies={snapshot.originalCurrency}
        minimum={minimum}
      />

      <aside
        aria-labelledby="analytics-methodology-heading"
        className="rounded-xl border border-blue-100 bg-blue-50 p-5 text-sm text-blue-950 sm:p-6"
      >
        <h3 id="analytics-methodology-heading" className="font-bold">
          How to read these numbers
        </h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 leading-6">
          <li>
            Unique sponsor contacts are based on normalized email contact keys.
            They are not a claim about a precise number of people.
          </li>
          <li>
            Verified sponsor accounts are reported separately from sponsor
            contacts.
          </li>
          <li>
            Groups with fewer than {minimum} sponsor contacts are suppressed,
            along with related breakdowns that could reveal them by subtraction.
          </li>
          <li>
            A value marked Withheld has fewer than {minimum} contributing
            sponsor contacts, or is hidden because arithmetic could reveal a
            smaller contributing group. Other values in the same summary may
            remain available.
          </li>
          <li>
            Canceled sponsorships retain collected history. Monthly and annual
            commitments reflect the stated cutoff. The annualized commitment is
            a projection, not collected funds.
          </li>
        </ul>
      </aside>
    </div>
  )
}
