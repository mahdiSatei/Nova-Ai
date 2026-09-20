import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { FakeZibalStore } from './fake-zibal.store';

export const FAKE_ZIBAL_RESULTS = {
  SUCCESS: 100,
  ALREADY_VERIFIED: 201,
  NOT_PAID: 202,
  INVALID_TRACK_ID: 203,
  MALFORMED: -1,
  PROVIDER_UNAVAILABLE: 503,
  TRANSPORT_FAILURE: -2,
} as const;

export interface ZibalRequestBody {
  merchant?: string;
  amount?: number;
  orderId?: string;
  description?: string;
  callbackUrl?: string;
  mobile?: string;
}

/**
 * Zibal-compatible surface. Amounts are in **rial**, exactly like the real
 * gateway, so the backend adapter's Toman↔rial conversion is exercised for
 * real rather than being assumed.
 */
@Controller()
export class FakeZibalController {
  constructor(private readonly store: FakeZibalStore) {}

  // Zibal answers 200 with a `result` code even when it rejects the request,
  // so the HTTP status must not be Nest's POST default of 201.
  @Post('v1/request')
  @HttpCode(200)
  requestPayment(@Body() body: ZibalRequestBody) {
    const amount = body?.amount;
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
      return { result: -1, message: 'amount must be a positive integer in rial' };
    }

    const trackId = this.store.nextTrackId();
    this.store.create({
      trackId,
      amountRial: amount,
      orderId: body.orderId,
      description: body.description,
      callbackUrl: body.callbackUrl,
      scenario: 'success',
      paid: false,
      verified: false,
      verifyCount: 0,
    });

    return {
      result: 100,
      message: 'success',
      trackId,
    };
  }

  @Get('start/:trackId')
  @Header('Content-Type', 'text/html; charset=utf-8')
  paymentPage(@Param('trackId') trackId: string): string {
    const tx = this.store.find(trackId);
    if (!tx) {
      throw new HttpException('unknown trackId', HttpStatus.NOT_FOUND);
    }

    const amountToman = Math.floor(tx.amountRial / 10).toLocaleString('en-US');
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Fake Zibal</title>
  </head>
  <body>
    <h1>Fake Zibal payment</h1>
    <p>Order: ${tx.orderId ?? '-'}</p>
    <p>Amount: ${amountToman} Toman</p>
    <form method="post" action="/start/${trackId}/pay">
      <button type="submit" name="outcome" value="success" data-outcome="success">Pay</button>
      <button type="submit" name="outcome" value="cancel" data-outcome="cancel">Cancel</button>
    </form>
  </body>
</html>`;
  }

  @Post('v1/verify')
  @HttpCode(200)
  verify(@Body() body: { merchant?: string; trackId?: string }) {
    const trackId = body?.trackId;
    if (!trackId) {
      return { result: FAKE_ZIBAL_RESULTS.MALFORMED, message: 'trackId is required' };
    }

    const tx = this.store.find(trackId);
    if (!tx) {
      return { result: FAKE_ZIBAL_RESULTS.INVALID_TRACK_ID, message: 'invalid trackId' };
    }
    if (tx.verified) {
      return { result: FAKE_ZIBAL_RESULTS.ALREADY_VERIFIED, message: 'already verified' };
    }
    if (tx.scenario === 'verify_unavailable') {
      // A transport-level outage, reported the way an unreachable gateway is:
      // a 5xx, not a `result` code in a 200 body.
      throw new HttpException(
        { result: FAKE_ZIBAL_RESULTS.TRANSPORT_FAILURE, message: 'provider unavailable' },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    if (tx.scenario === 'timeout') {
      return {
        result: FAKE_ZIBAL_RESULTS.PROVIDER_UNAVAILABLE,
        message: 'provider unavailable',
      };
    }
    if (!tx.paid) {
      return { result: FAKE_ZIBAL_RESULTS.NOT_PAID, message: 'transaction not paid' };
    }

    const amount = tx.scenario === 'amount_mismatch' ? tx.amountRial + 10_000 : tx.amountRial;

    this.store.markVerified(trackId);

    return {
      result: FAKE_ZIBAL_RESULTS.SUCCESS,
      message: 'success',
      amount,
      cardNumber: '603799******1234',
      refNumber: String(9_000_000 + Number(trackId)),
      paidAt: new Date().toISOString(),
    };
  }

  @Post('start/:trackId/pay')
  decide(
    @Param('trackId') trackId: string,
    @Body() body: { outcome?: string },
    @Res() res: Response,
  ): void {
    const tx = this.store.find(trackId);
    if (!tx) {
      throw new HttpException('unknown trackId', HttpStatus.NOT_FOUND);
    }
    const outcome = body?.outcome;
    if (outcome !== 'success' && outcome !== 'cancel') {
      throw new HttpException('outcome must be success or cancel', HttpStatus.BAD_REQUEST);
    }
    if (!tx.callbackUrl) {
      throw new HttpException('transaction has no callbackUrl', HttpStatus.BAD_REQUEST);
    }

    // A configured failure scenario overrides the user's click, which is how the
    // backend's "provider says not paid" path gets exercised on demand. Only the
    // unpaid scenarios block payment: `timeout`, `verify_unavailable` and
    // `amount_mismatch` model gateway trouble on a transaction the user *did* pay.
    const unpaidByScenario = tx.scenario === 'fail' || tx.scenario === 'cancel';
    const paid = outcome === 'success' && !unpaidByScenario;
    this.store.markPaid(trackId, paid);

    const separator = tx.callbackUrl.includes('?') ? '&' : '?';
    const target = `${tx.callbackUrl}${separator}trackId=${encodeURIComponent(trackId)}&success=${
      paid ? '1' : '0'
    }`;
    res.redirect(HttpStatus.FOUND, target);
  }
}
