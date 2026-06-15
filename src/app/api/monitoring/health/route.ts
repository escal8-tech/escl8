import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/monitoring/health - Overall system health check
 */
export async function GET(request: NextRequest) {
  const checks = {
    timestamp: new Date().toISOString(),
    services: {} as Record<string, { status: 'healthy' | 'degraded' | 'down'; latencyMs?: number; message?: string }>,
    overall: 'healthy' as 'healthy' | 'degraded' | 'down',
  };

  // Check control database
  const dbStart = Date.now();
  try {
    const { queryRows } = await import('@/lib/db');
    const probe = await queryRows('control', 'SELECT 1');
    if (probe.length === 0) {
      throw new Error('Control DB pool not configured');
    }
    checks.services.controlDatabase = { status: 'healthy', latencyMs: Date.now() - dbStart };
  } catch (error) {
    console.error('[health] controlDatabase check failed:', error);
    checks.services.controlDatabase = { status: 'down', latencyMs: Date.now() - dbStart, message: 'Control DB check failed' };
    checks.overall = 'down';
  }

  // Check agent database
  const agentDbStart = Date.now();
  try {
    const { queryRows } = await import('@/lib/db');
    const probe = await queryRows('agent', 'SELECT 1');
    if (probe.length === 0) {
      throw new Error('Agent DB pool not configured');
    }
    checks.services.agentDatabase = { status: 'healthy', latencyMs: Date.now() - agentDbStart };
  } catch (error) {
    console.error('[health] agentDatabase check failed:', error);
    checks.services.agentDatabase = { status: 'down', latencyMs: Date.now() - agentDbStart, message: 'Agent DB check failed' };
    checks.overall = 'down';
  }

  // Check SenangPay config
  const senangPayConfigured = Boolean(process.env.SENANGPAY_SECRET_KEY && process.env.SENANGPAY_MERCHANT_ID);
  checks.services.senangPay = {
    status: senangPayConfigured ? 'healthy' : 'degraded',
    message: senangPayConfigured ? 'SenangPay credentials configured' : 'SenangPay credentials missing',
  };
  if (checks.overall === 'healthy' && checks.services.senangPay.status === 'degraded') {
    checks.overall = 'degraded';
  }

  // Check JWT config
  checks.services.jwt = {
    status: process.env.JWT_SECRET ? 'healthy' : 'down',
    message: process.env.JWT_SECRET ? 'JWT secret configured' : 'JWT secret missing',
  };
  if (!process.env.JWT_SECRET) checks.overall = 'down';

  // Webhook replay stats
  try {
    const { webhookReplayStore } = await import('@/lib/webhook-replay');
    const stats = await webhookReplayStore.getStats();
    checks.services.webhookReplay = {
      status: 'healthy',
      message: `${stats.total} tracked, ${stats.successful} successful, ${stats.pending} pending`,
    };
  } catch {
    checks.services.webhookReplay = { status: 'degraded', message: 'Replay store not available' };
    if (checks.overall === 'healthy') checks.overall = 'degraded';
  }

  const statusCode = checks.overall === 'healthy' ? 200 : checks.overall === 'degraded' ? 200 : 503;
  return NextResponse.json(checks, { status: statusCode });
}
