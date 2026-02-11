export interface FlashPayConfig {
    apiEndpoint: string;
    appKey: string;
    merchantPrivateKey: string;
    flashPayPublicKey: string;
    notifyUrl: string;
    returnUrl?: string;
}
export interface CreateQRPaymentParams {
    outUserId: string;
    outTradeNo: string;
    paymentAmount: number;
    currencyCode: string;
    subject: string;
    body?: string;
    expireTime?: string;
}
export interface QRPaymentResponse {
    tradeNo: string;
    outTradeNo: string;
    qrImage: string;
    qrRawData: string;
}
export interface CreateAppPaymentParams {
    outTradeNo: string;
    paymentAmount: number;
    currencyCode: string;
    subject: string;
    bankCode: string;
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
        tradeStatus: number;
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
export declare enum THBankCode {
    BBL = "002",
    KTB = "006",
    TMB = "011",
    UOBT = "024",
    BAY = "025",
    GSB = "030",
    SCB = "014",
    KBANK = "004"
}
export declare class FlashPayClient {
    private config;
    constructor(config: FlashPayConfig);
    /**
     * Get the private key in PEM format (PKCS#8)
     */
    private getPrivateKeyPem;
    /**
     * Get the public key in PEM format
     */
    private getPublicKeyPem;
    /**
     * Create the string to sign from payload
     * Format: key1=value1&key2=value2&... (sorted alphabetically)
     * The 'data' field is serialized as sorted JSON
     */
    private createDataForSignature;
    /**
     * Generate RSA-SHA256 signature using Web Crypto API
     */
    private generateSignature;
    /**
     * Verify RSA-SHA256 signature from FlashPay using Web Crypto API
     */
    private verifySignature;
    /**
     * Make a request to FlashPay API
     */
    private makeRequest;
    /**
     * Create a PromptPay QR Code for payment
     */
    createQRPayment(params: CreateQRPaymentParams): Promise<QRPaymentResponse>;
    /**
     * Create a mobile banking deep link payment
     */
    createAppPayment(params: CreateAppPaymentParams): Promise<AppPaymentResponse>;
    /**
     * Transfer funds to a bank account (payout)
     */
    payoutToBankAccount(params: PayoutParams): Promise<{
        tradeNo: string;
    }>;
    /**
     * Query payment result from FlashPay
     * Can query by tradeNo (FlashPay's trade number) or outTradeNo (merchant's order number)
     */
    queryPaymentResult(params: {
        tradeNo?: string;
        outTradeNo?: string;
    }): Promise<{
        outTradeNo: string;
        tradeNo: string;
        tradeStatus: number;
        tradeTime: string;
        paymentAmount: number;
        currencyCode: string;
        completeTime?: string;
    }>;
    /**
     * Verify and parse a payment notification from FlashPay
     */
    handleNotification(notification: NotificationPayload): Promise<NotificationResult>;
}
export declare function createFlashPayClient(config: FlashPayConfig): FlashPayClient;
//# sourceMappingURL=client.d.ts.map