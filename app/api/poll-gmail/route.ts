import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { pollAndForward } from '@/lib/gmail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface GmailAccount {
  id: string
  email: string
  app_password_encrypted: string
  last_polled_at: string | null
}

interface RuleRow {
  id: string
  name: string
  from_filter: string | null
  subject_filter: string | null
  rule_recipients?: Array<{ recipients: { email: string } | Array<{ email: string }> | null } | null>
}

interface AccountPollResult {
  accountId: string
  email: string
  status: 'ok' | 'auth_error' | 'imap_error' | 'send_error'
  forwarded: number
  error?: string
}

interface PollSummary {
  ok: boolean
  startedAt: string
  finishedAt: string
  accounts: number
  forwarded: number
  results: AccountPollResult[]
  error?: string
}

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>

let activePoll: Promise<PollSummary> | null = null
let lastPollSummary: PollSummary | null = null

async function runPoll(): Promise<PollSummary> {
  const startedAt = new Date().toISOString()
  const results: AccountPollResult[] = []

  try {
    requireEnv('NEXT_PUBLIC_SUPABASE_URL')
    requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    requireEnv('ENCRYPTION_SECRET')
    requireEnv('BREVO_API_KEY')
    requireEnv('BREVO_FROM_EMAIL')

    const supabase = await createServiceClient()

    const { data: accounts, error } = await supabase
      .from('gmail_accounts')
      .select('id, email, app_password_encrypted, last_polled_at')
      .eq('active', true)

    if (error) throw new Error(`Could not load Gmail accounts: ${error.message}`)

    const gmailAccounts = (accounts ?? []) as GmailAccount[]
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const concurrency = getPositiveInteger(process.env.POLL_ACCOUNT_CONCURRENCY, 3)

    results.push(...await mapWithConcurrency(
      gmailAccounts,
      concurrency,
      account => pollAccount(supabase, account, since7d)
    ))

    const finishedAt = new Date().toISOString()
    const summary: PollSummary = {
      ok: results.every(result => result.status === 'ok'),
      startedAt,
      finishedAt,
      accounts: gmailAccounts.length,
      forwarded: results.reduce((total, result) => total + result.forwarded, 0),
      results,
    }

    await writePollState(summary)
    return summary
  } catch (err: unknown) {
    const summary: PollSummary = {
      ok: false,
      startedAt,
      finishedAt: new Date().toISOString(),
      accounts: results.length,
      forwarded: results.reduce((total, result) => total + result.forwarded, 0),
      results,
      error: errorMessage(err),
    }

    await writePollState(summary).catch(() => {})
    return summary
  }
}

async function pollAccount(
  supabase: ServiceClient,
  account: GmailAccount,
  since7d: Date
): Promise<AccountPollResult> {
  try {
    const { data: rules, error: rulesError } = await supabase
      .from('rules')
      .select('id, name, from_filter, subject_filter, account_id, rule_recipients(recipients(email))')
      .eq('account_id', account.id)
      .eq('active', true)

    if (rulesError) throw new Error(`Could not load rules: ${rulesError.message}`)

    const { data: recentLogs, error: logsError } = await supabase
      .from('forwarded_log')
      .select('message_id')
      .eq('account_id', account.id)
      .gte('forwarded_at', since7d.toISOString())
      .not('message_id', 'is', null)

    if (logsError) throw new Error(`Could not load forwarded log: ${logsError.message}`)

    const alreadyForwarded = new Set<string>(
      (recentLogs ?? []).map((l: { message_id: string }) => l.message_id).filter(Boolean)
    )

    const formattedRules = ((rules ?? []) as unknown as RuleRow[]).map(rule => ({
      id: rule.id,
      name: rule.name,
      from_filter: rule.from_filter,
      subject_filter: rule.subject_filter,
      recipients: getRecipientEmails(rule.rule_recipients),
    }))

    const sinceDate = getSinceDate(account.last_polled_at)
    const forwarded = await pollAndForward(account, formattedRules, sinceDate, alreadyForwarded)

    if (forwarded.length > 0) {
      const { error: insertError } = await supabase.from('forwarded_log').insert(
        forwarded.map(result => ({
          account_id: account.id,
          subject: result.subject,
          from_address: result.from,
          forwarded_to: result.recipients,
          rule_matched: result.ruleName,
          message_id: result.messageId,
        }))
      )

      if (insertError) throw new Error(`Could not write forwarded log: ${insertError.message}`)
    }

    await supabase.from('gmail_accounts').update({
      last_polled_at: new Date().toISOString(),
      last_poll_status: 'ok',
    }).eq('id', account.id)

    return {
      accountId: account.id,
      email: account.email,
      status: 'ok',
      forwarded: forwarded.length,
    }
  } catch (err: unknown) {
    const msg = errorMessage(err)
    const status = classifyPollError(msg)

    await supabase.from('gmail_accounts').update({
      last_poll_status: `${status}: ${msg.slice(0, 200)}`,
    }).eq('id', account.id)

    return {
      accountId: account.id,
      email: account.email,
      status,
      forwarded: 0,
      error: msg,
    }
  }
}

