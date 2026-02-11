import { format as formatDate, addDays } from 'date-fns';

/**
 * Convert a PEM-encoded key to an ArrayBuffer
 */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN.*-----/, '')
    .replace(/-----END.*-----/, '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Import a PKCS#8 private key for signing
 */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const keyData = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * Import an SPKI public key for verification
 */
async function importPublicKey(pem: string): Promise<CryptoKey> {
  const keyData = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    'spki',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

export interface FlashPayConfig {
  apiEndpoint: string; // e.g., 'https://pay-openapi.flashfin.com'
  appKey: string;
  merchantPrivateKey: string; // RSA private key (without PEM headers)
  flashPayPublicKey: string; // FlashPay's public key for verifying responses
  notifyUrl: string;
  returnUrl?: string;
}

export interface CreateQRPaymentParams {
  outUserId: string;
  outTradeNo: string;
  paymentAmount: number; // In smallest unit (e.g., 123 for 1.23 THB)
  currencyCode: string; // THB, MYR, PHP
  subject: string;
  body?: string;
  expireTime?: string; // yyyy-MM-dd HH:mm:ss format
}

export interface QRPaymentResponse {
  tradeNo: string;
  outTradeNo: string;
  qrImage: string; // Base64 encoded QR code image
  qrRawData: string;
}

export interface CreateAppPaymentParams {
  outTradeNo: string;
  paymentAmount: number;
  currencyCode: string;
  subject: string;
  bankCode: string; // Bank code for mobile banking
}

export interface AppPaymentResponse {
  tradeNo: string;
  outTradeNo: string;
  deeplinkUrl: string;
}

export interface PayoutParams {
  outTradeNo: string;
  amount: number;
  currencyCode: string;
  subject: string;
  payeeAccountNo: string;
  payeeBankCode: string;
  payeeAccountName?: string;
  payeeAccountMobile?: string;
  notes?: string;
}

export interface NotificationPayload {
  appKey: string;
  charset: string;
  time: string;
  version: string;
  data: {
    outTradeNo: string;
    tradeNo: string;
    tradeStatus: number; // 3 = success, 4 = failed
    paymentAmount: number;
    cur: string;
  };
  sign: string;
  signType: string;
}

export interface NotificationResult {
  outTradeNo: string;
  tradeNo: string;
  paymentAmount: number;
  currencyCode: string;
  success: boolean;
}

// Bank codes for Thailand
export enum THBankCode {
  BBL = '002',
  KTB = '006',
  TMB = '011',
  UOBT = '024',
  BAY = '025',
  GSB = '030',
  SCB = '014',
  KBANK = '004',
}

export class FlashPayClient {
  private config: FlashPayConfig;

  constructor(config: FlashPayConfig) {
    this.config = config;
  }

  /**
   * Get the private key in PEM format (PKCS#8)
   */
  private getPrivateKeyPem(): string {
    const key = this.config.merchantPrivateKey;
    if (key.includes('-----BEGIN')) {
      return key;
    }
    return `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`;
  }

  /**
   * Get the public key in PEM format
   */
  private getPublicKeyPem(): string {
    const key = this.config.flashPayPublicKey;
    if (key.includes('-----BEGIN')) {
      return key;
    }
    return `-----BEGIN PUBLIC KEY-----\n${key}\n-----END PUBLIC KEY-----`;
  }

  /**
   * Create the string to sign from payload
   * Format: key1=value1&key2=value2&... (sorted alphabetically)
   * The 'data' field is serialized as sorted JSON
   */
  private createDataForSignature(
    payload: Record<string, unknown>
  ): string {
    const clonedPayload: Record<string, unknown> = { ...payload };

    // Handle the 'data' field specially - serialize as sorted JSON
    if (payload.data && typeof payload.data === 'object') {
      const data = payload.data as Record<string, unknown>;
      // Remove empty values and sort
      const cleanedData: Record<string, unknown> = {};
      const sortedKeys = Object.keys(data).sort();
      for (const key of sortedKeys) {
        const value = data[key];
        if (value !== null && value !== undefined && value !== '') {
          cleanedData[key] = value;
        }
      }
      clonedPayload.data = JSON.stringify(cleanedData);
    }

    // Sort keys and create key=value pairs
    return Object.keys(clonedPayload)
      .sort()
      .map((key) => `${key}=${clonedPayload[key]}`)
      .join('&');
  }

  /**
   * Generate RSA-SHA256 signature using Web Crypto API
   */
  private async generateSignature(payload: Record<string, unknown>): Promise<string> {
    const stringToSign = this.createDataForSignature(payload);
    const privateKey = await importPrivateKey(this.getPrivateKeyPem());
    const encoder = new TextEncoder();
    const data = encoder.encode(stringToSign);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data);
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  /**
   * Verify RSA-SHA256 signature from FlashPay using Web Crypto API
   */
  private async verifySignature(
    payload: Record<string, unknown>,
    signature: string
  ): Promise<boolean> {
    const stringToVerify = this.createDataForSignature(payload);
    const publicKey = await importPublicKey(this.getPublicKeyPem());
    const encoder = new TextEncoder();
    const data = encoder.encode(stringToVerify);
    const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, sigBytes, data);
  }

  /**
   * Make a request to FlashPay API
   */
  private async makeRequest<T>(
    urlPath: string,
    data?: Record<string, unknown>
  ): Promise<T> {
    const payload: Record<string, unknown> = {
      appKey: this.config.appKey,
      charset: 'UTF-8',
      time: formatDate(new Date(), 'yyyy-MM-dd HH:mm:ss'),
      version: '1.0',
    };

    if (data) {
      payload.data = data;
    }

    const signature = await this.generateSignature(payload);
    payload.sign = signature;
    payload.signType = 'RSA2';

    const url = this.config.apiEndpoint + urlPath;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = (await response.json()) as {
      code: number;
      message: string;
      data?: T;
    };

    if (result.code !== 0) {
      throw new Error(`FlashPay API error: ${result.message} (code: ${result.code})`);
    }

    return result.data as T;
  }

  /**
   * Create a PromptPay QR Code for payment
   */
  async createQRPayment(params: CreateQRPaymentParams): Promise<QRPaymentResponse> {
    const now = new Date();
    const data: Record<string, unknown> = {
      outUserId: params.outUserId,
      outTradeNo: params.outTradeNo,
      outTradeTime: formatDate(now, 'yyyy-MM-dd HH:mm:ss'),
      paymentAmount: params.paymentAmount,
      cur: params.currencyCode,
      subject: params.subject,
      notifyUrl: this.config.notifyUrl,
      expireTime:
        params.expireTime || formatDate(addDays(now, 1), 'yyyy-MM-dd HH:mm:ss'),
    };

    if (params.body) {
      data.body = params.body;
    }

    const result = await this.makeRequest<{
      tradeNo: string;
      outTradeNo: string;
      qrImage: string;
      qrRawData: string;
    }>('/upay/create-qrcode-payment', data);

    if (!result.qrImage) {
      throw new Error('Failed to create QR code: no qrImage in response');
    }

    return result;
  }

  /**
   * Create a mobile banking deep link payment
   */
  async createAppPayment(params: CreateAppPaymentParams): Promise<AppPaymentResponse> {
    const now = new Date();
    const data: Record<string, unknown> = {
      outTradeNo: params.outTradeNo,
      outTradeTime: formatDate(now, 'yyyy-MM-dd HH:mm:ss'),
      paymentAmount: params.paymentAmount,
      cur: params.currencyCode,
      subject: params.subject,
      notifyUrl: this.config.notifyUrl,
      returnUrl: this.config.returnUrl,
      bankCode: params.bankCode,
    };

    const result = await this.makeRequest<{
      tradeNo: string;
      outTradeNo: string;
      deeplinkUrl: string;
    }>('/upay/create-app-payment', data);

    if (!result.deeplinkUrl) {
      throw new Error('Failed to create deep link: no deeplinkUrl in response');
    }

    return result;
  }

  /**
   * Transfer funds to a bank account (payout)
   */
  async payoutToBankAccount(params: PayoutParams): Promise<{ tradeNo: string }> {
    const now = new Date();
    const data: Record<string, unknown> = {
      outTradeNo: params.outTradeNo,
      outTradeTime: formatDate(now, 'yyyy-MM-dd HH:mm:ss'),
      amount: params.amount,
      cur: params.currencyCode,
      subject: params.subject,
      notifyUrl: this.config.notifyUrl,
      payeeAccountNo: params.payeeAccountNo,
      payeeBankCode: params.payeeBankCode,
      payeeAccountType: 1, // Bank account
      timeliness: 0, // Real-time
    };

    if (params.payeeAccountName) {
      data.payeeAccountName = params.payeeAccountName;
    }
    if (params.payeeAccountMobile) {
      data.payeeAccountMobile = params.payeeAccountMobile;
    }
    if (params.notes) {
      data.notes = params.notes;
    }

    return this.makeRequest<{ tradeNo: string }>('/fund/trans/transfer', data);
  }

  /**
   * Query payment result from FlashPay
   * Can query by tradeNo (FlashPay's trade number) or outTradeNo (merchant's order number)
   */
  async queryPaymentResult(params: { tradeNo?: string; outTradeNo?: string }): Promise<{
    outTradeNo: string;
    tradeNo: string;
    tradeStatus: number; // 0=pending, 2=processing, 3=success, 4=failed, 5=closed
    tradeTime: string;
    paymentAmount: number;
    currencyCode: string;
    completeTime?: string;
  }> {
    if (!params.tradeNo && !params.outTradeNo) {
      throw new Error('Either tradeNo or outTradeNo is required');
    }

    const data: Record<string, unknown> = {};
    if (params.tradeNo) {
      data.tradeNo = params.tradeNo;
    }
    if (params.outTradeNo) {
      data.outTradeNo = params.outTradeNo;
    }

    const result = await this.makeRequest<{
      outTradeNo: string;
      tradeNo: string;
      tradeStatus: number;
      tradeTime: string;
      paymentAmount: number;
      cur: string;
      completeTime?: string;
    }>('/upay/get-payment-result', data);

    return {
      outTradeNo: result.outTradeNo,
      tradeNo: result.tradeNo,
      tradeStatus: result.tradeStatus,
      tradeTime: result.tradeTime,
      paymentAmount: result.paymentAmount,
      currencyCode: result.cur,
      completeTime: result.completeTime,
    };
  }

  /**
   * Verify and parse a payment notification from FlashPay
   */
  async handleNotification(notification: NotificationPayload): Promise<NotificationResult> {
    const { appKey, charset, time, version, data, sign } = notification;

    // Verify signature
    const payloadToVerify = { appKey, charset, time, version, data };
    const isValid = await this.verifySignature(payloadToVerify, sign);

    if (!isValid) {
      throw new Error('Invalid notification signature');
    }

    // Check payment status (3 = success, 4 = failed)
    const success = data.tradeStatus === 3;

    return {
      outTradeNo: data.outTradeNo,
      tradeNo: data.tradeNo,
      paymentAmount: data.paymentAmount,
      currencyCode: data.cur,
      success,
    };
  }
}

export function createFlashPayClient(config: FlashPayConfig): FlashPayClient {
  return new FlashPayClient(config);
}
