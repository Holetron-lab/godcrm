// ADR-0011 · Phase C · SMS method plugin — stub.
//
// Real implementation requires an SMS gateway (e.g. Twilio, SMSC). Scheduled
// for Phase D. Until then, returns method_not_implemented so clients relying
// on SMS see a clean 501 rather than a hang.

export const smsMethod = {
  name: 'sms',
  async verify() {
    return {
      ok: false,
      code: 'method_not_implemented',
      message: 'SMS method is not yet implemented',
      status: 501,
    };
  },
};