function startPoll() {
  if (activePoll) return { started: false, promise: activePoll }

  activePoll = runPoll()
    .then(summary => {
      lastPollSummary = summary
      return summary
    })
    .catch(err => {
      const summary: PollSummary = {
        ok: false,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        accounts: 0,
        forwarded: 0,
        results: [],
        error: errorMessage(err),
      }
      lastPollSummary = summary
      console.error('poll-gmail failed', err)
      return summary
    })
    .finally(() => {
      activePoll = null
    })

  return { started: true, promise: activePoll }
}

async function writePollState(summary: PollSummary) {
  const supabase = await createServiceClient()
  await supabase.from('app_state').upsert([
    { key: 'last_checked', value: summary.finishedAt },
    { key: 'last_poll_summary', value: JSON.stringify(summary) },
  ])
}

function getSinceDate(lastPolledAt: string | null) {
  const configuredMinutes = Number(process.env.POLL_MAX_LOOKBACK_MINUTES ?? 24 * 60)
  const maxLookbackMinutes = Number.isFinite(configuredMinutes) ? configuredMinutes : 24 * 60
  const maxLookback = new Date(Date.now() - Math.max(maxLookbackMinutes, 1) * 60 * 1000)

  if (!lastPolledAt) return maxLookback

  const lastPoll = new Date(lastPolledAt)
  if (Number.isNaN(lastPoll.getTime())) return maxLookback

  return new Date(Math.max(lastPoll.getTime(), maxLookback.getTime()))
}

function getRecipientEmails(ruleRecipients: RuleRow['rule_recipients']) {
  return (ruleRecipients ?? [])
    .flatMap(rr => {
      const recipients = rr?.recipients
      if (!recipients) return []
      return Array.isArray(recipients) ? recipients.map(recipient => recipient.email) : [recipients.email]
    })
    .filter((email): email is string => Boolean(email))
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
) {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(Math.max(concurrency, 1), items.length)

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await fn(items[index])
    }
  }))

  return results
}

function getPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.floor(parsed)
}

function classifyPollError(message: string): AccountPollResult['status'] {
  const lower = message.toLowerCase()
  if (
    lower.includes('authenticationfailed') ||
    lower.includes('invalid credentials') ||
    lower.includes('auth') ||
    lower.includes('login')
  ) {
    return 'auth_error'
  }

  if (
    lower.includes('brevo send failed') ||
    lower.includes('missing environment variable: brevo') ||
    lower.includes('missing email recipient')
  ) {
    return 'send_error'
  }

  return 'imap_error'
}

function isAuthorized(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false

  const querySecret = req.nextUrl.searchParams.get('secret')
  const headerSecret = req.headers.get('x-cron-secret')
  const bearerSecret = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')

  return querySecret === expected || headerSecret === expected || bearerSecret === expected
}

function shouldWait(req: NextRequest) {
  const wait = req.nextUrl.searchParams.get('wait')?.toLowerCase()
  return wait === '1' || wait === 'true' || wait === 'yes'
}

function requireEnv(name: string) {
  if (!process.env[name]) throw new Error(`Missing environment variable: ${name}`)
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (req.nextUrl.searchParams.get('status') === '1') {
    return NextResponse.json({
      ok: true,
      running: Boolean(activePoll),
      lastPollSummary,
    })
  }

  const { started, promise } = startPoll()

  if (shouldWait(req)) {
    const summary = await promise
    return NextResponse.json(
      { ok: summary.ok, started, running: false, summary },
      { status: summary.ok ? 200 : 500 }
    )
  }

  return NextResponse.json(
    {
      ok: true,
      started,
      running: true,
      lastPollSummary,
    },
    { status: started ? 202 : 200 }
  )
}

export async function POST(req: NextRequest) {
  return GET(req)
}
