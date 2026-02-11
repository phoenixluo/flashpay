"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlashPayClient = exports.THBankCode = void 0;
exports.createFlashPayClient = createFlashPayClient;
const date_fns_1 = require("date-fns");
/**
 * Convert a PEM-encoded key to an ArrayBuffer
 */
function pemToArrayBuffer(pem) {
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
async function importPrivateKey(pem) {
    const keyData = pemToArrayBuffer(pem);
    return crypto.subtle.importKey('pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
/**
 * Import an SPKI public key for verification
 */
async function importPublicKey(pem) {
    const keyData = pemToArrayBuffer(pem);
    return crypto.subtle.importKey('spki', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}
// Bank codes for Thailand
var THBankCode;
(function (THBankCode) {
    THBankCode["BBL"] = "002";
    THBankCode["KTB"] = "006";
    THBankCode["TMB"] = "011";
    THBankCode["UOBT"] = "024";
    THBankCode["BAY"] = "025";
    THBankCode["GSB"] = "030";
    THBankCode["SCB"] = "014";
    THBankCode["KBANK"] = "004";
})(THBankCode || (exports.THBankCode = THBankCode = {}));
class FlashPayClient {
    constructor(config) {
        this.config = config;
    }
    /**
     * Get the private key in PEM format (PKCS#8)
     */
    getPrivateKeyPem() {
        const key = this.config.merchantPrivateKey;
        if (key.includes('-----BEGIN')) {
            return key;
        }
        return `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`;
    }
    /**
     * Get the public key in PEM format
     */
    getPublicKeyPem() {
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
    createDataForSignature(payload) {
        const clonedPayload = { ...payload };
        // Handle the 'data' field specially - serialize as sorted JSON
        if (payload.data && typeof payload.data === 'object') {
            const data = payload.data;
            // Remove empty values and sort
            const cleanedData = {};
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
    async generateSignature(payload) {
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
    async verifySignature(payload, signature) {
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
    async makeRequest(urlPath, data) {
        const payload = {
            appKey: this.config.appKey,
            charset: 'UTF-8',
            time: (0, date_fns_1.format)(new Date(), 'yyyy-MM-dd HH:mm:ss'),
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
        const result = (await response.json());
        if (result.code !== 0) {
            throw new Error(`FlashPay API error: ${result.message} (code: ${result.code})`);
        }
        return result.data;
    }
    /**
     * Create a PromptPay QR Code for payment
     */
    async createQRPayment(params) {
        const now = new Date();
        const data = {
            outUserId: params.outUserId,
            outTradeNo: params.outTradeNo,
            outTradeTime: (0, date_fns_1.format)(now, 'yyyy-MM-dd HH:mm:ss'),
            paymentAmount: params.paymentAmount,
            cur: params.currencyCode,
            subject: params.subject,
            notifyUrl: this.config.notifyUrl,
            expireTime: params.expireTime || (0, date_fns_1.format)((0, date_fns_1.addDays)(now, 1), 'yyyy-MM-dd HH:mm:ss'),
        };
        if (params.body) {
            data.body = params.body;
        }
        const result = await this.makeRequest('/upay/create-qrcode-payment', data);
        if (!result.qrImage) {
            throw new Error('Failed to create QR code: no qrImage in response');
        }
        return result;
    }
    /**
     * Create a mobile banking deep link payment
     */
    async createAppPayment(params) {
        const now = new Date();
        const data = {
            outTradeNo: params.outTradeNo,
            outTradeTime: (0, date_fns_1.format)(now, 'yyyy-MM-dd HH:mm:ss'),
            paymentAmount: params.paymentAmount,
            cur: params.currencyCode,
            subject: params.subject,
            notifyUrl: this.config.notifyUrl,
            returnUrl: this.config.returnUrl,
            bankCode: params.bankCode,
        };
        const result = await this.makeRequest('/upay/create-app-payment', data);
        if (!result.deeplinkUrl) {
            throw new Error('Failed to create deep link: no deeplinkUrl in response');
        }
        return result;
    }
    /**
     * Transfer funds to a bank account (payout)
     */
    async payoutToBankAccount(params) {
        const now = new Date();
        const data = {
            outTradeNo: params.outTradeNo,
            outTradeTime: (0, date_fns_1.format)(now, 'yyyy-MM-dd HH:mm:ss'),
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
        return this.makeRequest('/fund/trans/transfer', data);
    }
    /**
     * Query payment result from FlashPay
     * Can query by tradeNo (FlashPay's trade number) or outTradeNo (merchant's order number)
     */
    async queryPaymentResult(params) {
        if (!params.tradeNo && !params.outTradeNo) {
            throw new Error('Either tradeNo or outTradeNo is required');
        }
        const data = {};
        if (params.tradeNo) {
            data.tradeNo = params.tradeNo;
        }
        if (params.outTradeNo) {
            data.outTradeNo = params.outTradeNo;
        }
        const result = await this.makeRequest('/upay/get-payment-result', data);
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
    async handleNotification(notification) {
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
exports.FlashPayClient = FlashPayClient;
function createFlashPayClient(config) {
    return new FlashPayClient(config);
}
