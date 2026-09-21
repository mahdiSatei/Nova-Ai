import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { FakeZibalScenario, FakeZibalStore } from './fake-zibal.store';

export const FAKE_ZIBAL_SCENARIOS: FakeZibalScenario[] = [
  'success',
  'fail',
  'cancel',
  'timeout',
  'amount_mismatch',
  'verify_unavailable',
];

/**
 * Test/dev-only surface. Not part of Zibal's contract, hence the `__test__`
 * prefix, which also keeps it obviously out of the OpenAPI document.
 */
@Controller('__test__/transactions')
export class FakeZibalAdminController {
  constructor(private readonly store: FakeZibalStore) {}

  @Put(':trackId/scenario')
  @HttpCode(204)
  setScenario(@Param('trackId') trackId: string, @Body() body: { scenario?: string }): void {
    const scenario = body?.scenario as FakeZibalScenario | undefined;
    if (!scenario || !FAKE_ZIBAL_SCENARIOS.includes(scenario)) {
      throw new BadRequestException(
        `scenario must be one of ${FAKE_ZIBAL_SCENARIOS.join(', ')}`,
      );
    }
    if (!this.store.setScenario(trackId, scenario)) {
      throw new NotFoundException('unknown trackId');
    }
  }

  /**
   * Deliver the browser callback out-of-band.
   *
   * The fake's payment page redirects the browser, which no in-process suite can
   * follow. This posts the same query string to the stored `callbackUrl` over
   * real HTTP, so the backend's public callback route is still exercised as a
   * genuine HTTP request.
   */
  @Post(':trackId/callback')
  @HttpCode(204)
  async triggerCallback(@Param('trackId') trackId: string): Promise<void> {
    const tx = this.store.find(trackId);
    if (!tx) {
      throw new NotFoundException('unknown trackId');
    }
    if (!tx.callbackUrl) {
      throw new BadRequestException('transaction has no callbackUrl');
    }

    const separator = tx.callbackUrl.includes('?') ? '&' : '?';
    const success = tx.scenario === 'success' && tx.paid ? '1' : '0';
    const url = `${tx.callbackUrl}${separator}trackId=${encodeURIComponent(trackId)}&success=${success}`;

    this.store.recordCallbackAttempt(trackId);

    // `redirect: 'manual'`: the target answers with a 302 to the frontend's
    // result page, and the fake must not try to fetch that.
    const response = await fetch(url, { method: 'GET', redirect: 'manual' });
    if (response.status >= 500) {
      throw new BadRequestException(`callback target responded ${response.status}`);
    }
  }

  @Get(':trackId')
  inspect(@Param('trackId') trackId: string) {
    const tx = this.store.find(trackId);
    if (!tx) {
      throw new NotFoundException('unknown trackId');
    }
    return {
      trackId: tx.trackId,
      amountRial: tx.amountRial,
      scenario: tx.scenario,
      paid: tx.paid,
      verified: tx.verified,
      verifyCount: tx.verifyCount,
      orderId: tx.orderId,
      callbackUrl: tx.callbackUrl,
      description: tx.description,
    };
  }
}

@Controller('__test__')
export class FakeZibalResetController {
  constructor(private readonly store: FakeZibalStore) {}

  @Post('reset')
  @HttpCode(204)
  reset(): void {
    this.store.reset();
  }
}
