# @liteimport/flashpay

FlashPay payment gateway integration for Thailand PromptPay QR payments, mobile banking deep links, and payouts.

## Installation

```bash
pnpm add @liteimport/flashpay
```

## Configuration

```typescript
import { createFlashPayClient, type FlashPayConfig } from '@liteimport/flashpay';

const config: FlashPayConfig = {
  apiEndpoint: 'https://pay-openapi.flashfin.com',
  appKey: 'your-app-key',
  merchantPrivateKey: 'your-rsa-private-key', // Without PEM headers, or full PEM format
  flashPayPublicKey: 'flashpay-public-key',   // For verifying webhook signatures
  notifyUrl: 'https://your-domain.com/api/webhook/flashpay',
  returnUrl: 'https://your-domain.com/payment/complete', // Optional, for app payments
};

const client = createFlashPayClient(config);
```

## API Reference

### Create PromptPay QR Payment

Generate a PromptPay QR code for customers to scan and pay.

```typescript
const response = await client.createQRPayment({
  outUserId: 'customer-id',      // Max 32 chars, no special characters
  outTradeNo: 'order-12345',     // Your unique order ID, max 32 chars
  paymentAmount: 10000,          // Amount in smallest unit (10000 = 100.00 THB)
  currencyCode: 'THB',           // THB, MYR, or PHP
  subject: 'Order #12345',       // Payment description
  body: 'Optional details',      // Optional
  expireTime: '2024-12-31 23:59:59', // Optional, defaults to 24 hours
});

// Response
{
  tradeNo: 'FP123456789',        // FlashPay's trade number
  outTradeNo: 'order-12345',     // Your order ID
  qrImage: 'base64-encoded-png', // QR code image
  qrRawData: '00020101...',      // Raw PromptPay data
}
```

### Create Mobile Banking Deep Link

Generate a deep link for mobile banking apps.

```typescript
import { THBankCode } from '@liteimport/flashpay';

const response = await client.createAppPayment({
  outTradeNo: 'order-12345',
  paymentAmount: 10000,
  currencyCode: 'THB',
  subject: 'Order #12345',
  bankCode: THBankCode.KBANK, // See bank codes below
});

// Response
{
  tradeNo: 'FP123456789',
  outTradeNo: 'order-12345',
  deeplinkUrl: 'kplus://...',    // Open in mobile banking app
}
```

### Query Payment Status

Check the status of a payment.

```typescript
const result = await client.queryPaymentResult({
  tradeNo: 'FP123456789',        // FlashPay's trade number
  // OR
  outTradeNo: 'order-12345',     // Your order ID
});

// Response
{
  outTradeNo: 'order-12345',
  tradeNo: 'FP123456789',
  tradeStatus: 3,                // See status codes below
  tradeTime: '2024-01-15 10:30:00',
  paymentAmount: 10000,
  currencyCode: 'THB',
  completeTime: '2024-01-15 10:31:00',
}
```

**Trade Status Codes:**
| Code | Status |
|------|--------|
| 0 | Pending |
| 2 | Processing |
| 3 | Success |
| 4 | Failed |
| 5 | Closed |

### Payout to Bank Account

Transfer funds to a bank account.

```typescript
const result = await client.payoutToBankAccount({
  outTradeNo: 'payout-12345',
  amount: 50000,                 // 500.00 THB
  currencyCode: 'THB',
  subject: 'Refund for order #12345',
  payeeAccountNo: '1234567890',
  payeeBankCode: THBankCode.KBANK,
  payeeAccountName: 'John Doe',  // Optional
  payeeAccountMobile: '0812345678', // Optional
  notes: 'Refund',               // Optional
});

// Response
{
  tradeNo: 'FP987654321',
}
```

### Handle Webhook Notifications

Verify and process payment notifications from FlashPay.

```typescript
import type { NotificationPayload } from '@liteimport/flashpay';

// In your webhook handler
async function handleWebhook(payload: NotificationPayload) {
  const result = await client.handleNotification(payload);

  if (result.success) {
    // Payment successful
    console.log(`Payment ${result.outTradeNo} completed`);
  } else {
    // Payment failed
    console.log(`Payment ${result.outTradeNo} failed`);
  }

  return { success: true };
}
```

**Notification Payload Structure:**
```typescript
{
  appKey: 'your-app-key',
  charset: 'UTF-8',
  time: '2024-01-15 10:31:00',
  version: '1.0',
  data: {
    outTradeNo: 'order-12345',
    tradeNo: 'FP123456789',
    tradeStatus: 3,              // 3 = success, 4 = failed
    paymentAmount: 10000,
    cur: 'THB',
  },
  sign: 'base64-signature',
  signType: 'RSA2',
}
```

## Thai Bank Codes

```typescript
import { THBankCode } from '@liteimport/flashpay';

THBankCode.BBL    // '002' - Bangkok Bank
THBankCode.KBANK  // '004' - Kasikorn Bank
THBankCode.KTB    // '006' - Krung Thai Bank
THBankCode.TMB    // '011' - TMBThanachart Bank
THBankCode.SCB    // '014' - Siam Commercial Bank
THBankCode.UOBT   // '024' - UOB Thailand
THBankCode.BAY    // '025' - Bank of Ayudhya (Krungsri)
THBankCode.GSB    // '030' - Government Savings Bank
```

## Type Exports

```typescript
import {
  // Classes
  FlashPayClient,

  // Factory function
  createFlashPayClient,

  // Enums
  THBankCode,

  // Types
  type FlashPayConfig,
  type CreateQRPaymentParams,
  type QRPaymentResponse,
  type CreateAppPaymentParams,
  type AppPaymentResponse,
  type PayoutParams,
  type NotificationPayload,
  type NotificationResult,
} from '@liteimport/flashpay';
```

## Error Handling

The client throws errors for API failures and invalid signatures:

```typescript
try {
  const response = await client.createQRPayment(params);
} catch (error) {
  if (error.message.includes('FlashPay API error')) {
    // API returned an error code
    console.error('API error:', error.message);
  } else if (error.message.includes('Invalid notification signature')) {
    // Webhook signature verification failed
    console.error('Invalid signature');
  }
}
```

## Security Notes

- Store your `merchantPrivateKey` securely (environment variables, secrets manager)
- Always verify webhook signatures before processing payments
- Use HTTPS for your `notifyUrl` endpoint
- The client uses RSA-SHA256 for signing requests and verifying responses
