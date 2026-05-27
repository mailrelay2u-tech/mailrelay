import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ok: true, service: 'mailrelay', time: new Date().toISOString() })
}

export async function POST() {
  return GET()
}
